import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
const BV='BV1abcde1234',UID='12345',S='a'.repeat(16)
function create(t,read){
 let scope=S,uid=UID
 const results=[]
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>uid,getAccountTag:()=>scope,
   choose:async ({candidates})=>({ok:true,proof:{key:candidates[0].kind}}),verify:()=>({ok:true}),
   receipt:(proof,r)=>results.push([proof.key,r.status]),verifyPlatformState:read})
 t.after(()=>bridge.stop())
 const post=async(route,body)=>{
   const env=bridge.env(),resp=await fetch(env.BILI_LIFE_ACTION_URL+route,{method:'POST',
     headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)})
   return {code:resp.status,...await resp.json()}
 }
 return {bridge,post,results,setScope:x=>scope=x,setUid:x=>uid=x}
}
for(const [tool,kind,target] of [
 ['bili_video_like','video_like',BV],['bili_video_collect','video_collect',BV],
 ['bili_follow_creator','video_follow',BV],['bili_unfollow_creator','video_unfollow','67890']]){
 test(`dev15 ${kind}: only independent read turns a write into a verified completion`,async t=>{
  const reads=[],x=create(t,async row=>{reads.push(row);return true})
  await x.bridge.start()
  const grant=await x.post('/life-action',{tool,target,uid:UID})
  assert.equal(grant.ok,true)
  const outcome=await x.post('/life-action-result',{grant:grant.grant,uid:UID,ok:true})
  assert.equal(outcome.status,'verified')
  assert.deepEqual(x.results,[[kind,'verified']])
  assert.deepEqual(reads,[{kind,target,uid:UID,scope:S}])
  assert.equal((await x.post('/life-action-result',{grant:grant.grant,uid:UID,ok:true})).code,409)
 })
}
test('dev15 failed write never queries platform; uncertain read is not promoted',async t=>{
 let calls=0
 const x=create(t,async()=>{calls++;throw Error('offline')})
 await x.bridge.start()
 const one=await x.post('/life-action',{tool:'bili_video_like',target:BV,uid:UID})
 const a=await x.post('/life-action-result',{grant:one.grant,uid:UID,ok:true})
 assert.equal(a.status,'accepted-unverified')
 const two=await x.post('/life-action',{tool:'bili_video_like',target:BV,uid:UID})
 const b=await x.post('/life-action-result',{grant:two.grant,uid:UID,ok:false})
 assert.equal(b.status,'uncertain');assert.equal(calls,1)
})
test('dev15 account changed while verifier awaits: result stays unverified',async t=>{
 let release
 const wait=new Promise(ok=>release=ok)
 const x=create(t,async()=>{await wait;return true})
 await x.bridge.start()
 const g=await x.post('/life-action',{tool:'bili_video_collect',target:BV,uid:UID})
 const promise=x.post('/life-action-result',{grant:g.grant,uid:UID,ok:true})
 await new Promise(r=>setTimeout(r,10))
 x.setScope('b'.repeat(16));release()
 assert.notEqual((await promise).status,'verified')
 assert.ok(x.results.every(r=>r[1]!=='verified'))
})
test('dev15 unverified comment and folder delete never claim post-state from write reply',async t=>{
 let reads=0;const x=create(t,async()=>{reads++;return true})
 await x.bridge.start()
 for(const [tool,target] of [['bili_reply',BV],['bili_favorite_folder_delete','456789']]){
  const g=await x.post('/life-action',{tool,target,uid:UID})
  const outcome=await x.post('/life-action-result',{grant:g.grant,uid:UID,ok:true})
  assert.equal(outcome.status,'accepted-unverified')
 }
 assert.equal(reads,0)
})
