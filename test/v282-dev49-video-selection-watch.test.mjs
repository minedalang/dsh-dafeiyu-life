import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {summarizeVideoFunnel} from '../lib/video-round-funnel.mjs'
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const BV='BV1234567890'

test('one metadata-plus-description decision, no separate model detail decision',()=>{
  const source=read('index.js')
  assert.match(source,/一次选片决策，逐步接触信息/)
  assert.match(source,/标题、UP、播放量\/点赞量\/评论量、时长、简介和详情热度/)
  assert.match(source,/选片前不获取字幕、ASR 或画面内容/)
  assert.match(source,/BILI_DUTY_VIDEO_PICK_FLOW: ' \+ yq\('1'\)/)
  assert.match(source,/list = \[\.\.\.\(sourceMode==='home'\?\[\]:\['bili_search'\]\), 'bili_watch_video'/)
})
test('only unified watch is model visible for headless agent; raw tools stay internal',()=>{
  const source=read('index.js'), py=read('vendor/bilibili-mcp/mcp_server.py')
  assert.match(source,/mcpWhitelist\(sourceMode\)\.filter\(name=>!\['bili_subtitle','bili_transcribe_safe','bili_preview_vision'\]/)
  assert.match(py,/_VIDEO_PICK_INTERNAL_TOOLS = frozenset/)
  assert.match(py,/fn\.__name__ in _VIDEO_PICK_INTERNAL_TOOLS/)
  assert.match(py,/fn\.__name__ in _VIDEO_PICK_POST_SELECTION_READS/)
  assert.match(py,/not _selected_in_current_video_round/)
  assert.match(py,/async def bili_watch_video\(bvid: str, view_depth: str = 'standard'\)/)
  assert.match(py,/await asyncio\.gather\(read_speech\(\), read_visual\(\)\)/)
  assert.doesNotMatch(source,/\+ `👀[^`]*先读 bili_subtitle/)
})
test('one bundled tool receipt projects actual visual, subtitle and failures without claiming watching',()=>{
  const items=[
    {tool:'bili_video_info',ok:true,bvid:BV,stat:{view:10000,like:100,reply:30}},
    {tool:'bili_ledger_mark',ok:true,bvid:BV,status:'picked',recorded:true},
    {tool:'bili_watch_video',ok:true,bvid:BV,speech:true,subtitle:true,visualAttempted:true,visual:false},
    {tool:'bili_watch_video',ok:true,bvid:'BVaaaaaaaaaa',speech:false,subtitle:false,visualAttempted:true,visual:true},
    {tool:'bili_watch_video',ok:false,bvid:'BVbbbbbbbbbb',speech:false,visualAttempted:true,visual:false}
  ]
  const f=summarizeVideoFunnel(items,{views:1000,likes:10,replies:3})
  assert.equal(f.selected,1)
  assert.equal(f.contentRead,1)
  assert.equal(f.subtitleRead,1)
  assert.equal(f.visualAttempted,3)
  assert.equal(f.visualVerified,1)
  assert.equal(f.toolErrors,1)
  assert.equal(f.rows.find(x=>x.bvid==='BVbbbbbbbbbb').visualVerified,false)
})

test('video agent charter cannot pre-load subtitles, ASR, comments or raw vision before pick',()=>{
  const charter=read('prompts/duty.md')
  assert.match(charter,/挑视频仍是一轮模型决策/)
  assert.match(charter,/入选前不要索取字幕、ASR、画面或评论正文/)
  assert.match(charter,/统一调用 `bili_watch_video/)
  assert.doesNotMatch(charter,/入选前[^\n]*至少读取到足够的字幕/)
})

test('README current release features natural video watching, not a separate selection step',()=>{
  const readme=read('README.md'),changelog=read('CHANGELOG.md'),packageInfo=JSON.parse(read('package.json'))
  assert.match(packageInfo.version,/^2\.8\.(?:2|3)(?:-dev\.[1-9]\d*)?$/)
  assert.match(read('docs/近期版本新功能.md'),/## 🆕 2\.8\.2 视频感知体验优化[\s\S]*优化鱼鱼看视频的行为/)
  assert.match(readme,/挑视频仍是一轮自主判断/)
  assert.match(changelog,/2\.8\.2-dev\.49 · 优化鱼鱼看视频的行为/)
})
