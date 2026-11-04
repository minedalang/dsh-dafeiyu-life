import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDmAutoReply } from '../lib/dm-autoreply.mjs';
import { createInteractionBatcher } from '../lib/interaction-batch.mjs';

async function setup({ phrase = '🍚', strangerMaxReplies = 1, approvalEnabled = true } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-dm-invite-'));
  let clock = 1_790_000_000_000;
  let n = 0;
  const inbox = [], outgoing = [];
  const config = { enabled: true, strangerEnabled: true, strangerFirstFixed: false,
    strangerMaxReplies, approvalEnabled, approvalPhrase: phrase,
    whitelist: ['200'], whitelistCooldownSeconds: 0, maxPerPoll: 10 };
  const handler = createDmAutoReply({ dataDir, selfUid: '999', now: () => clock,
    getConfig: () => config, fetchIncoming: async () => inbox,
    generateReply: async () => '星星眼是在夸本鱼吗？本鱼的小尾巴已经翘起来啦🐳',
    send: async message => { outgoing.push(message); return { ok: true }; },
    logger: { warn() {}, error() {} } });
  const add = (uid, text) => { inbox.push({ senderUid: uid, messageId: `dm-${++n}`,
    timestampMs: clock++, text, incoming: true }); };
  await handler.poll(); // 首次只建立基线
  return { add, handler, outgoing, config };
}

test('陌生人达到回复上限时不插入程序投喂邀请，保留模型自主措辞', async () => {
  const x = await setup();
  x.add('100', '星星眼是在夸我还是夸这题呀？');
  assert.equal((await x.handler.poll()).sent, 1);
  assert.equal(x.outgoing[0].text,'星星眼是在夸本鱼吗？本鱼的小尾巴已经翘起来啦🐳');
  assert.doesNotMatch(x.outgoing[0].text, /主人|审核|审批|批准|申请|等.*通过/);
  x.add('100', '🍚');
  assert.equal((await x.handler.poll()).sent, 0);
  assert.equal((await x.handler.listApprovals())[0].status, 'pending');
});

test('暗号可配置；任意陌生人回复都不由程序追加邀请', async () => {
  const x = await setup({ phrase: '大米🍙', strangerMaxReplies: 2 });
  x.add('100', '嗨');
  assert.equal((await x.handler.poll()).sent, 1);
  assert.doesNotMatch(x.outgoing[0].text, /投喂一口/);
  x.add('100', '还在吗');
  assert.equal((await x.handler.poll()).sent, 1);
  assert.doesNotMatch(x.outgoing[1].text, /投喂一口/);
  x.add('100', '大米🍙');
  assert.equal((await x.handler.poll()).sent, 0);
  assert.equal((await x.handler.listApprovals())[0].status, 'pending');
});

test('白名单和关闭申请的陌生人都不附加投喂暗号', async () => {
  const x = await setup({ approvalEnabled: false });
  x.add('100', '你好'); x.add('200', '你好');
  assert.equal((await x.handler.poll()).sent, 2);
  for (const row of x.outgoing) assert.doesNotMatch(row.text, /投喂一口/);
});

test('私信模型提示不主动透露人工审核信息', async () => {
  let prompt = '';
  const batcher = createInteractionBatcher({ delayMs: 1, getPersona: () => '可爱的鲸鱼女孩',
    invoke: async content => { prompt = content; return '{"items":[{"id":"0","reply":"你好呀"}]}'; } });
  assert.equal(await batcher.generate({ kind: 'dm', uid: '100', text: '你好' }), '你好呀');
  assert.match(prompt, /对外不解释聊天权限、人工审核、主人审批/);
  batcher.stop();
});
