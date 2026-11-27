import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {buildVideoPerceptionHandoff} from '../lib/video-perception-handoff.mjs'
import {continuationMenu} from '../lib/life-continuation.mjs'
const BV='BV1234567890', OTHER='BV0987654321', NOW=Date.parse('2026-11-18T12:00:00Z'), DAY=86_400_000
const cred={dedeuserid:'12345678',sessdata:'test'},tag=discussionAccountTag(cred)
const validEvent=(id,{bvid=BV,accountTag=tag,visual=true}={})=>({kind:'watch',key:'video-explore:'+id,bvid,title:'公开的视频观察',at:NOW,
  accountTag,experience:{source:'bili-life',metadata:true,evidenceSchema:'life-video-evidence/v1',
    preview:visual,vision:visual,...(visual?{visualReceipt:{source:'low-resolution-preview',frameCount:2,firstAtMs:1000,lastAtMs:9000},
      visualSceneNotes:['画面有绿色草地和天空']}:{}),purpose:'自主查看'}})
const withStore=fn=>{const dir=mkdtempSync(join(tmpdir(),'v282-dev5-visual-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

// An actual, still-clear memory is a fallback when a crash, a legacy route or
// an earlier missed receipt left no corresponding visualReads entry.
test('current-account verified public visual memory prevents redundant Episode observation without writing a second ledger',()=>withStore(dir=>{
 let at=NOW
 const memory=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>tag,now:()=>at,
   getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
 try{
  assert.equal(memory.recordEvents([validEvent('older-observation')]).added,1)
  const store=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>at,
    getCurrentVisualMemoryEvidence:opts=>memory.videoEvidenceTrace(opts)})
  assert.equal(store.hasVerifiedVideoVisual(BV,tag),true)
  assert.equal(store.hasVerifiedVideoVisual(OTHER,tag),false)
  const proof={ok:true,bvid:BV,depth:'standard',source:'low-resolution-preview',frameCount:2}
  assert.deepEqual(store.rememberVerifiedVideoVisual(proof,tag),{ok:true,alreadySeen:true})
  const ledger=join(dir,'life-opportunities',tag+'.json')
  assert.equal(existsSync(ledger),false,'do not backfill a second durable source from fading memory')
  const intention={id:'a'.repeat(24),status:'ready',expiresAt:at+1000,nextAt:0,episodeSteps:1,
    selectedBvid:BV,selectedTitle:'已核验标题',metadataAt:at,observedVideoBvids:[]}
  assert.ok(continuationMenu(intention,{at,previouslyObservedBvids:[BV]}).every(x=>x.action!=='observe_video'))
  at+=14*DAY // the existing gateway now destructively fades the experience
  assert.deepEqual(memory.videoEvidenceTrace({accountTag:tag,bvid:BV}),[])
  assert.equal(store.hasVerifiedVideoVisual(BV,tag),false,'forgotten memory cannot act as a hidden visual cache')
 }finally{memory.close()}
}))

test('visual-only projection still finds older clear visual proof behind many metadata-only returns',()=>withStore(dir=>{
 const future=NOW+25_000
 const memory=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>tag,now:()=>future,
   getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
 try{
  const events=[validEvent('old-visual')]
  for(let i=0;i<18;i++)events.push({...validEvent('metadata-'+i,{visual:false}),at:NOW+1000+i*1000})
  assert.equal(memory.recordEvents(events).added,19)
  assert.ok(!memory.videoEvidenceTrace({accountTag:tag,bvid:BV,limit:12}).some(x=>x.visual))
  const visual=memory.videoEvidenceTrace({accountTag:tag,bvid:BV,visualOnly:true,limit:12})
  assert.equal(visual.length,1)
  const store=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>future,
    getCurrentVisualMemoryEvidence:opts=>memory.videoEvidenceTrace(opts)})
  assert.equal(store.hasVerifiedVideoVisual(BV,tag),true)
 }finally{memory.close()}
}))

test('metadata alone, wrong BV, wrong account and untrusted visual rows cannot unlock visual dedup',()=>withStore(dir=>{
 const memory=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>tag,now:()=>NOW,
   getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
 try{
  memory.recordEvents([validEvent('metadata-only',{visual:false}),validEvent('wrong-bv',{bvid:OTHER})])
  const store=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>NOW,
    getCurrentVisualMemoryEvidence:opts=>memory.videoEvidenceTrace(opts)})
  assert.equal(store.hasVerifiedVideoVisual(BV,tag),false)
  assert.equal(store.hasVerifiedVideoVisual(OTHER,tag),true)
  assert.equal(store.hasVerifiedVideoVisual(OTHER,'f'.repeat(16)),false)
  const invalid=createLifeOpportunities({stateDir:join(dir,'other'),getCredential:()=>cred,now:()=>NOW,
    getCurrentVisualMemoryEvidence:()=>[{bvid:BV,readOnly:true,sources:['metadata'],visual:{frameCount:2,source:'decoded-public-video'}}]})
  assert.equal(invalid.hasVerifiedVideoVisual(BV,tag),false)
  assert.equal(invalid.rememberVerifiedVideoVisual({ok:false,bvid:BV,source:'decoded-public-video',frameCount:2,depth:'deep'},tag).ok,false)
  assert.equal(invalid.hasVerifiedVideoVisual(BV,tag),false)
 }finally{memory.close()}
}))

test('verified visual model sample timestamps are gaps, never continuous playback or unobserved-scene claims',()=>{
 const evidence={schema:'life-video-evidence/v1',bvid:BV,sources:[
   {kind:'metadata',status:'verified'},
   {kind:'decoded_video_frames',status:'verified',timePointsMs:[8000,15000,115000]},
   {kind:'decoded_visual_analysis',status:'analyzed',timePointsMs:[8000,15000,115000]}]}
 const timeline={schema:'life-video-perception-timeline/v1',bvid:BV,anchors:[]}
 const visual={bvid:BV,status:'analyzed',description:'抽样画面可见几个不同的卡通角色'}
 const handoff=buildVideoPerceptionHandoff({bvid:BV,depth:'deep',info:{bvid:BV,title:'已核验的视频',duration:120},visual,evidence,timeline})
 assert.deepEqual(handoff.coverageAssessment.visualSampling,{
   source:'decoded-public-video',sampleCount:3,firstSampleAtMs:8000,lastSampleAtMs:115000,
   videoDurationMs:120000,largestIntervalBetweenSamplesMs:100000,sampledSpanMs:107000,
   confidence:'sample-timestamps-only-not-continuous-coverage',unknownBetweenSamples:true})
 assert.equal(handoff.coverageAssessment.videoIsFullyObserved,false)
 assert.equal(handoff.coverageAssessment.isSufficientToClaimFullUnderstanding,false)
 assert.equal(handoff.review.verifiedAgreement,false)
 const noDuration=buildVideoPerceptionHandoff({bvid:BV,depth:'deep',info:{bvid:BV,title:'无时长'},visual,evidence,timeline})
 assert.equal('videoDurationMs' in noDuration.coverageAssessment.visualSampling,false)
 const noVisual=buildVideoPerceptionHandoff({bvid:BV,info:{bvid:BV,title:'仅有公开标题'},visual:null,
   evidence:{schema:'life-video-evidence/v1',bvid:BV,sources:[{kind:'metadata',status:'verified'}]},timeline})
 assert.equal(noVisual.coverageAssessment.visualSampling,null)
})

test('production reuses the existing forgetting gateway and emits a warning for failed cross-route visual ledger writes',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/getCurrentVisualMemoryEvidence:query=>lifeMemory\?\.videoEvidenceTrace\(query\)\|\|\[\]/)
 assert.match(source,/if\(result\?\.ok!==true\)result=lifeOpportunities\.rememberVerifiedVideoVisual\(proof,initialLifeAccountTag\)/)
 assert.match(source,/if\(result\?\.ok!==true\)log\('视频视觉防重复回执未写入/)
})
