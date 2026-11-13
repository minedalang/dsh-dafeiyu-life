import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const root=new URL('../',import.meta.url)
const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
const index=readFileSync(new URL('index.js',root),'utf8')

test('AI 模型页将视频模型与 Life 互动模型真实职责准确呈现',()=>{
  assert.match(html,/视频模型（视频 Agent）/)
  assert.match(html,/互动模型（Life 自主决策与社交）/)
  assert.match(html,/Life 是否开启视频探索、是否委派视频 Agent，由下方「互动模型」负责决定/)
  assert.match(html,/Life 的核心决策模型/)
  assert.match(html,/id="models-video"/)
  assert.match(html,/id="models-interaction"/)
  assert.doesNotMatch(html,/<summary><strong>后台评论与私信模型/)
})

test('界面改名不更改底层 interaction 和 video 模型路由',()=>{
  assert.match(index,/modelRoute = 'interaction'/)
  assert.match(index,/cfg\.interactionModelProvider\|\|cfg\.pluginDefaultModelProvider/)
  assert.match(index,/cfg\.videoModelProvider\|\|cfg\.pluginDefaultModelProvider/)
  assert.match(index,/invokeModel:\(prompt,maxChars\)=>invokeInteractionPrompt\(prompt,maxChars\)/)
})
