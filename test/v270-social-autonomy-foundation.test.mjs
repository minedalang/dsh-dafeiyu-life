import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeSocialDecisionContext, interestEvidenceForTopic, validateSocialActionProposal } from '../lib/social-autonomy-contract.mjs'

const actorUid = '485221842'
const context = (overrides = {}) => composeSocialDecisionContext({
  channel: 'dm', actorUid, threadKey: 'session:123', trigger: 'incoming',
  lifeVoiceContext: 'Life Voice Context: 此轮由统一人格提供连续情绪与成长人格。',
  verifiedScene: '真实私信中讨论一只小猫', topic: '猫', ...overrides,
})
const temp = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-v270-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('没有命中兴趣列表是未知而不是不感兴趣，更不是硬过滤', () => {
  assert.deepEqual(interestEvidenceForTopic('小猫', [{ topic: '音乐', stance: 'like', source: 'explicit-self-report' }]),
    { status: 'unknown', evidence: false, hardVeto: false })
  assert.deepEqual(interestEvidenceForTopic('小猫', [{ topic: '小猫', stance: 'dislike', source: 'explicit-self-report' }]),
    { status: 'explicit-dislike', evidence: true, hardVeto: false })
})

test('统一社交输入只接收唯一 Life Voice；熟悉度和画像不是权限', () => {
  const c = context({ relationship: { stage: 'friend', verifiedPortrait: true, portrait: '经核实喜欢猫' },
    conversation: { confirmedReplies: 2, phase: 'closing' }, interests: [] })
  assert.equal(c.ok, true)
  assert.match(c.lifeVoiceContext, /Life Voice Context/)
  assert.equal(Object.keys(c).filter(k => k === 'lifeVoiceContext').length, 1)
  assert.equal(c.relationship.portrait, '经核实喜欢猫')
  assert.equal(c.interestEvidence.status, 'unknown')
  assert.equal(c.requiresSeparatePolicyGate, true)
  assert.equal('emotionSnapshot' in c, false)
  assert.equal('canSend' in c, false)
  assert.equal(context({ lifeVoiceContext: '' }).reason, 'life-voice-required')
  assert.equal(context({ actorUid: 'not-a-uid' }).reason, 'invalid-actor-uid')
})

test('普通回复可以一到三气泡；四气泡、空文本及未经许可的@必须拒绝', () => {
  const c = context()
  assert.equal(validateSocialActionProposal({ action: 'reply', messages: ['这个角度挺有趣', '我再想想'] }, c).ok, true)
  assert.equal(validateSocialActionProposal({ action: 'reply', messages: ['一', '二', '三', '四'] }, c).reason, 'reply-bubble-limit')
  assert.equal(validateSocialActionProposal({ action: 'reply', messages: [' '] }, c).reason, 'invalid-reply-text')
  assert.equal(validateSocialActionProposal({ action: 'reply', messages: ['我想@陌生人 一起看'] }, c).reason, 'proactive-at-forbidden')
  // Even a model-generated "authorization" field is not trusted.
  assert.equal(validateSocialActionProposal({ action: 'reply', messages: ['@陌生人'], explicitMentionAuthorization: true }, c).reason,
    'mention-requires-external-policy')
})

test('收到任意核验UID的@可以进入意愿考虑，但不存在由此推导的写入授权', () => {
  const c = context({ channel: 'at', trigger: 'incoming', threadKey: 'BV1xx411c7mD:rpid:123' })
  assert.equal(c.ok, true)
  const r = validateSocialActionProposal({ action: 'reply', messages: ['谢谢邀请，我想先看看视频'] }, c)
  assert.equal(r.ok, true)
  assert.equal(r.requiresSeparatePolicyGate, true)
  assert.equal('atWhitelist' in c, false)
  assert.equal('canPost' in r, false)
})

test('自主延期不产生新的自动预约，沉默和结束不是自动发送',()=>{
 const c=context()
 const r=validateSocialActionProposal({action:'defer',notBefore:1800000000000},c,{now:1700000000000})
 assert.equal(r.ok,true);assert.equal(r.action,'defer')
 assert.equal(r.notBefore,undefined);assert.equal(r.requiresReconsideration,undefined)
 assert.equal(validateSocialActionProposal({action:'skip'},c).ok,true)
 assert.equal(validateSocialActionProposal({action:'close'},c).ok,true)
})
