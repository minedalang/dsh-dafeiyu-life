import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionMessageBurstController } from '../lib/message-burst.mjs'
import { createLifeReflection } from '../lib/life-reflection.mjs'
import { videoFunnelReport } from '../lib/video-round-funnel.mjs'
import { continuationPrompt } from '../lib/life-continuation.mjs'

function fakeAgent(){
  const events=new Map(),steered=[],followups=[],cancels=[]
  const inbox={nextStep:[],nextTurn:[],remove(id){this.nextStep=this.nextStep.filter(x=>x.id!==id);this.nextTurn=this.nextTurn.filter(x=>x.id!==id)}}
  const agent={inbox,status:'running',steer(m){steered.push(m);inbox.nextStep.push(m)},followup(m){followups.push(m);inbox.nextTurn.push(m)},
    cancel:(...x)=>cancels.push(x),ctx:{on(name,fn){events.set(name,[...(events.get(name)||[]),fn]);return ()=>events.set(name,(events.get(name)||[]).filter(f=>f!==fn))}}}
  const emit=(name,...args)=>{for(const fn of events.get(name)||[])fn(...args)}
  const claim=(m,turn)=>{inbox.remove(m.id);emit('agent/inbox/claimed',{message:m,turn})}
  return {agent,emit,claim,steered,followups,cancels}
}

test('main Session sends only model-authored independent bubbles and never rethinks on delivery alone',()=>{
  const h=fakeAgent(),c=createSessionMessageBurstController({agent:h.agent,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:11}})
  assert.deepEqual(c.start(['今天看到了一段好视频。','里面的想法让我想起昨天的聊天。']),{ok:true,queued:2})
  assert.equal(h.followups.length,0)
  h.claim(h.steered[0],11)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:11,message:{content:[{type:'text',text:'今天看到了一段好视频。'}]}}})
  h.emit('agent/turn-stopping',{turn:11,signal:new AbortController().signal})
  assert.equal(h.followups.length,1)
  assert.match(h.followups[0].content[0].text,/里面的想法让我想起昨天的聊天/)
  h.emit('session/event',null,{type:'turn/end',data:{turn:11}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:12}})
  h.claim(h.followups[0],12)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:12,message:{content:[{type:'text',text:'里面的想法让我想起昨天的聊天。'}]}}})
  h.emit('agent/turn-stopping',{turn:12,signal:new AbortController().signal})
  assert.equal(h.followups.length,1,'receipt alone cannot trigger speculative third bubble')
  assert.deepEqual(c.status(),{active:false})
  c.dispose()
})

test('a single message stays a normal reply; old afterReceipt does not force speculative continuation',()=>{
  const h=fakeAgent(),c=createSessionMessageBurstController({agent:h.agent,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:2}})
  assert.deepEqual(c.start(['只说一句'],{afterReceipt:true}),{ok:false,reason:'use-ordinary-single-reply'})
  assert.equal(h.steered.length,0)
  assert.equal(h.followups.length,0)
  c.dispose()
})

test('new owner message cancels remaining model-authored bubbles, but not the owner input',()=>{
  const h=fakeAgent(),c=createSessionMessageBurstController({agent:h.agent,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:4}})
  c.start(['第一句','第二句']);h.claim(h.steered[0],4)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:4,message:{content:[{type:'text',text:'第一句'}]}}})
  h.emit('agent/turn-stopping',{turn:4,signal:new AbortController().signal})
  assert.equal(h.followups.length,1)
  h.emit('agent/inbox/inserted',{message:{id:'new',role:'user',source:{kind:'user'}}})
  assert.equal(h.agent.inbox.nextTurn.length,0)
  assert.deepEqual(c.status(),{active:false})
  assert.equal(h.cancels.length,1)
  assert.deepEqual(h.cancels[0][1],{keepInbox:true})
  c.dispose()
})

test('video round report does not describe unused reference budgets as deficits',()=>{
  const text=videoFunnelReport({searches:0,homeReads:1,candidates:3,metadataVerified:2,contentRead:1,selected:0,heatInsufficient:0,skipped:2,duplicate:0,metadataFailed:0,toolErrors:0,notDeepRead:2,rows:[]},{targetRead:8,targetPick:4})
  assert.match(text,/参考范围/)
  assert.doesNotMatch(text,/目标尚有差额|提前结束须/)
})

test('verified account Episode context is available to the read-only decision without granting a write',()=>{
  const menu=[{id:'a'.repeat(24),action:'abandon_exploration'}]
  const prompt=continuationPrompt(menu,'',{ok:false,verifiedEpisodeContext:{bvid:'BV1abcde1234',title:'已核验标题',readCounts:{discussion:2}}})
  assert.match(prompt,/已核验标题/)
  assert.match(prompt,/不是新鲜写入授权/)
  assert.doesNotMatch(prompt,/选择写操作时 reason/)
})

const config={mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:4,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16}
const bvid=n=>'BV'+String(n).padStart(10,'0')
function reflectionHarness({invokeModel,commitMemories}={}){
  const dir=mkdtempSync(join(tmpdir(),'life-reflection-audit-'))
  const reflection=createLifeReflection({dataDir:dir,getConfig:()=>config,now:()=>Date.parse('2026-11-13T06:00:00Z'),
    invokeModel:invokeModel|| (async()=>JSON.stringify({memories:[]})),
    commitMemories:commitMemories|| (()=>({added:0,rows:[]})),
    memoryGateway:{reflectionEvidence:keys=>keys.map(key=>({key,text:'来自可衰减原始证据的真实资料'}))},logger:{warn(){}}})
  reflection.addEvents([1,2].map(n=>({kind:'watch',day:'2026-11-13',bvid:bvid(n),key:'watch:'+n,title:'公开作品'})))
  return {reflection,dispose:()=>rmSync(dir,{recursive:true,force:true})}
}

test('reflection reports model candidates, accepted proposals, duplicates and actual additions distinctly',async()=>{
  const proposed={candidate_ids:[],insight:'我发现一个值得长期记住的变化',behavior:'以后我会更加细心地了解',kind:'experience',importance:0.7}
  const h=reflectionHarness({invokeModel:async prompt=>{
    const ids=[...prompt.matchAll(/"id":"(c-[0-9a-f]+)"/g)].map(x=>x[1])
    return JSON.stringify({memories:[{...proposed,candidate_ids:[ids[0]]}]})
  },commitMemories:()=>({added:0,rows:[{id:'old',candidateIds:[],duplicate:true}]})})
  try{
    const result=await h.reflection.reflect({force:true})
    assert.equal(result.modelInput,2)
    assert.equal(result.memoryProposed,1)
    assert.equal(result.qualityAccepted,1)
    assert.equal(result.storageDuplicates,1)
    assert.equal(result.created,0)
    assert.equal(result.diagnosis,'duplicate-no-new-memory')
    const summary=h.reflection.status().recentRunSummary
    assert.equal(summary.storageDuplicates,1)
    assert.equal(summary.modelInput,2)
  }finally{h.dispose()}
})

test('reflection failures preserve stage codes and do not count as fish silence',async()=>{
  const h=reflectionHarness({invokeModel:async()=>{throw Error('model timed out')}})
  try{
    const r=await h.reflection.reflect({force:true})
    assert.equal(r.ok,false)
    assert.equal(r.failureCode,'reflection-model-failed')
    const summary=h.reflection.status().recentRunSummary
    assert.equal(summary.diagnosis,'technical-failure')
    assert.equal(summary.failureCode,'reflection-model-failed')
    assert.equal(summary.created,0)
  }finally{h.dispose()}
})

test('main Session tool asks for model-authored semantic bubbles without after-receipt prediction',()=>{
  const source=readFileSync(new URL('../lib/long-term-memory.mjs',import.meta.url),'utf8')
  assert.match(source,/对于有多个实际表达要点的回复/)
  assert.doesNotMatch(source,/after_receipt/)
})
