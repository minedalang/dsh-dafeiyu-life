import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic} from '../lib/daily-dynamic.mjs'
const id='e-1234567890abcdefab'
const memory=[{id,ownText:'我觉得慢慢听听大家不同的想法，常常能遇到很有意思的小发现。',day:'2026-11-06'}]
const reply={should_post:true,text:'今天和大家聊着聊着，发现认真听听不同的想法还蛮有趣的，脑袋里多出了一个小问号。',source_bvids:[],source_memory_ids:[id],evidence_claims:[{type:'public_conversation',id}],reason:'有点好奇'}
const config=()=>({masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:false,dailyDynamicDailyLimit:2})
function set(t,{allow=true,proofValid=true,modelReply=reply,publishStatus='api_accepted_unverified'}={}){
  const dir=mkdtempSync(join(tmpdir(),'life-dynamic-p0-'))
  t.after(()=>rmSync(dir,{force:true,recursive:true}))
  const events=[];let drafts=0,sends=0
  const obj=createDailyDynamic({dataDir:dir,getConfig:config,getPublicVideos:()=>[],getPublicSocial:()=>memory,
    getEmotion:()=>({label:'好奇',intensity:52}),
    invokeModel:async()=>{drafts++;return JSON.stringify(modelReply)},
    publish:async()=>{sends++;return {status:publishStatus}},
    chooseLife:async opts=>{events.push({type:'choice',opts});return allow?{ok:true,style:'feeling',proof:{id:'life-approved'}}:{ok:false,action:'skip'}},
    verifyLife:(proof,kind)=>({ok:proofValid&&proof?.id==='life-approved'&&kind==='write_dynamic'}),
    recordLife:(proof,row)=>events.push({type:'receipt',proof,row}),now:()=>Date.now()})
  return {obj,events,counts:()=>({drafts,sends}),dir}
}
test('Life skip is silence: no automatic dynamic draft or Bilibili write',async t=>{
 const x=set(t,{allow:false});await x.obj.tick()
 assert.deepEqual(x.counts(),{drafts:0,sends:0});assert.equal(x.events[0].opts.candidates[0].kind,'write_dynamic')
})
test('Life allows an evidenced public utterance and records the platform-accepted unverified receipt',async t=>{
 const x=set(t);await x.obj.tick()
 assert.deepEqual(x.counts(),{drafts:1,sends:1})
 assert.equal(x.events.at(-1).row.status,'accepted-unverified')
 const drafts=x.obj.list();assert.equal(drafts[0].status,'published')
 assert.equal(drafts[0].style,'feeling')
 assert.doesNotMatch(readFileSync(join(x.dir,'daily-dynamic','drafts.json'),'utf8'),/life-approved/)
})
test('Revoked willingness proof prevents automatic publish despite valid draft and consent',async t=>{
 const x=set(t,{proofValid:false});await x.obj.tick()
 assert.deepEqual(x.counts(),{drafts:1,sends:0})
 assert.equal(x.obj.list()[0].status,'draft')
})
test('Unconfirmed remote response does not claim a published dynamic or a verified intent',async t=>{
 const x=set(t,{publishStatus:'timeout'});await x.obj.tick()
 assert.equal(x.obj.list()[0].status,'uncertain')
 assert.equal(x.events.at(-1).row.status,'uncertain')
 await x.obj.tick();assert.equal(x.counts().sends,1)
})
test('No confirmed public evidence means an allowed choice cannot fabricate a dynamic',async t=>{
 const x=set(t,{modelReply:{should_post:false,reason:'没有依据'}});await x.obj.tick()
 assert.deepEqual(x.counts(),{drafts:1,sends:0})
})
