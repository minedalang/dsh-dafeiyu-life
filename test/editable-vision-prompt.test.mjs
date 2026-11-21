import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DEFAULT_VISION_PROMPT,MAX_VISION_PROMPT_CHARS,normalizeVisionPrompt,validateVisionPromptUpdate,visionObservationFocus} from '../lib/vision-prompt.mjs'
const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const isolated=readFileSync(new URL('../lib/vision_dsh.py',import.meta.url),'utf8')

test('默认观察重点仅描述已送达画面，不参与 Life 是否观看的决策',()=>{
 assert.match(DEFAULT_VISION_PROMPT,/自适应分镜/)
 assert.match(DEFAULT_VISION_PROMPT,/真实|实际/)
 assert.doesNotMatch(DEFAULT_VISION_PROMPT,/判断是否值得识图|优先选择.*视频|自主决定是否/)
 const legacy='判断是否值得识图时，综合视频标题、字幕、弹幕、评论、播放与互动信息，优先选择真的靠画面表达笑点、出现陌生视觉梗或文字难以解释的角色/动作的视频。\n着重描述画面人物眼神。'
 assert.equal(visionObservationFocus(legacy),'着重描述画面人物眼神。')
 assert.equal(visionObservationFocus('保持原有观察重点'), '保持原有观察重点')
 assert.equal(normalizeVisionPrompt('A\r\nB\0'),'A\nB')
 assert.equal(normalizeVisionPrompt('x'.repeat(20000)).length,MAX_VISION_PROMPT_CHARS)
 assert.equal(validateVisionPromptUpdate(' A\r\nB '),'A\nB')
 assert.equal(validateVisionPromptUpdate('鱼'.repeat(4000)).length,4000)
 assert.throws(()=>validateVisionPromptUpdate('鱼'.repeat(4001)),/不能超过4000字符/)
 assert.throws(()=>validateVisionPromptUpdate('🙂'.repeat(2001)),/不能超过4000字符/)
 assert.throws(()=>validateVisionPromptUpdate({text:'invalid'}),/必须是文本/)
})

test('配置端到端：schema、校验、API、UI、日志脱敏和本轮 prompt',()=>{
  assert.match(js,/visionPrompt: z\.string\(\)/)
  assert.match(js,/visionPrompt: ''/)
  assert.match(js,/p\.visionPrompt=storedRead\?normalizeVisionPrompt\(p\.visionPrompt\):validateVisionPromptUpdate/)
  assert.match(js,/vision-prompt-default/)
  assert.doesNotMatch(js,/buildVisionPrompt\(cfg\.visionPrompt\)/)
  assert.match(js,/visionObservationFocus\(cfg\.visionPrompt\)/)
  assert.match(js,/if \('visionPrompt' in args\.patch\) return \{ok:false, blocked:true/)
  assert.match(js,/visionPrompt: '\[识图提示词已更新\]'/)
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const manager=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/视觉观察重点/)
  assert.match(html,/不负责决定选哪个视频、是否取帧或观看深度/)
  assert.match(html,/保存识图提示词/)
  assert.match(html,/vision-prompt-reset/)
  assert.match(manager,/visionPrompt/)
})

test('独立 DSH 识图模型收到用户观察重点，提示词更改会使缓存失效',()=>{
  assert.match(js,/BILI_VISION_PROMPT_B64/)
  assert.match(js,/Buffer\.from\(visionObservationFocus\(cfg\.visionPrompt\)/)
  assert.match(isolated,/BILI_VISION_PROMPT_B64/)
  assert.match(isolated,/prompt_hash=hashlib\.sha256/)
  assert.match(isolated,/d\.get\('prompt_hash'\)==prompt_hash/)
  assert.match(isolated,/'prompt_hash':prompt_hash/)
  assert.match(isolated,/VISION_FAILED/)
  assert.match(isolated,/BILI_VISION_PROOF_FILE/)
})
