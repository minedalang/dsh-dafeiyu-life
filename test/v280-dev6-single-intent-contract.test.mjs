import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {intakeAiReadProposals} from '../lib/social-todo-intake.mjs'
const TAG='a'.repeat(16),BV='BV1hVWQ6ZEcw',T=Date.parse('2026-11-12T03:00:00Z')
function tmp(t){const dir=mkdtempSync(join(tmpdir(),'dev6-intent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
function intake(t,{timing='now',disposition='accept',kind='dm',bvid=BV}={}){
 const dir=tmp(t),engine=createOwnerTodoEngine({dataDir:dir,now:()=>T,getAccountUid:()=> '999888777'}),agency=createDualContextAgency({dataDir:dir,now:()=>T,
  getEmotion:()=>({energy:0,sociality:0,curiosity:0})})
 const input={row:{incoming:true,senderUid:'123456',messageId:'fresh-message',timestampMs:T,text:'去看我的作品 https://www.bilibili.com/video/'+bvid,senderName:'test'},channel:kind,
  todoDisposition:disposition,todoTiming:timing,suggestedTodo:{type:'watch_video',bvid,title:'公开作品',evidence:bvid},currentMessages:['去看我的作品 https://www.bilibili.com/video/'+bvid],
  now:()=>T,todos:engine,decide:req=>agency.recordAI({source:kind==='dm'?'bili-dm':'bili-comment',...req,action:'read_todo',decision:'allow'})}
 return {engine,agency,input,call:()=>intakeAiReadProposals(input)}
}
test('original social model alone records now willingness even with extreme low emotions',t=>{
 const s=intake(t),out=s.call()
 assert.equal(out.complete,true)
 assert.equal(out.createdCount,1)
 const row=s.engine.list()[0]
 assert.equal(row.acceptance.kind,'social-willingness')
 assert.equal(row.acceptance.timing,'now')
 assert.equal(row.origin.kind,'bilibili-dm')
 assert.equal(s.agency.assessReadExecution({task:row}).decision,'allow')
 assert.equal(s.call().duplicateCount,1)
 assert.equal(s.engine.list().length,1)
})
test('accepted later remains deferred and cannot claim an immediate intention',t=>{
 const s=intake(t,{timing:'later'}),out=s.call()
 assert.equal(out.createdCount,1)
 assert.equal(s.engine.list()[0].acceptance.timing,'later')
})
test('invalid BV, non-AI acceptance and forged action do not create jobs',t=>{
 for(const p of [{bvid:'BV123'},{disposition:'refuse'}]){
  const s=intake(t,p);assert.equal(s.call().createdCount,0);assert.equal(s.engine.list().length,0)
 }
 const s=intake(t)
 s.input.suggestedTodo={type:'dm_friend',uid:'123456',evidence:BV}
 assert.equal(s.call().createdCount,0)
 assert.equal(s.engine.list().length,0)
})
test('verified DM follow-next-action can seal first social decision without another model vote',async t=>{
 const dir=tmp(t);let modelCalls=0,scope=TAG
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,enabled:()=>true,
  getContext:()=>'',invokeModel:async()=>{modelCalls++;throw Error('second model forbidden')},now:()=>T})
 const p=await will.adoptSocialDecisionQueued({kind:'dm_follow',uid:'123456',sourceKey:'dm-follow:123456:msg-01',messages:[]})
 assert.equal(p.ok,true)
 assert.equal(modelCalls,0)
 assert.equal(will.verify(p.proof,'dm_follow',{uid:'999999'}).ok,false,'cannot switch target')
 assert.equal(will.verify(p.proof,'dm_follow',{uid:'123456'}).ok,true)
 assert.equal(will.verify(p.proof,'dm_follow',{uid:'123456'}).ok,false,'cannot reuse action')
 assert.equal(will.receipt(p.proof,{status:'not-sent'}).ok,true)
 scope='b'.repeat(16)
 assert.equal(will.verify(p.proof,'dm_follow',{uid:'123456'}).ok,false,'cannot reuse across account')
})
test('DM follow seal rejects unverified text and never enables unknown action types',async t=>{
 const dir=tmp(t)
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,enabled:()=>true,getContext:()=>'',invokeModel:async()=>''})
 assert.equal((await will.adoptSocialDecisionQueued({kind:'dm_follow',uid:'123456',sourceKey:'dm-follow:123456:a',messages:['unapproved text']})).ok,false)
 assert.equal((await will.adoptSocialDecisionQueued({kind:'dm_friend',uid:'123456',sourceKey:'dm-follow:123456:b',messages:[]})).ok,false)
})
test('no second model vote may be added in specialist followup or friend message drafting',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(code,/adoptSocialDecisionQueued\(\{kind:intentKind/)
 assert.doesNotMatch(code,/lifeWillingness\?\.decide\(\{trigger:'dm-relationship'/)
 assert.match(code,/Life 已经自主选择联系，不要再次对同一联系意愿投票/)
 assert.match(code,/这里不是第二次是否愿意的投票，只负责生成真实、有依据的表达/)
 const follow=code.split('const ownerTodoFollowup=createOwnerTodoFollowup(')[1]?.split('onSent:async')[0]||''
 assert.match(follow,/const body=naturalFollowupText/)
 assert.doesNotMatch(follow,/\['reply','defer','skip'\]\.includes\(obj\.decision\)/)
})
