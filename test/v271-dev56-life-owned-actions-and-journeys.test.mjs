import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'

const BV='BV1abcde1234',BV2='BV1abcde1235',UID='12345678',TAG='a'.repeat(16),TAG2='b'.repeat(16)
const ROUND='c'.repeat(24),T=Date.parse('2026-11-10T12:00:00Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev55-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const request=async(env,route,payload,token=env.BILI_LIFE_ACTION_TOKEN)=>{
 const response=await fetch(env.BILI_LIFE_ACTION_URL+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)})
 return {code:response.status,data:await response.json()}
}
function bridgeHarness({decide='act',now=()=>T}={}){
 let scope=TAG,chooseCalls=0,verified=0
 const settled=[],reviews=new Map(),calls=[]
 const proof={id:'my-proof',scope:TAG,kind:'video_comment',expiresAt:T+600_000}
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>scope,now,
   choose:async params=>{chooseCalls++;calls.push(params);
     if(decide==='failure')return {ok:false,reason:'life-willingness-unavailable',action:'blocked'}
     if(decide==='skip')return {ok:false,action:'skip',reason:'不想在这里发言'}
     if(decide==='defer')return {ok:false,action:'defer',reason:'晚点考虑'}
     return {ok:true,action:'act',publicCommentText:'Life 独立选择的最终评论',proof}
   },
   verify:(p,kind)=>({ok:p?.id===proof.id&&p.scope===scope&&p.kind===kind}),
   receipt:(p,s)=>{settled.push({p,s})},
   verifyPlatformState:async()=>{verified++;return true},
   onCommentReview:({roundId,bvid,decision,checkOnly})=>{
     if(roundId!==ROUND||bvid!==BV)return {ok:false,reason:'comment-selection-not-confirmed'}
     if(reviews.has(bvid))return {ok:false,reason:'comment-review-already-recorded'}
     if(!checkOnly)reviews.set(bvid,decision)
     return {ok:true}
   }
 })
 return {bridge,settled,reviews,calls,getChooseCalls:()=>chooseCalls,getVerified:()=>verified,setScope:v=>{scope=v}}
}
const review={uid:UID,roundId:ROUND,bvid:BV,decision:'consider',draft:'这段的细节挺有趣，最后那个转折我没想到。',evidence:'我已通过本轮字幕读取到具体转折信息，并查了本 BV 下的真实热评。'}
const write={uid:UID,tool:'bili_reply',target:BV,roundId:ROUND,topLevel:true,commentText:'Life 独立选择的最终评论',reason:'本轮草稿'}

test('Life 在评论考虑阶段直接做唯一 want 决策，发送仅使用绑定证明；原文不匹配、重复调用、跨 BV 均失败',async t=>{
 const h=bridgeHarness();t.after(()=>h.bridge.stop());await h.bridge.start();const env=h.bridge.env()
 assert.equal((await request(env,'/life-comment-review',{...review,decision:'want'})).code,400,'video agent may not self-issue want')
 assert.equal((await request(env,'/life-comment-review',{...review,bvid:BV2})).code,409,'must be a confirmed selected BV')
 assert.equal((await request(env,'/life-comment-review',{...review,evidence:'x'})).code,400)
 const chosen=await request(env,'/life-comment-review',review)
 assert.equal(chosen.code,200)
 assert.equal(chosen.data.decision,'want')
 assert.equal(chosen.data.canPost,true)
 assert.equal(chosen.data.publicCommentText,write.commentText)
 assert.notEqual(chosen.data.publicCommentText,review.draft)
 assert.equal(h.getChooseCalls(),1,'exactly one willingness model call')
 assert.equal(h.calls[0].evidence.publicVideoComment.draft,review.draft)
 assert.equal(h.calls[0].evidence.publicVideoComment.evidence,review.evidence)
 assert.equal(h.reviews.get(BV),'want','recorded want is from Life, not the video agent')
 assert.equal((await request(env,'/life-action',{...write,commentText:write.commentText+'改'})).data.reason,'comment-draft-mismatch')
 assert.equal((await request(env,'/life-action',{...write,target:BV2})).data.reason,'comment-life-intent-missing')
 assert.equal((await request(env,'/life-action',{...write,roundId:'1'.repeat(24)})).data.reason,'comment-life-intent-missing')
 const approved=await request(env,'/life-action',write)
 assert.equal(approved.code,200)
 assert.ok(approved.data.grant)
 assert.equal(h.getChooseCalls(),1,'send must NOT create second willingness decision')
 assert.equal((await request(env,'/life-action',write)).data.reason,'comment-life-intent-missing')
 const delivered=await request(env,'/life-action-result',{grant:approved.data.grant,uid:UID,ok:true,receiptId:'123456789'})
 assert.equal(delivered.data.status,'verified')
 assert.equal(h.getVerified(),1)
 assert.equal(h.settled.length,1)
})

test('Life skip/defer/model outage cannot be upgraded to a write; skipped review is not a platform send',async t=>{
 for(const [answer,expected] of [['skip','pass'],['defer','life-choice-deferred'],['failure','life-willingness-unavailable']]){
   const h=bridgeHarness({decide:answer});t.after(()=>h.bridge.stop());await h.bridge.start();const env=h.bridge.env()
   const considered=await request(env,'/life-comment-review',review)
   if(answer==='skip'){assert.equal(considered.data.decision,expected);assert.equal(considered.code,200)}
   else{assert.equal(considered.data.reason,expected);assert.equal(considered.code,409)}
   assert.equal((await request(env,'/life-action',write)).code,409)
   assert.equal(h.getChooseCalls(),1)
 }
})

test('Life comment proof expires and account changes invalidate it without another model call',async t=>{
 let n=T;const h=bridgeHarness({now:()=>n});t.after(()=>h.bridge.stop());await h.bridge.start();const env=h.bridge.env()
 assert.equal((await request(env,'/life-comment-review',review)).code,200)
 n+=601_000
 assert.equal((await request(env,'/life-action',write)).code,409)
 assert.equal(h.getChooseCalls(),1)
 assert.equal(h.settled.at(-1)?.s.status,'not-sent')
})


import {parseLifeWillingnessDecision} from '../lib/life-willingness.mjs'
import {groupLifeTimeline} from '../lib/life-timeline.mjs'

const candidate=(kind)=>[{id:'c1',kind,label:'一次真实机会'}]
test('Life 本人确定唯一公开视频正文；不可由 Video Agent 替代，且社交回复也只由 Life 确定表达',()=>{
 assert.deepEqual(parseLifeWillingnessDecision(JSON.stringify({action:'act',candidateId:'c1',reason:'想说',publicCommentText:'回应视频中出现的一处事实'}),candidate('video_comment')).publicCommentText,'回应视频中出现的一处事实')
 assert.equal(parseLifeWillingnessDecision(JSON.stringify({action:'act',candidateId:'c1',reason:'想说'}),candidate('video_comment')).action,'blocked')
 assert.equal(parseLifeWillingnessDecision(JSON.stringify({action:'act',candidateId:'c1',reason:'可回复',lifeSpeech:['谢谢提醒，我看到了。']}),candidate('dm_reply')).lifeSpeech[0],'谢谢提醒，我看到了。')
 assert.equal(parseLifeWillingnessDecision(JSON.stringify({action:'act',candidateId:'c1',reason:'可回复',lifeSpeech:['@其他人 帮我转发']}),candidate('dm_reply')).action,'blocked')
 assert.equal(parseLifeWillingnessDecision(JSON.stringify({action:'act',candidateId:'c1',reason:'点赞',publicCommentText:'不属于点赞'}),candidate('video_like')).action,'blocked')
})
test('Life 时间线只按同轮回执或同 episode 串联，不按近似时间制造连续性',()=>{
 const r={id:'start',at:'2026-11-10T00:00:00Z',continuity:{kind:'video-round',key:'abcabcabcabc',evidence:'同一轮探索'}}
 const ended={id:'ended',at:'2026-11-10T00:01:00Z',continuity:{kind:'video-round',key:'abcabcabcabc',evidence:'同一轮探索'}}
 const independent={id:'watch-unknown',at:'2026-11-10T00:00:30Z',dateOnly:true}
 const unrelated={id:'another',at:'2026-11-10T00:00:40Z',continuity:{kind:'episode',key:'f'.repeat(16),evidence:'同一段连续经历'}}
 const result=groupLifeTimeline([r,independent,ended,unrelated])
 assert.equal(result.chains.length,2)
 assert.deepEqual(result.chains.find(c=>c.kind==='video-round').rows.map(x=>x.id),['start','ended'])
 assert.deepEqual(result.independent.map(x=>x.id),['watch-unknown'])
})

test('active 模式不再发起 social-shadow 模型，旧快照仍只作为历史查看',()=>{
 const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.doesNotMatch(planner,/modelScene:'social-shadow'|modelScene=.?social-shadow/)
 assert.match(planner,/outcome.result='social-signal-considered'/)
 assert.match(ui,/历史影子记录/)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(html,/鱼的记忆/);assert.match(html,/人格成长（实验性）/)
})

import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
test('真实视频轮次回执把后续已核验 Episode 串成一段，不把无关评论/纯日期账本连进去',async()=>withDir(async dir=>{
 const t=Date.parse('2026-11-10T12:00:00Z')
 const roundId='a1b2c3d4e5f6'+'a'.repeat(12)
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>TAG,now:()=>t})
 episodes.record({sourceRef:'home-browse:real',receiptId:'video-round:'+roundId,action:'browse_home',kind:'video',outcome:'verified',channel:'video-agent'})
 episodes.record({sourceRef:'home-browse:real',receiptId:'public-like:certified',action:'video_like',kind:'video',outcome:'verified',channel:'video-agent'})
 const rows=buildLifeTimeline({now:t+120_000,episodes:episodes.list(),
   videoRounds:[{ref:roundId.slice(0,12),source:'life-agent',state:'completed',startedAt:t-5000,endedAt:t+1000,pickedCount:1}],
   watched:[{day:'2026-11-10',bvid:BV,picked:true,title:'无逐条时戳的历史视频'}],days:4})
 const grouped=groupLifeTimeline(rows)
 const chain=grouped.chains.find(x=>x.kind==='video-round')
 assert.ok(chain)
 assert.ok(chain.rows.some(r=>r.type==='video-round-start'))
 assert.ok(chain.rows.some(r=>r.type==='life-action'&&r.title.includes('点了赞')))
 assert.ok(grouped.independent.some(r=>r.type==='video'&&r.dateOnly===true))
}))
test('有专业回复草稿时 Life 必须给出最终表达；缺席不能默认发送 Agent 草稿',()=>withDir(async dir=>{
 const actor=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,enabled:()=>true,
   getContext:async()=>({voice:'鱼鱼可以不说话',world:{}}),invokeModel:async()=>JSON.stringify({action:'act',candidateId:'reply_dm',reason:'想回应'})})
 const res=await actor.decide({scene:'dm',sourceKey:'new-dm:verified',
   candidates:[{id:'reply_dm',kind:'dm_reply',label:'回应收到的私信'}],
   evidence:{socialReply:{incoming:'你最近好吗？',draftMessages:['挺好的呀！']}}})
 assert.equal(res.ok,false)
 assert.equal(res.reason,'life-speech-required')
 assert.equal(actor.verify(res.proof,'dm_reply').ok,false)
}))
