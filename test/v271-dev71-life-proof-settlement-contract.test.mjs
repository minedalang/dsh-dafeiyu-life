import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')

test('Life 准入记录区分已批准但未消费与已经消费的证明',()=>{
  const admission=read('../lib/life-willingness-admission.mjs')
  assert.match(admission,/previous\.used===false/)
  assert.match(admission,/expiredUnusedApproval/)
  assert.match(admission,/function markUsed\(scope,token\)/)
  assert.match(admission,/claim\.used=true/)
  assert.match(admission,/allScopes===true/)
})

test('过期且未执行的本地证明先结算，再从内存表移除',()=>{
  const willingness=read('../lib/life-willingness.mjs')
  assert.match(willingness,/const started=p\.executionStarted===true/)
  assert.match(willingness,/admission\.settle\(p\.scope,p\.admissionToken,\{verified:false\}\)/)
  assert.match(willingness,/options\?\.markUsed!==false/)
})

test('私信、评论、待办回访和视频分享发送路径均在提前退出时结算 Life 证明',()=>{
  const index=read('../index.js')
  assert.match(index,/const lifeProofSettler=proof=>/)
  assert.ok((index.match(/lifeProofSettler\(/g)||[]).length>=4)
  assert.match(index,/finally\{settleProof\('not-sent'\)\}/)
  assert.match(index,/catch\(e\)\{settleProof\('uncertain'\);throw e\}/)
})

test('视频评论预审只检查证明，最终发送前才标记证明已消费',()=>{
  const bridge=read('../lib/life-video-action-bridge.mjs')
  assert.match(bridge,/verify\(choice\.proof,'video_comment',undefined,\{markUsed:false\}\)/)
  assert.match(bridge,/verify\(pre\.proof,kind\)/)
})

test('Life 授权复核状态进入诊断，不再显示为模型生成失败',()=>{
  const comments=read('../lib/comment-interact.mjs')
  const ui=read('../lib/management-console.js')
  assert.match(comments,/life_authorization_review_required/)
  assert.match(ui,/life_authorization_review_required:'Life 授权账本需要复核/)
  assert.match(ui,/willingnessAdmission/)
  const index=read('../index.js')
  assert.match(index,/审阅尝试 /)
  assert.match(index,/自主延期 /)
  assert.match(index,/Life 授权账本待离线复核/)
})
