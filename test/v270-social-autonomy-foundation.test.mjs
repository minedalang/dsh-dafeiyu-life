import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeSocialDecisionContext, interestEvidenceForTopic, validateSocialActionProposal } from '../lib/social-autonomy-contract.mjs'
import { createSocialContinuityLedger } from '../lib/social-continuity-ledger.mjs'

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

test('延期要求未来重新判断，沉默和结束不是自动发消息', () => {
  const c = context(), t = 1770000000000
  assert.equal(validateSocialActionProposal({ action: 'defer', notBefore: t + 60000 }, c, { now: t }).requiresReconsideration, true)
  assert.equal(validateSocialActionProposal({ action: 'defer', notBefore: t - 1 }, c, { now: t }).reason, 'invalid-defer-time')
  assert.equal(validateSocialActionProposal({ action: 'skip' }, c).action, 'skip')
  assert.equal(validateSocialActionProposal({ action: 'close' }, c).action, 'close')
})

test('P6-A/B 共享按账号、UID、线程隔离的预约账本，且不保存私信原文', () => temp(dir => {
  let clock = 1770000000000
  const ledger = createSocialContinuityLedger({ dataDir: dir, accountUid: '10001', now: () => clock })
  const req = { uid: actorUid, channel: 'dm', threadKey: 'private-conversation-1', sourceEventId: 'real-message-1',
    purpose: 'silence-reconsideration', notBefore: clock + 60000, expiresAt: clock + 4 * 3600000 }
  const r = ledger.schedule(req)
  assert.equal(r.scheduled, true)
  assert.equal(ledger.schedule(req).duplicate, true)
  assert.equal(ledger.due().length, 0)
  const saved = readFileSync(ledger.file, 'utf8')
  assert.doesNotMatch(saved, /private-conversation-1|real-message-1|真实私信/)
  assert.equal(ledger.status().accountUid, '10001')
  clock += 61000
  assert.equal(ledger.due().length, 1)
  assert.equal(ledger.claim(r.id).recheckPermissionAndMood, true)
  assert.equal(ledger.due().length, 0)
  assert.equal(ledger.settle(r.id, { outcome: 'sent' }).reason, 'missing-platform-receipt')
  assert.equal(ledger.settle(r.id, { outcome: 'sent', receiptId: 'bili-confirmed-567' }).status, 'sent')
  assert.equal(ledger.claim(r.id).reason, 'not-scheduled')
  assert.throws(() => createSocialContinuityLedger({ dataDir: dir, accountUid: '20002' }).status(), /mismatch/)
}))

test('新消息取消同一人同一线程的未执行续聊，其他人和线程不受影响', () => temp(dir => {
  let clock = 1770000000000
  const ledger = createSocialContinuityLedger({ dataDir: dir, accountUid: '10001', now: () => clock })
  const base = { channel: 'dm', purpose: 'delayed-supplement', notBefore: clock + 60000, expiresAt: clock + DAY }
  const a = ledger.schedule({ ...base, uid: '10010', threadKey: 'a', sourceEventId: 'm1' })
  const b = ledger.schedule({ ...base, uid: '10010', threadKey: 'b', sourceEventId: 'm2' })
  const c = ledger.schedule({ ...base, uid: '10011', threadKey: 'a', sourceEventId: 'm3' })
  assert.equal(a.ok && b.ok && c.ok, true)
  assert.equal(ledger.cancelForIncoming({ uid: '10010', channel: 'dm', threadKey: 'a' }).cancelled, 1)
  clock += 61000
  const due = ledger.due()
  assert.equal(due.length, 2)
  assert.deepEqual(new Set(due.map(x => x.id)), new Set([b.id, c.id]))
}))

test('到期的续聊预约会被明确标记 expired，不会永久留在 scheduled', () => temp(dir => {
  let clock=1770000000000
  const ledger=createSocialContinuityLedger({dataDir:dir,accountUid:'10001',now:()=>clock})
  const r=ledger.schedule({uid:'10010',channel:'dm',threadKey:'a',sourceEventId:'expired-1',purpose:'silence-reconsideration',
    notBefore:clock+60000,expiresAt:clock+120000})
  assert.equal(r.scheduled,true)
  clock+=121000
  assert.deepEqual(ledger.due(),[])
  assert.equal(ledger.status().counts.expired,1)
  assert.equal(ledger.status().counts.scheduled,0)
}))

const DAY = 86400000

test('已领取但未收到可信回执不能自动重复发送；退出时仍显示 claimed', () => temp(dir => {
  let clock = 1770000000000
  const opts = { dataDir: dir, accountUid: '10001', now: () => clock }
  const first = createSocialContinuityLedger(opts)
  const r = first.schedule({ uid: '10010', channel: 'comment', threadKey: 'BV:thread', sourceEventId: 'rpid',
    purpose: 'silence-reconsideration', notBefore: clock + 1500, expiresAt: clock + DAY })
  clock += 2000
  assert.equal(first.claim(r.id).ok, true)
  const rebooted = createSocialContinuityLedger(opts)
  assert.deepEqual(rebooted.due(), [])
  assert.equal(rebooted.status().counts.claimed, 1)
  assert.equal(rebooted.settle(r.id, { outcome: 'uncertain' }).ok, true)
  assert.equal(rebooted.claim(r.id).ok, false)
}))

test('账本拒绝越界时间', () => temp(dir => {
  const t = 1770000000000
  const ledger = createSocialContinuityLedger({ dataDir: dir, accountUid: '10001', now: () => t })
  assert.equal(ledger.schedule({ uid: '10010', channel: 'at', threadKey: 'a', sourceEventId: 'm', purpose: 'delayed-supplement',
    notBefore: t - 1000, expiresAt: t + DAY }).reason, 'invalid-intention-time')
}))

test('账本拒绝用普通文件冒充存储目录', () => temp(dir => {
  const ledger = createSocialContinuityLedger({ dataDir: dir, accountUid: '10001' })
  writeFileSync(join(dir, 'social-continuity'), 'not a directory')
  assert.throws(() => ledger.status(), /unsafe-continuity-dir/)
}))

test('账本拒绝符号链接目录（Windows 使用无需提升权限的 junction）', t => temp(dir => {
  const ledger = createSocialContinuityLedger({ dataDir: dir, accountUid: '10001' })
  const linked = join(dir, 'linked'); mkdirSync(linked)
  try {
    symlinkSync(linked, join(dir, 'social-continuity'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    // A restricted Windows account / filesystem can forbid even directory junctions.
    // Only skip link creation in that environment; time/path safety tests still run.
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error?.code)) {
      t.skip(`当前 Windows 环境不允许创建目录联接：${error.code}`)
      return
    }
    throw error
  }
  assert.throws(() => ledger.status(), /unsafe-continuity-dir/)
}))
