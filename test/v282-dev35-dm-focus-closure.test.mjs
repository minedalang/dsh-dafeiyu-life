import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {scopedLifeFocusContext,continuationMenu} from '../lib/life-continuation.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {verifyVideoFocusReview} from '../lib/video-focus-review.mjs'

const BV='BV1ab2345678',OTHER='BV1ab2345679',ID='a'.repeat(24),MIN=60_000
const DM={followUnread:0,unfollowUnread:0,dustbinUnread:0}
const flush=()=>new Promise(resolve=>setTimeout(resolve,15))
const baseIntention={id:ID,status:'ready',selectedBvid:BV,selectedTitle:'测试视频',
  metadataAt:1800000000000,observedVideoBvids:[BV],expiresAt:1800003600000,
  episodeMaxSteps:5,episodeSteps:1}
const observed={bvid:BV,focusCandidates:[{atSeconds:65,startSeconds:57.5,endSeconds:72.5}],
  focusUsage:{windows:0,frames:0,seconds:0,bytes:0,batches:0},videoDurationSeconds:200,focusHistory:[]}

test('Life current Episode alone can inherit its verified focus candidates; absent, null or stale observation cannot leak',()=>{
  for(const value of [null,undefined,{}, {...observed,bvid:OTHER},{...observed,focusCandidates:null}]){
    const scoped=scopedLifeFocusContext(baseIntention,value)
    assert.deepEqual(scoped,{focusCandidates:[]})
    assert.equal(continuationMenu(baseIntention,{at:1800000000001,...scoped}).some(x=>x.action==='focus_video'),false)
  }
  assert.deepEqual(scopedLifeFocusContext(null,observed),{focusCandidates:[]})
  const scoped=scopedLifeFocusContext(baseIntention,observed)
  const menu=continuationMenu(baseIntention,{at:1800000000001,...scoped})
  assert.equal(menu.find(x=>x.action==='focus_video')?.candidates.length,1)
  const production=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  assert.equal((production.match(/\.\.\.scopedLifeFocusContext\((?:live|fresh),visualObservation\)/g)||[]).length,2)
  assert.doesNotMatch(production,/visualObservation\?\.bvid===\w+\?\.selectedBvid\?visualObservation\.focusCandidates/)
})

function makeScheduler({dmPoll,changeScopeOnSentinel=false,changeScopeOnPoll=false,sentinelResult=null}={}){
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev35-sentinel-'))
  let t=1800000000000,scope='0123456789abcdef',requests={dmUnread:0,dmList:0}
  const budget={
    status:()=>({blocked:false,retryAt:0,dmListNextAt:0,dmUnreadNextAt:0,socialUnreadNextAt:0,
      byKind:[],lastReadAtByKind:{}}),record:kind=>{requests[kind]=(requests[kind]||0)+1}
  }
  const scheduler=createInteractionScheduler({
    dm:{poll:async()=>{requests.dmList++;if(changeScopeOnPoll)scope='fedcba9876543210';return dmPoll?dmPoll():{ok:true,failed:0}},
      needsBootstrap:async()=>false,hasDueContinuation:()=>false,nextFastUid:()=>null,
      status:()=>({})},comments:{poll:async()=>({ok:true})},
    readPrivateUnread:async()=>{requests.dmUnread++;if(changeScopeOnSentinel)scope='fedcba9876543210';return sentinelResult||{...DM}},
    getAccountTag:()=>scope,readBudget:budget,dataDir:dir,now:()=>t,
    getConfig:()=>({masterEnabled:true,dmWatch:true,dmActivePollEnabled:false}),
    logger:{error:()=>{}}
  })
  return {dir,scheduler,requests,advance:ms=>{t+=ms},scope:()=>scope,setScope:v=>{scope=v},cleanup:()=>{scheduler.stop();rmSync(dir,{recursive:true,force:true})}}
}
test('30-minute DM list reconciliation remains intact and does not amplify on quiet ticks',async()=>{
  const f=makeScheduler();try{
    f.scheduler.start();await flush()
    const first=f.requests.dmList
    assert.equal(first,1)
    f.advance(5*MIN);await f.scheduler.tick();assert.equal(f.requests.dmList,1)
    f.advance(25*MIN);await f.scheduler.tick();assert.equal(f.requests.dmList,2)
    await f.scheduler.tick();assert.equal(f.requests.dmList,2)
    assert.equal(f.scheduler.status().dmAdaptive.reconciliationMinutes,30)
  }finally{f.cleanup()}
})
test('DM poll returns ok:false: never clear a pending reconciliation or create a successful baseline',async()=>{
  const f=makeScheduler({dmPoll:()=>({ok:false,reason:'temporary-detail-failure'})});try{
    f.scheduler.start();await flush()
    const dm=f.scheduler.status().sentinels.private
    assert.equal(dm.pending,true)
    assert.equal(dm.bootstrapped,false)
    assert.equal(dm.lastDetailAt,0)
    assert.equal(f.scheduler.status().checks.dmDetails.lastResult,'error')
  }finally{f.cleanup()}
})
test('Bilibili -509 returned as ok:false must enter persistent network backoff, not a completed DM list',async()=>{
  const f=makeScheduler({dmPoll:()=>({ok:false,reason:'code=-509 请求过于频繁'})});try{
    f.scheduler.start();await flush()
    const status=f.scheduler.status()
    assert.equal(status.checks.dmDetails.lastResult,'error')
    assert.equal(status.sentinels.private.pending,true)
    assert.equal(status.networkBackoff.dm.category,'rate-limit')
    assert.equal(status.networkBackoff.dm.allowed,false)
    const requests=f.requests.dmList
    await f.scheduler.tick()
    assert.equal(f.requests.dmList,requests)
  }finally{f.cleanup()}
})
test('account switched after async sentinel read: no stale unread count written to another account scope',async()=>{
  const f=makeScheduler({changeScopeOnSentinel:true});try{
    f.scheduler.start();await flush()
    assert.equal(f.scope(),'fedcba9876543210')
    const dm=f.scheduler.status().sentinels.private
    assert.equal(dm.unread,null)
    assert.equal(dm.pending,false)
    assert.equal(f.requests.dmList,0)
  }finally{f.cleanup()}
})
test('late -509 for old account does not impose backoff on the newly selected account',async()=>{
  const f=makeScheduler({changeScopeOnSentinel:true,sentinelResult:{ok:false,reason:'code=-509 请求过于频繁'}});try{
    // The old-account sentinel response arrives only after the active scope switched.
    // Even a valid -509 text must not write a new-account rate-limit lane.
    f.scheduler.start();await flush()
    assert.equal(f.scheduler.status().networkBackoff.dm.category,'')
    assert.equal(f.requests.dmList,0)
  }finally{f.cleanup()}
})
test('successful DM list result after account switch does not clear the old or new account pending state',async()=>{
  const f=makeScheduler({changeScopeOnPoll:true});try{
    f.scheduler.start();await flush()
    assert.equal(f.scope(),'fedcba9876543210')
    assert.equal(f.scheduler.status().sentinels.private.pending,false)
    f.setScope('0123456789abcdef')
    assert.equal(f.scheduler.status().sentinels.private.pending,true)
    assert.equal(f.scheduler.status().sentinels.private.bootstrapped,false)
  }finally{f.cleanup()}
})
test('focus verifier accepts only true decoded time-window and bounded independent evidence',()=>{
  const result={bvid:BV,ok:true,status:'analyzed',description:'楼梯口可见扶手',
    image_source:'B站公开视频片段（离线解码）',focus_window:{startSeconds:57.5,endSeconds:72.5},
    sampling:{input_bytes:4000000,network_budget_bytes:8000000}}
  const plan={status:'ready',startSeconds:57.5,endSeconds:72.5,networkBudgetBytes:8000000}
  const evidence={sources:[{kind:'decoded_video_frames',timePointsMs:[58000,65000,72000]},
    {kind:'decoded_visual_analysis'}]}
  const proof=verifyVideoFocusReview({bvid:BV,plan,result,evidence})
  assert.equal(proof?.source,'decoded-public-video-focus')
  assert.equal(proof?.frameCount,3)
  assert.equal(verifyVideoFocusReview({bvid:OTHER,plan,result,evidence}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result:{...result,focus_window:{startSeconds:35,endSeconds:50}},evidence}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result,evidence:{sources:[{kind:'preview_frames',timePointsMs:[65000]}]}}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan:{...plan,networkBudgetBytes:3000000},result,evidence}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result,evidence:{sources:{}}}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result:{...result,sampling:{...result.sampling,input_bytes:-1}},evidence}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result:{...result,sampling:{...result.sampling,network_budget_bytes:'8000000'}},evidence}),null)
  assert.equal(verifyVideoFocusReview({bvid:BV,plan,result,evidence:{sources:[{kind:'decoded_video_frames',timePointsMs:[65000,65000]},{kind:'decoded_visual_analysis'}]}}),null)
  const code=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  assert.match(code,/traceStep\('blocked',\{action:'focus_video',code:reason,visualStatus/)
  assert.match(code,/verifyVideoFocusReview\(/)
})
