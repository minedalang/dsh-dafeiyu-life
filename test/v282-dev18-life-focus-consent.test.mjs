import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const focus=readFileSync(new URL('../lib/video-focus-review.mjs',import.meta.url),'utf8')
const admission=readFileSync(new URL('../lib/life-video-read-admission.mjs',import.meta.url),'utf8')
const watch=server.slice(server.indexOf('const executeWatchVideo = async'),server.indexOf("name:'bili_life_consider_video'"))
const revisit=server.slice(server.indexOf("name:'bili_video_revisit_moment'"),server.indexOf("name:'bili_video_revisit_moment'")+6500)

test('overview uncertainty is only a suggestion, never an automatic focus read',()=>{
  assert.ok(watch.length>1500)
  assert.match(watch,/let focusReview=null,focusReviewStatus=null,focusPlan=null/)
  assert.match(watch,/focusPlan=planVideoFocusReview/)
  assert.match(watch,/focusReviewStatus='life-decision-required'/)
  assert.match(watch,/focusReviewSuggestion/)
  assert.match(watch,/kind:'life-choice-only'/)
  assert.doesNotMatch(watch,/call\('bili_preview_vision',\{bvid,perception_source:'adaptive',view_depth:'deep',\s*focus_start_seconds:focusPlan/)
  assert.match(focus,/no-verified-focus-candidate/)
})
test('actual revisit runs the existing Life vote and verification first',()=>{
  assert.match(revisit,/runLifeChosenVideoRead\(\{willingness:lifeWillingness/)
  assert.match(revisit,/mode:'revisit'/)
  const vote=revisit.indexOf('runLifeChosenVideoRead(')
  const read=revisit.indexOf("call('bili_preview_vision'")
  assert.ok(vote>=0&&read>vote)
  assert.match(admission,/willingness\.decide\(/)
  assert.match(admission,/willingness\.verify\(/)
  assert.match(revisit,/verifyVideoFocusReview/)
})

test('actual autonomous revisit handler runs without owner job, uses lease, and records only fresh evidence',async()=>{
  const {runInNewContext}=await import('node:vm')
  const {randomUUID,createHash}=await import('node:crypto')
  const {runLifeChosenVideoRead}=await import('../lib/life-video-read-admission.mjs')
  const {withLifeVideoVisualLease}=await import('../lib/life-planner-atomic.mjs')
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
  const dir=mkdtempSync(join(tmpdir(),'life-revisit-actual-')),account='a'.repeat(16),bvid='BV1234567890'
  let spec,visualStatus='analyzed',observations=0,events=0,updates=0,choice='act',activeAccount=account,receipt
  const proofSet=new WeakSet(),plan={ok:true,status:'ready',startSeconds:1,endSeconds:13,anchorSeconds:7,origin:'explicit-time'}
  const context={tool:x=>{spec=x},cfg:{masterEnabled:true,visionEnabled:true,visionFrames:12},refreshCfg(){},hasCredential:()=>true,
    resolvedVisionMode:()=> 'independent_local',validBv:()=>true,accountBinding:{status:()=>({blocked:false})},trustedLifeAccountTag:()=>activeAccount,
    parseMaybeJson:x=>x,call:async(name)=>{if(name==='bili_video_info')return {duration:60};observations++;return {status:visualStatus}},
    planVideoMomentFollowup:()=>plan,recallVideoFocusCues:()=>[],runLifeChosenVideoRead,withLifeVideoVisualLease,stateDir:dir,
    lifeWillingness:{decide:async()=>choice==='act'?{ok:true,candidateId:'focus-read',proof:{}}:{ok:false,reason:'life-deferred'},verify:()=>({ok:true}),receipt:(_p,r)=>{receipt=r.status}},
    liveLifeActivity:{start:()=>()=>{}},safeVideoDebugCapture:()=>null,buildVideoEvidenceBundle:()=>({}),
    verifyVideoFocusReview:()=>({startMs:1000,endMs:13000,frameTimesMs:[7000],description:'局部画面'}),
    buildFreshVideoDetails:({sourceRef})=>[{fragmentId:'frame-1',type:'observed-scene',sourceRef,certainty:'model-observation',content:'局部画面',timeAnchorMs:[7000,7000]}],
    buildVideoExplorationEvent:({operationId,accountTag})=>({key:'video-explore:'+operationId,accountTag,experience:{}}),
    lifeMemoryCoordinator:{recordEvents:async([event],opts)=>{events++;assert.equal(event.accountTag,account);context.expectedId='e-'+createHash('sha256').update(event.key).digest('hex').slice(0,18);const proof=opts.detailAdmission?.sourceProof;assert.ok(proofSet.has(proof));assert.equal(proof.memoryId,context.expectedId);assert.equal(opts.detailAdmission.fragments[0].sourceRef,proof.sourceRef);updates++;return {ok:true,detailWrite:{ok:true,shallowVersion:1,deepFragments:1}}}},
    randomUUID,createHash,admittedOwnerFocusProofs:proofSet,lifeMemory:{videoEvidenceTrace:()=>context.validRecall?[{memoryId:'e-'+'a'.repeat(18)}]:[]},log(){}}
  const start=server.lastIndexOf('  tool({',server.indexOf("name:'bili_video_revisit_moment'")),end=server.indexOf('  tool({',start+8)
  try{
    const adapterStart=server.indexOf('  const persistFreshVideoDetail='),adapterEnd=server.indexOf('  const executeWatchVideo = async',adapterStart)
    runInNewContext(server.slice(adapterStart,adapterEnd)+server.slice(start,end),context)
    context.validRecall=false;const rejected=await spec.execute({bvid,at_seconds:7,recall_memory_id:'e-'+'a'.repeat(18)});assert.equal(rejected.reason,'recall-source-unavailable');assert.equal(observations,0);
    context.validRecall=true;const first=await spec.execute({bvid,at_seconds:7,recall_memory_id:'e-'+'a'.repeat(18)});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.deepMemory.status,'updated');assert.equal(events,1);assert.equal(updates,1);assert.equal(receipt,'verified')
    visualStatus='cached';const cached=await spec.execute({bvid,at_seconds:7});assert.equal(cached.status,'reused-cached-window');assert.equal(events,1);assert.equal(updates,1)
    choice='defer';const refused=await spec.execute({bvid,at_seconds:7});assert.equal(refused.ok,false);assert.equal(observations,2)
    choice='act';const busy=await withLifeVideoVisualLease(dir,{accountTag:account,bvid},()=>spec.execute({bvid,at_seconds:7}));assert.equal(busy.ok,false);assert.equal(observations,2)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
