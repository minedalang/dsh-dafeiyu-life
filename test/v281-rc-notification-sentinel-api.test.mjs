import test from 'node:test'
import assert from 'node:assert/strict'
import {readPrivateUnreadCounts,readInteractionUnreadCounts} from '../lib/dm.mjs'

const cred={sessdata:'session-token',bili_jct:'csrf-token',buvid3:'buvid-token',dedeuserid:'12345'}
function budgetSpy(){
  const calls=[]
  return {calls,acquire:kind=>calls.push(['acquire',kind]),noteSuccess:kind=>calls.push(['success',kind]),
    noteError:(error,kind)=>calls.push(['error',kind,String(error?.message||error)]),schedule:(_kind,task)=>task()}
}
async function withFetch(handler,fn){
  const old=globalThis.fetch;globalThis.fetch=handler
  try{return await fn()}finally{globalThis.fetch=old}
}
const response=(data,{status=200}={})=>({status,json:async()=>data})

test('私信哨兵只读取 single_unread 计数并标准化所有支持字段',async()=>{
  const budget=budgetSpy();let requested=''
  const result=await withFetch(async(url,options)=>{requested=String(url);assert.match(options.headers.Cookie,/SESSDATA=session-token/)
    return response({code:0,data:{follow_unread:2,unfollow_unread:1,dustbin_unread:0,unfollow_push_msg:3,dustbin_push_msg:2,
      biz_msg_follow_unread:4,biz_msg_unfollow_unread:5,custom_unread:6}})},
    ()=>readPrivateUnreadCounts(cred,{readBudget:budget}))
  assert.match(requested,/session_svr\/single_unread/)
  assert.deepEqual(result,{followUnread:2,unfollowUnread:1,dustbinUnread:0,unfollowPushUnread:3,dustbinPushUnread:2,
    bizFollowUnread:4,bizUnfollowUnread:5,customUnread:6})
  assert.deepEqual(budget.calls.map(x=>x.slice(0,2)),[['acquire','dm-unread'],['success','dm-unread']])
})

test('互动哨兵兼容拆分 reply/at 与新版 recv_reply 聚合字段',async()=>{
  const budget=budgetSpy();let calls=0
  const results=[
    {code:0,data:{reply:2,at:3,like:4,recv_reply:5,recv_like:4}},
    {code:0,data:{recv_reply:7,recv_like:8}},
  ]
  await withFetch(async url=>{calls++;assert.match(String(url),/x\/im\/web\/msgfeed\/unread/);return response(results[calls-1])},async()=>{
    assert.deepEqual(await readInteractionUnreadCounts(cred,{readBudget:budget}),
      {mode:'split',replyCount:2,atCount:3,replyAtTotal:5,likeCount:4})
    assert.deepEqual(await readInteractionUnreadCounts(cred,{readBudget:budget}),
      {mode:'combined',replyCount:null,atCount:null,replyAtTotal:7,likeCount:8})
  })
  assert.equal(calls,2)
})

test('哨兵结构异常或 HTTP 200/-509 不会被解释为未读数为零',async()=>{
  const budget=budgetSpy()
  await withFetch(async()=>response({code:0,data:{unexpected:'shape'}}),async()=>{
    await assert.rejects(()=>readPrivateUnreadCounts(cred,{readBudget:budget}),/缺少必要分类字段/)
  })
  await withFetch(async()=>response({code:-509,message:'请求过于频繁',data:null}),async()=>{
    await assert.rejects(()=>readInteractionUnreadCounts(cred,{readBudget:budget}),/code=-509/)
  })
  assert.ok(budget.calls.some(x=>x[0]==='error'&&x[1]==='social-unread'))
  assert.equal(budget.calls.some(x=>x[0]==='success'&&x[1]==='dm-unread'),false,'结构异常不应推进成功恢复观察')
})

test('计数哨兵遇到瞬时网络错误不进行 450ms 快速重试，避免重试被自身最小间隔挡回',async()=>{
  const budget=budgetSpy();let calls=0
  await withFetch(async()=>{calls++;throw Object.assign(new Error('ECONNRESET'),{code:'ECONNRESET'})},async()=>{
    await assert.rejects(()=>readPrivateUnreadCounts(cred,{readBudget:budget}),/私信接口网络请求失败/)
  })
  assert.equal(calls,1)
  assert.equal(budget.calls.filter(x=>x[0]==='acquire'&&x[1]==='dm-unread').length,1)
})
