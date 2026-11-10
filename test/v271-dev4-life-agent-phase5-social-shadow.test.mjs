import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeSocialShadow,parseLifeSocialShadowDecision,classifyLegacySocialDecision} from '../lib/life-social-shadow.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const A='a'.repeat(16),B='b'.repeat(16),ID='c'.repeat(24)
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-phase5-test-'));try{await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
function make(){
  let account=A,enabled=false,t=Date.parse('2026-11-05T12:00:00Z')
  const shadow=createLifeSocialShadow({getAccountTag:()=>account,getConsent:()=>enabled,now:()=>t})
  return {shadow,enable:()=>{enabled=true},disable:()=>{enabled=false},switchAccount:v=>{account=v},later:v=>{t+=v},get account(){return account},get time(){return t}}
}
test('opt-in is required, friend DM only; stranger and owner private texts cannot stage',()=>{
  const v=make(),args={eventId:ID,channel:'dm',uid:'123',sourceKey:'m1',text:'私密内容',role:'friend',verified:true}
  assert.equal(v.shadow.capture(args).reason,'not-opted-in')
  v.enable()
  assert.equal(v.shadow.capture({...args,role:'owner'}).ok,false)
  assert.equal(v.shadow.capture({...args,role:'stranger'}).ok,false)
  assert.equal(v.shadow.capture({...args,verified:false}).ok,false)
  assert.equal(v.shadow.capture(args).created,true)
  assert.equal(v.shadow.capture(args).created,false)
  assert.equal(v.shadow.preview({eventId:ID,channel:'dm',expectedScope:A}).excerpt,'私密内容')
  assert.equal(v.shadow.capture({...args,uid:'124'}).reason,'event-collision')
  assert.equal(v.shadow.status().staged,1)
  assert.doesNotMatch(JSON.stringify(v.shadow.status()),/私密内容|123|m1|a{16}/)
})
test('public comment needs verified source, current account, TTL and explicit revocation',()=>{
  const v=make();v.enable()
  const row={eventId:ID,channel:'comment',uid:'234',sourceKey:'BV1ABcdE123:77',text:'公开文本',role:'stranger',verified:true}
  assert.equal(v.shadow.capture(row).ok,true)
  assert.equal(v.shadow.preview({eventId:ID,channel:'dm',expectedScope:A}).ok,false)
  v.switchAccount(B)
  assert.equal(v.shadow.preview({eventId:ID,channel:'comment',expectedScope:A}).reason,'account-changed')
  assert.equal(v.shadow.status().staged,0)
  v.switchAccount(A)
  v.disable();v.shadow.revoke();assert.equal(v.shadow.preview({eventId:ID,channel:'comment',expectedScope:A}).reason,'not-opted-in')
  v.enable();assert.equal(v.shadow.preview({eventId:ID,channel:'comment',expectedScope:A}).ok,false)
  assert.equal(v.shadow.capture(row).ok,true)
  v.later(10*60_000+1)
  assert.equal(v.shadow.preview({eventId:ID,channel:'comment',expectedScope:A}).reason,'verified-context-expired')
})
test('shadow and legacy decision comparison is categorical, in-memory and account isolated',()=>{
  const v=make();v.enable();v.shadow.capture({eventId:ID,channel:'dm',uid:'123',sourceKey:'msg',text:'你好吗',role:'friend',verified:true})
  assert.equal(v.shadow.noteLegacy({channel:'dm',uid:'123',sourceKey:'msg',action:'reply'}).paired,false)
  assert.equal(v.shadow.noteLife({eventId:ID,expectedScope:A,action:'silent'}).paired,true)
  assert.deepEqual([v.shadow.status().paired,v.shadow.status().disagreed],[1,1])
  v.switchAccount(B);assert.equal(v.shadow.status().paired,0)
  assert.equal(v.shadow.noteLife({eventId:ID,expectedScope:A,action:'reply'}).ok,false)
})
test('model JSON is strictly categorical; legacy result is classified but never sent by shadow',()=>{
  assert.equal(parseLifeSocialShadowDecision('{"action":"reply"}'),'reply')
  assert.equal(parseLifeSocialShadowDecision('{"action":"send_message","to":"1"}'),'invalid')
  assert.equal(parseLifeSocialShadowDecision('reply'),'invalid')
  assert.equal(parseLifeSocialShadowDecision('{"action":"reply","sendTo":"123"}'),'invalid')
  assert.equal(classifyLegacySocialDecision({action:'reply',messages:['你好']}),'reply')
  assert.equal(classifyLegacySocialDecision({action:'defer'}),'defer')
  assert.equal(classifyLegacySocialDecision({action:'skip'}),'silent')
  assert.equal(classifyLegacySocialDecision('SKIP'),'silent')
})
async function plannerScenario(dir,{optIn=true,maxRuns=5,modelDuringSecond=()=>{}}={}){
  const v=make();if(optIn)v.enable()
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>v.account,now:()=>v.time})
  const offered=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'123:msg'})
  v.shadow.capture({eventId:offered.id,channel:'dm',uid:'123',sourceKey:'msg',text:'合成好友私信：在吗？',role:'friend',verified:true})
  let calls=0,sends=0,prompts=[]
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'shadow',autonomousPlannerDailyLimit:maxRuns,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,autonomousPlannerMinutes:5}),
    getLifeAccountTag:()=>v.account,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:row=>events.recordDecision(row),
    getLifeSocialPreview:x=>v.shadow.preview(x),noteLifeSocialShadow:x=>v.shadow.noteLife(x),
    getTodos:()=>[],getLifeCapabilities:()=>[],getLifeVoice:()=> '鱼鱼可以沉默',
    invokeModel:async prompt=>{prompts.push(prompt);calls++;if(calls===1)return JSON.stringify({action:'consider_social',id:offered.id});modelDuringSecond(v);return JSON.stringify({action:'defer'})},
    executeRead:()=>{sends++;return {ok:true}},updateTodo:()=>{sends++},reflect:()=>{sends++}})
  const result=await planner.tick({force:true})
  return {v,result,events,planner,calls,sends,prompts}
}
test('retired social shadow: planner considers social event once; no second private model call or send',()=>withDir(async dir=>{
  const r=await plannerScenario(dir)
  assert.equal(r.result.action,'consider_social')
  assert.equal(r.result.result,'social-signal-considered')
  assert.equal(r.calls,1);assert.equal(r.sends,0)
  assert.equal(r.prompts.length,1);assert.doesNotMatch(r.prompts[0],/合成好友私信/)
  assert.equal(r.planner.status().runs,1)
  assert.equal(r.v.shadow.status().lifeChoices,0)
  const ledger=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(ledger,/合成好友私信|123|msg/)
  assert.match(ledger,/social-signal-considered/)
}))
test('without opt-in or daily budget the planner never requests private content',()=>withDir(async dir=>{
  const r=await plannerScenario(dir,{optIn:false})
  assert.equal(r.result.result,'social-signal-considered');assert.equal(r.calls,1)
  const other=await plannerScenario(join(dir,'other'),{optIn:true,maxRuns:1})
  assert.equal(other.result.result,'social-signal-considered');assert.equal(other.calls,1)
}))
test('revoking legacy shadow consent does not change active social attention ownership',()=>withDir(async dir=>{
  const r=await plannerScenario(dir,{modelDuringSecond:v=>v.disable()})
  assert.equal(r.result.result,'social-signal-considered')
  assert.equal(r.calls,1);assert.equal(r.v.shadow.status().lifeChoices,0)
  assert.equal(r.sends,0)
}))
test('production wiring uses opt-in, verified callbacks, no send API and exposes bounded status',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/lifeAgentSocialContextOptIn: z\.boolean\(\)\.default\(false\)/)
  assert.match(src,/lifeSocialShadowConfirm!=='ENABLE_READ_ONLY_SHADOW'/)
  assert.match(src,/lifeSocialShadow\.revoke\(\)/)
  assert.doesNotMatch(src,/lifeSocialShadow\.capture\(\{eventId:id,channel:'dm'/)
  assert.doesNotMatch(src,/lifeSocialShadow\.capture\(\{eventId:id,channel:'comment'/)
  assert.match(src,/getLifeSocialPreview:params=>lifeSocialShadow\.preview\(params\)/)
  assert.match(src,/socialShadow:lifeSocialShadow\.status\(\)/)
  assert.doesNotMatch(readFileSync(new URL('../lib/life-social-shadow.mjs',import.meta.url),'utf8'),/bili_send_message|bili_reply/)
})
