import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const web=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const manager=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
test('梗库记忆默认启用并且通过严格 MCP 白名单',()=>{
  assert.match(js,/memeMemoryEnabled: z\.boolean\(\)\.default\(true\)/)
  assert.match(js,/if \(cfg\.memeMemoryEnabled\) list\.push\('bili_meme_search','bili_meme_observe'\)/)
  assert.match(js,/BILI_MEME_MEMORY/)
  assert.match(py,/async def bili_meme_search\(/)
  assert.match(py,/async def bili_meme_observe\(/)
  assert.match(py,/_guard\('bili_meme_observe'\)/)
})
test('记忆查询和写入都带来源且和外部指令隔离',()=>{
  assert.match(js,/bili_meme_search\(query=/)
  assert.match(js,/bili_meme_observe\(name,bvid,evidence,evidence_type\)/)
  assert.match(charter,/没有真实视觉证据时不能描述画面/)
  assert.match(py,/visual_status.*未识图/)
  assert.ok(!py.includes('eval('))
})
test('管理中心负责梗记忆审核编辑；原设置页只保留启用与容量',()=>{
  assert.match(js,/\/api\/bili-duty\/meme-memory/)
  assert.match(js,/meme-memory-admin\.py/)
  assert.match(web,/梗知识库 · 长期记忆/)
  assert.match(readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),/梗知识保存上限/)
  assert.match(manager,/meme-memory\/delete/)
  assert.match(manager,/meme-memory\/review/)
})

// Storage capacity is distinct from the 30-row UI page size.
test('知识库保存上限独立配置并下发 Python，UI 的 30 仅为查询返回数',()=>{
  assert.match(js,/memeMemoryMaxEntries: z\.natural\(\)\.default\(300\)/)
  assert.match(js,/BILI_MEME_MAX_ENTRIES/)
  assert.match(js,/if \('memeMemoryMaxEntries' in p\)/)
  assert.match(readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),/梗知识保存上限/)
  assert.match(manager,/memeMemoryMaxEntries/)
  assert.match(py,/_meme_capacity\(/)
  assert.match(py,/BEGIN IMMEDIATE/)
  assert.match(py,/capacity_reached/)
})
