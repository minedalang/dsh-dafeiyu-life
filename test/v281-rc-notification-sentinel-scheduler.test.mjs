import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'

const minute=60_000
const dmCounts=(followUnread=0)=>({followUnread,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0})
const socialCounts=(replyCount=0,atCount=0,likeCount=0)=>({mode:'split',replyCount,atCount,replyAtTotal:replyCount+atCount,likeCount})
const wait=()=>new Promise(resolve=>setTimeout(resolve,12))
function fixture({dmUnread=dmCounts(),socialUnread=socialCounts()}={}){
  const dir=mkdtempSync(join(tmpdir(),'bili-sentinel-scheduler-'));let now=1_800_000_000_000
  const counts=new Map(),lastReadAtByKind={}
  const budget={
    record(kind){counts.set(kind,(counts.get(kind)||0)+1);lastReadAtByKind[kind]=now},
    status(){return {blocked:false,retryAt:0,minuteLimit:30,hourLimit:450,minuteUsed:0,hourUsed:0,
      byKind:[...counts].map(([kind,hour])=>({kind,hour,minute:hour})),lastReadAtByKind:{...lastReadAtByKind},
      dmListIntervalMinutes:5,dmListNextAt:lastReadAtByKind['dm-list']?lastReadAtByKind['dm-list']+5*minute:0,
      dmUnreadNextAt:lastReadAtByKind['dm-unread']?lastReadAtByKind['dm-unread']+5*minute:0,
      socialUnreadNextAt:lastReadAtByKind['social-unread']?lastReadAtByKind['social-unread']+5*minute:0,socialEndpoints:{}}}
  }
  let dmValue=structuredClone(dmUnread),socialValue=structuredClone(socialUnread),continuationDue=false,needsBootstrap=false,fastUid=''
  const dmCalls=[],commentCalls=[]
  const dm={
    async poll(options={}){dmCalls.push({...options});if(options.fastUid||options.continuationOnly)budget.record('dm-messages');else budget.record('dm-list');return {ok:true,sent:0,failed:0,ignored:0,freshIncomingContacts:0}},
    nextFastUid(){const value=fastUid;fastUid='';return value||null},
    hasDueContinuation(){return continuationDue},
    async needsBootstrap(){return needsBootstrap},
    status(){return {fast:{enabled:true,activeCount:0,nextIntervalSeconds:60,baseIntervalSeconds:60,checks:0}}},
  }
  const comments={async poll(options={}){commentCalls.push({...options});if(options.notifications)budget.record('mcp:bili_received_replies');if(options.mentions)budget.record('mcp:bili_received_at_and_likes');return {sent:0,failed:0,ignored:0}}}
  const scheduler=createInteractionScheduler({dm,comments,readBudget:budget,dataDir:dir,getAccountTag:()=> '0123456789abcdef',
    readPrivateUnread:async()=>{budget.record('dm-unread');return structuredClone(dmValue)},
    readSocialUnread:async()=>{budget.record('social-unread');return structuredClone(socialValue)},
    getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:true,commentAtEnabled:true,
      dmActivePollEnabled:true,dmActivePollSeconds:60}),now:()=>now,logger:{error:()=>{}}})
  return {dir,scheduler,budget,dmCalls,commentCalls,advance(ms){now+=ms},setDm(v){dmValue=structuredClone(v)},setSocial(v){socialValue=structuredClone(v)},setContinuation(v){continuationDue=v},setNeedsBootstrap(v){needsBootstrap=v},setFast(v){fastUid=v}}
}

test('冷启动只建立两类计数基线并各做一次安全详情基线',async()=>{
  const f=fixture();try{f.scheduler.start();await wait()
    assert.equal(f.budget.status().lastReadAtByKind['dm-unread']>0,true)
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,1)
    assert.equal(f.budget.status().lastReadAtByKind['social-unread']||0,0)
    f.advance(15_001);await f.scheduler.tick()
    assert.equal(f.budget.status().lastReadAtByKind['social-unread']>0,true)
    assert.equal(f.commentCalls.length,1)
    assert.deepEqual(f.commentCalls[0],{notifications:true,mentions:true,top:false})
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('未读计数不变时不重复读取会话列表、评论回复或 @ 详情',async()=>{
  const f=fixture();try{
    f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const lists=f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,comments=f.commentCalls.length
    f.advance(5*minute);await f.scheduler.tick();f.advance(15_001);await f.scheduler.tick()
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,lists)
    assert.equal(f.commentCalls.length,comments)
    assert.equal(f.budget.status().byKind.find(x=>x.kind==='dm-unread').hour,2)
    assert.equal(f.budget.status().byKind.find(x=>x.kind==='social-unread').hour,2)
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('私信计数增加才触发会话列表；互动类别增加只读取对应详情',async()=>{
  const f=fixture();try{
    f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const beforeDm=f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length
    f.setDm(dmCounts(1));f.advance(5*minute);await f.scheduler.tick()
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,beforeDm+1)
    const beforeComments=f.commentCalls.length
    f.setSocial(socialCounts(1,0,0));f.advance(5*minute);await f.scheduler.tick()
    f.advance(15_001);await f.scheduler.tick()
    assert.equal(f.commentCalls.length,beforeComments+1)
    assert.deepEqual(f.commentCalls.at(-1),{notifications:true,mentions:false,top:false})
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('活跃私信定向检查与 Life 技术续办不触发全量会话列表',async()=>{
  const f=fixture();try{
    f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const listBefore=f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length
    f.setContinuation(true);await f.scheduler.tick()
    assert.equal(f.dmCalls.at(-1).continuationOnly,true)
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,listBefore)
    f.setContinuation(false);f.setFast('123456')
    await f.scheduler.tick()
    assert.equal(f.dmCalls.at(-1).fastUid,'123456')
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,listBefore)
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('哨兵读取失败时不会把计数当作零，也不会退回完整列表轮询',async()=>{
  const f=fixture();try{
    const scheduler=createInteractionScheduler({dm:{poll:async()=>{throw Error('should-not-run')},nextFastUid:()=>null,hasDueContinuation:()=>false},
      comments:{poll:async()=>{throw Error('should-not-run')}},readBudget:f.budget,dataDir:f.dir,getAccountTag:()=> '0123456789abcdef',
      readPrivateUnread:async()=>{f.budget.record('dm-unread');throw Error('HTTP 200 code=-509')},
      readSocialUnread:async()=>{f.budget.record('social-unread');throw Error('HTTP 200 code=-509')},
      getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:true,commentAtEnabled:true,dmActivePollEnabled:false}),
      now:()=>1_800_000_000_000,logger:{error:()=>{}}})
    scheduler.start();await wait();scheduler.stop()
    assert.equal(scheduler.status().sentinels.private.unread,null)
    assert.equal(scheduler.status().sentinels.private.pending,false)
    assert.equal(scheduler.status().checks.dm.lastResult,'error')
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('30 分钟一致性核对会在计数未变化时安排一次详情读取',async()=>{
  const f=fixture();try{f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const before=f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length
    f.advance(30*minute);await f.scheduler.tick()
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,before+1)
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('30 分钟一致性核对同时覆盖互动通知详情，即使两个哨兵计数未变化',async()=>{
  const f=fixture();try{f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const before=f.commentCalls.length
    f.advance(30*minute);await f.scheduler.tick()
    f.advance(15_001);await f.scheduler.tick()
    assert.equal(f.commentCalls.length,before+1)
    assert.deepEqual(f.commentCalls.at(-1),{notifications:true,mentions:true,top:false})
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('Life 手动检查复用最近哨兵快照，不绕过五分钟计数请求下限',async()=>{
  const f=fixture();try{f.scheduler.start();await wait();f.advance(15_001);await f.scheduler.tick()
    const beforeDm=f.budget.status().byKind.find(x=>x.kind==='dm-unread').hour
    const beforeSocial=f.budget.status().byKind.find(x=>x.kind==='social-unread').hour
    const result=await f.scheduler.checkNow()
    assert.equal(result.ok,true)
    assert.equal(f.budget.status().byKind.find(x=>x.kind==='dm-unread').hour,beforeDm)
    assert.equal(f.budget.status().byKind.find(x=>x.kind==='social-unread').hour,beforeSocial)
    assert.ok(result.sentinels.private)
    assert.ok(result.sentinels.interaction)
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('DM 收件箱账本缺失时，在有计数基线/待续办证据后重新建立安全基线',async()=>{
  const f=fixture();try{f.scheduler.start();await wait()
    const before=f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length
    f.setNeedsBootstrap(true);f.setContinuation(true);f.advance(5*minute);await f.scheduler.tick()
    assert.equal(f.dmCalls.filter(x=>!x.fastUid&&!x.continuationOnly).length,before+1)
    assert.equal(f.dmCalls.at(-1).continuationOnly,undefined)
  }finally{f.scheduler.stop();rmSync(f.dir,{recursive:true,force:true})}
})


test('协作模式和无效宿主策略禁止通知、详情、快速及手动哨兵派发；恢复不清空原快照',async()=>{
  const f=fixture();let policy={mode:'memory-foundation',revision:1},reads=0,details=0
  const s=createInteractionScheduler({dataDir:f.dir,getAccountTag:()=> '0123456789abcdef',
    getSessionIntegration:()=>policy,getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:true}),
    readPrivateUnread:async()=>{reads++;return dmCounts()},readSocialUnread:async()=>{reads++;return socialCounts()},
    dm:{poll:async()=>{details++;return {ok:true}},nextFastUid:()=> '123',hasDueContinuation:()=>true},
    comments:{poll:async()=>{details++;return {ok:true}}},logger:{error:()=>{}},now:()=>1_800_000_000_000})
  try{s.start();await s.tick();assert.equal((await s.checkNow()).skipped,'session-integration-paused')
    assert.equal(s.status().checks.dm.enabled,false);assert.equal(reads+details,0)
    policy={mode:'autonomous-life',revision:-1};await s.tick();assert.equal(reads+details,0)
    policy={mode:'autonomous-life',revision:2};await s.tick();assert.equal(reads,1);assert.ok(details>0)
    const snapshot=s.status().sentinels.private.unread;policy={mode:'memory-foundation',revision:3};await s.tick()
    assert.equal(s.status().sentinels.private.unread,snapshot)
  }finally{s.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('在途哨兵可结算真实计数，但切走再切回不允许旧轮派发详情',async()=>{
  const f=fixture();let policy={mode:'autonomous-life',revision:0},finish,reads=0,details=0
  const pending=new Promise(resolve=>{finish=resolve})
  const s=createInteractionScheduler({dataDir:f.dir,getAccountTag:()=> '0123456789abcdef',
    getSessionIntegration:()=>policy,getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:true}),
    readPrivateUnread:async()=>{reads++;return pending},readSocialUnread:async()=>{reads++;return socialCounts()},
    dm:{poll:async()=>{details++;return {ok:true}},nextFastUid:()=> '123'},comments:{poll:async()=>{details++;return {ok:true}}},
    logger:{error:()=>{}},now:()=>1_800_000_000_000})
  try{s.start();assert.equal(reads,1);policy={mode:'memory-foundation',revision:1};policy={mode:'autonomous-life',revision:2}
    finish(dmCounts(4));await wait();assert.equal(reads,1);assert.equal(details,0)
    assert.equal(s.status().sentinels.private.unread,4);assert.equal(s.status().sentinels.private.pending,true)
    await s.tick();assert.ok(details>0);assert.equal(reads,1)
  }finally{s.stop();rmSync(f.dir,{recursive:true,force:true})}
})

test('owner-only discovery waits for ordinary baseline and dispatches separately without changing the five-minute sentinel',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-priority-scheduler-'));let time=1_800_000_000_000,ownerReady=true,blocked=false;const calls=[];let unreadCalls=0;
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerPollEnabled:true,dmActivePollEnabled:false};
 const dm={poll:async args=>{calls.push(args||{});return {ok:true,sent:0}},pollOwner:async fastUid=>{calls.push({fastUid,ownerPriority:true});return {ok:true,sent:0}},nextOwnerUid:()=>ownerReady?'12345':'',nextFastUid:()=>'',status:()=>({ownerPriority:{enabled:true,intervalSeconds:150,nextAt:time+150000}})};
 const scheduler=createInteractionScheduler({dm,comments:{poll:async()=>({})},dataDir:dir,getAccountTag:()=> '0123456789abcdef',getConfig:()=>cfg,now:()=>time,readPrivateUnread:async()=>{unreadCalls++;return dmCounts()},readBudget:{status:()=>({blocked,minuteLimit:30,hourLimit:450})},logger:{error(){}}});
 try{scheduler.start();await wait();assert.deepEqual(calls,[{}]);time+=150_000;await scheduler.tick();assert.deepEqual(calls.at(-1),{fastUid:'12345',ownerPriority:true});assert.equal(unreadCalls,1);assert.equal(scheduler.status().checks.dmOwner.lastResult,'completed');
 blocked=true;time+=150_000;await scheduler.tick();assert.equal(calls.length,2);blocked=false;ownerReady=false;await scheduler.tick();assert.equal(unreadCalls,2);
 }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})
