import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeTraceExplanation,lifeTracePresentation,createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {currentAccountRelationshipView} from '../lib/account-memory-boundary.mjs'
import {createAccountBinding} from '../lib/account-binding.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'

const TIME=Date.parse('2026-11-19T12:00:00Z')
const A='a'.repeat(16),B='b'.repeat(16)
const r1='1'.repeat(16),r2='2'.repeat(16)
const row=steps=>({state:'finished',at:TIME,updatedAt:TIME,steps:steps.map(s=>({at:TIME,...s}))})
const ex=(actionRef,result,delivery)=>({type:'execution-result',actionRef,result,delivery})
const ar=(actionRef,result)=>({type:'action-result',actionRef,result})
const cred=uid=>({dedeuserid:uid,sessdata:'fake',bili_jct:'fake'})
const inHome=async fn=>{const p=mkdtempSync(join(tmpdir(),'dev11-life-'));try{return await fn(p)}finally{rmSync(p,{recursive:true,force:true})}}

test('linked execution and action receipt prove only their own platform confirmation',()=>{
 const one=row([{type:'model-choice',code:'valid',action:'act'},ex(r1,'verified','platform-confirmed'),ar(r1,'verified')])
 assert.equal(lifeTraceExplanation(one,TIME).category,'platform-verified')
 assert.equal(lifeTracePresentation(one,TIME),'platform-verified')
 const two=row([{type:'model-choice',code:'valid',action:'act'},ex(r1,'verified','platform-confirmed'),ar(r1,'verified'),ex(r2,'verified','platform-confirmed'),ar(r2,'verified')])
 assert.equal(lifeTraceExplanation(two,TIME).category,'platform-verified')
 const local=row([ex(r1,'verified','not-proven'),ar(r1,'verified')])
 assert.equal(lifeTraceExplanation(local,TIME).category,'local-result-unverified')
 assert.notEqual(lifeTracePresentation(local,TIME),'platform-verified')
})

test('unknown receipt always blocks success; independent failure is mixed, same-action mismatch is unresolved',()=>{
 const unknown=row([ex(r1,'verified','platform-confirmed'),ar(r1,'verified'),ex(r2,'uncertain','outcome-unknown'),ar(r2,'uncertain')])
 assert.equal(lifeTraceExplanation(unknown,TIME).category,'result-uncertain')
 const mixed=row([ex(r1,'verified','platform-confirmed'),ar(r1,'verified'),ex(r2,'failed','not-sent'),ar(r2,'failed')])
 assert.equal(lifeTraceExplanation(mixed,TIME).category,'mixed-outcomes')
 assert.equal(lifeTracePresentation(mixed,TIME),'result-uncertain')
 const contradicted=row([ex(r1,'verified','platform-confirmed'),ar(r1,'failed')])
 assert.equal(lifeTraceExplanation(contradicted,TIME).category,'result-uncertain')
 // Do not heuristically pair raw legacy steps; conflict remains conservative.
 assert.equal(lifeTraceExplanation(row([ex(undefined,'verified','platform-confirmed'),ar(undefined,'failed')]),TIME).category,'result-uncertain')
})

test('only fixed-length anonymous refs pass trace sanitization and account directories remain separate',()=>inHome(async dir=>{
 let account=A
 const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>account,now:()=>TIME})
 const a=trace.begin({trigger:'social'})
 a.step('execution-result',{actionRef:r1,action:'dm_reply',result:'verified',delivery:'platform-confirmed',rawUid:'987654',rawMessage:'A confidential DM'})
 a.step('action-result',{actionRef:r1,action:'dm_reply',result:'verified'})
 a.finish({state:'finished',result:'verified'})
 const read=trace.get(a.id)
 assert.equal(read.explanation.category,'platform-verified')
 assert.equal(read.run.steps[0].actionRef,r1)
 assert.doesNotMatch(JSON.stringify(read),/987654|confidential/)
 account=B
 assert.equal(trace.get(a.id).ok,false)
 const b=trace.begin({trigger:'social'})
 b.step('execution-result',{actionRef:'this-is-not-a-hash',result:'verified',delivery:'platform-confirmed'})
 b.finish({state:'finished',result:'verified'})
 assert.equal(trace.get(b.id).run.steps[0].actionRef,undefined)
}))

test('Life historical acquaintance survives, but new B account has new relationship and no reciprocal recognition proof',()=>{
 const historical={count:25,stage:'friend',score:90}
 const newAccount=currentAccountRelationshipView(historical,null)
 assert.equal(newAccount.knownBefore,true)
 assert.equal(newAccount.stage,'new')
 assert.equal(newAccount.seenHere,false)
 assert.equal(newAccount.dmEligible,false)
 assert.equal(newAccount.otherPartyRecognizesUs,'unverified')
 const current={total:{count:14,activeDays:7,incoming:7,outgoing:7,firstAt:TIME-17*86400000,lastAt:TIME},dmOpenness:{eligible:true}}
 const familiar=currentAccountRelationshipView(historical,current)
 assert.equal(familiar.stage,'friend')
 assert.equal(familiar.seenHere,true)
 assert.equal(familiar.dmEligible,true)
 assert.equal(familiar.otherPartyRecognizesUs,'unverified','even reciprocal DM does not prove the other user knows the old account identity')
 const publicOnly=currentAccountRelationshipView(historical,{total:{count:5,activeDays:3,incoming:3,outgoing:2,firstAt:TIME-5*86400000,lastAt:TIME},dmOpenness:{eligible:false}})
 assert.equal(publicOnly.stage,'familiar')
 assert.equal(publicOnly.dmEligible,false)
})

test('production Bilibili account switch keeps Life character while retaining old account-scoped channel boundary',()=>inHome(async dir=>{
 writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(cred('10001')))
 let account=createAccountBinding({dataDir:dir,verifier:async c=>({uid:c.dedeuserid})})
 const id=account.characterId()
 account.stage(cred('20002'))
 const result=await account.activate({expectedUid:'20002'})
 assert.equal(result.changed,true)
 assert.equal(result.reviewRequired,true)
 assert.equal(result.restartRequired,true)
 assert.equal(account.characterId(),id)
 assert.equal(account.status().blocked,true)
 assert.equal(account.taskAllowed({accountUid:'10001'}),false)
 account=createAccountBinding({dataDir:dir,verifier:async c=>({uid:c.dedeuserid})})
 account.acknowledgeRestart()
 account.resume({expectedUid:'20002'})
 assert.equal(account.status().blocked,false)
 assert.equal(account.characterId(),id)
 assert.equal(account.taskAllowed({accountUid:'10001'}),false)
 assert.equal(account.taskAllowed({accountUid:'20002'}),true)
 const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(src,/currentAccountRelationshipView\(existingRelationshipIndex\(\)\?\.get\(numericUid/)
 assert.match(src,/对方可能完全不认识当前账号/)
 assert.match(src,/const local=relationshipChannels\(\)\?\.get\(row\.uid\)/)
}))

test('real Life willingness production trace correlates its own approved action and actual callback',()=>inHome(async dir=>{
 const traces=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>A,now:()=>TIME})
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>A,now:()=>TIME,
   getContext:async()=>({voice:'Fish',world:{},experience:{}}),
   invokeModel:async()=>JSON.stringify({action:'act',candidateId:'candidate',reason:'愿意先检查'}),
   beginTrace:args=>traces.begin(args)})
 const decision=await will.decide({trigger:'video-observed',scene:'video',sourceKey:'video:sample-ref',
   candidates:[{id:'candidate',kind:'explore_video',label:'可验证公开视频探索'}]})
 assert.equal(decision.ok,true)
 const pre=traces.list().runs[0]
 const plan=pre.steps.find(s=>s.type==='execution-plan')
 assert.match(plan.actionRef,/^[a-f0-9]{16}$/)
 assert.equal(pre.explanation.category,'approval-pending')
 assert.equal(will.receipt(decision.proof,{status:'verified',receiptId:'read-only-source-confirmed'}).ok,true)
 const after=traces.get(pre.id)
 assert.equal(after.ok,true)
 const endings=after.run.steps.filter(s=>['action-result','execution-result'].includes(s.type))
 assert.equal(endings.length,2)
 assert.equal(endings[0].actionRef,plan.actionRef)
 assert.equal(endings[1].actionRef,plan.actionRef)
 assert.equal(after.explanation.category,'platform-verified')
 assert.doesNotMatch(JSON.stringify(after),/video:sample-ref|read-only-source-confirmed/)
}))

test('roadmap keeps actual account migration and open platform APIs out of 2.8.2',()=>{
 const roadmap=readFileSync(new URL('../docs/ROADMAP.md',import.meta.url),'utf8')
 const proposal=readFileSync(new URL('../docs/architecture/future-life-account-relationship-continuity.md',import.meta.url),'utf8')
 assert.match(roadmap,/换号后的 Life 记忆与关系延续设计/)
 assert.match(proposal,/不自动搜老友发私信/)
 assert.match(proposal,/friendDirectory/)
 assert.match(roadmap,/真实 API 未实施/)
})
