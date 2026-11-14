import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const T=Date.parse('2026-11-07T16:12:43Z'),BV='BV1aBcD2eF3G'
const receipt=(kind,at=T,evidence='platform-transaction-receipt')=>({at,mode:'active',action:'verified_write',result:'verified-action',verifiedActionKind:kind,verifiedEvidence:evidence})
const comment=(at=T,kind='reply')=>({time:new Date(at).toISOString(),bvid:BV,rpid:'323218031856',kind,snippet:'嫌完还是乖乖待在屏幕上',recipientName:'大肥鱼念念'})
const forbidden=/(平台发送事务|独立平台只读回查|原发送事务|已核验|回执|执行前|账本|内部反思已结算|视频 Agent|退出码)/

test('评论正文可见时，不再为同一条回复另造平台事务卡片',()=>{
 const rows=buildLifeTimeline({now:T+5000,days:1,lifeDecisions:[receipt('comment_reply')],comments:[comment()]})
 assert.equal(rows.length,1)
 assert.equal(rows[0].type,'comment')
 assert.equal(rows[0].label,'回复评论')
 assert.match(rows[0].title,/嫌完还是乖乖/)
 assert.doesNotMatch(JSON.stringify(rows),forbidden)
})

test('视频原创主评论同样合并；错误种类、不同日不合并',()=>{
 const rows=buildLifeTimeline({now:T+86400_000,days:2,lifeDecisions:[receipt('video_comment',T)],comments:[comment(T+1000,'top')]})
 assert.equal(rows.filter(x=>x.type==='comment').length,1)
 assert.equal(rows.filter(x=>x.type==='life-write').length,0)
 const later=buildLifeTimeline({now:T+86400_000,days:2,lifeDecisions:[receipt('video_comment',T)],comments:[comment(T+4*60_000,'top')]})
 assert.equal(later.filter(x=>x.type==='life-write').length,1)
 const wrongKind=buildLifeTimeline({now:T+5000,days:1,lifeDecisions:[receipt('video_comment')],comments:[comment(T,'reply')]})
 assert.equal(wrongKind.filter(x=>x.type==='life-write').length,1)
})

test('评论明细缺席时只展示简短真实互动，不泄露内部回执信息',()=>{
 const rows=buildLifeTimeline({now:T+2000,lifeDecisions:[receipt('comment_reply'),receipt('dm_reply',T+1000),receipt('dynamic_post',T+1500)]})
 assert.equal(rows.length,3)
 assert.ok(rows.some(x=>x.title==='回复了别人的评论'))
 assert.ok(rows.some(x=>x.title==='回复了一条私信'))
 assert.ok(rows.some(x=>x.title==='发布了一条动态'))
 assert.doesNotMatch(JSON.stringify(rows),forbidden)
})

test('只读、反思、视频探索、心情仅展示生活行为，不显示审计与操作术语',()=>{
 const rows=buildLifeTimeline({now:T+2000,days:1,lifeDecisions:[
  {at:T,mode:'active',action:'inspect_opportunity',verifiedReadKind:'video-metadata',result:'verified-metadata'},
  {at:T+100,mode:'active',action:'reflect',result:'completed'}],
  videoRounds:[{ref:'a'.repeat(12),source:'life-agent',state:'completed',pickedCount:2,endedAt:T+200}],
  emotionHistory:[{at:T+300,mood:'joyful',label:'开心'}]})
 assert.equal(rows.length,4)
 assert.ok(rows.some(x=>x.title==='这一轮挑中了 2 条视频'))
 assert.ok(rows.some(x=>x.title==='梳理了一次自己的想法'))
 assert.doesNotMatch(JSON.stringify(rows),forbidden)
})

test('未证实行动、模型意愿、仅平台受理仍然不能出现在生活时间线',()=>{
 const rows=buildLifeTimeline({now:T+3000,lifeDecisions:[
  {...receipt('comment_reply'),result:'accepted-unverified'},
  {...receipt('comment_reply'),failed:true},
  {...receipt('video_like'),mode:'shadow'},
  {...receipt('write_dynamic'),result:'verified-action'}]})
 assert.equal(rows.length,0)
})

test('管理页使用生活摘要，技术回执仍留在原始诊断与事务账本',()=>{
 const source=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const timeline=readFileSync(new URL('../lib/life-timeline.mjs',import.meta.url),'utf8')
 const ledger=readFileSync(new URL('../lib/life-agent-events.mjs',import.meta.url),'utf8')
 assert.match(source,/最近 \${days} 天：挑选视频/)
 assert.doesNotMatch(source,/已核验生活互动/)
 assert.match(ledger,/verifiedEvidence/) // original diagnostic evidence remains in the persistent ledger
 assert.match(timeline,/alreadyShownAsComment/)
})
