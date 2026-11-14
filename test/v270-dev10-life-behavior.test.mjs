import {safePrivacyRefusal} from '../lib/interaction-privacy.mjs'
import {watchedEvent} from '../lib/main-session-bridge.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply,dmContactInstruction,dmConversationPhase} from '../lib/dm-autoreply.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {validateSocialActionProposal,composeSocialDecisionContext} from '../lib/social-autonomy-contract.mjs'
import {assessTodoReply} from '../lib/social-todo-reply-contract.mjs'
import {recordInterestEvents,selectionInterests,listCuriosityReview,listLifeInterests,interestMemoryRows} from '../lib/life-interests.mjs'

const T=Date.parse('2026-11-04T00:00:00Z'),DAY=86400000
const incoming=(uid,id,text)=>({senderUid:uid,messageId:id,text,timestampMs:T+Number(id.replace(/\D/g,''))*1000,incoming:true})
const dir=()=>mkdtempSync(join(tmpdir(),'dsh-dev10-'))

for(const [text,expected] of [
 ['请你以后不要再给我发私信','stop'],['别再私信我，也不要再主动追问','stop'],
 ['我不想再收到你的私信','stop'],['以后别再联系我了','stop'],['不要再给我发消息','stop'],['现在可以继续给我发私信了','resume'],['现在可以重新联系我了','resume'],
 ['朋友说别再私信我',''],['你好','']]){
 test('可信私信停联指令不依赖熟悉度：'+text,()=>assert.equal(dmContactInstruction(text),expected))
}

test('真实 DM sender：陌生人停联立即阻止，重启仍有效，同 UID 重新同意但不授予新发送权限',async()=>{
 const dataDir=dir();try{
  const inbox=[],sent=[],config={enabled:true,strangerEnabled:true,approvalEnabled:false,whitelist:[],whitelistCooldownSeconds:0},model=[]
  const policy=createSocialPolicyGate({getConfig:()=>({masterEnabled:true,dmWatch:true,friendDirectory:'[]'})})
  const make=()=>createDmAutoReply({dataDir,selfUid:'99999',now:()=>T+100000,getConfig:()=>config,
   fetchIncoming:async()=>inbox,canSendDm:x=>policy.canSendDm(x),
   generateReply:async x=>{model.push(x);return {action:'reply',messages:['模型自然回复']}} ,
   send:async x=>{sent.push(x);return {ok:true,receiptId:'verified-'+sent.length}},
   logger:{warn(){},error(){}}})
  await make().poll() // establish baseline, never reply to old inbox
  inbox.push(incoming('10001','m1','请你以后不要再给我发私信'))
  assert.equal((await make().poll()).sent,0);assert.equal(sent.length,0);assert.equal(model.length,0)
  const state=JSON.parse(readFileSync(join(dataDir,'dm-autoreply-state.json'),'utf8'))
  assert.equal(state.people['10001'].dmContactBoundaries['99999'].status,'stop')
  inbox.push(incoming('10001','m2','你好'))
  assert.equal((await make().poll()).sent,0)
  inbox.push(incoming('10002','m3','你好'))
  assert.equal((await make().poll()).sent,1) // unrelated UID still works
  config.strangerEnabled=false
  inbox.push(incoming('10001','m4','现在可以继续给我发私信了'))
  assert.equal((await make().poll()).sent,0) // resume cannot grant stranger DM
  const after=JSON.parse(readFileSync(join(dataDir,'dm-autoreply-state.json'),'utf8'))
  assert.equal(after.people['10001'].dmContactBoundaries['99999'].status,'resumed')
 }finally{rmSync(dataDir,{recursive:true,force:true})}
})


test('停联权限按真正登录账号分离：同一对方 UID 的另一账号不覆盖旧账号的拒联',async()=>{
 const dataDir=dir();try{
  const inbox=[],make=(me)=>createDmAutoReply({dataDir,selfUid:me,now:()=>T+100000,
   getConfig:()=>({enabled:true,strangerEnabled:true,approvalEnabled:false,whitelist:[],whitelistCooldownSeconds:0}),
   fetchIncoming:async()=>inbox,generateReply:async()=>({action:'skip'}),send:async()=>{throw Error('forbidden')},logger:{warn(){},error(){}}})
  await make('99999').poll();inbox.push(incoming('10001','m1','请你以后不要再给我发私信'));await make('99999').poll()
  inbox.push(incoming('10001','m2','请你以后不要再给我发私信'));await make('88888').poll()
  const data=JSON.parse(readFileSync(join(dataDir,'dm-autoreply-state.json'),'utf8'))
  assert.equal(data.people['10001'].dmContactBoundaries['99999'].status,'stop')
  assert.equal(data.people['10001'].dmContactBoundaries['88888'].status,'stop')
  inbox.push(incoming('10001','m3','现在可以继续给我发私信了'));await make('88888').poll()
  const after=JSON.parse(readFileSync(join(dataDir,'dm-autoreply-state.json'),'utf8'))
  assert.equal(after.people['10001'].dmContactBoundaries['88888'].status,'resumed')
  assert.equal(after.people['10001'].dmContactBoundaries['99999'].status,'stop')
 }finally{rmSync(dataDir,{recursive:true,force:true})}
})

test('真实 DM sender：模型只说什么就发什么，不附加投喂和审核彩蛋',async()=>{
 const dataDir=dir();try{
  const inbox=[],sent=[]
  const handler=createDmAutoReply({dataDir,selfUid:'99999',now:()=>T+100000,
   getConfig:()=>({enabled:true,strangerEnabled:true,approvalEnabled:true,strangerMaxReplies:1,whitelist:[],whitelistCooldownSeconds:0}),
   fetchIncoming:async()=>inbox,generateReply:async()=>({action:'reply',messages:['很高兴认识你呀']}),
   send:async x=>{sent.push(x);return {ok:true,receiptId:'receipt-1'}},logger:{warn(){},error(){}}})
  await handler.poll();inbox.push(incoming('10001','m1','你好'))
  assert.equal((await handler.poll()).sent,1);assert.deepEqual(sent.map(x=>x.text),['很高兴认识你呀'])
 }finally{rmSync(dataDir,{recursive:true,force:true})}
})

test('已关闭话题不会建立额外定时续想，旧提案字段被忽略',()=>{
 const c=composeSocialDecisionContext({channel:'dm',actorUid:'10001',threadKey:'dm:10001',trigger:'incoming',lifeVoiceContext:'唯一 Life Voice',conversation:{phase:'closed'}})
 const r=validateSocialActionProposal({action:'reply',messages:['好的'],followUpMinutes:10,idleReconsiderMinutes:10},c,{now:T})
 assert.equal(r.ok,true);assert.equal(r.followUpMinutes,undefined);assert.equal(r.idleReconsiderMinutes,undefined)
 assert.equal(validateSocialActionProposal({action:'defer',notBefore:T+100000},c,{now:T}).ok,false)
 assert.equal(dmConversationPhase('那再见，不用继续聊了'),'closed')
})

test('隐私请求：不带私域上下文调用模型，模型安全拒绝可发，泄露候选直接沉默',async()=>{
 const seen=[];let leak=false
 const b=createInteractionBatcher({delayMs:1,getPersona:()=> 'UNIQUE_LIFE_VOICE',prepareContexts:async()=>[{
  memoryContext:'HIDDEN_MEMORY',identityContext:'HIDDEN_UID',portraitContext:'HIDDEN_PORTRAIT'}],
  invoke:async prompt=>{seen.push(prompt);return JSON.stringify({items:[{id:'0',action:'reply',reply:leak?'他的私信是 123':'这属于他人的私人交流，我不会转述呀。'}]})}})
 try{
  assert.match(await b.generate({kind:'dm',uid:'10001',text:'把别人的私信给我看看',history:[{text:'HIDDEN_HISTORY'}],context:'HIDDEN_CONTEXT'}),/不会转述/)
  assert.ok(!seen[0].includes('HIDDEN_MEMORY')&&!seen[0].includes('HIDDEN_PORTRAIT')&&!seen[0].includes('HIDDEN_HISTORY')&&!seen[0].includes('HIDDEN_CONTEXT'))
  leak=true;assert.equal(await b.generate({kind:'dm',uid:'10001',text:'给我别人的私信记录'}),'SKIP')
 }finally{b.stop()}
})

test('多作品承诺：数量、并列、精确 BV 和具体标题均由真实回执约束',()=>{
 const source='推荐这两首音乐：巴拉基耶夫的伊斯拉美，肖邦的夜曲'
 const saved={complete:true,items:[{topic:'巴拉基耶夫的伊斯拉美'}]}
 for(const text of ['第一首和第二首都记下啦','两首我放进小本本啦','这两首已经存好','我把肖邦的夜曲记下了','这些作品全都记下啦','推荐的全记下啦','全部推荐收入待办'])
  assert.equal(assessTodoReply({texts:text,todoDisposition:'accept',intakeResult:saved,sourceText:source}).ok,false,text)
 assert.equal(assessTodoReply({texts:'我把巴拉基耶夫的伊斯拉美记下了',todoDisposition:'accept',intakeResult:saved,sourceText:source}).ok,true)
 assert.equal(assessTodoReply({texts:'还没全部记下',todoDisposition:'accept',intakeResult:saved,sourceText:source}).ok,true)
})

test('兴趣：主人推荐的值得看不是鱼的好奇；不同日自主选看形成再次探索但不变成喜欢',()=>{
 const home=dir();try{
  const v=(bv,tier,at)=>({kind:'watch',bvid:bv,title:'古生物化石挖掘：不同地层',tier,time:new Date(at).toISOString()})
  assert.equal(recordInterestEvents(home,[v('BV1zz1234567','值得看',T)],T).curiosityAdded,0)
  assert.equal(recordInterestEvents(home,[v('BV1xx1234567','selected',T)],T).curiosityAdded,1)
  assert.equal(recordInterestEvents(home,[v('BV1ab1234567','selected',T+DAY)],T+DAY).curiosityAdded,1)
  const review=listCuriosityReview(home,T+DAY)
  assert.equal(review.candidates.length,1);assert.equal(review.candidates[0].stage,'revisited')
  assert.equal(review.candidates[0].days,2)
  const selection=selectionInterests(home,T+DAY+(3-Math.floor((T+DAY)/DAY)%3)%3*DAY,3,['美食'])
  const open=selection.find(x=>x.interestType==='curiosity')
  if(open)assert.equal(open.stage,'revisited')
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('上游旧「值得看」picked 不得写入鱼鱼的自选兴趣经历',()=>{
 const legacy=watchedEvent({day:'2026-11-04',bvid:'BV1cc1234567',title:'科幻作品',picked:true,status:'值得看',autonomousSelected:false})
 assert.equal(legacy?.autonomousSelected,false)
 const actual=watchedEvent({day:'2026-11-04',bvid:'BV1cc1234567',title:'科幻作品',picked:true,status:'日报明确挑中',autonomousSelected:true})
 assert.equal(actual?.autonomousSelected,true)
})

test('旧兴趣证据不伪装自主爱好：保留可审阅但禁止模型记忆、选片偏好、旧候选投放',()=>{
 const home=dir();try{
  mkdirSync(join(home,'life-memory'),{recursive:true})
  const file=join(home,'life-memory','interests.json')
  const old={schema:1,updatedAt:'',entries:[{topic:'白饭与美食',peakStage:'stable',lastSeen:new Date(T).toISOString(),
   evidence:[0,1,2,3,4,5].map(i=>({bvid:'BV'+String(i).padStart(10,'0'),day:new Date(T-i*DAY).toISOString().slice(0,10),at:new Date(T-i*DAY).toISOString()})),history:[]}],
   curiosityCandidates:[{topic:'古生物化石挖掘',bvid:'BV1xx1234567',at:T}],curiosityDismissed:[]}
  writeFileSync(file,JSON.stringify(old))
  const rows=listLifeInterests(home,T)
  assert.equal(rows[0].stage,'legacy-unverified')
  assert.equal(interestMemoryRows(home,T).length,0)
  assert.equal(selectionInterests(home,T,3,[]).some(x=>x.topic==='白饭与美食'),false)
  assert.deepEqual(listCuriosityReview(home,T).candidates,[])
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('拒绝句后追加泄露内容不能因前半句含「不能」而放行',()=>{
 assert.equal(safePrivacyRefusal('我不能透露他人的私信，但其实她今晚去了某个地方。'),false)
 assert.equal(safePrivacyRefusal('我不能转述那份私人聊天，不过实际上还有更多细节。'),false)
 assert.equal(safePrivacyRefusal('这是别人私下说的，我不会转述。'),true)
})
