import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {spawnSync} from 'node:child_process'

const source=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const match=source.match(/  const formatLocalTime=value=>\{[\s\S]*?\n  \};/)
assert.ok(match,'管理中心必须提供统一的本地时间显示函数')

// Evaluate only the pure UI date formatter; no browser APIs or server needed.
const expression=`(()=>{${match[0]}\nreturn formatLocalTime})()`
const formatTime=runInNewContext(expression)

test('长期认识、待反思、人格时间线全部使用浏览器本地时间，而非截断 UTC ISO 字符串',()=>{
  assert.match(source,/formatLocalTime\(m\.at\|\|m\.createdAt\)/)
  assert.match(source,/formatLocalTime\(e\.time\|\|e\.day\|\|e\.createdAt\)/)
  assert.match(source,/formatLocalTime\(e\.at\).*当时证据/)
  assert.match(source,/const last=data\.lastReflectionAt\?formatLocalTime\(data\.lastReflectionAt\)/)
  assert.doesNotMatch(source,/String\(m\.at\|\|m\.createdAt\|\|''\)\.slice\(0,19\)/)
  assert.doesNotMatch(source,/String\(e\.time\|\|e\.day\|\|e\.createdAt\|\|''\)\.slice\(0,19\)/)
})

test('ISO UTC 时刻按用户设备时区显示：中国 UTC+8、洛杉矶夏令时及跨日期',()=>{
  const script=`const {runInNewContext}=require('node:vm');const fn=runInNewContext(${JSON.stringify(expression)});process.stdout.write(fn('2026-11-01T02:19:52.000Z'))`
  for(const [tz,expected] of [['Asia/Shanghai','2026/11/1 10:19:52'],['America/Los_Angeles','2026/10/31 19:19:52']]){
    const result=spawnSync(process.execPath,['-e',script],{env:{...process.env,TZ:tz},encoding:'utf8'})
    assert.equal(result.status,0,result.stderr)
    assert.equal(result.stdout,expected,`TZ ${tz}`)
  }
})

test('仅有日期的经历不伪造当天零点；无效时间安全退化',()=>{
  assert.equal(formatTime('2026-11-01'),'2026-11-01 · 具体时刻未记录')
  assert.equal(formatTime(''),'时间未记录')
  assert.equal(formatTime(null),'时间未记录')
  assert.equal(formatTime('not-a-time'),'时间未记录')
})
