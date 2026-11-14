import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_COMMENT_MEME_PROMPT, MAX_COMMENT_MEME_PROMPT_CHARS, normalizeCommentMemePrompt, buildCommentMemePrompt } from '../lib/comment-meme-prompt.mjs'

const server = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('旧用户没有自定义时使用内置选图规则', () => {
  const out=buildCommentMemePrompt({dailyLimit:100,roundLimit:3})
  assert.ok(out.includes(DEFAULT_COMMENT_MEME_PROMPT))
  assert.ok(out.includes('今日最多尝试 100 次'))
  assert.ok(out.includes('每轮最多 3 次'))
})

test('自定义提示词真实进入本轮 Agent 提示词，内置风格不再覆盖', () => {
  const out=buildCommentMemePrompt({customPrompt:'选图时优先判断荒诞反转，不适配则不附图。',dailyLimit:3,roundLimit:1})
  assert.ok(out.includes('优先判断荒诞反转'))
  assert.ok(!out.includes('① 先读视频真实字幕'))
  assert.ok(out.includes('实际次数由程序硬限制'))
  assert.ok(out.includes('不能声称已亲眼看到画面'))
  assert.match(server,/buildCommentMemePrompt/)
 assert.match(server,/commentMemePrompt: z\.string\(\)/)
 assert.match(server,/BILI_COMMENT_MEMES_ENABLED/)
})

test('超长和异常控制字符被限制',()=>{
  assert.equal(normalizeCommentMemePrompt('A\r\nB\0'), 'A\nB')
  assert.equal(normalizeCommentMemePrompt('x'.repeat(12000)).length,MAX_COMMENT_MEME_PROMPT_CHARS)
  assert.equal(normalizeCommentMemePrompt(null),'')
})

test('配置读取、保存、恢复默认接口和页面均接入',()=>{
  assert.match(server,/commentMemePrompt: z\.string\(\)/)
  assert.match(server,/commentMemePrompt: ''/)
  assert.match(server,/p\.commentMemePrompt=normalizeCommentMemePrompt/)
  assert.match(server,/comment-meme-prompt-default/)
  assert.match(server,/'commentMemePrompt','visionPrompt','memeMemoryEnabled'/)
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const manager=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/AI 选图提示词/)
  assert.match(html,/保存选图提示词/)
  assert.match(html,/meme-prompt-reset/)
  assert.match(manager,/commentMemePrompt/)
  assert.match(html,/maxlength="4000"/)
})

test('AI 不可修改用户提示词，且日志不打印编辑正文',()=>{
  assert.match(server,/if \('commentMemePrompt' in args\.patch\) return \{ok:false, blocked:true/)
  assert.match(server,/commentMemePrompt: '\[选图提示词已更新\]'/)
})
