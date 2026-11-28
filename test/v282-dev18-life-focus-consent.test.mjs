import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const focus=readFileSync(new URL('../lib/video-focus-review.mjs',import.meta.url),'utf8')
const admission=readFileSync(new URL('../lib/life-video-read-admission.mjs',import.meta.url),'utf8')
const watch=server.slice(server.indexOf('const executeWatchVideo = async'),server.indexOf("name:'bili_life_consider_video'"))
const revisit=server.slice(server.indexOf("name:'bili_video_revisit_moment'"),server.indexOf("  // Host-only adapters",server.indexOf("name:'bili_video_revisit_moment'")))

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
  const {VideoReadFailure,videoReadDiagnostic,explainVideoVisionFailure}=await import('../lib/video-visual-failure.mjs')
  const {planVideoMomentFollowup,resolveLiveVideoCue,validateVideoRecallGap}=await import('../lib/video-moment-followup.mjs')
  const {withLifeVideoVisualLease}=await import('../lib/life-planner-atomic.mjs')
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
  const dir=mkdtempSync(join(tmpdir(),'life-revisit-actual-')),account='a'.repeat(16),bvid='BV1234567890'
  let spec,visualStatus='analyzed',observations=0,events=0,updates=0,choice='act',activeAccount=account,receipt,epoch=1,revision=1,metadata=0,afterVote=null,afterMetadata=null,afterVisual=null,visualError=null,focusVerified=true
  const recallId='e-'+'a'.repeat(18),trace={memoryId:recallId,bvid,visibility:'public-event',visual:{source:'decoded-public-video'},sources:['visual-model-observation']}
  const gap={bvid,at_seconds:7,recall_memory_id:recallId,recall_start_ms:6000,recall_end_ms:8000}
  const part={memoryId:recallId,visibility:'public-event',certainty:'model-observation',sourceRef:'verified:sample',fragmentId:'frame-1',content:'画面中有一只红色风筝',timeAnchorMs:[7000,7000]}
  let details={ok:false,reason:'no-detail-in-time-range'},cueDetails={ok:true,bvid,hasMore:false,missingSources:0,totalFragments:1,fragments:[part]}
  const proofSet=new WeakSet(),plan={ok:true,status:'ready',startSeconds:1,endSeconds:13,anchorSeconds:7,origin:'explicit-time'}
  const context={tool:x=>{spec=x},cfg:{masterEnabled:true,visionEnabled:true,visionFrames:12},refreshCfg(){},hasCredential:()=>true,
    resolvedVisionMode:()=> 'independent_local',validBv:()=>true,accountBinding:{status:()=>({blocked:false}),generation:()=>epoch},trustedLifeAccountTag:()=>activeAccount,
    getSessionIntegration:()=>({mode:'autonomous-life',revision}),integrationAvailable:()=>true,platformReady:()=>true,
    parseMaybeJson:x=>x,call:async(name,args,opts)=>{if(name==='bili_video_info'){metadata++;afterMetadata?.();return {duration:60}}assert.equal(opts.isCurrent(),true);observations++;afterVisual?.();if(visualError)throw visualError;return {status:visualStatus,errorCode:'vision_board_grid_mismatch'}},videoReadDiagnostic,explainVideoVisionFailure,
    planVideoMomentFollowup,resolveLiveVideoCue,validateVideoRecallGap,runLifeChosenVideoRead,withLifeVideoVisualLease,stateDir:dir,
    lifeWillingness:{decide:async()=>{afterVote?.();return choice==='act'?{ok:true,candidateId:'focus-read',proof:{}}:{ok:false,reason:'life-deferred'}},verify:()=>({ok:true}),receipt:(_p,r)=>{receipt=r.status}},
    liveLifeActivity:{start:()=>()=>{}},safeVideoDebugCapture:()=>null,buildVideoEvidenceBundle:()=>({}),
    verifyVideoFocusReview:()=>focusVerified?({startMs:1000,endMs:13000,frameTimesMs:[7000],description:'局部画面'}):null,
    buildFreshVideoDetails:({sourceRef})=>[{fragmentId:'frame-1',type:'observed-scene',sourceRef,certainty:'model-observation',content:'局部画面',timeAnchorMs:[7000,7000]}],
    buildVideoExplorationEvent:({operationId,accountTag})=>({key:'video-explore:'+operationId,accountTag,experience:{}}),
    lifeMemoryCoordinator:{recordEvents:async([event],opts)=>{events++;assert.equal(event.accountTag,account);context.expectedId='e-'+createHash('sha256').update(event.key).digest('hex').slice(0,18);const proof=opts.detailAdmission?.sourceProof;assert.ok(proofSet.has(proof));assert.equal(proof.memoryId,context.expectedId);assert.equal(opts.detailAdmission.fragments[0].sourceRef,proof.sourceRef);updates++;return {ok:true,detailWrite:{ok:true,shallowVersion:1,deepFragments:1}}}},
    randomUUID,createHash,admittedOwnerFocusProofs:proofSet,lifeMemory:{recordVerifiedFocusRevision:opts=>{assert.equal(opts.memoryId,recallId);assert.equal(opts.partialGapAtMs,7000);assert.ok(proofSet.has(opts.sourceProof));updates++;return {ok:true,shallowVersion:1,deepFragments:1}},videoEvidenceTrace:()=>context.validRecall?[trace]:[],partialVideoGapTrace:opts=>context.validPartial&&opts.startMs===7000&&opts.endMs===7000?[{memoryId:recallId,bvid,visibility:'public-event',partialGapAtMs:7000}]:[],recallVideoDetails:opts=>{assert.equal(opts.ownerSession,false);assert.equal(opts.visibility,'public-event');return opts.startMs===undefined?cueDetails:details}},log(){}}
  const start=server.indexOf('  const videoRevisitSpec={'),end=server.indexOf('  // Host-only adapters',start)
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
    context.validRecall=false;context.validPartial=true;const partialGap={...gap,recall_start_ms:7000,recall_end_ms:7000}
    choice='defer';const beforePartial=observations;assert.equal((await spec.execute(partialGap)).ok,false);assert.equal(observations,beforePartial)
    choice='act';afterVote=()=>{context.validPartial=false};assert.equal((await spec.execute(partialGap)).ok,false);assert.equal(observations,beforePartial)
    afterVote=null;context.validPartial=true;const result=await spec.execute(partialGap);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(observations,beforePartial+1);assert.equal(events,2);assert.equal(updates,3)
    // The same actual handler reports only the trusted stage, never the raw error.
    visualError=new VideoReadFailure('vision-native-runtime-busy','PRIVATE secret path')
    const failed=await spec.execute({bvid,at_seconds:7});assert.equal(failed.reason,'life-video-read-failed');assert.equal(failed.readStatus,'focus-read-failed');assert.deepEqual(failed.readDiagnostic,{code:'vision-native-runtime-busy',stage:'runtime'});assert.doesNotMatch(JSON.stringify(failed),/PRIVATE/);assert.equal(receipt,'failed');assert.equal(events,2)
    const dm=await runLifeChosenVideoRead({willingness:context.lifeWillingness,getAccountTag:()=>account,bvid,mode:'revisit',scene:'dm',uid:'123',read:async()=>({ok:false,reason:'focus-read-failed',readDiagnostic:videoReadDiagnostic(visualError)})});assert.equal(dm.readDiagnostic,undefined);assert.equal(receipt,'failed')
    visualError=Error('PRIVATE raw provider');const unknown=await spec.execute({bvid,at_seconds:7});assert.equal(unknown.readDiagnostic.code,'vision-dispatch-unavailable');assert.doesNotMatch(JSON.stringify(unknown),/PRIVATE/)
    visualError=null;visualStatus='vision_incomplete';focusVerified=false;const mismatch=await spec.execute({bvid,at_seconds:7});assert.equal(mismatch.readStatus,'vision_board_grid_mismatch');assert.equal(events,2);assert.equal(receipt,'failed')
    const beforeCancel=observations;const cancelled=await spec.execute({bvid,at_seconds:7},{signal:{aborted:true}});assert.equal(cancelled.ok,false);assert.equal(observations,beforeCancel)

  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('cross-channel revisit checks delivered public target, existing observation and live gap',async()=>{
 const {runContextualVideoRevisit}=await import('../lib/video-moment-followup.mjs')
 const bvid='BV1234567890',memoryId='e-'+'a'.repeat(18)
 const trace={memoryId,bvid,visibility:'public-event',visual:{source:'decoded-public-video'},sources:['visual-model-observation']}
 const fragment={memoryId,visibility:'public-event',certainty:'model-observation',content:'红色风筝飞起来了',timeAnchorMs:[1000,1000],sourceRef:'verified:1',fragmentId:'sample-1'}
 let live=true,rows=[trace],parts=[fragment],gap=true,reads=0,vanish=false
 const details=()=>({ok:true,bvid,fragments:parts,totalFragments:parts.length,hasMore:false,missingSources:0})
 const options={allowRange:()=>true,offeredBvids:[bvid],isCurrent:()=>live,readTrace:({memoryId:id})=>rows.filter(r=>!id||r.memoryId===id),readDetails:({startMs})=>startMs!==undefined&&gap?{ok:false,reason:'no-detail-in-time-range'}:details(),execute:async(args,before,after)=>{reads++;assert.equal(before(),true);assert.equal(args.recall_memory_id,memoryId);if(vanish)rows=[];assert.equal(after(),!vanish);return {ok:true,bvid,status:'observed-new-window',review:{startMs:0,endMs:12000,frameTimesMs:[7000],description:'新画面'},deepMemory:{status:'not-recorded'}}}}
 const req={bvid,startMs:6000,endMs:8000}
 assert.equal((await runContextualVideoRevisit({...options,request:{...req,bvid:'BV0987654321'}})).evidence.ok,false)
 assert.equal((await runContextualVideoRevisit({...options,request:{...req,uid:'1'}})).evidence.ok,false)
 gap=false;const old=await runContextualVideoRevisit({...options,request:req});assert.equal(old.evidence.status,'existing-historical-observations');assert.equal(reads,0);assert.equal(old.validate(),true)
 parts=[];assert.equal(old.validate(),false);parts=[fragment];gap=true
 const fresh=await runContextualVideoRevisit({...options,request:{bvid,eventCue:'红色风筝',afterSeconds:6}});assert.equal(fresh.evidence.status,'observed-new-window');assert.equal(fresh.validate(),true);assert.equal(reads,1)
 live=false;assert.equal(fresh.validate(),false);live=true
 parts=[fragment,{...fragment,fragmentId:'sample-2'}];assert.equal((await runContextualVideoRevisit({...options,request:{bvid,eventCue:'红色风筝',afterSeconds:6}})).evidence.ok,false);assert.equal(reads,1)
 vanish=true;assert.equal((await runContextualVideoRevisit({...options,request:req})).evidence.ok,false);assert.equal(reads,2)
})

test('DM explicit time only uses incoming absolute video notation, not guessed relative seconds',async()=>{
 const {hasExplicitVideoTime}=await import('../lib/video-moment-followup.mjs')
 assert.equal(hasExplicitVideoTime('那段视频第1分20秒发生了什么？',79000,81000),true)
 assert.equal(hasExplicitVideoTime('00:08 那一段呢？',6000,9000),true)
 assert.equal(hasExplicitVideoTime('红色风筝飞起来后过了8秒',6000,9000),false)
 assert.equal(hasExplicitVideoTime('上次的视频后来发生了什么',6000,9000),false)
})


test('contextual exact partial gap uses range-bound original trace, never a shifted moment or missing source',async()=>{
 const {runContextualVideoRevisit}=await import('../lib/video-moment-followup.mjs')
 const bvid='BV1234567890',memoryId='e-'+'a'.repeat(18);let live=true,reads=0
 const opts={offeredBvids:[bvid],isCurrent:()=>true,allowRange:()=>true,readDetails:()=>({ok:false,reason:'no-detail'}),
  readTrace:({startMs,endMs,memoryId:id})=>live&&startMs===7000&&endMs===7000&&(!id||id===memoryId)?[{bvid,memoryId,visibility:'public-event',partialGapAtMs:7000}]:[],
  execute:async(args,before,after)=>{reads++;assert.equal(args.recall_memory_id,memoryId);assert.equal(before(),true);assert.equal(after(),true);return {ok:true,bvid,status:'observed-new-window',review:{startMs:1000,endMs:13000,frameTimesMs:[7000],description:'新观察'},deepMemory:{status:'not-recorded'}}}}
 const result=await runContextualVideoRevisit({...opts,request:{bvid,startMs:7000,endMs:7000}})
 assert.equal(result.evidence.ok,true);assert.equal(result.validate(),true);assert.equal(reads,1)
 assert.equal((await runContextualVideoRevisit({...opts,request:{bvid,startMs:8000,endMs:8000}})).evidence.ok,false)
 live=false;assert.equal(result.validate(),false);assert.equal((await runContextualVideoRevisit({...opts,request:{bvid,startMs:7000,endMs:7000}})).evidence.ok,false);assert.equal(reads,1)
})

test('cross-channel revisit re-proves live gap before media read, and invalidates changed coverage without inventing new observations',async()=>{
 const {runContextualVideoRevisit}=await import('../lib/video-moment-followup.mjs')
 const bvid='BV1234567890',memoryId='e-'+'a'.repeat(18),row={bvid,memoryId,visibility:'public-event',partialGapAtMs:7000},fragment={memoryId,visibility:'public-event',certainty:'model-observation',content:'真实历史观察',timeAnchorMs:[7000,7000]}
 let gap=true,missing=0,reads=0
 const options={request:{bvid,startMs:7000,endMs:7000},offeredBvids:[bvid],isCurrent:()=>true,allowRange:()=>true,readTrace:()=>[row],readDetails:()=>gap?{ok:false,reason:'no-detail-in-time-range'}:{ok:true,bvid,fragments:[fragment],totalFragments:1,hasMore:false,missingSources:missing},execute:async(args,before)=>{gap=false;assert.equal(before(),false);return {ok:false,reason:'video-recall-evidence-changed'}}}
 const declined=await runContextualVideoRevisit(options);assert.equal(declined.evidence.ok,false);assert.equal(reads,0)
 const recalled=await runContextualVideoRevisit({...options,execute:()=>{reads++;throw Error('not needed')}});assert.equal(recalled.evidence.status,'existing-historical-observations');assert.equal(recalled.validate(),true);missing=1;assert.equal(recalled.validate(),false);assert.equal(reads,0)
})

test('partial revisit may close its own exact gap after a verified append, but no foreign source or stale receipt is delivered',async()=>{
 const {runContextualVideoRevisit}=await import('../lib/video-moment-followup.mjs')
 const bvid='BV1234567890',memoryId='e-'+'a'.repeat(18),sourceRef='focus:'+'b'.repeat(32)
 const row={bvid,memoryId,visibility:'public-event',partialGapAtMs:7000}
 const fragment={memoryId,visibility:'public-event',certainty:'model-observation',coverage:'partial-sample',sourceRef,timeAnchorMs:[7000,7000],content:'实际新采样'}
 let gap=true,parts=[],reads=0
 const options={request:{bvid,startMs:7000,endMs:7000},offeredBvids:[bvid],isCurrent:()=>true,allowRange:()=>true,
  readTrace:()=>gap?[row]:[],readDetails:()=>parts.length?{ok:true,bvid,fragments:parts,totalFragments:parts.length}:{ok:false,reason:'no-detail-in-time-range'},
  execute:async(args,before,after)=>{assert.equal(before(),true);reads++;gap=false;parts=[fragment];const deepMemory={status:'updated',memoryId,sourceRef};assert.equal(after(deepMemory),true);assert.equal(after({...deepMemory,sourceRef:'focus:'+'c'.repeat(32)}),false);return {ok:true,bvid,status:'observed-new-window',review:{startMs:1000,endMs:13000,frameTimesMs:[7000],description:'新观察'},deepMemory}}}
 const fresh=await runContextualVideoRevisit(options);assert.equal(fresh.evidence.ok,true,JSON.stringify(fresh.evidence));assert.equal(fresh.validate(),true);assert.equal(reads,1)
 const historical=await runContextualVideoRevisit(options);assert.equal(historical.evidence.status,'existing-historical-observations');assert.equal(historical.evidence.fragments[0].coverage,'partial-sample');assert.equal(reads,1)
 parts=[];assert.equal(fresh.validate(),false);assert.equal(historical.validate(),false)
})
