import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('homepage recommendations are independent opt-in source and enabled by default',()=>{
 const server=src('index.js')
 assert.match(server,/homeRecommendationsEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(server,/homeRecommendationsEnabled: true, keywords:/)
 assert.match(server,/if \(sourceMode==='home' && cfg\.homeRecommendationsEnabled\) list\.push\('bili_home_recommendations'\)/)
 assert.match(server,/name: 'bili_home_recommendations'/)
})
test('首页漫游和兴趣关键词探索有互斥来源，Life 仍可选择不看或休息',()=>{
 const code=src('index.js')
 assert.match(code,/sourceMode==='home'\?\[\]:\['bili_search'\]/)
 assert.match(code,/sourceMode==='home' && cfg\.homeRecommendationsEnabled/)
 assert.match(code,/首页候选不足可以直接结束，不转关键词搜索/)
 assert.match(code,/关键词搜索无合适结果可以直接结束，不自动切换首页/)
 assert.match(code,/兴趣\/生活线索探索/)
})
test('Python server limits recommendation list to one round call; nothing is published',()=>{
 const server=src('vendor/bilibili-mcp/mcp_server.py')
 const helper=src('vendor/bilibili-mcp/home_recommendations.py')
 assert.match(server,/_HOME_RECOMMEND_REQUESTED = True/)
 assert.match(server,/get_home_recommendations/)
 assert.match(helper,/max_count=12/)
 assert.match(helper,/class _NoRedirect/)
 assert.match(helper,/goto'/)
})
test('settings UI contains homepage recommendations toggle in selection section',()=>{
 const ui=src('lib/management-console.html'),controller=src('lib/management-console.js')
 assert.match(ui,/bili-home-recommend/)
 assert.match(controller,/homeRecommendationsEnabled/)
 assert.match(ui,/兴趣档案主导搜索/)
})
test('AI vision and mention history guardrails still present',()=>{
 const ui=src('lib/management-console.js'),server=src('vendor/bilibili-mcp/mcp_server.py')
 assert.match(ui,/mention-diagnostics/)
 assert.match(ui,/slice\(0,12\)/)
 assert.doesNotMatch(server,/_VISION_PER_RUN_LIMIT\s*=/)
})
