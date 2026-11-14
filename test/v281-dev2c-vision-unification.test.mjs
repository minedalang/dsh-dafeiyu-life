import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createDshVisionReview} from '../lib/dsh-vision-review.mjs'
import {HEADLESS_DENY_TOOLS,validateHeadlessOverlayText} from '../lib/headless-security.mjs'
const src=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8')
const route={provider:'dsh-provider',model:'vision-model-1'}
const disabled=HEADLESS_DENY_TOOLS.map(k=>`- id: ${k}\n  disabled: true\n`).join('')
const available=['credentials','authorization','deepseek-account'].map(k=>`- id: ${k}\n  disabled: false\n`).join('')
const overlay=(tool,selftest)=>`${disabled}${available}- insert:\n    - id: mcp-bili-vision-readonly\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: bilivision\n        transport: stdio\n        env:\n          BILI_MCP_TOOLS: '${tool}'\n          ${selftest?'BILI_VISION_SELFTEST_ALLOWED: \'1\'':'BILI_VISION_CHILD: \'1\''}\n          ${selftest?"BILI_VISION_TEST_ASSET: '/opt/app/local-vision-selftest-dafeiyu.png'":''}\n`
test('前端只有两种识图方式，旧 Endpoint 的编辑项已删除',()=>{
  const html=src('lib/management-console.html'),js=src('lib/management-console.js'),client=src('client.js')
  const select=/<select id="models-vision-mode">([\s\S]*?)<\/select>/.exec(html)?.[1]
  assert.ok(select)
  assert.deepEqual([...select.matchAll(/<option value="([^"]+)"/g)].map(m=>m[1]),['independent_dsh','independent_local'])
  assert.doesNotMatch(js,/旧版 Endpoint|visionEndpoint/)
  assert.doesNotMatch(client,/reuse_video_model.*option/)
  for(const id of ['dsh-vision-probe-image','dsh-vision-probe-answer','dsh-vision-approve','dsh-vision-reject','dsh-vision-verify'])assert.ok(html.includes(`id="${id}"`),id)
})
test('生产模型配置移除旧视觉 Endpoint、legacy 模式安全退役',()=>{
  const js=src('index.js')
  assert.doesNotMatch(js,/visionEndpoint|BILI_VISION_ENDPOINT/)
  assert.match(js,/visionMode: z\.string\(\)\.default\('independent_dsh'\)/)
  assert.match(js,/cfg\.visionEnabled=false \/\/ never convert a legacy/)
  assert.match(js,/const dshVisionReview=createDshVisionReview/)
  assert.match(js,/\/api\/bili-duty\/dsh-vision\/verify/)
  assert.match(js,/\/api\/bili-duty\/dsh-vision\/review/)
})
test('DSH 视觉隔离配置区分正式视频观察和唯一固定测试图',()=>{
  assert.equal(validateHeadlessOverlayText(overlay('bili_preview_vision',false),'vision').ok,true)
  assert.equal(validateHeadlessOverlayText(overlay('bili_vision_selftest',true),'vision-selftest').ok,true)
  assert.throws(()=>validateHeadlessOverlayText(overlay('bili_preview_vision',false),'vision-selftest'),/工具白名单/)
  assert.throws(()=>validateHeadlessOverlayText(overlay('bili_vision_selftest',true),'vision'),/工具白名单/)
  assert.throws(()=>validateHeadlessOverlayText(overlay('bili_vision_selftest',true).replace('local-vision-selftest-dafeiyu.png','other.png'),'vision-selftest'),/图片路径/)
})
test('DSH 识图必须真实返回回复，等待本人判断，不能自动认可',async()=>{
  const manager=createDshVisionReview({getRoute:()=>({...route}),probe:async()=>({ok:true,answer:'蓝色头发、白色围裙和鱼尾的卡通角色'})})
  const started=await manager.verify()
  assert.equal(started.awaitingReview,true)
  assert.equal(manager.status().verified,false)
  assert.equal(manager.status().answer,'蓝色头发、白色围裙和鱼尾的卡通角色')
  assert.throws(()=>manager.review({reviewId:'invalid',accepted:true}),/已失效/)
  assert.equal(manager.review({reviewId:started.reviewId,accepted:true}).verified,true)
  assert.equal(manager.status().verified,true)
  route.model='vision-model-2'
  assert.equal(manager.status().verified,false)
  assert.equal(manager.status().status,'route_changed')
})
test('DSH 模型错误、没有图片答案、重测和拒绝不允许留下旧认证',async()=>{
  let text='海蓝色的头发';const m=createDshVisionReview({getRoute:()=>route,probe:async()=>({ok:true,answer:text})})
  const a=await m.verify();m.review({reviewId:a.reviewId,accepted:true});assert.equal(m.isVerified(),true)
  text='';await assert.rejects(m.verify(),/未得到真实图片识别回复/)
  assert.equal(m.isVerified(),false)
  text='没有看见';const b=await m.verify()
  assert.equal(m.review({reviewId:b.reviewId,accepted:false}).verified,false)
  assert.throws(()=>m.review({reviewId:b.reviewId,accepted:true}),/已失效/)
})
