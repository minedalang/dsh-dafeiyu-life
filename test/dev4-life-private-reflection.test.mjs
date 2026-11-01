import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {preparePrivateLifeEvent,canReadPrivate} from '../lib/life-private-policy.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {createSocialInteractionCoordinator} from '../lib/social-interaction-coordinator.mjs'

const at=Date.parse('2026-11-01T00:00:00.000Z')
const mk=()=>mkdtempSync(join(tmpdir(),'dafeiyu-private-life-'))
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionMemoryHalfLifeDays:30})

test('私信过滤：敏感内容、陌生人身份和未经验证内容不得进入候选，实际文本不落盘',()=>{
 assert.equal(preparePrivateLifeEvent({source:'friend-dm',role:'stranger',uid:'456',eventId:'a',text:'我喜欢游戏',at}),null)
 assert.equal(preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'a',text:'我的验证码是123456',at}),null)
 assert.equal(preparePrivateLifeEvent({source:'owner-dm',role:'owner',uid:'123',eventId:'a',text:'联系我13800000000',at}),null)
 assert.equal(preparePrivateLifeEvent({source:'owner-session',role:'owner',eventId:'a',text:'你为什么这么说',at}),null)
 const e=preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'a',text:'我不想你主动给我发私信了，谢谢',at})
 assert.equal(e.visibility,'friend-private');assert.equal(e.subjectUid,'456')
 assert.doesNotMatch(JSON.stringify(e),/我不想你主动给我发私信了/)
 assert.match(e.text,/尊重/)
})

test('双层记忆隔离：主人与好友各自可回忆，公开评论/别的好友不可；私密档案仅留脱敏元数据',()=>{
 const dir=mk()
 try{
  const mem=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>at})
  const owner=preparePrivateLifeEvent({source:'owner-dm',role:'owner',uid:'123',eventId:'o1',text:'我最近累了，今天想轻松聊天',at})
  const friend=preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'f1',text:'我不想你主动发私信',at})
  assert.equal(mem.recordEvents([owner,friend]).added,2)
  assert.ok(mem.recall({query:'轻松',domain:'main-session',role:'owner'}).some(e=>e.kind==='private-social'))
  assert.ok(mem.recall({query:'边界',domain:'bili-dm',role:'friend',actorUid:'456'}).some(e=>e.kind==='private-social'))
  assert.equal(mem.recall({query:'边界',domain:'bili-life',role:'friend',actorUid:'456'}).length,0)
  assert.equal(mem.recall({query:'边界',domain:'bili-dm',role:'friend',actorUid:'999'}).length,0)
  assert.equal(mem.recall({query:'轻松',domain:'bili-dm',role:'stranger',actorUid:'789'}).length,0)
  assert.equal(mem.reflectionEvidence([owner.key,friend.key]).length,0)
  assert.equal(mem.reflectionEvidence([friend.key],{visibility:'friend-private',subjectUid:'456'}).length,1)
  assert.equal(mem.reflectionEvidence([friend.key],{visibility:'owner-private',subjectUid:'owner'}).length,0)
  const archive=join(dir,'life-memory','archive',readdirSync(join(dir,'life-memory','archive'))[0])
  const record=readFileSync(archive,'utf8');assert.doesNotMatch(record,/我最近累了|我不想你主动/)
  assert.doesNotMatch(record,/尊重这项请求|更轻松的交流方式/)
  assert.doesNotMatch(record,/\"subjectUid\":\"456\"/,'永久档案不得保留好友明文 UID')
  mem.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('分域反思：私密批次不能与公开混合，也不能写入公开长期记忆或公开人格变化',async()=>{
 const dir=mk();const prompts=[],publicWrites=[],personality=[]
 try{
  const memory=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>at})
  const reflection=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:memory,now:()=>at,
    commitMemories:x=>{publicWrites.push(...x);return {added:x.length,rows:[]}},
    invokeModel:async prompt=>{prompts.push(prompt);return JSON.stringify({memories:[{candidate_ids:[JSON.parse(prompt.match(/<candidate_data>(.*?)<\/candidate_data>/s)[1])[0].id],insight:'我发现倾听对方明确表达的交流边界很重要',behavior:'以后我应该在交流中尊重这些边界',kind:'relationship',importance:.7}],trait_proposals:[{trait:'social_openness',direction:1,candidate_ids:['fake']}],mood_update:{mood:'warm',intensity:2}})},
    onPersonalityProposals:x=>personality.push(...x),logger:{warn:()=>{}},getPersonalityEnabled:()=>true})
  const life=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:memory,lifeReflection:reflection,now:()=>at,logger:{warn:()=>{}}})
  const friend=preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'a',text:'我不想你主动给我发私信',at})
  assert.equal((await life.recordEvents([friend],{reflect:true})).ok,true)
  const result=await reflection.reflect({force:true})
  assert.equal(result.ok,true);assert.equal(result.created,1)
  assert.equal(publicWrites.length,0);assert.equal(personality.length,0)
  assert.match(prompts[0],/私密经历/)
  assert.equal(memory.privateInsights({domain:'bili-life',role:'friend',actorUid:'456',query:'尊重'}).length,0)
  assert.equal(memory.privateInsights({domain:'bili-dm',role:'friend',actorUid:'999',query:'尊重'}).length,0)
  assert.equal(memory.privateInsights({domain:'bili-dm',role:'friend',actorUid:'456',query:'尊重'}).length,1)
  assert.equal(memory.privateInsights({domain:'main-session',role:'owner',query:'尊重'}).length,0)
  memory.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('社交协调器可补偿好友私信派生经历，不在 outbox 保存原始消息',async()=>{
 const dir=mk()
 try{
  const memory=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>at})
  let failed=true
  const social=createSocialInteractionCoordinator({dataDir:dir,recordLifeEvent:()=>{if(failed){failed=false;return {ok:false,reason:'retry'}}return {ok:true}},logger:{warn:()=>{}}})
  const event=preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'m1',text:'我不想你主动联系我',at})
  assert.equal((await social.record({type:'incoming',source:'dm',role:'friend',actorUid:'456',eventKey:'m1',at,lifeEvent:event})).ok,false)
  const raw=readFileSync(social.file,'utf8')
  assert.doesNotMatch(raw,/我不想你主动联系我/)
  assert.equal((await social.flush()).pending,0)
  assert.equal((await social.record({type:'incoming',source:'dm',role:'friend',actorUid:'456',eventKey:'m1',at,lifeEvent:event})).duplicate,true)
  memory.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
