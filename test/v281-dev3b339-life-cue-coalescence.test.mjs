import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {plannerActionMenu} from '../lib/autonomous-planner.mjs'
const A='a'.repeat(16)
const run=testFn=>{const dir=mkdtempSync(join(tmpdir(),'dev339-life-'));try{return testFn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('quiet-window wake reuses one outstanding attention signal despite many timer intervals',()=>run(dir=>{
  let time=100_000
  const x=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>time})
  const first=x.offer({kind:'quiet-window',sourceKey:'window:1'})
  for(let i=2;i<40;i++){
    time+=60_000
    assert.equal(x.offer({kind:'quiet-window',sourceKey:'window:'+i}).coalesced,true)
  }
  assert.equal(x.status().pending,1)
  assert.equal(x.peek(4).filter(r=>r.kind==='quiet-window').length,1)
  x.settle([first.id],'considered')
  assert.equal(x.offer({kind:'quiet-window',sourceKey:'window:new'}).created,true)
}))

test('pending experience-ready cues cap at three without model instruction or write permission',()=>run(dir=>{
  const x=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>120_000})
  for(let i=0;i<20;i++)x.offer({kind:'experience-ready',sourceKey:'verified:'+i})
  assert.equal(x.status().pending,3)
  const raw=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(raw,/verified:\d|message|BV1/)
}))

test('expired or exhausted Episode does not re-enter resume decision menu',()=>{
  const old={id:'spent',status:'ready',episodeSteps:5,episodeMaxSteps:5,videos:[{bvid:'BV1abCdEfGhI'}]}
  const good={id:'live',status:'ready',episodeSteps:1,episodeMaxSteps:5,videos:[{bvid:'BV1234567890'}]}
  const choices=plannerActionMenu({intents:[old,good]})
  assert.deepEqual(choices.find(x=>x.action==='resume_episode').ids,['live'])
  assert.equal(choices.find(x=>x.action==='inspect_exploration').targets.some(x=>x.id==='spent'),false)
  const no=plannerActionMenu({intents:[old]})
  assert.equal(no.some(x=>x.action==='resume_episode'),false)
})
