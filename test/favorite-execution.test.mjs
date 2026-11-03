import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const root=new URL('../',import.meta.url)
const js=readFileSync(new URL('index.js',root),'utf8')
const py=readFileSync(new URL('vendor/bilibili-mcp/mcp_server.py',root),'utf8')
const ui=readFileSync(new URL('client.js',root),'utf8')
test('自动收藏不再逐条批量执行；旧接口安全拒绝',()=>{
  assert.doesNotMatch(js,/favToday\('auto'\)/)
  assert.match(js,/整轮批量收藏已经取消/)
  assert.doesNotMatch(ui,/补收藏今天的/)
})
test('仅注册启用的自主点赞和收藏工具',()=>{
  assert.match(js,/if \(cfg\.autoVideoLike\) list\.push\('bili_video_like'\)/)
  assert.match(js,/if \(cfg\.autoVideoCollect\) list\.push\('bili_video_collect'\)/)
  assert.match(py,/_selected_for_reaction/)
  assert.match(py,/create_video_favorite_list/)
  assert.match(py,/private=_favorite_new_private\(visibility\) if automatic else True/)
})
