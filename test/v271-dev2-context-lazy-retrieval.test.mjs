import test from 'node:test'
import assert from 'node:assert/strict'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {createInteractionBatcher as createBaseInteractionBatcher} from '../lib/interaction-batch.mjs'
// Silence incidental batch diagnostics; tests assert outcomes rather than logger output.
const createInteractionBatcher=(options)=>createBaseInteractionBatcher({logger:{info(){},warn(){}},...options})

const answer=(extra={})=>JSON.stringify({items:[{id:'0',action:'reply',reply:'已核对',todoDisposition:'none',mood:'neutral',intensity:0,...extra}]})
const policy={actor:uid=>({role:uid==='0'?'unverified':uid==='1'?'owner':'friend'}),memoryScope:()=> 'public',
  canViewIdentity:()=>true,canViewRelationship:()=>true}
function harness({memoryFail=false}={}){
 const counts={memory:0,portrait:0,meme:0},queries=[]
 const assembler=createSocialContextAssembler({policy,
  memoryRetriever:{socialContext:(q,{actorUid})=>{counts.memory++;queries.push(actorUid);if(memoryFail)throw Error('injected');return `memory-${actorUid}`}},
  getMeme:async({uid})=>{counts.meme++;return `meme-${uid}`},
  getPortrait:uid=>{counts.portrait++;return `portrait-${uid}`},
  getIdentity:uid=>`identity-${uid}`,getRelationship:uid=>`relation-${uid}`,getPersona:()=>'',
  logger:{warn:()=>{}}})
 return {assembler,counts,queries}
}

test('精简首轮不执行记忆/梗/画像读取，能力清单不依赖已有命中',async()=>{
 const {assembler,counts}=harness()
 const r=await assembler.message({uid:'2',kind:'dm',text:'最近怎么样'},{mode:'compact'})
 assert.equal(r.ok,true)
 assert.equal(r.memoryContext,'');assert.equal(r.memeContext,'');assert.equal(r.portraitContext,'')
 assert.deepEqual(counts,{memory:0,portrait:0,meme:0})
 assert.ok(r.availableContexts.includes('memory'))
 assert.ok(r.availableContexts.includes('portrait'))
 assert.equal(r.identityContext,'identity-2')
})

test('仅模型请求的记忆与画像触发本UID读取，梗仍不查询',async()=>{
 const {assembler,counts,queries}=harness()
 const r=await assembler.message({uid:'2',kind:'dm',text:'我们以前聊过什么',recallQueries:['过去的聊天经历']},{mode:'compact',requested:['memory','portrait']})
 assert.equal(r.memoryContext,'memory-2');assert.equal(r.portraitContext,'portrait-2')
 assert.equal(r.memeContext,'')
 assert.deepEqual(counts,{memory:1,portrait:1,meme:0});assert.deepEqual(queries,['2'])
})

test('完整模式保持原始检索行为；未认证账号不得读取内容',async()=>{
 const {assembler,counts}=harness()
 const full=await assembler.message({uid:'2',kind:'dm',text:'嗯'},{mode:'full'})
 assert.equal(full.memoryContext,'memory-2')
 assert.equal(full.memeContext,'meme-2')
 assert.equal(full.portraitContext,'portrait-2')
 assert.deepEqual(counts,{memory:1,portrait:1,meme:1})
 const blocked=await assembler.message({uid:'0',kind:'dm',text:'嗯'},{mode:'compact',requested:['memory','portrait','meme']})
 assert.equal(blocked.ok,false)
 assert.deepEqual(counts,{memory:1,portrait:1,meme:1})
})

test('批处理：没有扩展只调一次模型，不访问三种检索器',async()=>{
 const {assembler,counts}=harness();let calls=0
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:(rows,options)=>assembler.batch(rows,options),
  loadRequestedContexts:(rows,requestedByIndex)=>assembler.batch(rows,{mode:'compact',requestedByIndex}),
  invoke:async()=>{calls++;return answer()}})
 assert.equal(await b.generate({uid:'2',kind:'dm',text:'你好'}),'已核对');b.stop()
 assert.equal(calls,1);assert.deepEqual(counts,{memory:0,portrait:0,meme:0})
})

test('批处理：模型请求时仅触发当前 UID 的真实只读检索，缺失其他上下文不影响',async()=>{
 const {assembler,counts}=harness();const prompts=[]
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:(rows,options)=>assembler.batch(rows,options),
  loadRequestedContexts:(rows,requestedByIndex)=>assembler.batch(rows,{mode:'compact',requestedByIndex}),
  invoke:async prompt=>{prompts.push(prompt);return prompts.length===1?answer({action:'skip',reply:'',contextRequests:['memory','portrait'],recallQueries:['以前相处经历']}):answer({reply:'确认'})}})
 assert.equal(await b.generate({uid:'2',kind:'dm',text:'你还记得吗'}),'确认');b.stop()
 assert.equal(prompts.length,2)
 assert.doesNotMatch(prompts[0],/memory-2|portrait-2|meme-2/)
 assert.match(prompts[1],/memory-2|portrait-2/)
 assert.doesNotMatch(prompts[1],/meme-2/)
 assert.deepEqual(counts,{memory:1,portrait:1,meme:0})
})

test('按需检索失败不向用户发半成品，也不能伪装为没有记忆',async()=>{
 const {assembler}=harness({memoryFail:true});let calls=0
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:(rows,options)=>assembler.batch(rows,options),
  loadRequestedContexts:(rows,requestedByIndex)=>assembler.batch(rows,{mode:'compact',requestedByIndex}),
  invoke:async()=>{calls++;return answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['过往经历']})},logger:{warn:()=>{}}})
 await assert.rejects(b.generate({uid:'2',kind:'dm',text:'你好'}),/未形成编号/)
 assert.equal(calls,1);b.stop()
})


test('检索无命中会告诉模型 not-found，不虚构已找到的历史',async()=>{
 const h=harness();h.assembler // use a separate retriever returning an empty result
 const a=createSocialContextAssembler({policy,memoryRetriever:{socialContext:()=>''},getMeme:async()=>'',getPortrait:()=>'',getIdentity:()=>'',getRelationship:()=>''})
 const seen=[];const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:(rows,o)=>a.batch(rows,o),loadRequestedContexts:(rows,req)=>a.batch(rows,{mode:'compact',requestedByIndex:req}),
  invoke:async prompt=>{seen.push(prompt);return seen.length===1?answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['过往经历']}):answer({reply:'我暂时找不到可靠记录'})}})
 assert.equal(await b.generate({uid:'2',kind:'dm',text:'还记得吗'}),'我暂时找不到可靠记录')
 assert.match(seen[1],/not-found/);b.stop()
})

test('诊断只有请求种类和结果，不记录 uid/正文/回忆文本',async()=>{
 const h=harness();let count=0;let report
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:(rows,o)=>h.assembler.batch(rows,o),loadRequestedContexts:(rows,req)=>h.assembler.batch(rows,{mode:'compact',requestedByIndex:req}),
  onContextUsage:e=>report=e,invoke:async()=>++count===1?answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['过往经历']}):answer()})
 assert.equal(await b.generate({uid:'2',kind:'dm',text:'测试敏感口令12345678'}),'已核对')
 assert.deepEqual(report.requestedKinds,['memory']);assert.deepEqual(report.foundKinds,['memory'])
 assert.equal(report.actualLazyReads,1);assert.equal(report.continued,true)
 assert.doesNotMatch(JSON.stringify(report),/memory-2|测试敏感|12345678|\"uid\"/);b.stop()
})
