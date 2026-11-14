import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {normalizeRecallRequest,normalizeRecallTime,isRecallRecordEligible} from '../lib/recall-request.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {parseAgentStep,createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {searchVerifiedPublicComments} from '../lib/recent-comments.mjs'

const NOW=Date.parse('2026-11-07T16:30:00Z'),TZ='America/Los_Angeles',OWNER='210228238',FRIEND='90001',BV='BV1SqHK6oE2i'
const timed={intent:'activity_recall',queries:['昨天做过什么'],time:{relative:'yesterday'}}
const conversations={intent:'conversation_recall',queries:['昨天聊的事情'],time:{relative:'yesterday'}}
const e=[
 {id:'watch-yesterday',summary:'昨晚挑选一条公开科普视频',kind:'watch',stage:'clear',at:'2026-11-07T07:20:00Z'},
 {id:'social-yesterday',summary:'和朋友聊过天气与散步',kind:'social',stage:'clear',at:'2026-11-06T09:20:00Z'},
 {id:'private-yesterday',summary:'私信 UID 90001 谈过一件生活小事',kind:'private-social',stage:'clear',at:'2026-11-06T14:00:00Z'},
 {id:'watch-today',summary:'刚刚挑选一条音乐视频',kind:'watch',stage:'clear',at:'2026-11-07T09:20:00Z'},
 {id:'old-semantic',summary:'上个月认真聊了职业规划',kind:'social',stage:'clear',at:'2026-10-03T12:00:00Z'},
 {id:'fuzzy-no-day',summary:'我隐约记得那次谈话',kind:'social',stage:'fuzzy',at:''},
]
const mem=[
 {id:'fact-created-yesterday',text:'以前计划学习吉他',createdAt:'2026-11-06T11:00:00Z',importance:1},
 {id:'fact-old-event',text:'过去某次和朋友讨论吉他',createdAt:'2026-11-06T11:00:00Z',occurredAt:'2026-10-09T00:00:00Z'},
 {id:'fact-event-yesterday',text:'已核实昨天买过笔记本',createdAt:'2026-11-07T11:00:00Z',occurredAt:'2026-11-06T11:00:00Z'},
]
const fakeConfig=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryEmbeddingEnabled:true,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:2200})
function fixture({semantic=async(q,rows)=>({ready:true,items:rows.map(x=>({id:x.id,score:.99}))}),records=e,memories=mem,now=()=>NOW}={}){
 const seen=[]
 const getEpisodeCandidates=({domain,role,actorUid,kinds,ids,limit}={})=>{
  let rows=records
  if(domain==='bili-life')rows=rows.filter(x=>['watch','social'].includes(x.kind))
  if(domain==='bili-dm')rows=role==='friend'&&actorUid===FRIEND?rows.filter(x=>x.kind==='private-social'):[]
  if(domain==='main-session')rows=records
  if(Array.isArray(kinds))rows=rows.filter(x=>kinds.includes(x.kind))
  if(Array.isArray(ids))rows=rows.filter(x=>ids.includes(x.id))
  return rows.slice(0,limit||3200)
 }
 const retriever=createMemoryRetriever({getMemories:()=>memories,getConfig:fakeConfig,getEpisodeCandidates,
  getEpisodes:()=>[],semanticSearch:async(q,candidates,o)=>{seen.push(candidates.map(x=>x.id));return semantic(q,candidates,o)},
  now,getTimeZone:()=>TZ,getAccount:()=>({activeUid:'999',oldUids:[]})})
 return {retriever,seen,getEpisodeCandidates}
}

test('用户时区决定昨天边界，夏令时当天可以是 23 小时',()=>{
 const yesterday=normalizeRecallTime({relative:'yesterday'},{now:NOW,timeZone:TZ})
 assert.equal(new Date(yesterday.start).toISOString(),'2026-11-06T08:00:00.000Z')
 assert.equal(new Date(yesterday.end).toISOString(),'2026-11-07T08:00:00.000Z')
 const spring=normalizeRecallTime({day:'2026-03-08'},{timeZone:TZ})
 assert.equal(spring.end-spring.start,23*60*60*1000)
 const autumn=normalizeRecallTime({day:'2026-11-01'},{timeZone:TZ})
 assert.equal(autumn.end-autumn.start,25*60*60*1000)
})
test('输入结构必须白名单化，不能用模型参数冒充角色或选择本地时区',()=>{
 const r=normalizeRecallRequest({...timed,role:'owner',actorUid:OWNER,timeZone:'Asia/Tokyo',kinds:['watch','private-social','external-archive','watch']},{now:NOW,timeZone:TZ})
 assert.deepEqual(r.kinds,['watch','private-social'])
 assert.equal(r.time.timeZone,TZ)
 assert.equal(r.actorUid,undefined);assert.equal(r.role,undefined)
 assert.equal(normalizeRecallRequest({...timed,time:{relative:'tomorrow'}},{now:NOW,timeZone:TZ}),null)
 assert.equal(normalizeRecallRequest({...timed,time:{day:'2026-02-29'}},{now:NOW,timeZone:TZ}),null)
 assert.equal(normalizeRecallRequest({...timed,queries:[]},{now:NOW,timeZone:TZ}),null)
 assert.equal(normalizeRecallRequest({...timed,time:{fromDay:'2026-01-01',toDay:'2026-07-01'}},{now:NOW,timeZone:TZ}),null)
})
test('明确日期必须用发生时间，不能把录入日期、模糊记忆当成昨天发生',()=>{
 const r=normalizeRecallRequest({...timed,intent:'topic_recall'},{now:NOW,timeZone:TZ})
 assert.equal(isRecallRecordEligible(mem[0],r,{type:'memory'}),false)
 assert.equal(isRecallRecordEligible(mem[1],r,{type:'memory'}),false)
 assert.equal(isRecallRecordEligible(mem[2],r,{type:'memory'}),true)
 assert.equal(isRecallRecordEligible(e[5],r,{type:'episode'}),false)
 assert.equal(isRecallRecordEligible(e[0],r,{type:'episode'}),true)
 assert.equal(isRecallRecordEligible(e[3],r,{type:'episode'}),false)
})
test('主人昨天活动回顾能找到多类型事件，但不被上个月语义高分记录污染',async()=>{
 const {retriever,seen}=fixture()
 const r=await retriever.ownerSearchAsync(timed,{limit:6,beforeAt:NOW})
 assert.equal(r.ok,true)
 assert.deepEqual(r.items.map(x=>x.id),['episode:watch-yesterday','episode:private-yesterday','episode:social-yesterday'])
 assert.ok(!r.items.some(x=>x.id.includes('old-semantic')||x.id.includes('watch-today')))
 assert.equal(seen.length,0,'宽泛时间线无需向量推理')
})
test('昨天交谈先执行时间和类型硬过滤，之后才可执行语义召回',async()=>{
 const {retriever,seen}=fixture()
 const r=await retriever.ownerSearchAsync(conversations,{limit:6,beforeAt:NOW})
 assert.equal(r.ok,true)
 assert.ok(r.items.some(x=>x.id==='episode:social-yesterday'))
 assert.ok(!r.items.some(x=>x.id==='episode:watch-yesterday'))
 assert.ok(seen.length>0)
 assert.ok(seen.flat().every(id=>!id.includes('old-semantic')&&!id.includes('watch-today')&&!id.includes('fact-created-yesterday')))
})
test('向量不可用仍按日期回忆，不退回无日期约束的词法检索',async()=>{
 const {retriever}=fixture({semantic:async()=>{throw Error('offline')}})
 const r=await retriever.ownerSearchAsync(conversations,{limit:6,beforeAt:NOW})
 assert.equal(r.ok,true)
 assert.ok(r.items.length>0)
 assert.ok(r.items.every(x=>x.id==='episode:private-yesterday'||x.id==='episode:social-yesterday'))
})
test('异步向量返回前记忆已被删除，不得重新披露',async()=>{
 let records=[...e]
 const {retriever}=fixture({records,semantic:async(q,rows)=>{records.splice(0,records.length);return {ready:true,items:rows.map(x=>({id:x.id,score:1}))}}})
 const r=await retriever.ownerSearchAsync(conversations,{limit:6,beforeAt:NOW})
 assert.deepEqual(r.items,[])
})
test('主 Session 结构化时间检索不自动附加昨天以外的常驻身份事实',async()=>{
 const {retriever}=fixture()
 const r=await retriever.retrieve(timed,'chat')
 assert.match(r.context,/昨晚挑选/)
 assert.doesNotMatch(r.context,/吉他|职业规划|音乐视频/)
 assert.equal(r.usedModel,false)
})
test('公开评论时间召回仅返回当前 UID 可公开的事件，不包含私人经历',async()=>{
 const {retriever,seen}=fixture()
 const r=await retriever.socialContextAsync({...conversations,kinds:['social','private-social']},{actorUid:FRIEND,role:'friend',maxItems:6,maxChars:1200})
 assert.match(r,/朋友聊过天气/)
 assert.doesNotMatch(r,/私信 UID|上个月|音乐视频/)
 assert.ok(seen.flat().every(id=>!id.includes('private-yesterday')&&!id.includes('old-semantic')))
})
test('好友私信只检索同 UID 的昨天私有经历',async()=>{
 const {retriever}=fixture()
 const r=await retriever.privateContextAsync({uid:FRIEND,role:'friend',query:conversations})
 assert.match(r,/UID 90001/)
 const other=await retriever.privateContextAsync({uid:'123456',role:'friend',query:conversations})
 assert.equal(other,'')
})
test('主人私信的首次模型就能请求结构化时间回忆，普通回忆旧格式保持不变',()=>{
 const step=parseAgentStep({action:'memory_search',queries:['昨晚的经历'],recall:{intent:'activity_recall',time:{relative:'yesterday'},kinds:['watch']}})
 assert.equal(step.recallRequest?.intent,'activity_recall')
 assert.equal(step.recallRequest?.time?.relative,'yesterday')
 assert.deepEqual(parseAgentStep({action:'memory_search',queries:['散步']}).recallRequest,null)
})
test('compact 社交模型提供时间约束并原样交给有权限的统一装配器',async()=>{
 let requested=[],calls=0
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:async rows=>rows.map(()=>({availableContexts:['memory'],memoryContext:''})),
  loadRequestedContexts:async rows=>{requested=rows;return rows.map(()=>({memoryContext:'昨天确定发生的活动'}))},
  invoke:async()=>JSON.stringify({items:[{id:'0',action:++calls===1?'skip':'reply',reply:calls===1?'':'我记起来了。',
    ...(calls===1?{contextRequests:['memory'],recallQueries:['昨天生活活动'],recall:{intent:'activity_recall',time:{relative:'yesterday'}}}:{}),mood:'neutral',intensity:0}]})})
 assert.equal(await b.generate({kind:'dm',uid:FRIEND,text:'你昨天干了什么'}),'我记起来了。')
 b.stop()
 assert.equal(requested[0].recallRequest.intent,'activity_recall')
 assert.equal(requested[0].recallRequest.time.relative,'yesterday')
})
test('公开成功评论回执支持日期筛选，且不能从日期查询跳过账号切换围栏',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-dev25-comments-'))
 try{
  mkdirSync(join(dir,'seen'))
  writeFileSync(join(dir,'seen','2026-11.md'),`# 成功评论\n| ${BV} | 322275838160 | 0 | 2026-11-06T12:41:35-08:00 | 昨天谈到了雨后的天空。 |\n| ${BV} | 322275838161 | 0 | 2026-11-03 08:00:00 | 很久以前也谈到了雨后的天空。 |\n`)
  const result=searchVerifiedPublicComments(dir,{query:{intent:'conversation_recall',queries:['过去说过的话'],time:{relative:'yesterday'}},beforeAt:NOW})
  assert.equal(result.ok,true);assert.deepEqual(result.items.map(x=>x.id),[`public-comment:${BV}:322275838160`])
  // Same instant falls on Nov 6 in Los Angeles and Nov 7 in Shanghai.
  // Query timezone is supplied by trusted host options, never model text.
  const forShanghai=searchVerifiedPublicComments(dir,{query:{intent:'conversation_recall',queries:['过去说过的话'],time:{relative:'yesterday'},timeZone:'Pacific/Honolulu'},timeZone:'Asia/Shanghai',beforeAt:NOW})
  assert.deepEqual(forShanghai.items.map(x=>x.id),[`public-comment:${BV}:322275838160`])
  const forLosAngeles=searchVerifiedPublicComments(dir,{query:{intent:'conversation_recall',queries:['过去说过的话'],time:{relative:'yesterday'}},timeZone:TZ,beforeAt:NOW})
  assert.deepEqual(forLosAngeles.items.map(x=>x.id),[`public-comment:${BV}:322275838160`])
  const afterSwitch=searchVerifiedPublicComments(dir,{query:{intent:'conversation_recall',queries:['过去说过的话'],time:{relative:'yesterday'}},timeZone:'Asia/Shanghai',oldestAt:Date.parse('2026-11-06T22:00:00Z'),beforeAt:NOW})
  assert.deepEqual(afterSwitch.items,[],'offset conversion must not bypass account cutover')
  const cut=searchVerifiedPublicComments(dir,{query:{intent:'conversation_recall',queries:['过去说过的话'],time:{relative:'yesterday'}},oldestAt:Date.parse('2026-11-06T22:00:00Z'),beforeAt:NOW})
  assert.equal(cut.items.length,0)
  assert.equal(searchVerifiedPublicComments(dir,{query:{queries:['a'],time:{relative:'tomorrow'}},beforeAt:NOW}).ok,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('社交装配器携带时间请求时保持 UID 和公开渠道约束',async()=>{
 const policy={actor:uid=>({role:uid===FRIEND?'friend':'unverified'}),memoryScope:()=> 'public',canViewIdentity:()=>false,canViewRelationship:()=>false}
 const {retriever}=fixture()
 const a=createSocialContextAssembler({policy,memoryRetriever:retriever,getPrivateLifeContext:()=> '不应该出现的私有经历'})
 const r=await a.message({kind:'comment',uid:FRIEND,text:'你昨天做了什么',recallQueries:timed.queries,recallRequest:timed},{mode:'compact',requested:['memory']})
 assert.match(r.memoryContext,/昨晚挑选|朋友聊过天气/)
 assert.doesNotMatch(r.memoryContext,/私信 UID|不应该出现/)
})
