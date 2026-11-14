import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {releaseAcceptanceEvidence} from '../lib/release-acceptance-evidence.mjs'
import {prioritizeLifeContinuationCandidates} from '../lib/life-episode-entrypoints.mjs'
const A='a'.repeat(16),B='b'.repeat(16),UID='1234567',BV='BV1abcde1234',ROUND='f'.repeat(24),T=1794137555241
const sandbox=fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-episode-comment-fix-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('过去自愿暂停的 Episode 在冷却后重新具备续行资格，不绕过原可信来源',()=>sandbox(dir=>{
 let t=T,who=A
 const e=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>who,now:()=>t})
 const source='intention:original-source'
 e.record({sourceRef:source,receiptId:'real-picked-home',action:'browse_home',kind:'video',outcome:'verified'})
 e.pauseLatest({delayMs:60*60_000})
 assert.equal(e.list()[0].status,'paused')
 assert.equal(e.due({eligibleSources:[source]}),false)
 assert.equal(e.health({eligibleSources:[source]}).pausedCooling,1)
 t+=60*60_000+1
 assert.equal(e.due({eligibleSources:[]}),false,'不能凭 Episode 历史制造新意愿')
 assert.equal(e.health().pausedWithoutEligibleSource,1)
 assert.equal(e.due({eligibleSources:[source]}),true,'冷却结束后应该可以再次自主考虑')
 const health=e.health({eligibleSources:[source]})
 assert.equal(health.eligibleToResume,1)
 assert.equal(health.pausedDueWithSource,1)
 const again=e.record({sourceRef:source,receiptId:'real-metadata-next',action:'inspect_exploration',kind:'exploration',outcome:'verified'})
 assert.equal(again.ok,true)
 assert.equal(again.episode.steps,2)
 assert.equal(again.episode.status,'active')
 assert.equal(e.due({eligibleSources:[source]}),false,'新动作后的短冷却不能直接打转')
 who=B
 assert.deepEqual(e.list(),[])
 assert.equal(e.due({eligibleSources:[source]}),false)
 who=A
 assert.equal(e.record({sourceRef:'intention:unknown',receiptId:'pending-write',action:'comment_video',kind:'video',outcome:'unknown'}).episode.status,'review')
 assert.equal(e.due({eligibleSources:['intention:unknown']}),false,'未知结果不能触发外发续行')
}))

test('只读评论考虑拒绝会返回具体可枚举原因，不会触发 Life 写审批或平台发送',async t=>{
 let scope=A,proposal=0,writes=0,selected=false
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>scope,
  choose:async()=>{proposal++;return {ok:false}},verify:()=>({ok:false}),receipt:()=>{writes++},
  onCommentReview:()=>scope!==A?{ok:false,reason:'comment-review-not-current'}:selected?{ok:true}:{ok:false,reason:'comment-selection-not-confirmed'}})
 t.after(()=>bridge.stop());await bridge.start()
 const env=bridge.env(),payload={uid:UID,roundId:ROUND,bvid:BV,decision:'insufficient'}
 const send=async()=>{const r=await fetch(env.BILI_LIFE_ACTION_URL+'/life-comment-review',{method:'POST',
  headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(payload)})
  return {status:r.status,body:await r.json()}}
 const fail=await send()
 assert.equal(fail.status,409)
 assert.equal(fail.body.reason,'comment-selection-not-confirmed')
 selected=true
 const good=await send()
 assert.equal(good.status,200)
 assert.equal(good.body.recorded,true)
 assert.equal(proposal,0);assert.equal(writes,0)
 scope=B
 assert.equal((await send()).status,409)
})

test('匿名 S0 快照把暂停冷却、失去原来源与可恢复分开，仍然不输出私人标识',()=>{
 const obj=releaseAcceptanceEvidence({lifeEpisodeHealth:{active:0,paused:1,pausedCooling:0,pausedWithoutEligibleSource:1,
   pausedDueWithSource:0,eligibleToResume:0},hostPlatform:'win32',now:T})
 assert.equal(obj.episode.pausedWithoutEligibleSource,1)
 assert.equal(obj.episode.pausedCooling,0)
 assert.equal(obj.releaseReady,false)
 const text=JSON.stringify(obj)
 assert.doesNotMatch(text,/BV1abcde1234|1234567|private body/)
})

test('视频标记的附带只读意愿与评论写入仍是独立工具，当前轮未入选则拒绝',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(idx,/Video Agent 不准提交 comment_decision=pass/)
 assert.match(idx,/comment-review-permission-unavailable/)
 assert.match(idx,/row\.previouslyPickedBvids\.has\(bvid\)/)
 assert.match(py,/comment_decision: str = ""/)
 assert.match(py,/if comment_decision and \(comment_decision != 'insufficient'/)
 assert.match(py,/result\['comment_review'\]/)
 assert.match(py,/round_id = os\.environ\.get\('BILI_DUTY_LIFE_ROUND_ID'/)
 assert.match(py,/if route in \('\/life-comment-review', '\/life-action'\) and exc\.code == 409/)
})

test('上次真实探索排在新首页兴趣之前，且暂停/未知不得冒充可续行',()=>{
 // The canonical source already filtered expired, finished, and cooled-down entries.
 const rows=Array.from({length:12},(_,i)=>({id:'intent-'+i,source:'home-browse'}))
 const states={
  'intention:intent-10':{status:'paused',nextAt:T-1,steps:2,lastAt:T-3600_000},
  'intention:intent-9':{status:'active',nextAt:T-1,steps:1,lastAt:T-1000},
  'intention:intent-8':{status:'paused',nextAt:T+3600_000,steps:4,lastAt:T-2000},
  'intention:intent-7':{status:'review',nextAt:0,steps:4,lastAt:T-5000}
 }
 const ranked=prioritizeLifeContinuationCandidates(rows,id=>states[id],{now:T,limit:3})
 assert.deepEqual(ranked.map(x=>x.id),['intent-10','intent-9','intent-0'])
 assert.equal(prioritizeLifeContinuationCandidates(rows,()=>null,{now:T,limit:3})[0].id,'intent-0')
})
