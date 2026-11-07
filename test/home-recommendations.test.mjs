import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('homepage recommendations are independent opt-in source and enabled by default',()=>{
 const server=src('index.js')
 assert.match(server,/homeRecommendationsEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(server,/homeRecommendationsEnabled: true, keywords:/)
 assert.match(server,/if \(cfg\.homeRecommendationsEnabled\) list\.push\('bili_home_recommendations'\)/)
 assert.match(server,/name: 'bili_home_recommendations'/)
})
test('Agent freely chooses recommendation/search sources within shared quotas',()=>{
 const code=src('index.js')
 for (const txt of ['不强制同时使用全部来源','不强制按来源配比','不设每日或每轮选片数量','不设选片数量目标','自行选择搜索词','自主决定是否查视频详情']) {
  assert.ok(code.includes(txt),txt)
 }
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
 assert.match(server,/_VISION_PER_RUN_LIMIT = 2/)
})
