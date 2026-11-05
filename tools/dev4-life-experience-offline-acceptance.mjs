import assert from 'node:assert/strict'
import {runLifeExperienceOfflineDemo} from '../lib/life-experience-demo.mjs'
import {lifeExperienceReadiness} from '../lib/life-experience-readiness.mjs'
const r=await runLifeExperienceOfflineDemo()
assert.equal(r.ok,true)
assert.equal(r.cases.length,4)
assert.deepEqual(r.cases.map(c=>c.result),[
  'shadow-would-explore','capability-launched','voluntary-rest','no-actionable-options'])
const ready=lifeExperienceReadiness({config:{masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:20},planner:{runs:0},events:{ok:true,videoStartsToday:0,lastVideoAt:0},capabilities:[{id:'video.start'}]})
assert.equal(ready.videoDelegationEligible,true)
console.log(JSON.stringify({ok:true,scenarios:r.cases.length,synthetic:true,realModelCalls:0,networkCalls:0,externalMessagesSent:0,results:r.cases.map(x=>x.result)},null,2))
