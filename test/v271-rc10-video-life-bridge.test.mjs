import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
const S='a'.repeat(16),U='1234567',BV='BV1abcde1234'
function fixture(t,{choose=true}={}){
  let uid=U,tag=S,enabled=true,called=0,receipt=[]
  const bridge=createLifeVideoActionBridge({getAccountUid:()=>uid,getAccountTag:()=>tag,enabled:()=>enabled,
    choose:async options=>{called++;return choose?{ok:true,proof:{id:'random-id',scope:tag,kind:options.candidates[0].kind}}:{ok:false}},
    verify:proof=>({ok:!!proof?.id}),receipt:(proof,result)=>receipt.push(result.status)})
  t.after(()=>bridge.stop())
  async function post(route,body,auth=true){const env=bridge.env(),response=await fetch(env.BILI_LIFE_ACTION_URL+route,{method:'POST',
    headers:{authorization:'Bearer '+(auth?env.BILI_LIFE_ACTION_TOKEN:'invalid'),'content-type':'application/json'},body:JSON.stringify(body)})
    return {status:response.status,...await response.json()}}
  return {bridge,post,receipt,called:()=>called,uid:x=>uid=x,tag:x=>tag=x,enabled:x=>enabled=x}
}
test('video Agent needs one Life approval for each write and reports outcome as UNVERIFIED',async t=>{
  const x=fixture(t);await x.bridge.start()
  const grant=await x.post('/life-action',{tool:'bili_video_like',target:BV,uid:U,reason:'真心喜欢'})
  assert.equal(grant.ok,true);assert.equal(x.called(),1)
  const result=await x.post('/life-action-result',{grant:grant.grant,uid:U,ok:true})
  assert.equal(result.status,'accepted-unverified');assert.deepEqual(x.receipt,['accepted-unverified'])
  assert.equal((await x.post('/life-action-result',{grant:grant.grant,uid:U,ok:true})).ok,false)
})
test('reject wrong token, foreign account, invented action, invalid targets before model',async t=>{
  const x=fixture(t);await x.bridge.start()
  for(const body of [
    {tool:'bili_video_like',target:BV,uid:'other'},
    {tool:'bili_video_like',target:'https://untrusted',uid:U},
    {tool:'bili_send_message',target:BV,uid:U},
  ])assert.equal((await x.post('/life-action',body)).ok,false)
  assert.equal((await x.post('/life-action',{tool:'bili_video_like',target:BV,uid:U},false)).status,403)
  assert.equal(x.called(),0)
})
test('Life decline and account switch cannot grant a video write',async t=>{
  const a=fixture(t,{choose:false});await a.bridge.start()
  assert.equal((await a.post('/life-action',{tool:'bili_video_collect',target:BV,uid:U})).ok,false)
  const b=fixture(t);await b.bridge.start()
  const grant=await b.post('/life-action',{tool:'bili_follow_creator',target:BV,uid:U})
  assert.equal(grant.ok,true)
  b.tag('b'.repeat(16))
  assert.equal((await b.post('/life-action-result',{grant:grant.grant,uid:U,ok:true})).ok,false)
})
test('paused Life cannot create approvals even for a valid source',async t=>{
  const x=fixture(t);await x.bridge.start();x.enabled(false)
  assert.equal((await x.post('/life-action',{tool:'bili_unfollow_creator',target:'778899',uid:U})).ok,false)
  assert.equal(x.called(),0)
})
