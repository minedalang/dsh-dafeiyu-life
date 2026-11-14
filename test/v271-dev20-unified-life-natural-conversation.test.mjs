import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {isOwnerActivityQuestion,ownerRecentLifeSnapshot} from '../lib/owner-recent-life.mjs'
import {createSocialInteractionRhythm} from '../lib/social-interaction-rhythm.mjs'
import {quickSocialPlan,quickRevision} from '../lib/quick-setup-options.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
import {verifyOutboundVideoLinks} from '../lib/outbound-video-link-evidence.mjs'
const BV='BV1xx411c7mD'
const withDir=async(fn)=>{const p=mkdtempSync(join(tmpdir(),'dev20-life-'));try{return await fn(p)}finally{rmSync(p,{recursive:true,force:true})}}
test('主人问自己今天的视频与妙评，或追问“妙评”，均识别为自身经历',()=>{
 assert.equal(isOwnerActivityQuestion('今天有什么好玩的评论和视频吗'),true)
 assert.equal(isOwnerActivityQuestion('我意思是你发的或者看过的视频'),true)
 assert.equal(isOwnerActivityQuestion('有吗 有秒评吗',[{role:'user',text:'今天有什么好玩的评论和视频吗'}]),true)
 assert.equal(isOwnerActivityQuestion('妙评',[{role:'user',text:'你今天发过什么评论'}]),true)
 assert.equal(isOwnerActivityQuestion('请搜索B站全站热门视频'),false)
})
test('自身经历必须是当前核验账号的数据；只凭入选不能称看完，外发评论只能说明有发送回执',()=>{
 const rows={watched:[{bvid:BV,day:'2026-11-07',picked:true,title:'今天的有趣视频'},
  {bvid:'BV18m411W7P9',day:'2026-11-07',picked:false,title:'没选中'}],
  comments:[{bvid:BV,kind:'reply',hasReceipt:true,time:'2026-11-07T16:12:43',snippet:'嫌完还是乖乖待在屏幕上'},
    {bvid:BV,kind:'top',hasReceipt:false,time:'2026-11-07T16:12:43',snippet:'没有发送的草稿'}],now:new Date('2026-11-07T17:00:00').getTime()}
 assert.deepEqual(ownerRecentLifeSnapshot({...rows,accountVerified:false}).videos,undefined)
 const data=ownerRecentLifeSnapshot({...rows,accountVerified:true})
 assert.equal(data.videos.length,1);assert.equal(data.comments.length,1)
 assert.match(data.videos[0].meaning,/不证明看完/)
 assert.match(data.comments[0].meaning,/发送回执/)
})
test('切换账号时不能把旧账号同日视频和评论说成新账号经历',()=>{
 const cut=new Date('2026-11-07T15:00:00').getTime()
 const data=ownerRecentLifeSnapshot({now:new Date('2026-11-07T18:00:00').getTime(),accountVerified:true,oldestAt:cut,
  watched:[{bvid:BV,day:'2026-11-07',picked:true,title:'旧账号视频'},
    {bvid:BV,day:'2026-11-08',picked:true,title:'后一天新账号视频'}],
  comments:[{bvid:BV,kind:'top',hasReceipt:true,time:'2026-11-07T14:40:00',snippet:'旧账号评论'},
    {bvid:BV,kind:'top',hasReceipt:true,time:'2026-11-07T16:40:00',snippet:'新账号评论'}]})
 assert.equal(data.videos.length,0)
 assert.deepEqual(data.comments.map(c=>c.text),['新账号评论'])
})
test('主人私信模型会收到自己的公开经历；不能让最新平台热搜覆盖自身记录',()=>withDir(async dir=>{
 let prompt='',sendText='',searches=0
 const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>({masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true}),
  getRecentActivity:()=>({available:true,day:'2026-11-07',videos:[{bvid:BV,title:'好玩的视频'}],
    comments:[{kind:'原创顶层评论',text:'这个梗居然还有反转',bvid:BV}]}),
  invokeModel:async p=>{prompt=p;return JSON.stringify({action:'reply',text:'我今天确实留了句评论：“这个梗居然还有反转”。视频也挑中过一条，不过我可没说看完啦。'})},
  executeRead:async()=>{searches++;return {ok:true}},executeWrite:async()=>({ok:true}),send:async x=>{sendText=x.text;return {ok:true}}})
 agent.primeInbox([])
 const result=await agent.processMessage({incoming:true,senderUid:'123',messageId:'new-01',timestampMs:Date.now(),text:'今天有什么好玩的评论和视频吗'})
 assert.equal(result.ok,true);assert.equal(searches,0)
 assert.match(prompt,/这个梗居然还有反转/)
 assert.match(prompt,/不要用平台热门搜索替代/)
 assert.match(sendText,/今天确实留了句评论/)
}))
test('共享跨渠道节奏不再以同一人 8 条每天阻断；未知结果仍冻结',()=>withDir(async dir=>{
 let t=Date.now(),uid='567'
 const x=createSocialInteractionRhythm({dataDir:dir,getAccountUid:()=>uid,now:()=>t,getPolicy:()=>({crossChannelMinutes:0,dailyPerPerson:8})})
 for(let i=0;i<35;i++){
  const a=x.reserve({uid:'123',channel:i%2?'dm':'comment'})
  assert.equal(a.ok,true,JSON.stringify(a))
  assert.equal(x.settle(a.id,{outcome:'sent',receiptId:'id-'+i}).ok,true)
 }
 const unknown=x.reserve({uid:'123',channel:'at'});assert.equal(unknown.ok,true)
 assert.equal(x.settle(unknown.id,{outcome:'uncertain'}).ok,true)
 assert.equal(x.reserve({uid:'123',channel:'dm'}).reason,'prior-outcome-unresolved')
}))
test('旧版每天一次分享上限不再阻挡同一好友分享另一条真正入选视频',()=>withDir(async dir=>{
 const uid='34567',videoA=BV,videoB='BV18m411W7P9',stamp=Date.parse('2026-11-07T13:00:00Z'),day='2026-11-07'
 const config={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,
   socialVideoRecommendationsAuthorizedV2:true,socialOutreachDailyLimit:1,dmOwnerUid:uid,
   friendDirectory:JSON.stringify([{uid,dm:true,recommend:'both'}])}
 const candidates=[videoA,videoB].map(bvid=>({id:'life-share:'+uid+':'+bvid,uid,bvid,
   title:'真实入选的视频',type:'interest-share',status:'draft',createdAt:stamp,sourceAt:stamp,
   text:'我选中了这条视频，想跟你分享一下：https://www.bilibili.com/video/'+bvid}))
 const {writeFileSync}=await import('node:fs')
 writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,sent:[],items:candidates}))
 let count=0
 const engine=createSocialIntentEngine({dataDir:dir,videoRecommendationsOnly:true,getConfig:()=>config,
   now:()=>stamp,getSelectedVideos:()=>[videoA,videoB].map(bvid=>({bvid,picked:true,day})),
   invokeModel:async()=>'',authorizeDraft:async()=>({ok:true,proof:{lifeApproved:true}}),
   sendMessage:async()=>{count++;return {ok:true}}})
 assert.equal((await engine.send(candidates[0].id,{automatic:true})).ok,true)
 assert.equal((await engine.send(candidates[1].id,{automatic:true})).ok,true)
 assert.equal(count,2)
 assert.equal((await engine.send(candidates[0].id,{automatic:true})).ok,false)
 assert.equal(count,2)
}))
test('快速分享只修改权限，不再把旧 dailyLimit=1 写回',()=>{
 const cfg={socialOutreachDailyLimit:1,socialOutreachEnabled:false,socialAutoSend:false}
 const plan=quickSocialPlan(cfg,{channel:'share',choice:'autonomous',revision:quickRevision(cfg,'social'),previewOnly:true},{ready:true})
 assert.equal(Object.hasOwn(plan.patch,'socialOutreachDailyLimit'),false)
 assert.equal(plan.patch.socialAutoSend,true)
})
test('账号已核验本轮读取的历史公开视频可以核验链接来源，但不能证明视听完成',()=>{
 const good=verifyOutboundVideoLinks('这条我最近挑中过 https://www.bilibili.com/video/'+BV,
  {readRecords:[{action:'recent_activity',ok:true,videos:[{bvid:BV,title:'好玩的视频'}]}]})
 assert.equal(good.ok,true)
 const no=verifyOutboundVideoLinks('https://www.bilibili.com/video/'+BV,{readRecords:[]})
 assert.equal(no.ok,false)
})
test('dev20 生产连线、版本与人格契约在同一份源码',()=>{
 const r=new URL('../',import.meta.url)
 const index=readFileSync(new URL('index.js',r),'utf8'),voice=readFileSync(new URL('lib/life-voice-context.mjs',r),'utf8')
 assert.match(index,/getRecentActivity:\(/)
 assert.match(voice,/Life 协调全局生活/)
 assert.match(readFileSync(new URL('package.json',r),'utf8'),/"version": "2\.8\.0(?:-dev\.\d+)?"/)
})
