import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildCommentMemePrompt} from '../lib/comment-meme-prompt.mjs'
const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('选图提示词要求先本地语义检索，再判定没有匹配，而不把45张当全部图库',()=>{
  const text=buildCommentMemePrompt({dailyLimit:6,roundLimit:2,inventory:'• 奶蛙/普通'})
  assert.match(text,/bili_comment_meme_search\(query=/)
  assert.match(text,/简表没合适图必须先用 bili_comment_meme_search/)
  assert.match(text,/战斗机/)
  assert.match(text,/白饭/)
  assert.match(text,/大笑/)
  assert.match(text,/不能声称已亲眼看到画面/)
  assert.match(text,/每日|今日最多尝试/)
})

test('新版只追加一个只读MCP工具，不越过图片发送授权和额度硬闸',()=>{
  const index=read('index.js')
  const mcp=read('vendor/bilibili-mcp/mcp_server.py')
  const py=read('vendor/bilibili-mcp/comment_meme_search.py')
  assert.match(index,/cfg\.commentMemesEnabled && cfg\.autoComment\) list\.push\('bili_comment_meme_list','bili_comment_meme_search'\)/)
  assert.match(mcp,/async def bili_comment_meme_search\(query:/)
  assert.match(mcp,/if \(deny := _guard\('bili_comment_meme_search'\)\)/)
  assert.match(py,/def search_library\(/)
  assert.doesNotMatch(py,/urllib|subprocess|requests/)
  assert.match(mcp,/reserve_attempt\(/)
})

test('未选图诊断展示本地候选而不是冒称AI已核验图片内容',()=>{
  const ui=read('lib/management-console.js')
  const mcp=read('vendor/bilibili-mcp/mcp_server.py')
  assert.match(ui,/本地名称检索可参考/)
  assert.match(ui,/仅匹配文件名；不是已识图或确认适配/)
  assert.match(mcp,/'local_candidates': suggestions/)
})
