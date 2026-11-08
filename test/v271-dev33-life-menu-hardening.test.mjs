import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner,plannerActionMenu,validateOfferedLifeAction} from '../lib/autonomous-planner.mjs'
import {createLifeCapabilities} from '../lib/life-capabilities.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'

const ACCOUNT='a'.repeat(16)
const AT=Date.parse('2026-11-08T10:00:00Z')
const BV='BV1234567890'
const withTemp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-menu-audit-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function fixture(dir,{reply,canReflect=false,home=true,reflect=async()=>({ok:true})}={}){
  const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:30,
    autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:home}
  const journal=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>AT})
  const skill=createLifeCapabilities([{id:'bilibili.video-explore',risk:'delegated-existing-permissions',description:'公开视频',
    available:()=>({ok:true}),execute:()=>({started:true})}])
  return createAutonomousPlanner({dataDir:dir,now:()=>AT,getConfig:()=>config,getTodos:()=>[],getLifeAccountTag:()=>ACCOUNT,
    getLifeEvents:()=>journal.peek(),offerLifeWake:x=>journal.offer(x),settleLifeEvents:(ids,why)=>journal.settle(ids,why),
    getLifeEventStatus:()=>journal.status(),getLifeCapabilities:()=>skill.list(),getLifeCapabilityReadiness:()=>skill.inspect(),
    runLifeCapability:(id,opts)=>skill.run(id,opts),recordVideoStart:()=>journal.recordVideoStart(),
    invokeModel:async()=>JSON.stringify(reply),reflectionStatus:()=>({pending:6,canAutoReflect:canReflect}),reflect,
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false})})
}

test('only this turn’s explicit menu grants a Life action (including reflect)',()=>{
  const menu=plannerActionMenu({videoEligible:true,homeEnabled:true,lifeSkills:[{id:'bilibili.video-explore'}],
    cues:[{id:'cue',source:'interest-milestone'}],opportunities:[{id:'opp',source:'discussion-read'}],
    intents:[{id:'intent',status:'ready',videos:[{bvid:BV,title:'verified'}]}],canReflect:false})
  assert.equal(validateOfferedLifeAction({action:'skip'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'reflect'},menu),false,'cooldown must not be revived by model')
  assert.equal(validateOfferedLifeAction({action:'browse_home',capability:'bilibili.video-explore'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'browse_home',capability:'arbitrary-tool'},menu),false)
  assert.equal(validateOfferedLifeAction({action:'use_capability',capability:'bilibili.video-explore'},menu),false,'no wake => no generic delegate')
  assert.equal(validateOfferedLifeAction({action:'inspect_exploration',id:'intent',bvid:BV},menu),true)
  assert.equal(validateOfferedLifeAction({action:'inspect_exploration',id:'intent',bvid:'BV0000000000'},menu),false)
  assert.equal(validateOfferedLifeAction({action:'begin_exploration',id:'cue'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'begin_exploration',id:'invented'},menu),false)
  assert.equal(validateOfferedLifeAction({action:'inspect_opportunity',id:'opp'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'defer',id:'unknown'},menu),false)
  assert.equal(validateOfferedLifeAction({action:'reach_out_friend',id:'invented'},menu),false)
  assert.equal(validateOfferedLifeAction({action:'comment_video',id:'intent'},menu),false,'video writes use a separate guarded continuation contract')
  assert.equal(validateOfferedLifeAction({action:'reflect'},[{action:'reflect'}]),true)
})

test('P0 regression: the model cannot execute unavailable reflection',()=>withTemp(async dir=>{
  let reflected=0
  const life=fixture(dir,{reply:{action:'reflect',reason:'我想反思'},canReflect:false,
    reflect:async()=>{reflected++;return {ok:true}}})
  const result=await life.tick({force:true})
  assert.equal(result.action,'skip')
  assert.equal(result.result,'invalid-decision')
  assert.equal(result.diagnosticCode,'model-action-not-offered')
  assert.equal(reflected,0)
}))

test('when reflection is genuinely offered, voluntary reflect is still valid',()=>withTemp(async dir=>{
  let reflected=0
  const life=fixture(dir,{reply:{action:'reflect',reason:'整理刚才的经历'},canReflect:true,
    reflect:async()=>{reflected++;return {ok:true}}})
  const result=await life.tick({force:true})
  assert.equal(result.action,'reflect')
  assert.equal(result.result,'completed')
  assert.equal(reflected,1)
}))
