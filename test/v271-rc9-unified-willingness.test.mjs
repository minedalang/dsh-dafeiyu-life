import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness,parseLifeWillingnessDecision} from '../lib/life-willingness.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
const A='a'.repeat(16),B='b'.repeat(16)
function fixture(t,{response=()=>JSON.stringify({action:'act',candidateId:'reply_dm',reason:'想聊聊'}),clock=Date.now()}={}){
 const dir=mkdtempSync(join(tmpdir(),'life-will-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let tag=A,active=true,now=clock,calls=0,world={interests:['画画'],mood:'好奇'}
 const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>tag,now:()=>now})
 const actor=createLifeWillingness({dataDir:dir,getAccountTag:()=>tag,now:()=>now,enabled:()=>active,
  getContext:()=>({voice:'活泼但不强求回复',world}),
  beginTrace:args=>trace.begin(args),invokeModel:async(p)=>{calls++;return response(p)}})
 const decide=(opts={})=>actor.decide({trigger:'dm-received',sourceKey:'verified-dm-event:123',scene:'dm',
  candidates:[{id:'reply_dm',kind:'dm_reply',label:'回应一位已核验的私信来信'}],...opts})
 return {dir,actor,decide,trace,changeTag:x=>tag=x,enable:x=>active=x,advance:x=>now+=x,
  changeWorld:x=>world=x,calls:()=>calls}
}
test('strict JSON: no invented action, wrong candidate, or extra fields',()=>{
 for(const raw of ['anything',JSON.stringify({action:'act',candidateId:'write_dynamic',reason:'x'}),
  JSON.stringify({action:'act',candidateId:'reply_dm',reason:'x',permission:true}),
  JSON.stringify({action:'act',candidateId:'reply_dm',reason:'x',style:'magic'})])
  assert.equal(parseLifeWillingnessDecision(raw,[{id:'reply_dm'}]).action,'blocked')
 assert.equal(parseLifeWillingnessDecision('```json\n{"action":"defer","reason":"稍后"}\n```').action,'defer')
})
test('Life choice produces a short lived account-bound proof and anonymous trace',async t=>{
 const x=fixture(t);const result=await x.decide()
 assert.equal(result.ok,true)
 assert.equal(x.actor.verify(result.proof,'dm_reply').ok,false) // legacy unsealed proof cannot send
 assert.equal(x.actor.verify(result.proof,'comment_reply').ok,false)
 const trace=x.trace.list().runs[0];assert.equal(trace.trigger,'dm-received')
 const stored=readFileSync(join(x.dir,'life-decision-traces',await import('node:crypto').then(m=>m.createHash('sha256').update(A).digest('hex').slice(0,24)),trace.id+'.json'),'utf8')
 for(const privateValue of ['verified-dm-event:123',A,'画画','活泼但不强求回复']) assert.equal(stored.includes(privateValue),false)
 x.actor.receipt(result.proof,{status:'verified'});assert.equal(x.actor.verify(result.proof,'dm_reply').ok,false) // legacy unsealed proof cannot send
 x.changeTag(B);assert.equal(x.actor.verify(result.proof,'dm_reply').ok,false)
})
test('time expiry, revoked settings and unknown receipt fail closed',async t=>{
 const x=fixture(t);let a=await x.decide();assert.equal(a.ok,true)
 x.actor.receipt(a.proof,{status:'uncertain'});assert.equal(x.actor.verify(a.proof,'dm_reply').ok,false)
 a=await x.decide();x.advance(10*60_000+1);assert.equal(x.actor.verify(a.proof,'dm_reply').ok,false)
 a=await x.decide();x.enable(false);assert.equal(x.actor.verify(a.proof,'dm_reply').ok,false)
})
test('model outage never grants a send or changes an already validated account scope',async t=>{
 const x=fixture(t,{response:()=>{throw Error('offline')}})
 const a=await x.decide();assert.equal(a.ok,false);assert.equal(a.action,'blocked');assert.equal(a.outcome,'unavailable');assert.equal(x.calls(),1)
 assert.equal(x.actor.verify(a.proof,'dm_reply').ok,false)
})
test('independent candidate triggers share one model contract and existing planner budget',async t=>{
 const x=fixture(t,{response:p=>JSON.stringify({action:'act',candidateId:JSON.parse(p.match(/这轮候选：([^\n]+)/)?.[1]||'[]')[0].id,reason:'想试试'})})
 for(const [kind,id] of [['comment_reply','reply_comment'],['write_dynamic','write_dynamic'],['share_video','share_video'],['followup','followup']]){
  const result=await x.decide({sourceKey:'trusted:'+id,candidates:[{id,kind,label:'真实候选'}]})
  assert.equal(result.ok,true,kind)
  assert.equal(x.actor.verify(result.proof,kind).ok,!['dm_reply','comment_reply'].includes(kind))
  x.actor.receipt(result.proof,{status:'verified'})
 }
 const ledger=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 assert.equal(ledger.willingnessRuns,4)
 assert.equal(ledger.runs,0) // normal social intent is outside background planner quota
 assert.equal(ledger.recent.length,0)
})
test('no verified scope, malformed source, unsupported capability or unsafe budget block before model call',async t=>{
 const x=fixture(t);x.changeTag('');assert.equal((await x.decide()).ok,false);assert.equal(x.calls(),0)
 x.changeTag(A)
 assert.equal((await x.decide({sourceKey:'x'})).ok,false)
 assert.equal((await x.decide({candidates:[{id:'do-anything',kind:'platform_write',label:'unsafe'}]})).ok,false)
 assert.equal(x.calls(),0)
 writeFileSync(join(x.dir,'autonomous-planner.json'),'corrupted')
 assert.equal((await x.decide()).ok,false);assert.equal(x.calls(),0)
})
test('prior real world state is passed to the same chooser, without storing raw world in traces',async t=>{
 const prompts=[];const x=fixture(t,{response:p=>{prompts.push(p);return JSON.stringify({action:'skip',reason:'想休息'})}})
 assert.equal((await x.decide()).action,'skip')
 x.changeWorld({interests:['摄影'],mood:'平静'})
 assert.equal((await x.decide({sourceKey:'verified-dm-event:124'})).action,'skip')
 assert.match(prompts[0],/画画/);assert.match(prompts[1],/摄影/)
 assert.ok(!JSON.stringify(x.trace.list()).includes('摄影'))
})
test('old planner budget exhaustion cannot stop a verified social willingness choice',async t=>{
 const x=fixture(t),day=new Date().toLocaleDateString('en-CA')
 writeFileSync(join(x.dir,'autonomous-planner.json'),JSON.stringify({version:1,day,runs:288,lifeRuns:12,socialRuns:24,recent:[],modelInputChars:10,modelOutputChars:10}))
 const outcome=await x.decide();assert.equal(outcome.ok,true);assert.equal(x.calls(),1)
 x.actor.receipt(outcome.proof,{status:'verified'})
 const row=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 assert.equal(row.runs,288);assert.equal(row.lifeRuns,12);assert.equal(row.willingnessRuns,1)
})

test('malformed or invented model candidate is invalid, never voluntary silence',async t=>{
 const x=fixture(t,{response:()=>JSON.stringify({action:'act',candidateId:'publish-anything',reason:'yes'})})
 const r=await x.decide()
 assert.equal(r.ok,false);assert.equal(r.invalid,true)
 assert.equal(x.actor.verify(r.proof,'dm_reply').ok,false)
})

test('video delegated start records launch only and revokes the single use proof',async t=>{
 const x=fixture(t,{response:()=>JSON.stringify({action:'act',candidateId:'explore_video',reason:'想多看看'})})
 const a=await x.decide({sourceKey:'verified-explore:1',candidates:[{id:'explore_video',kind:'explore_video',label:'开始一次公开视频探索'}]})
 assert.equal(a.ok,true);assert.equal(x.actor.verify(a.proof,'explore_video').ok,true)
 assert.equal(x.actor.receipt(a.proof,{status:'delegated'}).result,'delegated')
 assert.equal(x.actor.verify(a.proof,'explore_video').ok,false)
})


test('a busy social day may make more than 80 legitimate willingness choices without using planner quota',async t=>{
 const x=fixture(t,{response:()=>JSON.stringify({action:'skip',reason:'自行决定本次不回复'})})
 for(let i=0;i<105;i++){
   const result=await x.decide({sourceKey:'verified-dm-'+i})
   assert.equal(result.action,'skip',`social turn ${i}: ${JSON.stringify(result)}`)
 }
 assert.equal(x.calls(),105)
 const ledger=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 assert.equal(ledger.willingnessRuns,105)
 assert.equal(ledger.runs,0)
 assert.equal(ledger.lifeRuns,0)
})

test('legacy shared counter is migrated once, preserving planner and social accounting',async t=>{
 const x=fixture(t,{response:()=>JSON.stringify({action:'skip',reason:'现在不聊'})})
 const today=new Date().toLocaleDateString('en-CA')
 writeFileSync(join(x.dir,'autonomous-planner.json'),JSON.stringify({version:1,day:today,runs:92,lifeRuns:7,socialRuns:5,willingnessRuns:80,recent:[]}))
 assert.equal((await x.decide({sourceKey:'verified-dm-new-1'})).action,'skip')
 let row=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 assert.equal(row.runs,12)
 assert.equal(row.willingnessRuns,81)
 assert.equal((await x.decide({sourceKey:'verified-dm-new-2'})).action,'skip')
 row=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 assert.equal(row.runs,12)
 assert.equal(row.willingnessRuns,82)
 assert.equal(row.lifeRuns,7)
 assert.equal(row.socialRuns,5)
})

test('统一意愿模型接收受信任的结构化 Episode/关系证据，但决策 trace 不保存证据正文',async t=>{
 let prompt=''
 const x=fixture(t,{response:p=>{prompt=p;return JSON.stringify({action:'skip',reason:'现在想休息'})}})
 const actor=createLifeWillingness({dataDir:x.dir,getAccountTag:()=>A,enabled:()=>true,
  getContext:async({evidence})=>({voice:'自然',world:{mood:'calm'},experience:evidence}),
  invokeModel:async p=>{prompt=p;return JSON.stringify({action:'skip',reason:'现在想休息'})}})
 await actor.decide({sourceKey:'verified-evidence:123',scene:'dm',candidates:[{id:'reply_dm',kind:'dm_reply',label:'回复'}],
  evidence:{episode:{status:'active',history:[{action:'dm_reply',outcome:'verified',channel:'dm'}]},relationship:{tier:'friend',stage:'familiar'}}})
 assert.match(prompt,/dm_reply/)
 assert.match(prompt,/familiar/)
 assert.match(prompt,/verified/)
 assert.doesNotMatch(JSON.stringify(x.trace.list()),/familiar|dm_reply/)
})
