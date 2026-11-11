import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCommentInteract,dynamicVerificationRetryDelay} from '../lib/comment-interact.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const did='1267086296612864004',uid='382440088',self='3747574597028931'
const rid='319847247793',parent='323612080800',root='319798167777'
const started=Date.parse('2026-11-11T12:55:30+08:00')
const notice={user:{mid:uid,uname:'毅武'},item:{business_id:17,business:'动态',subject_id:'414465057',source_id:rid,
  root_id:root,target_id:parent,uri:'https://t.bilibili.com/'+did,
  source_content:'回复 :肥鱼好久没发动态了，在做什么呢',
  target_reply_content:'在呀，刚看到你，抱歉让你久等啦 🐟',source_time:Math.floor(started/1000)}}
const config={watchReplies:true,watchAt:false,allowGeneralReplies:true,replyPerPoll:5,replyPerDay:30,
  globalDailyLimit:200,ownTopPerUser:5,ownNestedPerUser:5,diagReplyInboxEnabled:true}

test('动态核验技术故障不因三次失败写永久 seen；仍可重试并保留真实回复上下文',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev70-dynamic-'))
  let now=started+3*60_000,available=false,received=[],modelCalls=0
  const sent=[]
  const e=createCommentInteract({dataDir:dir,now:()=>now,selfUid:()=>self,getConfig:()=>config,
    getNotifications:()=>({code:0,data:{items:received}}),getOwnComments:()=>({top:[],nested:[]}),
    getDynamicContext:async x=>available
      ?{usable:true,dynamicId:did,targetUid:uid,authorUid:self,root,ownedLocal:true,
        verifiedCommentText:'肥鱼好久没发动态了，在做什么呢',ownDynamicText:'最近在生活'}
      :{usable:false,reason:'平台暂时无法返回完整的目标楼中楼'},
    generateReply:async()=>{modelCalls++;return '最近在认真生活，也在慢慢收集好玩的事 🐟'},
    send:async x=>{sent.push(x);return {ok:true,rpid:'323888888881'}}})
  try{
    await e.poll({notifications:true,top:false,mentions:false}) // first boot baseline
    received=[notice]
    for(let i=0;i<4;i++){
      await e.poll({notifications:true,top:false,mentions:false})
      const db=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'))
      const key='comment:dynamic:414465057:'+rid
      assert.equal(db.seen[key],undefined,'no failure-count permanent dedupe')
      assert.equal(db.atContextRetries[key]?.attempts,i+1)
      const diag=e.status().replyDiagnostics.find(x=>x.rpid===rid)
      assert.equal(diag.reason,'waiting_for_dynamic_context')
      assert.match(diag.errorDetail,/平台暂时/)
      assert.ok(diag.retryAt>now)
      now=diag.retryAt+1000
    }
    assert.equal(modelCalls,0)
    available=true
    assert.equal((await e.poll({notifications:true,top:false,mentions:false})).sent,1)
    assert.equal(sent.length,1)
    assert.equal(sent[0].rpid,rid)
    assert.equal(sent[0].dynamicId,did)
    assert.equal(sent[0].root,root)
    assert.equal((await e.poll({notifications:true,top:false,mentions:false})).sent,0)
    assert.equal(sent.length,1,'confirmed send must never repeat')
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('旧版三次核验失败被终止的近期通知会解除技术标记，已成功发送的不重开',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev70-dynamic-migrate-'))
  let now=started+600000,received=[],lookups=0
  const e=createCommentInteract({dataDir:dir,now:()=>now,selfUid:()=>self,getConfig:()=>config,
    getNotifications:()=>({code:0,data:{items:received}}),getOwnComments:()=>({top:[],nested:[]}),
    getDynamicContext:async()=>{lookups++;return {usable:false,reason:'模拟临时故障'}},
    generateReply:async()=>{throw Error('should not reach model')},send:async()=>{throw Error('should not send')}})
  try{
    await e.poll({notifications:true,top:false,mentions:false})
    const path=join(dir,'comment-interact-state.json')
    const key='comment:dynamic:414465057:'+rid
    const db=JSON.parse(await readFile(path,'utf8'))
    db.seen[key]='dynamic-context-unavailable'
    await writeFile(path,JSON.stringify(db))
    received=[notice]
    await e.poll({notifications:true,top:false,mentions:false})
    const after=JSON.parse(await readFile(path,'utf8'))
    assert.equal(after.seen[key],undefined)
    assert.equal(after.atContextRetries[key]?.attempts,1)
    assert.ok(lookups>0)
    after.seen[key]='sent';delete after.atContextRetries[key]
    await writeFile(path,JSON.stringify(after))
    const count=lookups
    await e.poll({notifications:true,top:false,mentions:false})
    assert.equal(lookups,count)
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('动态源匹配冲突立即终止，不会把可信的账号错误当作可继续发送',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev70-dynamic-mismatch-'))
  let received=[]
  const e=createCommentInteract({dataDir:dir,now:()=>started+100000,selfUid:()=>self,getConfig:()=>config,
    getNotifications:()=>({code:0,data:{items:received}}),getOwnComments:()=>({top:[],nested:[]}),
    getDynamicContext:async()=>({usable:false,terminal:true,reason:'作者 UID 与源评论不符'}),
    generateReply:async()=>{throw Error('must not generate')},send:async()=>{throw Error('must not send')}})
  try{
    await e.poll({notifications:true,top:false,mentions:false})
    received=[notice]
    await e.poll({notifications:true,top:false,mentions:false})
    assert.equal(e.status().replyDiagnostics.find(x=>x.rpid===rid)?.reason,'dynamic_source_mismatch')
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('动态技术重试使用有界退避，不是次数硬截止',()=>{
  assert.equal(dynamicVerificationRetryDelay(1),5*60_000)
  assert.equal(dynamicVerificationRetryDelay(2),10*60_000)
  assert.equal(dynamicVerificationRetryDelay(3),20*60_000)
  assert.equal(dynamicVerificationRetryDelay(4),30*60_000)
  assert.equal(dynamicVerificationRetryDelay(100),30*60_000)
})

test('可见 Life 自主预算相加不再被隐藏的每日 288 次总额度压低',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev70-life-budget-'))
  try{
    const planner=createAutonomousPlanner({dataDir:dir,
      getConfig:()=>({autonomousPlannerDailyLimit:288,autonomousSocialAttentionDailyLimit:288}),
      getTodos:()=>[],invokeModel:async()=>'{"action":"skip"}',executeRead:async()=>({ok:true}),
      updateTodo:()=>{},reflect:async()=>({ok:true})})
    const state=planner.status()
    assert.equal(state.dailyGlobalLimit,576)
    assert.equal(state.socialDailyLimit,288)
  }finally{await rm(dir,{recursive:true,force:true})}
})
