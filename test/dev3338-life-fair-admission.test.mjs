import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createLifeWillingnessAdmission} from '../lib/life-willingness-admission.mjs'
const TAG='a'.repeat(16)
const temp=t=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dm-fair-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
const will=(dir,clock)=>createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,getContext:()=>({}),enabled:()=>true,
  now:()=>clock.value,invokeModel:async()=>JSON.stringify({action:'act',candidateId:'video_candidate',reason:'视频已核实'})})
const dm=n=>({kind:'dm_reply',uid:'221',sourceKey:'dm:221:message-'+n,messages:['我想回复 '+n],targetKey:''})
const video=n=>({sourceKey:'video:opportunity-'+n,scene:'video',candidates:[{id:'video_candidate',kind:'video_like',label:'核实的视频点赞'}]})

test('DM preflight sees exact holder channel and release reason, with no UID in admission disk',async t=>{
  const dir=temp(t),clock={value:Date.now()},w=will(dir,clock)
  assert.equal(w.inspectSocialReadiness().ok,true)
  const hold=await w.adoptSocialDecisionQueued(dm(1));assert.equal(hold.ok,true)
  const busy=w.inspectSocialReadiness()
  assert.equal(busy.ok,false);assert.equal(busy.reason,'life-choice-in-progress')
  assert.equal(busy.ownerChannel,'dm')
  const stored=readFileSync(join(dir,'life-willingness-admission.json'),'utf8')
  assert.equal(stored.includes('221'),false);assert.equal(stored.includes('message-1'),false)
  assert.equal(w.receipt(hold.proof,{status:'not-sent'}).ok,true)
  assert.equal(w.inspectSocialReadiness().ok,true)
  assert.equal(w.status().admission.lastReleaseReason,'not-sent')
})

test('expired unused approval is recoverable, but expired USED proof remains blocked for offline review',async t=>{
  const dir=temp(t),clock={value:Date.now()},w1=will(dir,clock)
  const a=await w1.adoptSocialDecisionQueued(dm('unused'));assert.equal(a.ok,true)
  clock.value+=11*60_000
  const w2=will(dir,clock)
  assert.equal(w2.inspectSocialReadiness().ok,true,'unused expired approval may safely recover on acquisition')
  const b=await w2.adoptSocialDecisionQueued(dm('used'));assert.equal(b.ok,true)
  assert.equal(w2.verify(b.proof,'dm_reply',{uid:'221',targetKey:'',text:'我想回复 used'}).ok,true)
  clock.value+=11*60_000
  const w3=will(dir,clock)
  const blocked=w3.inspectSocialReadiness()
  assert.equal(blocked.ok,false);assert.equal(blocked.reason,'life-choice-review-required')
  const result=await w3.adoptSocialDecisionQueued(dm('cannot-replay'))
  assert.equal(result.ok,false);assert.equal(result.reason,'life-choice-review-required')
})

test('bounded fairness: two waiting DM replies overtake, then a video decision gets its turn',async t=>{
  const dir=temp(t),clock={value:Date.now()},w=will(dir,clock)
  const first=await w.decide(video('first'));assert.equal(first.ok,true)
  let order=[]
  const background=w.decide(video(1),{queueIfBusy:true}).then(r=>{order.push('video');return r})
  const d1=w.adoptSocialDecisionQueued(dm('one')).then(r=>{order.push('dm1');return r})
  const d2=w.adoptSocialDecisionQueued(dm('two')).then(r=>{order.push('dm2');return r})
  const d3=w.adoptSocialDecisionQueued(dm('three')).then(r=>{order.push('dm3');return r})
  assert.equal(w.status().queued,4)
  w.receipt(first.proof,{status:'not-sent'})
  const a=await d1;assert.equal(a.ok,true);assert.deepEqual(order,['dm1'])
  w.receipt(a.proof,{status:'not-sent'})
  const b=await d2;assert.equal(b.ok,true);assert.deepEqual(order,['dm1','dm2'])
  w.receipt(b.proof,{status:'not-sent'})
  const c=await background;assert.equal(c.ok,true);assert.deepEqual(order,['dm1','dm2','video'])
  w.receipt(c.proof,{status:'not-sent'})
  const d=await d3;assert.equal(d.ok,true);assert.deepEqual(order,['dm1','dm2','video','dm3'])
  w.receipt(d.proof,{status:'not-sent'})
})


test('three queued DM seals cannot starve an older video opportunity after two grants',async t=>{
 const dir=temp(t),clock={value:Date.now()},w=will(dir,clock)
 const first=await w.decide(video('hold'));assert.equal(first.ok,true)
 const order=[]
 const promises=[['dm1',w.adoptSocialDecisionQueued(dm('1'))],['dm2',w.adoptSocialDecisionQueued(dm('2'))],
   ['dm3',w.adoptSocialDecisionQueued(dm('3'))],['video',w.decide(video('late'),{queueIfBusy:true})]]
   .map(([name,p])=>p.then(result=>{order.push(name);if(result.proof)w.receipt(result.proof,{status:'not-sent'});return result}))
 w.receipt(first.proof,{status:'not-sent'})
 await Promise.all(promises)
 assert.deepEqual(order,['dm1','dm2','video','dm3'])
})

test('admission status exposes bounded release codes and never invents owner identity',t=>{
  const dir=temp(t),clock={value:Date.now()},a=createLifeWillingnessAdmission({dataDir:dir,now:()=>clock.value})
  const claim=a.acquire(TAG,{channel:'video'});assert.equal(claim.ok,true)
  assert.deepEqual([a.status(TAG).ownerChannel,a.status(TAG).stage],['video','considering'])
  assert.equal(a.settle(TAG,claim.token,{reason:'model-deferred'}).ok,true)
  assert.equal(a.status(TAG).lastReleaseReason,'model-deferred')
})
