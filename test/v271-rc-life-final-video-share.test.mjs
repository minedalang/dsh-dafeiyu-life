import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
const now=Date.parse('2026-11-06T13:00:00Z'),uid='22334455',bv='BV1abc234567'
function setup(t,{approved=true,throws=false,changed=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'life-video-final-'))
  t.after(()=>rmSync(dir,{force:true,recursive:true}))
  const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,
    socialAutoSend:true,socialVideoRecommendationsAuthorizedV2:true,socialOutreachDailyLimit:4,dmOwnerUid:uid,
    friendDirectory:JSON.stringify([{uid,dm:true,recommend:'both'}])}
  let sends=0,decisions=0
  writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,sent:[],items:[{
    id:'life-share:'+uid+':'+bv,uid,bvid:bv,title:'他人的公开视频',type:'interest-share',
    text:'我选中了一条公开的视频，想分享一下：https://www.bilibili.com/video/'+bv,
    status:'draft',sourceAt:now,createdAt:now}]}))
  const engine=createSocialIntentEngine({dataDir:dir,videoRecommendationsOnly:true,getConfig:()=>cfg,
    now:()=>now,getSelectedVideos:()=>[{picked:true,bvid:bv,day:'2026-11-06'}],
    invokeModel:async()=>'',authorizeDraft:async()=>{
      decisions++
      if(throws)throw Error('Life model offline')
      if(changed)cfg.socialAutoSend=false
      return {ok:approved,reason:'life-chose-rest'}
    },sendMessage:async()=>{sends++;return {ok:true}}})
  return {dir,engine,cfg,counts:()=>({sends,decisions}),id:'life-share:'+uid+':'+bv}
}
test('an old autonomous candidate cannot send without a Life final decision',async t=>{
 const x=setup(t,{approved:false}),r=await x.engine.send(x.id,{automatic:true})
 assert.equal(r.ok,false);assert.equal(r.skipped,true)
 assert.deepEqual(x.counts(),{decisions:1,sends:0})
 assert.equal(x.engine.status().items[0].status,'draft')
})
test('model failure and changed authorization cannot reserve a network send',async t=>{
 for(const option of [{throws:true},{changed:true}]){
   const x=setup(t,option)
   const r=await x.engine.send(x.id,{automatic:true})
   assert.equal(r.ok,false)
   assert.equal(x.counts().sends,0)
 }
})
test('a verified Life choice still passes original source, friend, quota and receipt guards',async t=>{
 const x=setup(t),r=await x.engine.send(x.id,{automatic:true})
 assert.equal(r.ok,true)
 assert.deepEqual(x.counts(),{decisions:1,sends:1})
 assert.equal((await x.engine.send(x.id,{automatic:true})).ok,false)
 assert.equal(x.counts().sends,1)
})
test('explicit manual reviewed send is NOT silently upgraded to autonomy',async t=>{
 const x=setup(t,{approved:false})
 assert.equal((await x.engine.send(x.id,{confirm:true,automatic:false})).ok,true)
 assert.deepEqual(x.counts(),{decisions:0,sends:1})
})
