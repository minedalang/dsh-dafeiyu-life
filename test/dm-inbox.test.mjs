import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDmInbox, parseDmWhitelist } from '../lib/dm-inbox.mjs'

test('白名单支持换行逗号且会清理非法 UID', () => {
  assert.deepEqual([...parseDmWhitelist('1234\n55,abc; 1234，99')], ['1234','55','99'])
})

test('把真实 dm.mjs 格式转换成私信引擎格式，忽略自己发出的消息', async () => {
  const messages = await collectDmInbox({
    ownUid: 999, now: () => 1_800_000_000_000,
    sessions: [{ uid: 101, unread: 1, lastTs: 1_800_000_000 }],
    readConversation: async () => [
      { key: '1', ts: 1_800_000_000, fromMe: true, text: '我自己发的', kind: 1 },
      { key: '2', ts: 1_800_000_001, fromMe: false, text: '你好', kind: 1 },
      { key: '3', ts: 1_800_000_002, fromMe: false, text: '[非文字消息]', kind: 1 },
      { key: '4', ts: 1_800_000_003, fromMe: false, text: '[分享视频] BV1234567890', kind: 7 },
    ],
  })
  assert.equal(messages.length, 2)
  assert.equal(messages[0].messageId, '101:2')
  assert.equal(messages[0].timestampMs, 1_800_000_001_000)
  assert.equal(messages[1].system, false)
})

test('无未读但近期活跃、以及旧白名单会话仍检查', async () => {
  const looked = []
  await collectDmInbox({
    ownUid: '1', now: () => 1_800_000_000_000, whitelist: ['30'],
    sessions: [
      {uid: 20, unread: 0, lastTs: 1_800_000_000},
      {uid: 30, unread: 0, lastTs: 1_700_000_000},
      {uid: 40, unread: 0, lastTs: 1_700_000_000},
    ],
    readConversation: async (uid) => { looked.push(uid); return [] },
  })
  assert.deepEqual(looked, ['30','20'])
})

test('一个私信接口异常不影响其他会话', async () => {
  const rows = await collectDmInbox({
    ownUid: '1', now: () => 1_800_000_000_000, logger: {warn(){}},
    sessions: [{uid: 2,unread: 1},{uid: 3,unread: 1}],
    readConversation: async uid => {
      if (uid === '2') throw new Error('temporarily down')
      return [{key: 3, ts: 1_800_000_000, fromMe: false, text: 'OK', kind: 1}]
    },
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].senderUid, '3')
})


test('B站分享动态/网页卡片进入普通入站上下文，系统类型不冒充分享', async () => {
  const rows = await collectDmInbox({
    ownUid: 999, now: () => 1_800_000_000_000,
    sessions: [{ uid: 101, unread: 1, lastTs: 1_800_000_000 }],
    readConversation: async () => [
      { key: 'dynamic', ts: 1_800_000_001, fromMe: false, text: '[分享动态] https://t.bilibili.com/1234567890123456', kind: 7 },
      { key: 'card', ts: 1_800_000_002, fromMe: false, text: '[网页卡片] https://t.bilibili.com/1234567890123456', kind: 13 },
      { key: 'legacy', ts: 1_800_000_003, fromMe: false, text: '[非文字消息]', kind: 8 },
    ],
  })
  assert.deepEqual(rows.map(x => x.messageId), ['101:dynamic','101:card'])
  assert.equal(rows.every(x => x.system === false), true)
})
