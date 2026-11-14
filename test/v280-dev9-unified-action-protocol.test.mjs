import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {createLifeContinuationWriteExecutor} from '../lib/life-continuation-write.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {observedVideoFromRead,lifeActionOutcome} from '../lib/life-action-protocol.mjs'
const U='1234567',BV='BV1abcde1234',OTHER='BV1abcde1235',ACCOUNT='a'.repeat(16),ID='b'.repeat(24)
const comment='我想讨论这段已核实公开简介介绍的主题'
const reason='鱼鱼基于实际取得的公开视频资料想作出这次选择'
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autoComment:true,
 commentPerRound:1,commentDailyLimit:10,autoVideoLike:true,autoVideoLikeDailyLimit:10,
 autoVideoCollect:true,agentFollowEnabled:true}
const temp=fn=>{const dir=mkdtempSync(join(tmpdir(),'life-unified-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
async function harness(t,dir){
 let tag=ACCOUNT,uid=U,choices=0
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>tag,
   getContext:()=>({voice:'鱼鱼本人'}),invokeModel:async()=>{choices++;throw Error('must not decide twice')},
   beginTrace:()=>({step(){},finish(){}})})
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>uid,getAccountTag:()=>tag,
   choose:async()=>{choices++;throw Error('second willingness forbidden')},
   verify:(...args)=>will.verify(...args),receipt:(...args)=>will.receipt(...args),
   verifyPlatformState:async({scope,target,receiptId})=>scope===tag&&target===BV&&receiptId==='12345678'})
 await bridge.start();t.after(()=>bridge.stop())
 const post=async(route,body)=>{const env=bridge.env();const response=await fetch(env.BILI_LIFE_ACTION_URL+route,{
   method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
   body:JSON.stringify(body)});return {status:response.status,...await response.json()}}
 const create=(action,body='')=>{
   const kind={comment_video:'video_comment',like_video:'video_like',collect_video:'video_collect',follow_creator:'video_follow'}[action]
   const choice=will.adoptVideoDecision({sourceKey:'life-episode:'+action+':'+cryptoRandom(),kind,target:BV,commentText:body})
   assert.equal(choice.ok,true,choice.reason)
   const registration=bridge.registerTrustedIntent({proof:choice.proof,kind,target:BV,commentText:body,scope:tag,uid})
   assert.equal(registration.ok,true,registration.code)
   return {choice,registration}
 }
 return {will,bridge,post,create,choices:()=>choices,setTag:v=>tag=v}
}
let unique=0;const cryptoRandom=()=>String(++unique)
test('Life Episode comment uses exact one-shot proof and no second model or video round ID',t=>temp(async dir=>{
 const h=await harness(t,dir)
 const {registration}=h.create('comment_video',comment)
 const base={uid:U,tool:'bili_reply',target:BV,topLevel:true,commentText:comment,intentTicket:registration.ticket}
 assert.equal((await h.post('/life-action',{...base,commentText:comment+'改'})).reason,'life-intent-target-mismatch')
 assert.equal((await h.post('/life-action',{...base,target:OTHER})).reason,'life-intent-target-mismatch')
 const grant=await h.post('/life-action',base)
 assert.equal(grant.ok,true)
 assert.equal((await h.post('/life-action',base)).ok,false,'ticket cannot authorize a second attempt')
 const result=await h.post('/life-action-result',{uid:U,grant:grant.grant,ok:true,receiptId:'12345678'})
 assert.equal(result.status,'verified')
 assert.equal(h.choices(),0,'Life Episode already decided intention and exact text')
 assert.equal(h.bridge.status().pending,0)
 assert.equal((await h.post('/life-action-result',{uid:U,grant:grant.grant,ok:true,receiptId:'12345678'})).ok,false)
}))
test('preapproved video likes share bridge verification; mismatched action and changed account fail closed',t=>temp(async dir=>{
 const h=await harness(t,dir)
 const first=h.create('like_video')
 assert.equal((await h.post('/life-action',{uid:U,tool:'bili_video_collect',target:BV,intentTicket:first.registration.ticket})).ok,false)
 const grant=await h.post('/life-action',{uid:U,tool:'bili_video_like',target:BV,intentTicket:first.registration.ticket})
 assert.equal(grant.ok,true)
 const unverified=await h.post('/life-action-result',{uid:U,grant:grant.grant,ok:true})
 assert.equal(unverified.status,'accepted-unverified','writer success without independent matching GET is not verified')
 const second=h.create('like_video')
 h.setTag('c'.repeat(16))
 assert.equal((await h.post('/life-action',{uid:U,tool:'bili_video_like',target:BV,intentTicket:second.registration.ticket})).ok,false)
 assert.equal(h.bridge.cancelTrustedIntent(second.registration.ticket).ok,false,'changed account entry was invalidated')
}))
test('declined/blocked/unoffered/verified/uncertain are distinct outcomes',()=>{
 assert.equal(lifeActionOutcome({offered:false}),'not_offered')
 assert.equal(lifeActionOutcome({decision:'skip'}),'declined')
 assert.equal(lifeActionOutcome({decision:'defer'}),'deferred')
 assert.equal(lifeActionOutcome({gate:'account-changed'}),'blocked')
 assert.equal(lifeActionOutcome({delivery:'verified'}),'verified')
 assert.equal(lifeActionOutcome({delivery:'accepted-unverified'}),'uncertain')
})
test('one original Life decision reaches the same execution gateway and writer without another AI vote',t=>temp(async dir=>{
 const h=await harness(t,dir)
 const entry={id:ID,status:'inspected',selectedBvid:BV,metadataAt:Date.now()-1000,
   expiresAt:Date.now()+3600_000,nextAt:0}
 let invocations=0,observedTicket=''
 const execute=createLifeContinuationWriteExecutor({getConfig:()=>cfg,getAccountTag:()=>ACCOUNT,
   getAccountUid:()=>U,getIntention:()=>entry,getPublicEvidence:async()=>({ok:true,bvid:BV,
   title:'真实公开视频',description:'确实核验过的一些公开视频资料',commentReady:true}),
   markSelected:async()=>({ok:true}),
   prepareIntent:({kind,target,commentText,sourceKey},{scope,uid})=>{
     const choice=h.will.adoptVideoDecision({kind,target,commentText,sourceKey})
     if(!choice.ok)return choice
     return h.bridge.registerTrustedIntent({proof:choice.proof,kind,target,commentText,scope,uid})
   },cancelIntent:ticket=>h.bridge.cancelTrustedIntent(ticket),
   runWriter:async({action,bvid,text},{intentTicket})=>{
     invocations++;observedTicket=intentTicket
     const grant=await h.post('/life-action',{uid:U,tool:action==='comment_video'?'bili_reply':'bili_video_like',
       target:bvid,commentText:text,topLevel:true,intentTicket})
     assert.equal(grant.ok,true,grant.reason)
     const result=await h.post('/life-action-result',{uid:U,grant:grant.grant,ok:true,receiptId:'12345678'})
     return {ok:true,status:result.status}
   },bridgeReady:()=>true})
 const result=await execute({action:'comment_video',id:ID,bvid:BV,reason,text:comment},ACCOUNT)
 assert.equal(result.status,'verified');assert.equal(invocations,1)
 assert.match(observedTicket,/^[0-9a-f-]{36}$/)
 assert.equal(h.choices(),0)
}))
test('owner DM and social immediate video reads use one canonical observation journal with scope + evidence checks',()=>temp(async dir=>{
 const credentials={dedeuserid:U,sessdata:'token-for-test'},scope=discussionAccountTag(credentials)
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>credentials,now:()=>Date.now()})
 const read={ok:true,bvid:BV,info:{bvid:BV,title:'来自真实公开 API 的视频标题'}}
 for(const source of ['social-read-now','owner-dm-read']){
   const observation=observedVideoFromRead({source,sourceId:'model-chose:'+source+':123',
     expectedBvid:BV,read,accountTag:scope})
   assert.equal(observation.ok,true)
   const first=life.beginVideoObservation(observation,scope)
   assert.equal(first.ok,true)
   assert.equal(life.beginVideoObservation(observation,scope).id,first.id,'no duplicate episode')
 }
 assert.equal(life.continuations().length,2)
 assert.equal(life.beginVideoObservation(observedVideoFromRead({source:'social-read-now',sourceId:'bad',
   expectedBvid:BV,read:{...read,info:{...read.info,bvid:OTHER}},accountTag:scope}),scope).ok,false)
 const valid=observedVideoFromRead({source:'social-read-now',sourceId:'account-switch',expectedBvid:BV,read,accountTag:scope})
 assert.equal(life.beginVideoObservation(valid,'c'.repeat(16)).ok,false)
}))

test('legacy owner requests without a model Agent use the SAME Life arbiter once, never emotion thresholds',t=>temp(async dir=>{
 const {unifiedLegacySocialChoice}=await import('../lib/life-action-protocol.mjs')
 let modelCalls=0,scope=ACCOUNT,approval=null
 const model=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,
   getContext:()=>({voice:'鱼鱼可以接受也可以拒绝',world:{}}),
   invokeModel:async()=>{modelCalls++;return JSON.stringify({action:'act',candidateId:'legacy_social',reason:'我自己想了解'})},
   beginTrace:()=>({step(){},finish(){}})})
 const decide=(props={})=>unifiedLegacySocialChoice({lifeWillingness:model,source:'bili-dm',
   uid:U,messageId:'1234567:verified-event-1',intent:'explore',target:BV,...props})
 const result=await decide()
 assert.equal(result.decision,'allow')
 assert.equal(modelCalls,1,'not a second model or fixed emotion score')
 assert.equal(model.status().activeAccounts,0,'delegated action has no orphaned proof')
 const denial=await decide({source:'untrusted'})
 assert.equal(denial.decision,'blocked');assert.equal(modelCalls,1)
 scope='not-an-account'
 const noScope=await decide({messageId:'1234567:verified-event-2'})
 assert.notEqual(noScope.decision,'allow','no account must never authorize legacy side effect')
}))

test('unified host routes have no remaining production emotion-score voter or independent social invitation comment publisher',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.doesNotMatch(code,/dualContextAgency\.decide\(/)
 const start=code.indexOf("if(action.type==='social_invite'){",code.indexOf('const ownerCommentAgent=createOwnerCommentAgent'))
 const end=code.indexOf("return {ok:false,error:'不支持的评论动作'}",start)
 const invited=code.slice(start,end)
 assert.ok(start>0)
 assert.match(invited,/beginVideoObservation\(observation,scope\)/)
 assert.doesNotMatch(invited,/decideOwnerSocialComment\(|runOwnerDmPublishComment\(/)
 assert.match(code,/decideAgency:\(\{uid,messageId,text,intent,target\}\)=>dualContextAgency.recordAI/)
})
