import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {recoverableCommentCandidates,explainCommentSelection} from '../lib/video-owned-ledger.mjs'
const now=Date.now(),BV='BV1abcde1234',ROUND='a'.repeat(24)
const item=(extra={})=>({bvid:BV,picked:true,roundId:'b'.repeat(24),selectedAt:now-40_000,reviewState:'pending',delivered:false,commented:false,...extra})
test('仅账号原账本近24小时未结算记录可恢复；旧版状态未知不复活',()=>{
 const candidates=[item(),item({bvid:'BV1zzzzy1234',reviewState:'approved'}),item({bvid:'BV1xxxxx1234',reviewState:'passed'}),item({bvid:'BV1mmmm1234',selectedAt:now-86_400_100}),item({bvid:'BV1yyyy1234',commented:true})]
 assert.deepEqual(recoverableCommentCandidates({ok:true,rows:candidates},{now}).map(x=>x.bvid),[BV])
 assert.deepEqual(recoverableCommentCandidates({ok:false,rows:candidates},{now}),[])
 assert.deepEqual(recoverableCommentCandidates({ok:true,rows:[item({reviewState:''})]},{now}),[])
})
test('跨轮只能重新申请 Life 意愿；当前轮原入选、未知发送和错误轮次均保持门禁',()=>{
 assert.deepEqual(explainCommentSelection({ok:true,rows:[item()]},BV,ROUND,{previouslyPicked:true}),{ok:true,recovered:true})
 assert.equal(explainCommentSelection({ok:true,rows:[item({reviewState:'approved'})]},BV,ROUND,{previouslyPicked:true}).ok,false)
 assert.equal(explainCommentSelection({ok:true,rows:[item({delivered:true})]},BV,ROUND,{previouslyPicked:true}).ok,false)
 assert.equal(explainCommentSelection({ok:false,rows:[item()]},BV,ROUND,{previouslyPicked:true}).ok,false)
 assert.equal(explainCommentSelection({ok:true,rows:[item()]},BV,'BAD',{previouslyPicked:true}).ok,false)
})
test('UI 是同源聚合而非旧三区硬搬；行动树由真实决策与回执驱动',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/id="life-plan-hub-grid"/)
 assert.match(html,/data-life-plan-filter="cue"/)
 assert.match(html,/id="life-plan-admin"/)
 assert.match(js,/lastOwnerTodos\?\.allItems/)
 assert.match(js,/lifePlansSource\?\.opportunities/)
 assert.match(js,/lifePlansSource\?\.intentions/)
 assert.match(js,/request\('\/life-agent\/decision-traces'\)/)
 assert.doesNotMatch(js,/innerHTML\s*=\s*[^'"\n]*lifePlan/)
})
