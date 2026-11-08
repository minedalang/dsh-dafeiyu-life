import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const ui = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('removed the legacy nickname field and its unsaved React state', () => {
  assert.doesNotMatch(ui, /旧版昵称（保留兼容，可不改）/)
  assert.doesNotMatch(ui, /setMention\(/)
  assert.doesNotMatch(ui, /value:\s*mention\s*\?\?/)
  assert.doesNotMatch(ui, /私信推荐收件人 UID|setDmMode|setDmUid/)
  assert.match(ui, /打开管理中心/)
})

test('preserve backwards-compatible mentionName in config and server', () => {
  assert.match(host, /mentionName/)
  assert.match(host, /mentionTargets/)
})
