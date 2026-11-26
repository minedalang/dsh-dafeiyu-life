import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutomaticSessionScope} from '../lib/session-integration-policy.mjs'
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

function modeFixture(t,{onChoice,onModel,onPublish,verifyPublished}={}){
 const dir=mkdtempSync(join(tmpdir(),'dynamic-mode-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let policy={mode:'full',revision:0};const scope=createAutomaticSessionScope(()=>policy)
 const switchMode=mode=>{policy={mode,revision:policy.revision+1}}
 const counts={choice:0,model:0,publish:0,verify:0},receipts=[]
 const engine=createDailyDynamic({dataDir:dir,getConfig:()=>({...config(),accountTag:'a'.repeat(16)}),getPublicVideos:()=>[],getPublicSocial:()=>memory,
   automaticSession:scope,chooseLife:async()=>{counts.choice++;await onChoice?.(switchMode);return {ok:true,style:'feeling',proof:{id:'life-approved'}}},
   verifyLife:()=>({ok:true}),recordLife:(_p,r)=>receipts.push(r.status),getEmotion:()=>({label:'平静'}),
   invokeModel:async()=>{counts.model++;await onModel?.(switchMode);return JSON.stringify(reply)},
   publish:async()=>{counts.publish++;return onPublish?onPublish(switchMode):{status:'api_accepted_unverified',dynamic_id:'1234567890123456789'}},
   verifyPublished:async()=>{counts.verify++;return verifyPublished?.()||{verified:false}}})
 return {engine,switchMode,counts,receipts}
}
test('dev24 mode blocks automatic dynamic tick, preserves explicit owner draft/publish and original receipt',async t=>{
 const x=modeFixture(t);x.switchMode('cooperative')
 assert.equal((await x.engine.tick()).skipped,'session-integration-paused')
 assert.equal((await x.engine.createDraft({auto:true})).skipped,'session-integration-paused')
 assert.deepEqual(x.counts,{choice:0,model:0,publish:0,verify:0})
 const d=await x.engine.createDraft();assert.equal(d.ok,true)
 assert.equal((await x.engine.sendDraft(d.draft.id)).status,'not-sent')
 assert.equal((await x.engine.sendDraft(d.draft.id,{manual:true})).status,'published')
 assert.equal(x.counts.publish,1)
 assert.equal((await x.engine.tick()).skipped,'session-integration-paused');assert.equal(x.counts.verify,1)
})
test('dev24 old dynamic choice cannot start draft after full-cooperative-full',async t=>{
 const x=modeFixture(t,{onChoice:s=>{s('cooperative');s('full')}})
 assert.equal((await x.engine.tick()).skipped,'session-integration-paused')
 assert.deepEqual(x.counts,{choice:1,model:0,publish:0,verify:0});assert.deepEqual(x.receipts,['not-sent'])
 assert.deepEqual(x.engine.list(),[])
})
test('dev24 obsolete draft model result is not saved, attempted model remains counted',async t=>{
 const x=modeFixture(t,{onModel:s=>s('cooperative')})
 assert.equal((await x.engine.tick()).skipped,'session-integration-paused')
 assert.equal(x.counts.model,1);assert.equal(x.counts.publish,0);assert.deepEqual(x.engine.list(),[])
 assert.equal(x.engine.status().autoAttemptsToday,1);assert.deepEqual(x.receipts,['not-sent'])
})
test('dev24 accepted send settles without starting another verification read in stale generation',async t=>{
 const x=modeFixture(t,{onPublish:s=>{s('cooperative');return {status:'api_accepted_unverified',dynamic_id:'1234567890123456789'}}})
 await x.engine.tick();assert.deepEqual(x.receipts,['accepted-unverified']);assert.equal(x.engine.list()[0].status,'published');assert.equal(x.counts.verify,0)
 x.switchMode('full');await x.engine.tick();assert.equal(x.counts.verify,1);assert.equal(x.counts.publish,1)
})
test('dev24 only unambiguous local mode refusal restores dynamic draft; contradictory outcome freezes',async t=>{
 for(const contradictory of [false,true]){
  const x=modeFixture(t,{onPublish:()=>({status:'session-integration-paused',notAttempted:true,...(contradictory?{accepted:true}: {})})})
  await x.engine.tick();assert.equal(x.engine.list()[0].status,contradictory?'uncertain':'draft')
  assert.deepEqual(x.receipts,[contradictory?'uncertain':'not-sent'])
 }
})
