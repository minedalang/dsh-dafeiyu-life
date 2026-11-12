import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createCommentInteract} from '../lib/comment-interact.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {verifiedVideoObservation} from '../lib/life-action-protocol.mjs'
import {continuationMenu,lifeWriteKinds} from '../lib/life-continuation.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const BV='BV1abcdEFG12', ACCOUNT='900', T=Date.now(), EVIDENCE_ID='intention:'+'a'.repeat(24)+':discussion'
const home=async f=>{const dir=mkdtempSync(join(tmpdir(),'dev11-life-hot-'));try{return await f(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const top={rpid:'800',mid:'333',content:'这个视频的编曲真的很好',time:Math.floor(T/1000)}
function scenario(dir,{watchReplies=true,allowGeneralReplies=true,verifiedVideo=true}={}){
 const sent=[],incoming=[],callbacks=[],cfg={watchReplies,allowGeneralReplies,watchTop:false,watchAt:false,replyPerPoll:1,replyPerDay:5,globalDailyLimit:20,topCount:12}
 let hotReads=0
 const event=id=>({user:{mid:123,uname:'网友'},item:{business_id:1,subject_id:987,source_id:id,root_id:777,
   uri:`https://www.bilibili.com/video/${BV}`,source_content:'你觉得如何？',source_time:Math.floor(T/1000)}})
 const create=()=>createCommentInteract({dataDir:dir,selfUid:async()=>ACCOUNT,getConfig:()=>cfg,now:()=>T,
  getNotifications:async()=>({data:{items:incoming}}),getOwnComments:async()=>({top:['777'],nested:[]}),
  getComments:async()=>{hotReads++;return {comments:[top]}},
  getVideoContext:async()=>({text:'核实过的视频和回复资料',usable:true,verifiedVideo:verifiedVideo?{bvid:BV,title:'音乐视频'}:null}),
  onConfirmedVideoReply:async event=>{callbacks.push(event)},generateReply:async()=> '哈哈，确实有意思',
  send:async args=>(sent.push(args),{ok:true,rpid:String(9000+sent.length)}),logger:{warn(){},error(){}}})
 return {create,cfg,incoming,callbacks,sent,event,get hotReads(){return hotReads}}
}

test('legacy side-hot toggle never fetches or queues unrelated comments; only trusted reply receipt registers public episode',()=>home(async dir=>{
 const x=scenario(dir)
 x.cfg.sideHotEnabled=true // obsolete imported setting must not matter
 await x.create().poll() // historical notification bootstrap
 x.incoming.push(x.event('700'))
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.hotReads,0)
 assert.equal(x.sent.length,1)
 assert.equal(x.callbacks.length,1)
 assert.equal(x.callbacks[0].receiptId,'9001')
 const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(state.lifeSelectedQueue.length,0)
 assert.equal(state.sideHotQueue,undefined)
 assert.equal((await x.create().poll()).sent,0)
 assert.equal(x.sent.length,1)
}))

test('Life-selected and verified discussion produces candidates; normal comment Agent still chooses whether to reply',()=>home(async dir=>{
 const x=scenario(dir)
 await x.create().poll();x.incoming.push(x.event('701'))
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.hotReads,0)
 const result=await x.create().offerLifeSelectedDiscussion({bvid:BV,comments:[top],accountUid:ACCOUNT,sourceId:EVIDENCE_ID})
 assert.deepEqual(result,{ok:true,queued:1})
 assert.equal(x.hotReads,0,'only Life-selected read may supply data; offer never triggers a new read')
 const next=await x.create().poll()
 assert.equal(next.sent,1)
 assert.equal(x.sent[1].rpid,'800')
 assert.equal(x.sent[1].bvid,BV)
 assert.equal(x.hotReads,1,'current exact rpid/uid/text must be reverified before sending')
 assert.equal((await x.create().poll()).sent,0)
 assert.equal(x.sent.length,2)
}))

test('failing permission, account, source or later target recheck is fail-closed',()=>home(async dir=>{
 const x=scenario(dir)
 await x.create().poll()
 const engine=x.create()
 for(const invalid of [{bvid:'BV-invalid',comments:[top],accountUid:ACCOUNT,sourceId:EVIDENCE_ID},
   {bvid:BV,comments:[top],accountUid:'999',sourceId:EVIDENCE_ID},
   {bvid:BV,comments:[top],accountUid:ACCOUNT,sourceId:'invented'},
   {bvid:BV,comments:'hot comments',accountUid:ACCOUNT,sourceId:EVIDENCE_ID}])
   assert.equal((await engine.offerLifeSelectedDiscussion(invalid)).ok,false)
 x.cfg.allowGeneralReplies=false
 assert.equal((await engine.offerLifeSelectedDiscussion({bvid:BV,comments:[top],accountUid:ACCOUNT,sourceId:EVIDENCE_ID})).ok,false)
 x.cfg.allowGeneralReplies=true
 assert.equal((await engine.offerLifeSelectedDiscussion({bvid:BV,comments:[top],accountUid:ACCOUNT,sourceId:EVIDENCE_ID})).queued,1)
 x.cfg.watchReplies=false
 const stopped=await x.create().poll()
 assert.notEqual(stopped.sent,1)
 assert.equal(x.sent.length,0)
}))

test('legacy persisted autonomous side-hot queue is discarded, never silently reauthorized',()=>home(async dir=>{
 const state={version:1,notificationBootstrapped:true,replyParserVersion:2,atBootstrapped:true,atParserVersion:3,
  seen:{},sent:[],sideHotQueue:[{id:'comment:800',kind:'top',sideHot:true,bvid:BV,uid:'333',rpid:'800',text:top.content,at:T}]}
 writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify(state))
 const x=scenario(dir)
 assert.equal((await x.create().poll()).sent,0)
 assert.equal(x.hotReads,0)
 const db=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(db.sideHotQueue,undefined)
 assert.equal(db.lifeSelectedQueue.length,0)
}))

test('brief verified video title is sufficient to OFFER optional original comment; no invented 30-char/2-comment threshold',()=>{
 const config={autoComment:true,commentDailyLimit:5,commentPerRound:1}
 const base={ok:true,bvid:BV,title:'短标题',description:'',comments:[]}
 assert.deepEqual(lifeWriteKinds(config,base),['comment_video'])
 assert.deepEqual(lifeWriteKinds(config,{...base,title:''}),[])
 assert.deepEqual(lifeWriteKinds({...config,autoComment:false},base),[])
 assert.deepEqual(lifeWriteKinds(config,{...base,ok:false}),[])
})

test('a confirmed comment-reply receipt can seed shared Episode; hot comments are offered as an optional READ, not auto-read or send',()=>home(async dir=>{
 const cred={dedeuserid:ACCOUNT,sessdata:'local-credential'}
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>T})
 const scope=discussionAccountTag(cred)
 const observation=verifiedVideoObservation({source:'comment-reply-receipt',sourceId:'reply:9001:comment:700',
   bvid:BV,title:'短标题',at:T,accountTag:scope})
 assert.equal(observation.ok,true)
 const result=life.beginVideoObservation(observation,scope)
 assert.equal(result.ok,true)
 assert.equal(result.created,true)
 assert.equal(life.beginVideoObservation(observation,scope).created,false)
 const episode=life.continuations()[0]
 const actions=continuationMenu(episode,{at:T,writeActions:[]}).map(x=>x.action)
 assert.ok(actions.includes('inspect_video_discussion'))
 assert.ok(actions.includes('abandon_exploration'))
 assert.equal(life.inspectVideoDiscussion(episode.id,{ok:true,verified:true,bvid:'BV1abcde1234',count:1},scope).ok,false)
 const success=life.inspectVideoDiscussion(episode.id,{ok:true,verified:true,bvid:BV,count:1},scope)
 assert.equal(success.ok,true)
 assert.ok(!continuationMenu(life.continuations()[0],{at:T}).some(x=>x.action==='inspect_video_discussion'))
}))

test('owner/friend and ordinary confirmed replies converge on the same Life observation registrar, without side-hot fetch',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/const registerConfirmedVideoCommentObservation=async\(/)
 assert.match(source,/onConfirmedVideoReply:registerConfirmedVideoCommentObservation/)
 assert.match(source,/trustedCommentVideoContext\.set\(trustedCommentEvidenceKey\(currentScope,row\.bvid,row\.rpid,row\.uid\)/)
 assert.match(source,/if\(confirmed\)\{[\s\S]{0,650}registerConfirmedVideoCommentObservation/)
 assert.match(source,/Date\.now\(\)-verified\.at<=10\*60_000/)
 assert.doesNotMatch(source,/sideHotEnabled|commentSideHotEnabled/)
})

test('management page and settings API do not expose any retired post-reply side-hot switch',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.doesNotMatch(html,/commentSideHotEnabled|sideHotEnabled/)
 assert.doesNotMatch(js,/commentSideHotEnabled|sideHotEnabled/)
 assert.doesNotMatch(code,/commentSideHotEnabled|sideHotEnabled/)
 assert.match(html,/只有 Life 实际选择并取得真实评论回执/)
})

test('video write evidence no longer automatically fetches hot comments to satisfy description-length heuristic',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=code.indexOf('  const lifeContinuationEvidence=async(')
 const stop=code.indexOf('  // A separate, short-lived Python process',start)
 assert.ok(start>0&&stop>start)
 const segment=code.slice(start,stop)
 assert.doesNotMatch(segment,/bili_comments|description\.length|commentReady/)
 assert.match(segment,/comment[s]?=\[\]/)
 assert.match(segment,/bili_video_info/)
})


test('Life continuation video evidence is not subject to Video Agent popularity thresholds',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=code.indexOf('  const lifeContinuationEvidence=async(')
 const stop=code.indexOf('  // A separate, short-lived Python process',start)
 const segment=code.slice(start,stop)
 assert.doesNotMatch(segment,/cfg\.minVideoViews|cfg\.minVideoLikes|cfg\.minVideoReplies/)
 assert.match(segment,/data\.stat/)
 // Video Agent's configurable selection thresholds remain outside the Life continuation.
 assert.match(code,/judgeVideoHeat\(heatInfo,\{views:cfg\.minVideoViews/)
})
