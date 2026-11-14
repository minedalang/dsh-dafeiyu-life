import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {continuationMenu,parseContinuationDecision} from '../lib/life-continuation.mjs'
import {createPrivateConversationExperiences} from '../lib/private-conversation-experiences.mjs'
import {publicPrivateDisclosureRisk} from '../lib/interaction-privacy.mjs'
const S='a'.repeat(16),BV='BV1abcde1234',ID='b'.repeat(24)
const cleanup=fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-bundle-'));return Promise.resolve(fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
const kind=a=>({like_video:'video_like',collect_video:'video_collect',follow_creator:'video_follow',comment_video:'video_comment'})[a]
const reason='鱼鱼确实因为已经核实的作品内容而想采取这项行动'
const menu=()=>continuationMenu({id:ID,status:'inspected',expiresAt:Date.now()+3600_000,
  episodeSteps:2,metadataAt:Date.now()-5000,selectedBvid:BV,selectedTitle:'已核验视频'},
  {at:Date.now(),writeActions:['like_video','collect_video','follow_creator','comment_video']})
test('同一次 Life 决策可以选择互不冲突的同 BV 写入；不同 BV、重复动作和不可信字段被拒绝',()=>{
 const m=menu()
 const row={action:'write_bundle',id:ID,bvid:BV,actions:[
  {action:'like_video',reason},{action:'comment_video',reason,text:'这段公开主题让我想聊聊'}]}
 const parsed=parseContinuationDecision(JSON.stringify(row),m)
 assert.equal(parsed.action,'write_bundle');assert.equal(parsed.actions.length,2)
 for(const bad of [
  {...row,bvid:'BV1abcde1235'},
  {...row,actions:[row.actions[0],row.actions[0]]},
  {...row,actions:[row.actions[0],{...row.actions[1],uid:'12345'}]},
  {...row,actions:[row.actions[0],{...row.actions[1],text:'我的私信密码是xxx'}]},
 ])assert.equal(parseContinuationDecision(JSON.stringify(bad),m).action,'stop')
})
test('一次父意愿中多个子动作按顺序逐个核验，重复、改评论正文和跨账号均拒绝',()=>cleanup(dir=>{
 let tag=S,invoked=0,notifications=[]
 const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>tag,getContext:()=>({voice:'鱼鱼'}),
  invokeModel:async()=>{invoked++;throw Error('不得额外投票')},onVerifiedAction:x=>notifications.push(x)})
 const approved=w.adoptVideoBundleDecision({sourceKey:'life-episode:bundle-test',actions:[
  {kind:'video_like',target:BV,commentText:''},{kind:'video_comment',target:BV,commentText:'真实公开评论'}]})
 assert.equal(approved.ok,true,approved.reason)
 const proof=approved.proof
 assert.equal(w.verify(proof,'video_comment',{target:BV,commentText:'真实公开评论'}).ok,false,'未先点赞不能越序评论')
 assert.equal(w.verify(proof,'video_like',{target:'BV1abcde1235',commentText:''}).ok,false)
 assert.equal(w.verify(proof,'video_like',{target:BV,commentText:''}).ok,true)
 assert.equal(w.verify(proof,'video_like',{target:BV,commentText:''}).ok,false)
 assert.equal(w.receipt(proof,{status:'verified',kind:'video_like',receiptId:'real-like-receipt'}).pending,true)
 assert.equal(w.verify(proof,'video_comment',{target:BV,commentText:'篡改的正文'}).ok,false)
 assert.equal(w.verify(proof,'video_comment',{target:BV,commentText:'真实公开评论'}).ok,true)
 assert.equal(w.receipt(proof,{status:'verified',kind:'video_comment',receiptId:'real-comment-receipt'}).result,'verified')
 assert.equal(w.verify(proof,'video_comment',{target:BV,commentText:'真实公开评论'}).ok,false)
 assert.equal(invoked,0);assert.equal(notifications.length,0,'子动作由视频桥直接记账，父意愿不能重复记成社交事件')
 tag='c'.repeat(16)
 assert.equal(w.verify(proof,'video_like',{target:BV,commentText:''}).ok,false)
}))
test('未知回执冻结整个组合，不允许后续子动作继续或重播',()=>cleanup(dir=>{
 const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>S,getContext:()=>({voice:'鱼鱼'}),invokeModel:async()=>''})
 const r=w.adoptVideoBundleDecision({sourceKey:'life-episode:bundle-unknown',actions:[
  {kind:'video_like',target:BV,commentText:''},{kind:'video_collect',target:BV,commentText:''}]})
 assert.equal(r.ok,true)
 assert.equal(w.verify(r.proof,'video_like',{target:BV,commentText:''}).ok,true)
 assert.equal(w.receipt(r.proof,{status:'uncertain',kind:'video_like'}).result,'uncertain')
 assert.equal(w.verify(r.proof,'video_collect',{target:BV,commentText:''}).ok,false)
 assert.equal(w.adoptVideoBundleDecision({sourceKey:'invalid-opposites',actions:[
  {kind:'video_follow',target:BV,commentText:''},{kind:'video_unfollow',target:BV,commentText:''}]}).ok,false)
}))
test('双实例同时整理同一私信片段，只会调用一次 AI',()=>cleanup(async dir=>{
 let runs=0,resolveModel
 const model=async prompt=>{runs++;return new Promise(res=>{resolveModel=()=>res('{"experiences":[]}')})}
 const config=()=>({mainSessionMemoryEnabled:true})
 let clock=1_800_000_000_000
 const args={dataDir:dir,getAccountTag:()=>S,getConfig:config,invokeModel:model,
  recordEvents:async()=>({ok:true}),now:()=>clock,logger:{warn(){}}}
 const a=createPrivateConversationExperiences(args),b=createPrivateConversationExperiences(args)
 await a.observe({uid:'12345',eventId:'first',text:'我们在聊一个有趣的视频',at:clock})
 await b.observe({uid:'12345',eventId:'second',direction:'outgoing',text:'我也对这个作品很感兴趣',at:clock+1})
 clock+=21*60_000
 const one=a.tick()
 for(let i=0;i<100&&!resolveModel;i++)await new Promise(res=>setTimeout(res,5))
 assert.equal(typeof resolveModel,'function')
 const two=await b.tick()
 assert.equal(two.processed,0);assert.equal(runs,1)
 resolveModel();const done=await one
 assert.equal(done.ok,true);assert.equal(done.processed,1)
 assert.equal(a.status().pendingSegments,0)
}))
test('跨渠道理解允许自然熟悉感，但阻止私信和私人独有细节被公开披露',()=>{
 assert.equal(publicPrivateDisclosureRisk('诶！怎么你也在这里哈哈', {privateContext:'我们平常开玩笑'}),false)
 assert.equal(publicPrivateDisclosureRisk('你最近那件事后来怎么样了',{privateContext:'最近聊过烦恼'}),true)
 assert.equal(publicPrivateDisclosureRisk('我们私信讨论过这件事',{privateContext:'以前聊过'}),true)
 assert.equal(publicPrivateDisclosureRisk('这款星空青柠奶昔真特别',{
   privateContext:'星空青柠奶昔是我们私下约定的话题',publicContext:'这是另一个公开视频'}),true)
 assert.equal(publicPrivateDisclosureRisk('这款星空青柠奶昔真特别',{
   privateContext:'星空青柠奶昔是我们私下约定的话题',publicContext:'视频标题是星空青柠奶昔'}),false)
})

test('同一父凭据通过真实 loopback 视频桥按两张一次性票据执行，不重复调用意愿模型',async t=>cleanup(async dir=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 let decisions=0,tag=S,completed=[]
 const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>tag,getContext:()=>({voice:'鱼鱼'}),invokeModel:async()=>{decisions++;throw Error('unexpected willingness')}})
 const bridge=createLifeVideoActionBridge({getAccountUid:()=> '1234567',getAccountTag:()=>tag,
  verify:(...a)=>w.verify(...a),receipt:(...a)=>w.receipt(...a),choose:async()=>{decisions++;throw Error('unexpected choose')},
  verifyPlatformState:async()=>true,onVerifiedAction:async row=>{completed.push(row);return {ok:true}}})
 await bridge.start();t.after(()=>bridge.stop())
 const sourceKey='life-episode:bridge-bundle',actions=[
  {kind:'video_like',target:BV,commentText:''},{kind:'video_collect',target:BV,commentText:''}]
 const p=w.adoptVideoBundleDecision({sourceKey,actions})
 assert.equal(p.ok,true,p.reason)
 const post=async(path,body)=>{const env=bridge.env();const r=await fetch(env.BILI_LIFE_ACTION_URL+path,
  {method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});return r.json()}
 for(let i=0;i<actions.length;i++){
  const child=actions[i]
  const registered=bridge.registerTrustedIntent({proof:p.proof,...child,scope:S,uid:'1234567'})
  assert.equal(registered.ok,true,registered.reason)
  const request={uid:'1234567',tool:i===0?'bili_video_like':'bili_video_collect',target:BV,intentTicket:registered.ticket}
  const grant=await post('/life-action',request)
  assert.equal(grant.ok,true,grant.reason)
  assert.equal((await post('/life-action',request)).ok,false)
  const result=await post('/life-action-result',{uid:'1234567',grant:grant.grant,ok:true,receiptId:'12345678'})
  assert.equal(result.status,'verified')
  assert.equal(completed.length,i+1)
 }
 assert.deepEqual(completed.map(x=>x.kind),['video_like','video_collect'])
 assert.equal(decisions,0)
}))

test('真正两个 Node 进程并发写入同一短期私信账本，消息不丢失也不合并身份',()=>cleanup(async dir=>{
 const {spawn}=await import('node:child_process')
 const moduleUrl=new URL('../lib/private-conversation-experiences.mjs',import.meta.url).href
 const script=`import {createPrivateConversationExperiences} from ${JSON.stringify(moduleUrl)};
 const dir=process.argv[1],which=process.argv[2];
 const w=createPrivateConversationExperiences({dataDir:dir,getAccountTag:()=>${JSON.stringify(S)},
 getConfig:()=>({mainSessionMemoryEnabled:true}),invokeModel:async()=>'{"experiences":[]}',recordEvents:async()=>({ok:true}),logger:{warn(){}}});
 for(let j=0;j<8;j++){const v=await w.observe({uid:which==='a'?'12345':'54321',eventId:which+'-'+j,
 text:'第'+j+'条真实聊天内容',at:Date.now()});if(v.ok!==true)throw Error('observe:'+v.reason)}
 process.stdout.write(String(w.status().pendingMessages));`
 const run=key=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script,dir,key],{stdio:['ignore','pipe','pipe']})
  let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x)
  child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(error||'process exited '+code)))
 })
 await Promise.all([run('a'),run('b')])
 const read=createPrivateConversationExperiences({dataDir:dir,getAccountTag:()=>S,
  getConfig:()=>({mainSessionMemoryEnabled:true}),invokeModel:async()=>'{"experiences":[]}',recordEvents:async()=>({ok:true})})
 assert.equal(read.status().pendingMessages,16)
}))
