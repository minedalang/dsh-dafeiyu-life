import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {videoCommentReadiness} from '../lib/video-comment-readiness.mjs'

const BV='BV1aBcD2eF3G'
const at=s=>Date.parse('2026-11-07T'+s+'Z')

test('生活时间线把同一天的全部类型按真实毫秒时间倒序，而不是分组显示',()=>{
 const rows=buildLifeTimeline({now:at('23:50:00'),days:3,
  videoRounds:[
   {source:'life-agent',ref:'aaaa1234bbbb',state:'completed',pickedCount:3,endedAt:at('14:44:54')},
   {source:'life-agent',ref:'bbbb1234cccc',state:'completed',pickedCount:2,endedAt:at('10:50:22')}],
  lifeDecisions:[
   {at:at('15:33:24'),mode:'active',action:'inspect_opportunity',result:'verified-metadata',verifiedReadKind:'video-metadata'},
   {at:at('15:43:31'),mode:'active',action:'reflect',result:'completed'}],
  comments:[{time:'2026-11-07T15:38:50Z',bvid:BV,rpid:'12345678',kind:'reply',snippet:'只回复别人'}],
  emotionHistory:[{at:at('15:38:49'),mood:'warm',label:'温暖'}],
  watched:[{day:'2026-11-07',bvid:BV,title:'只有日期的记录',picked:true}]
 })
 assert.deepEqual(rows.map(x=>x.type),[
  'life-reflection','comment','emotion','life-read','video-round','video-round','video'])
 assert.equal(rows.at(-1).dateOnly,true)
 const precise=rows.filter(x=>!x.dateOnly).map(x=>Date.parse(x.at))
 assert.deepEqual(precise,[...precise].sort((a,b)=>b-a))
 assert.equal(rows.find(x=>x.type==='comment').label,'回复评论')
})


test('首页来源入选数在生活时间线中与总入选数分开表达',()=>{
 const rows=buildLifeTimeline({now:at('23:50:00'),days:2,videoRounds:[{
   source:'life-agent',ref:'cccc1234dddd',state:'completed',entryMode:'home',homeRead:'candidates',
   homeCandidates:12,homePickedCount:2,pickedCount:4,endedAt:at('18:00:00')
 }]})
 assert.equal(rows.length,1)
 assert.equal(rows[0].title,'这一轮挑中了 4 条视频，其中首页推荐 2 条')
})

test('当时间线同一天混合数字与字符串时间输入仍排序，确定性处理同秒数据',()=>{
 const now=at('20:00:00'),t=at('12:00:00')
 const result=buildLifeTimeline({now,days:2,
  lifeDecisions:[{at:t+1000,mode:'active',action:'reflect',result:'completed'},
   {at:t,mode:'active',action:'execute_read',result:'done',verifiedReadKind:'todo-read'}],
  comments:[{time:new Date(t+5000).toISOString(),bvid:BV,kind:'top',rpid:'987654321',snippet:'自己发的原创主评论'}]})
 assert.deepEqual(result.map(x=>x.type),['comment','life-reflection','life-read'])
 assert.equal(result.find(x=>x.type==='comment').label,'发了评论')
})

test('主动视频评论准入独立于退役报告模式，只看授权、单轮额度和日额度',()=>{
 const good={masterEnabled:true,autoComment:true,commentPerRound:5,commentDailyLimit:1000}
 assert.equal(videoCommentReadiness(good).enabled,true)
 assert.equal(videoCommentReadiness({...good,dmMode:'only'}).enabled,true,'legacy mode must no longer block comments')
 assert.match(videoCommentReadiness({...good,autoComment:false}).blockers.join(' '),/原创评论权限关闭/)
 assert.match(videoCommentReadiness({...good,commentPerRound:0}).blockers.join(' '),/每轮原创评论额度为 0/)
 assert.match(videoCommentReadiness({...good,commentDailyLimit:0}).blockers.join(' '),/每日总额度为 0/)
 assert.equal(videoCommentReadiness({...good,masterEnabled:false}).enabled,false)
 assert.equal(videoCommentReadiness(good).note.includes('不代表历史轮次'),true)
})

test('控制台公开区分顶层评论与回复，旧报告投递选项已退役',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(index,/const commentReadiness=\{\.\.\.videoCommentReadiness\(cfg\)/)
 assert.match(index,/observedTop:todayVisible\.filter\(row=>row\.kind==='top'\)/)
 assert.match(index,/observedReplies:todayVisible\.filter\(row=>row\.kind==='reply'\)/)
 assert.match(index,/\['video','video-round','life-read','life-write','life-reflection','comment'/)
 assert.doesNotMatch(index,/dmModeEff = dmDegraded \? 'off' : cfg.dmMode/)
 assert.doesNotMatch(index,/const dmModeEff = cfg.dmMode/)
 assert.match(html,/id="life-timeline-comment-status"/)
 assert.match(html,/id="bili-proactive-comment-status"/)
 assert.match(js,/原创顶层评论/)
 assert.match(js,/视频 Agent 可以自主考虑原创评论|可自主考虑原创评论/)
 assert.doesNotMatch(html,/id="bili-dm-mode"|id="bili-dm-uid"/)
})
