import test from 'node:test'
import assert from 'node:assert/strict'
import { picksThisRound } from '../lib/pick-quota.mjs'

test('已退役每日选片上限：今日超过50条仍保留每轮参考目标', () => {
  assert.equal(picksThisRound(20, 5, 0), 5)
  assert.equal(picksThisRound(20, 5, 20), 5)
  assert.equal(picksThisRound(50, 8, 88), 8)
  assert.equal(picksThisRound(0, 8, 500), 8)
})

test('保留旧调用参数兼容与每轮参考目标的旧范围', () => {
  assert.equal(picksThisRound(50, undefined, 0), 5)
  assert.equal(picksThisRound(20, 1, 0), 1)
  assert.equal(picksThisRound(50, 1000, 0), 50)
  assert.equal(picksThisRound(50, 0, 0), 5)
})
