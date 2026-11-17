import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {createNetworkPollBackoff} from '../lib/network-poll-backoff.mjs'

const setup=async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dev3338-netgate-'))
 let t=1_800_000_000_000
 const scope=()=> 'ab12cd34ef56ab78'
 const now=()=>t
 const backoff=createNetworkPollBackoff({dataDir:dir,getAccountTag:scope,now})
 const scheduler=()=>createInteractionScheduler({dataDir:dir,getAccountTag:scope,now,
  dm:{poll:async()=>({skipped:'test'}),status:()=>({fast:{}})},
  comments:{poll:async()=>({skipped:'test'})},getConfig:()=>({masterEnabled:false})})
 return {dir,backoff,scheduler,advance:delta=>{t+=delta}}
}

test('Life DM continuation read gate respects persisted -509 and multi-step probation after restart',async()=>{
 const m=await setup()
 let worker=m.scheduler()
 assert.deepEqual(worker.recoveryReadGate(),{allowed:true,retryAt:0})
 const cooldown=m.backoff.settle('dm',new Error('code=-509'))
 assert.equal(cooldown.category,'rate-limit')
 assert.equal(worker.recoveryReadGate().allowed,false)
 m.advance(15*60_000+1)
 worker=m.scheduler()
 assert.equal(worker.recoveryReadGate().allowed,true)
 const probe=m.backoff.settle('dm','')
 assert.equal(probe.category,'rate-limit')
 assert.equal(probe.recoverySuccesses,1)
 assert.equal(worker.recoveryReadGate().allowed,false)
 m.advance(10*60_000+1)
 worker=m.scheduler()
 assert.equal(worker.recoveryReadGate().allowed,true)
})

test('damaged persisted DM network backoff refuses extra recovery reads',async()=>{
 const m=await setup()
 await writeFile(join(m.dir,'interaction-network-backoff.json'),'{not valid json','utf8')
 assert.deepEqual(m.scheduler().recoveryReadGate(),{allowed:false,retryAt:0})
})
