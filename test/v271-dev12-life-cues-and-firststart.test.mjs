import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const A='a'.repeat(16),B='b'.repeat(16),START=Date.parse('2026-11-07T07:00:00Z')
const cfg=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
  autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
const friendId='c'.repeat(24)
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'dev12-cues-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let at=START,account=A
 const events=()=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account,now:()=>at})
 const ref={id:friendId,eligible:true,outboundEnabled:false,stage:'known',ageHours:35}
 const make=(model,extra={})=>createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:cfg,getTodos:()=>[],getLifeAccountTag:()=>account,
 getLifeEvents:()=>events().peek(4),getLifeEventStatus:()=>events().status(),offerLifeWake:x=>events().offer(x),
 settleLifeEvents:(ids,why)=>events().settle(ids,why),recordLifeDecision:r=>events().recordDecision(r),
 getFriendInitiatives:()=>[ref],recordFriendInitiative:()=>({ok:true}),runFriendInitiative:async()=>{throw Error('must not send')},
 getLifeCapabilities:()=>[],invokeModel:async()=>JSON.stringify(model),getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true}),...extra})
 return {dir,events,make,ref,advance:ms=>at+=ms,account:x=>account=x}}

test('好友生活契机在无视频场景写入同一匿名事件账本，重启后可读，账号隔离',async t=>{
 const x=fixture(t),r=await x.make({action:'review_friend',id:friendId}).tick({force:true})
 assert.equal(r.action,'review_friend')
 const ledger=readFileSync(join(x.dir,'life-agent-events',A+'.json'),'utf8')
 assert.match(ledger,/friend-ready/)
 assert.equal(ledger.includes('好友'),false)
 assert.equal(ledger.includes(friendId),false,'opaque wake stores its digest not the source id')
 assert.equal(x.events().status().pendingLifeCues,0)
 x.account(B);assert.equal(x.events().status().pendingLifeCues,0)
 x.account(A);assert.equal(x.events().status().considered>0,true)
})

test('模型选另一个行动时好友契机延期可跨进程重建，不会自动发送',async t=>{
 const x=fixture(t);let calls=0
 const r=await x.make({action:'reflect',reason:'先整理一下'}, {reflectionStatus:()=>({pending:20}),reflect:async()=>{calls++;return {ok:true}}}).tick({force:true})
 assert.equal(r.action,'reflect')
 assert.equal(calls,1)
 assert.equal(x.events().status().waitingLifeCues>=1,true)
 assert.equal(x.events().peek(8).some(e=>e.kind==='friend-ready'),false)
 x.advance(31*60_000)
 const another=createLifeAgentEvents({stateDir:x.dir,getAccountTag:()=>A,now:()=>START+31*60_000})
 assert.equal(another.peek(8).some(e=>e.kind==='friend-ready'),true)
 assert.equal(another.status().pendingLifeCues>0,true)
})

test('现有跨进程事件账本对新契机去重并拒绝不合规来源',t=>{
 const x=fixture(t),events=x.events()
 const row={kind:'todo-ready',platform:'life',sourceKey:'task-12345678'}
 const one=events.offer(row),two=events.offer(row)
 assert.equal(one.created,true);assert.equal(two.created,false);assert.equal(one.id,two.id)
 assert.throws(()=>events.offer({kind:'friend-ready',platform:'life',sourceKey:''}),/Untrusted/)
 assert.throws(()=>events.offer({kind:'arbitrary-send',platform:'life',sourceKey:'12345678'}),/Untrusted/)
 const data=readFileSync(join(x.dir,'life-agent-events',A+'.json'),'utf8')
 assert.equal(data.includes('task-12345678'),false)
})

test('firststart 是同一流程：验证、卡片直存、可选会话和完成，旧控件 ID 不变',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../lib/first-start.mjs',import.meta.url),'utf8')
 const panel=html.slice(html.indexOf('<section id="panel-firststart"'),html.indexOf('<section id="panel-models"'))
 assert.equal((panel.match(/class="fs-journey"/g)||[]).length,1)
 assert.equal((panel.match(/class="fs-progress-step"/g)||[]).length,5)
 assert.ok(panel.indexOf('id="fs-verify-stage"')<panel.indexOf('id="fs-choices-stage"'))
 assert.ok(panel.indexOf('id="fs-choices-stage"')<panel.indexOf('id="fs-final-stage"'))
 for(const id of ['fs-bili-verify','fs-headless-state','quick-life-save','quick-memory-save','quick-dm-save','quick-share-save','fs-quick-ack','fs-complete'])assert.match(panel,new RegExp('id="'+id+'"'))
 assert.match(js,/fs-progress-hint/)
 assert.match(backend,/QUICK_SETUP_REVISION=4/)
})

test('多来源机会 first-pass 公平：同类多条不会完全掩盖其他生活来源',t=>{
 const x=fixture(t),e=x.events()
 for(let i=0;i<3;i++)e.offer({kind:'friend-ready',platform:'life',sourceKey:'friend-'+i})
 e.offer({kind:'todo-ready',platform:'life',sourceKey:'todo-123456'})
 e.offer({kind:'curiosity-ready',platform:'life',sourceKey:'interest-123456'})
 const seen=e.peek(3).map(x=>x.kind)
 assert.deepEqual(seen,['friend-ready','todo-ready','curiosity-ready'])
})

test('模型源 ID 含中文兴趣名称也只会进入摘要账本，不泄露主题文本',async t=>{
 const x=fixture(t)
 const rows=[{id:'interest:喜欢鲸鱼音乐',source:'interest-milestone',topic:'喜欢鲸鱼音乐',at:START}]
 const planner=x.make({action:'skip',reason:'今天休息'}, {getFriendInitiatives:()=>[],getLifeIntentionCues:()=>rows})
 await planner.tick({force:true})
 const file=readFileSync(join(x.dir,'life-agent-events',A+'.json'),'utf8')
 assert.match(file,/curiosity-ready/)
 assert.equal(file.includes('鲸鱼音乐'),false)
})
