import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const NOW=Date.parse('2026-11-19T03:00:00Z')
const BV='BV1234567890'
const credential={dedeuserid:'10001',sessdata:'fixture-session'}
const ACCOUNT=discussionAccountTag(credential)
const proof={ok:true,bvid:BV,depth:'standard',frameCount:2,source:'decoded-public-video'}
const useTemp=fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-visual-receipt-order-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function make(dir,memory){
 return createLifeOpportunities({stateDir:dir,getCredential:()=>credential,getAccountTag:()=>ACCOUNT,
   now:()=>NOW,getCurrentVisualMemoryEvidence:({accountTag,bvid})=>
     memory.ready&&accountTag===ACCOUNT&&bvid===BV?[{readOnly:true,bvid,sources:['visual-model-observation'],visual:{source:'decoded-public-video',frameCount:2}}]:[]})
}
function start(g){
 const r=g.beginVideoObservation({ok:true,source:'social-read-now',sourceId:'test-read-event',
   accountTag:ACCOUNT,at:NOW,bvid:BV,title:'已核验的公开视频标题'},ACCOUNT)
 assert.equal(r.ok,true,JSON.stringify(r));return r.id
}

test('fresh Life Episode visual memory may persist before its own verified visual ledger receipt',()=>useTemp(dir=>{
 const memory={ready:false},g=make(dir,memory),id=start(g)
 assert.equal(g.hasVerifiedVideoVisual(BV,ACCOUNT),false)
 // The genuine sampler writes a fading watch memory before returning to the planner.
 memory.ready=true
 const r=g.recordVideoVisual(id,proof,ACCOUNT)
 assert.equal(r.ok,true,JSON.stringify(r))
 assert.equal(r.frameCount,2)
 assert.equal(g.hasVerifiedVideoVisual(BV,ACCOUNT),true)
 assert.equal(g.recordVideoVisual(id,proof,ACCOUNT).ok,false,'same Episode cannot replay a visual receipt')
}))

test('visual receipt still requires exact account, real existing Episode and validated frame proof',()=>useTemp(dir=>{
 const memory={ready:false},g=make(dir,memory),id=start(g)
 assert.equal(g.recordVideoVisual(id,proof,'f'.repeat(16)).ok,false)
 assert.equal(g.recordVideoVisual('0'.repeat(24),proof,ACCOUNT).ok,false)
 assert.equal(g.recordVideoVisual(id,{...proof,frameCount:0},ACCOUNT).ok,false)
 assert.equal(g.recordVideoVisual(id,{...proof,bvid:'BV0987654321'},ACCOUNT).ok,false)
 assert.equal(g.hasVerifiedVideoVisual(BV,ACCOUNT),false)
}))
