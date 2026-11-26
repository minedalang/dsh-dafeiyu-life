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
  const {planVideoMomentFollowup,resolveLiveVideoCue,validateVideoRecallGap}=await import('../lib/video-moment-followup.mjs')
  const {withLifeVideoVisualLease}=await import('../lib/life-planner-atomic.mjs')
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
  const dir=mkdtempSync(join(tmpdir(),'life-revisit-actual-')),account='a'.repeat(16),bvid='BV1234567890'
  let spec,visualStatus='analyzed',observations=0,events=0,updates=0,choice='act',activeAccount=account,receipt,epoch=1,revision=1,metadata=0,afterVote=null,afterMetadata=null,afterVisual=null
  const recallId='e-'+'a'.repeat(18),trace={memoryId:recallId,bvid,visibility:'public-event',visual:{source:'decoded-public-video'},sources:['visual-model-observation']}
  const gap={bvid,at_seconds:7,recall_memory_id:recallId,recall_start_ms:6000,recall_end_ms:8000}
  const part={memoryId:recallId,visibility:'public-event',certainty:'model-observation',sourceRef:'verified:sample',fragmentId:'frame-1',content:'画面中有一只红色风筝',timeAnchorMs:[7000,7000]}
  let details={ok:false,reason:'no-detail-in-time-range'},cueDetails={ok:true,bvid,hasMore:false,missingSources:0,totalFragments:1,fragments:[part]}
  const proofSet=new WeakSet(),plan={ok:true,status:'ready',startSeconds:1,endSeconds:13,anchorSeconds:7,origin:'explicit-time'}
  const context={tool:x=>{spec=x},cfg:{masterEnabled:true,visionEnabled:true,visionFrames:12},refreshCfg(){},hasCredential:()=>true,
    resolvedVisionMode:()=> 'independent_local',validBv:()=>true,accountBinding:{status:()=>({blocked:false}),generation:()=>epoch},trustedLifeAccountTag:()=>activeAccount,
    getSessionIntegration:()=>({mode:'autonomous-life',revision}),integrationAvailable:()=>true,platformReady:()=>true,
    parseMaybeJson:x=>x,call:async(name)=>{if(name==='bili_video_info'){metadata++;afterMetadata?.();return {duration:60}}observations++;afterVisual?.();return {status:visualStatus}},
    planVideoMomentFollowup,resolveLiveVideoCue,validateVideoRecallGap,runLifeChosenVideoRead,withLifeVideoVisualLease,stateDir:dir,
    lifeWillingness:{decide:async()=>{afterVote?.();return choice==='act'?{ok:true,candidateId:'focus-read',proof:{}}:{ok:false,reason:'life-deferred'}},verify:()=>({ok:true}),receipt:(_p,r)=>{receipt=r.status}},
    liveLifeActivity:{start:()=>()=>{}},safeVideoDebugCapture:()=>null,buildVideoEvidenceBundle:()=>({}),
    verifyVideoFocusReview:()=>({startMs:1000,endMs:13000,frameTimesMs:[7000],description:'局部画面'}),
    buildFreshVideoDetails:({sourceRef})=>[{fragmentId:'frame-1',type:'observed-scene',sourceRef,certainty:'model-observation',content:'局部画面',timeAnchorMs:[7000,7000]}],
    buildVideoExplorationEvent:({operationId,accountTag})=>({key:'video-explore:'+operationId,accountTag,experience:{}}),
    lifeMemoryCoordinator:{recordEvents:async([event],opts)=>{events++;assert.equal(event.accountTag,account);context.expectedId='e-'+createHash('sha256').update(event.key).digest('hex').slice(0,18);const proof=opts.detailAdmission?.sourceProof;assert.ok(proofSet.has(proof));assert.equal(proof.memoryId,context.expectedId);assert.equal(opts.detailAdmission.fragments[0].sourceRef,proof.sourceRef);updates++;return {ok:true,detailWrite:{ok:true,shallowVersion:1,deepFragments:1}}}},
    randomUUID,createHash,admittedOwnerFocusProofs:proofSet,lifeMemory:{videoEvidenceTrace:()=>context.validRecall?[trace]:[],recallVideoDetails:opts=>{assert.equal(opts.ownerSession,false);assert.equal(opts.visibility,'public-event');return opts.startMs===undefined?cueDetails:details}},log(){}}
  const start=server.lastIndexOf('  tool({',server.indexOf("name:'bili_video_revisit_moment'")),end=server.indexOf('  tool({',start+8)
  try{
    const adapterStart=server.indexOf('  const persistFreshVideoDetail='),adapterEnd=server.indexOf('  const executeWatchVideo = async',adapterStart)
    runInNewContext(server.slice(adapterStart,adapterEnd)+server.slice(start,end),context)
    context.validRecall=false;const rejected=await spec.execute(gap);assert.equal(rejected.reason,'recall-source-unavailable');assert.equal(observations,0);
    context.validRecall=true;
    const before=metadata;assert.equal((await spec.execute({...gap,at_seconds:9})).reason,'recall-source-unavailable');assert.equal(metadata,before);
    details={ok:true};assert.equal((await spec.execute(gap)).reason,'recall-source-unavailable');assert.equal(metadata,before);
    details={ok:false,reason:'no-detail-in-time-range'};afterVote=()=>{details={ok:true}};
    assert.equal((await spec.execute(gap)).ok,false);assert.equal(observations,0);afterVote=null;details={ok:false,reason:'no-detail-in-time-range'};
    afterMetadata=()=>epoch++;assert.equal((await spec.execute(gap)).reason,'account-changed');assert.equal(observations,0);afterMetadata=null;
    afterVote=()=>revision++;assert.equal((await spec.execute(gap)).ok,false);assert.equal(observations,0);afterVote=null;
    const first=await spec.execute(gap);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.deepMemory.status,'updated');assert.equal(events,1);assert.equal(updates,1);assert.equal(receipt,'verified')
    visualStatus='cached';const cached=await spec.execute({bvid,at_seconds:7});assert.equal(cached.status,'reused-cached-window');assert.equal(events,1);assert.equal(updates,1)
    choice='defer';const refused=await spec.execute({bvid,at_seconds:7});assert.equal(refused.ok,false);assert.equal(observations,2)
    choice='act';const busy=await withLifeVideoVisualLease(dir,{accountTag:account,bvid},()=>spec.execute({bvid,at_seconds:7}));assert.equal(busy.ok,false);assert.equal(observations,2)
    visualStatus='analyzed';const cue=await spec.execute({bvid,event_cue:'红色风筝'});assert.equal(cue.ok,true,JSON.stringify(cue));assert.equal(cue.origin,'observed-event-anchor');assert.equal(cue.anchorSeconds,7);assert.equal(events,2);
    afterVote=()=>{cueDetails={...cueDetails,fragments:[{...part,content:'不同的画面'}]}};
    assert.equal((await spec.execute({bvid,event_cue:'红色风筝'})).ok,false);assert.equal(observations,3);afterVote=null;
    cueDetails={ok:true,bvid,hasMore:false,missingSources:0,totalFragments:1,fragments:[part]};
    afterVisual=()=>epoch++;assert.equal((await spec.execute({bvid,event_cue:'红色风筝'})).ok,false);assert.equal(events,2);afterVisual=null;

  }finally{rmSync(dir,{recursive:true,force:true})}
})
