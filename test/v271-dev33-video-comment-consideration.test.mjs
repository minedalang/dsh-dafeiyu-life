import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {classifyVideoCommentRound,videoCommentGateCode} from '../lib/video-comment-readiness.mjs'

const UID='12345678',TAG='a'.repeat(16),OTHER_TAG='b'.repeat(16), BV='BV1abcde1234',OTHER='BV1abcde1235',ROUND='c'.repeat(24)
const runDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-comment-review-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('评论诊断能够区分未考虑、不愿评论、想说但未提议、Life 否决与平台未知',()=>{
 const input={gate:'configured',pickedCount:2,exitCode:0}
 assert.equal(classifyVideoCommentRound(input).code,'model-review-not-observed')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewed:2,passed:2}}).code,'model-chose-not-comment')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewed:1,insufficient:1}}).code,'insufficient-evidence')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewed:1,wanted:1}}).code,'wanted-but-not-proposed')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewRejected:1}}).code,'comment-review-rejected')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewed:1,wanted:1,proposed:1,declined:1}}).code,'life-declined')
 assert.equal(classifyVideoCommentRound({...input,review:{reviewed:1,proposed:1,approved:1}}).code,'platform-unverified')
 assert.equal(classifyVideoCommentRound({...input,review:{verified:1}}).code,'platform-verified')
 assert.equal(classifyVideoCommentRound({...input,gate:'auto-comment-disabled'}).code,'comment-config-blocked')
 assert.equal(classifyVideoCommentRound({...input,gate:'life-bridge-not-ready'}).code,'life-bridge-not-ready')
 assert.equal(videoCommentGateCode({masterEnabled:true,autoComment:true,commentPerRound:2,commentDailyLimit:3},{bridgeReady:false}),'life-bridge-not-ready')
 assert.equal(classifyVideoCommentRound({...input,pickedCount:0}).code,'no-confirmed-selection')
 assert.equal(classifyVideoCommentRound({...input,pickedCount:null}).code,'selection-unknown')
 assert.equal(classifyVideoCommentRound({...input,exitCode:1}).code,'video-process-not-completed')
})

test('Video Agent 不能用 pass 抢走 Life 沉默权；insufficient 是技术证据不足，不花模型调用',async t=>{
 let scope=TAG,uid=UID,models=0
 const reviews=new Map(),selected=new Set([BV])
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>uid,getAccountTag:()=>scope,
  choose:async()=>{models++;return {ok:false,action:'skip'}},verify:()=>({ok:false}),receipt:()=>{},
  onCommentReview:({roundId,bvid,decision,checkOnly})=>{
   if(roundId!==ROUND||!selected.has(bvid)||reviews.has(bvid))return {ok:false}
   if(!checkOnly)reviews.set(bvid,decision)
   return {ok:true}
  }})
 t.after(()=>bridge.stop());await bridge.start()
 const {BILI_LIFE_ACTION_URL:url,BILI_LIFE_ACTION_TOKEN:secret}=bridge.env()
 const send=async(data,token=secret)=>{
  const response=await fetch(url+'/life-comment-review',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)})
  return {status:response.status,body:await response.json()}
 }
 const good={uid:UID,roundId:ROUND,bvid:BV,decision:'insufficient'}
 assert.equal((await send({...good,bvid:OTHER})).status,409)
 assert.equal((await send({...good,roundId:'bad'})).status,400)
 assert.equal((await send({...good,decision:'pass'})).status,400)
 assert.equal((await send(good,'0'.repeat(64))).status,403)
 assert.equal((await send(good)).body.recorded,true)
 assert.equal((await send(good)).status,409)
 assert.equal(reviews.get(BV),'insufficient')
 assert.equal(models,0)
 scope=OTHER_TAG;assert.equal((await send(good)).status,409)
})

test('视频轮次只持久化脱敏计数，DEBUG 单独记录视频结束，不把候选误认成发言',()=>runDir(async dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG})
 const id=e.recordVideoRoundStart({commentGate:'configured'}).id
 e.recordVideoRoundFinish(id,{exitCode:0,pickedCount:2,commentDiagnostics:{reviewed:2,wanted:1,passed:1,insufficient:0,proposed:0,approved:0,blocked:1,verified:0,unverified:0,commentText:'private',bvid:BV}})
 const row=e.status().recentVideoRounds[0]
 assert.equal(row.commentDiagnostics.reviewed,2)
 assert.equal(row.commentDiagnostics.wanted,1)
 assert.equal(row.commentDiagnostics.proposed,0)
 assert.equal(row.commentDiagnostics.blocked,1)
 const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG})
 const entry=trace.begin({mode:'video-round',trigger:'video-agent-result'})
 entry.step('video-comment-summary',{code:'wanted-but-not-proposed',reviewed:2,wanted:1,passed:1,insufficient:0,proposed:0,approved:0,blocked:1,picked:2,commentText:'private',bvid:BV})
 entry.finish({action:'video_comment',result:'wanted-but-not-proposed'})
 const saved=JSON.stringify(trace.list().runs)+readFileSync(join(dir,'life-agent-events',TAG+'.json'),'utf8')
 assert.doesNotMatch(saved,/private|BV1abcde1234|commentText|12345678/)
 assert.match(saved,/wanted-but-not-proposed/)
 assert.match(saved,/\"wanted\":1/)
 assert.match(saved,/\"passed\":1/)
 assert.match(saved,/\"blocked\":1/)
}))

test('源代码将考虑工具限定为已开启的原创评论视频 Agent，主 Session 仍须主人确认',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(idx,/list\.push\('bili_reply','bili_comment_consideration'\)/)
 assert.match(idx,/commentConsiderationDoc/)
 assert.match(idx,/onCommentReview:/)
 assert.match(idx,/BILI_DUTY_LIFE_ROUND_ID:videoRoundReceiptId/)
 assert.match(idx,/if \(args\?\.confirm !== true\) return \{ok:false,blocked:true,needsConfirmation:true,error:'需要主人在当前对话明确要求发送评论/)
 assert.match(py,/async def bili_comment_consideration\(bvid: str, decision: str = 'consider', reason: str = ''/)
 assert.match(py,/_life_video_request,'\/life-comment-review'/)
 assert.match(ui,/明确考虑/)
})
