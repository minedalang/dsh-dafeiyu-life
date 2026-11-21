import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

// Execute the actual production function body against fully mocked, read-only
// tool receipts. A text-only / regex assertion cannot detect a block-scoped
// variable leaking out of the observation try/finally.
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')
const begin=source.indexOf('  const executeWatchVideo = async(args={},internal={}) => {')
const end=source.indexOf("\n  tool({\n    name:'bili_watch_video'",begin)
assert.ok(begin>=0&&end>begin,'production video handler must be found')
const handler=source.slice(begin,end)

function mockWatch({vision=true,dryRun=true}={}){
  const bv='BV1234567890'
  const calls=[],visualCalls=[]
  const currentJob={id:'debug',account:'owner',status:'running',updatedAt:Date.now()}
  const capture={id:'abcdef0123456789abcdef0123456789',kind:'storyboard',bvid:bv,
    images:[{kind:'storyboard',file:'storyboard-01.jpg',times:[0],resolution:'384x216'}]}
  const ctx={
    cfg:{masterEnabled:true,visionEnabled:vision,transcribe:false},
    videoDebugJob:currentJob,videoDebugExpiry:1800000,lastLifeVideoDebug:null,stateDir:'/tmp/stub',
    lastLifeVisionActivity:null,readProductionVisionStatus:()=>null,
    videoDebugAccount:()=> 'owner',trustedLifeAccountTag:()=> 'account-tag',refreshCfg:()=>{},
    hasCredential:()=>true,validBv:x=>x===bv,
    call:async(name,args)=>{
      calls.push(name)
      if(name==='bili_video_info')return {title:'仅用于模拟的公开视频',author:'example'}
      if(name==='bili_subtitle')return {text:'模拟字幕'}
      if(name==='bili_preview_vision'){visualCalls.push(args);return {status:'analyzed',description:'模拟图像描述',debugCapture:capture}}
      if(name==='bili_danmaku')return {items:[]}
      return {ok:true}
    },
    visionDecision:()=>({attempt:vision,kind:vision?'enabled':'unavailable',depth:vision?'standard':'skim',reason:'fixture'}),
    resolvedVisionMode:()=> 'independent_local',
    liveLifeActivity:{start:()=>()=>{}},parseMaybeJson:x=>x,
    beginVideoObservationRead:async(run,complete)=>{const start=Date.now();
      try{return await run()}finally{complete?.(Date.now()-start)}},
    safeVideoDebugCapture:(value,bvid)=>value?.bvid===bvid?value:null,
    buildVideoEvidenceBundle:()=>({sources:[]}),planVideoFocusReview:()=>null,
    buildVideoPerceptionTimeline:()=>({}),
    buildVideoPerceptionHandoff:()=>({speech:{},video:{},timeAlignment:{},review:{}}),
    saveVideoDebugSummary:()=>true,log:()=>{},
    buildVideoExplorationEvent:()=>null,
    setTimeout,clearTimeout,Date,
  }
  runInNewContext(`${handler}\n globalThis.executeWatchVideoTest=executeWatchVideo`,ctx)
  return {run:ctx.executeWatchVideoTest,ctx,calls,visualCalls,bv,dryRun}
}

test('Debug without visual receipt still returns Life input instead of throwing at try/finally boundary',async()=>{
  const m=mockWatch({vision:false})
  const row=await m.run({bvid:m.bv,__debugDryRun:true,view_depth:'skim',record_session:false,include_comments:false,include_danmaku:false})
  assert.equal(row.ok,true)
  assert.equal(row.action,'watch')
  assert.equal(m.ctx.videoDebugJob.images.length,0)
})

test('Debug with visual JPEG receipt keeps scoped capture through Life output stage',async()=>{
  const m=mockWatch({vision:true})
  const row=await m.run({bvid:m.bv,__debugDryRun:true,view_depth:'standard',record_session:false,include_comments:false,include_danmaku:false})
  assert.equal(row.ok,true)
  assert.ok(m.calls.includes('bili_preview_vision'))
  assert.equal(m.ctx.videoDebugJob.images.length,1)
  assert.equal(m.ctx.videoDebugJob.images[0].kind,'storyboard')
  assert.equal(row.visual?.debugCapture,undefined,'debug image metadata must not enter model-visible Life input')
})

test('non-Debug Life read also retains transient image receipt after observation cleanup',async()=>{
  const m=mockWatch({vision:true,dryRun:false})
  const row=await m.run({bvid:m.bv,record_session:false,include_comments:false,include_danmaku:false}, {lifeChoiceVerified:false})
  assert.equal(row.ok,true)
  assert.equal(m.ctx.lastLifeVideoDebug?.images?.length,1)
  assert.equal(m.ctx.lastLifeVideoDebug?.payload?.visual?.debugCapture,undefined)
})


test('owner read-only Debug defaults to official videoshot; reason cannot impersonate Life choice',async()=>{
  const m=mockWatch({vision:true})
  const result=await m.run({bvid:m.bv,__debugDryRun:true,view_depth:'standard',
    record_session:false,include_comments:false,include_danmaku:false})
  assert.equal(m.visualCalls.length,1)
  assert.equal(m.visualCalls[0].perception_source,'preview')
  assert.equal(m.visualCalls[0].capture_for_debug,true)
  assert.equal(result.visionDecision,'owner-debug-standard')
  assert.equal(result.observationInitiator,'owner-manual-debug')
  assert.equal(result.debugPerceptionSourceRequested,'preview')
  assert.equal(m.ctx.lastLifeVideoDebug,null,'owner Debug must not appear as actual Life watching')
})

test('owner can explicitly test original decoding without changing the Life production source',async()=>{
  const original=mockWatch({vision:true})
  const observed=await original.run({bvid:original.bv,__debugDryRun:true,view_depth:'standard',
    record_session:false,include_comments:false,include_danmaku:false},
    {debugPerceptionSource:'adaptive'})
  assert.equal(original.visualCalls[0].perception_source,'adaptive')
  assert.equal(observed.debugPerceptionSourceRequested,'adaptive')
  assert.equal(observed.visionDecision,'owner-debug-standard')
  const life=mockWatch({vision:true})
  await life.run({bvid:life.bv,view_depth:'standard',record_session:false,
    include_comments:false,include_danmaku:false},{lifeChoiceVerified:true})
  assert.equal(life.visualCalls[0].perception_source,'preview')
  const direct=mockWatch({vision:true})
  await direct.run({bvid:direct.bv,view_depth:'standard',record_session:false,
    include_comments:false,include_danmaku:false})
  assert.equal(direct.visualCalls[0].perception_source,'adaptive')
})


test('dev22 Life may elect ordinary global vision; owner 48-frame budget applies to preview sampling without a pre-watch deep choice',async()=>{
  const life=mockWatch({vision:true})
  const row=await life.run({bvid:life.bv,view_depth:'standard',record_session:false,
    include_comments:false,include_danmaku:false},{lifeChoiceVerified:true})
  assert.equal(life.visualCalls.length,1)
  assert.equal(life.visualCalls[0].perception_source,'preview')
  assert.equal(life.visualCalls[0].view_depth,'deep','sampling depth is budget not pre-watch choice')
  assert.equal(row.viewDepth,'standard','Life did not decide to deep-focus before watching')
  const debug=mockWatch({vision:true})
  await debug.run({bvid:debug.bv,__debugDryRun:true,view_depth:'standard',
    record_session:false,include_comments:false,include_danmaku:false},
    {debugPerceptionSource:'preview',debugTwoStageGlobalOverview:true})
  assert.equal(debug.visualCalls[0].view_depth,'deep')
  const simple=mockWatch({vision:true})
  await simple.run({bvid:simple.bv,__debugDryRun:true,view_depth:'standard',
    record_session:false,include_comments:false,include_danmaku:false},
    {debugPerceptionSource:'preview'})
  assert.equal(simple.visualCalls[0].view_depth,'standard',
    'ordinary single-stage owner debug does not silently expand budget')
  const adaptive=mockWatch({vision:true})
  await adaptive.run({bvid:adaptive.bv,__debugDryRun:true,view_depth:'standard',
    record_session:false,include_comments:false,include_danmaku:false},
    {debugPerceptionSource:'adaptive',debugTwoStageGlobalOverview:true})
  assert.equal(adaptive.visualCalls[0].view_depth,'deep')
  assert.equal(adaptive.visualCalls[0].perception_source,'adaptive',
    'source selection remains independent from sampling budget')
})
