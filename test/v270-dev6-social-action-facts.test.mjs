import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeFactsFromCreatorSnapshot,lifeFactFromReceipt,currentLifeFactView} from '../lib/verified-life-facts.mjs'

const BV='BV1pXHK6mE6z',day='2026-11-02'
const snap={ok:true,accountUid:'123',creatorUid:777,bvid:BV,selectedToday:true,followCurrent:'not-following',
 followHistory:{recordedByPlugin:true,lastConfirmedAction:'unfollow',followedAt:'2026-10-01T12:00:00Z',unfollowedAt:'2026-11-01T12:00:00Z'},
 videoActionHistory:{collect:'confirmed-once'},videoActionDates:{collect:day}}

test('dev.6 已确认的关注、取关、收藏作为历史事实；当前状态不被历史覆盖',()=>{
 const r=lifeFactsFromCreatorSnapshot(snap,{accountUid:'123',channel:'main'})
 assert.deepEqual(r.facts.map(x=>x.type),['creator_follow_verified','creator_unfollow_verified','video_collected_verified'])
 assert.equal(r.current.follow,'not-following')
 assert.equal(r.current.collect,'not-verified')
 assert.ok(r.facts.every(x=>x.uid==='123'&&x.scope==='owner-private'&&x.targetUid==='777'))
 assert.equal(currentLifeFactView(r.facts,{uid:'999',channel:'main'}).length,0)
 assert.ok(currentLifeFactView(r.facts,{uid:'123',channel:'main',at:Date.parse('2026-11-03T00:00:00Z'),maxAgeMs:40*86400000}).length>=1)
})

test('dev.6 只有实时关系状态不构成「我关注过」的历史回执',()=>{
 const r=lifeFactsFromCreatorSnapshot({...snap,followCurrent:'following',followHistory:{recordedByPlugin:false}}, {accountUid:'123'})
 assert.deepEqual(r.facts.map(x=>x.type),['video_collected_verified'])
 assert.equal(r.current.follow,'following')
})

test('dev.6 无效账户、UID/BV、缺少回执或未来时间不能伪造事实',()=>{
 for(const uid of ['','0','123abc'])assert.equal(lifeFactsFromCreatorSnapshot(snap,{accountUid:uid}).facts.length,0)
 for(const value of [{...snap,creatorUid:0},{...snap,bvid:'wrong'},{...snap,ok:false},{...snap,accountUid:'999'}])
  assert.equal(lifeFactsFromCreatorSnapshot(value,{accountUid:'123'}).facts.length,0)
 const wrong={...snap,followHistory:{recordedByPlugin:true,lastConfirmedAction:'follow',followedAt:'2500-01-01T00:00:00Z'},videoActionDates:{collect:'x'}}
 assert.equal(lifeFactsFromCreatorSnapshot(wrong,{accountUid:'123'}).facts.length,0)
 assert.equal(lifeFactFromReceipt({type:'creator_follow_verified',operation:'platform-creator-follow-receipt',ok:true,uid:'123',scope:'owner-private',sourceId:'x',targetUid:'abc'}),null)
})

test('dev.6 主 Session 只读工具直接连接事实契约，视频 Agent 仅启用后出现相遇/关注工具',()=>{
 const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(js,/name:'bili_creator_relation_status'/)
 assert.match(readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8'),/if not _selected_for_creator_encounter\(bv\):raise ValueError\('只能关注今日鱼鱼明确入选/)
 assert.match(js,/lifeFactsFromCreatorSnapshot\(row,\{accountUid:accountBinding\.accountUid\(\),channel:'main'\}\)/)
 assert.match(js,/if \(cfg\.agentFollowEnabled\) list\.push\('bili_user_info','bili_creator_encounter'/)
 assert.match(js,/explicitSelection=new Set\(\['挑中'/)
 assert.match(ui,/今天判重表记录/)
 assert.match(ui,/B站已核验私信／评论互动/)
 assert.match(html,/不是人格倾向或结识新朋友的意愿强度/)
})
