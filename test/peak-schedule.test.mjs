import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { apply } from '../index.js'
import { parsePeakWindows, readPeakWindows, activePeakWindow, shouldRunWindow } from '../lib/peak-schedule.mjs'

const now = new Date('2026-10-25T10:10:00.000Z')

test('空配置及旧版中午夜间开关不会隐式启用时间段', () => {
  assert.deepEqual(readPeakWindows('[]'), [])
  assert.deepEqual(readPeakWindows('not-json'), [])
  assert.equal(activePeakWindow(new Date(2026,9,25,12,30), []), -1)
})

test('支持多个本地时间段，跨午夜，首时刻包含末时刻不包含', () => {
  const slots=parsePeakWindows('[{"start":"08:30","end":"09:00"},{"start":"23:00","end":"02:00"}]')
  const date=(hour,min)=>new Date(2026,9,25,hour,min,0)
  assert.equal(activePeakWindow(date(8,30),slots),0)
  assert.equal(activePeakWindow(date(8,59),slots),0)
  assert.equal(activePeakWindow(date(9,0),slots),-1)
  assert.equal(activePeakWindow(date(23,59),slots),1)
  assert.equal(activePeakWindow(date(0,0),slots),1)
  assert.equal(activePeakWindow(date(1,59),slots),1)
  assert.equal(activePeakWindow(date(2,0),slots),-1)
})

test('严格校验时间、范围、数组长度；格式错误不能伪装成成功保存',()=>{
  for(const input of ['bad','{}','[{"start":"25:00","end":"23:00"}]',
    '[{"start":"12:60","end":"13:00"}]','[{"start":"11:30","end":"11:30"}]',
    '[{"start":"","end":"12:00"}]',JSON.stringify(Array(17).fill({start:'12:00',end:'12:30'}))]) {
    assert.throws(()=>parsePeakWindows(input),undefined,input)
  }
  assert.deepEqual(parsePeakWindows('[]'),[])
  assert.deepEqual(parsePeakWindows([{start:'10:00',end:'10:15',label:'test'}]),[{start:'10:00',end:'10:15'}])
})

test('自动运行最小间隔允许 1、5、10 分钟，不再有 30 分钟下限',()=>{
  assert.equal(shouldRunWindow({now,intervalMinutes:1,lastRunAt:'2026-10-25T10:09:00Z'}).allowed,true)
  assert.equal(shouldRunWindow({now,intervalMinutes:1,lastRunAt:'2026-10-25T10:09:01Z'}).reason,'interval_not_elapsed')
  assert.equal(shouldRunWindow({now,intervalMinutes:5,lastRunAt:'2026-10-25T10:05:00Z'}).allowed,true)
  assert.equal(shouldRunWindow({now,intervalMinutes:5,lastRunAt:'2026-10-25T10:07:00Z'}).allowed,false)
  assert.equal(shouldRunWindow({now,intervalMinutes:10,lastRunAt:'2026-10-25T10:00:00Z'}).allowed,true)
  for(const invalid of [0,-1,721,0.5,NaN,undefined]) {
    if(invalid===undefined) continue // 缺省值合法，默认 30
    assert.equal(shouldRunWindow({now,intervalMinutes:invalid}).allowed,false)
  }
  assert.equal(shouldRunWindow({now,lastRunAt:'2026-10-25T10:00:00Z'}).allowed,false)
  assert.equal(shouldRunWindow({now,intervalMinutes:1,lastRunAt:'2026-10-25T10:11:00Z'}).reason,'future_timestamp')
})

test('HTTP 实际保存新时间段、间隔 1 分钟、拒绝无效数据且保留旧值',async()=>{
  const home=mkdtempSync(join(tmpdir(),'dsh-multi-window-'))
  let route
  const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(spec){route=spec.handler;return{dispose(){}}}},
    effect:f=>f(),settings:{describe(){return[]}}}
  try {
    apply(ctx,{})
    async function call(method,path,body){
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'localhost'}
      let status,payload
      const res={writeHead(code){status=code},end(str){payload=JSON.parse(str)}}
      await route(req,res)
      return {status,...payload}
    }
    const initial=await call('GET','config')
    assert.equal(initial.status,200)
    assert.equal(initial.config.peakWindows,'[]')
    assert.equal(initial.config.peakIntervalMinutes,30)
    const slots=[{start:'07:00',end:'07:15'},{start:'23:00',end:'02:00'}]
    const saved=await call('POST','config',{peakWindows:JSON.stringify(slots),peakIntervalMinutes:1,peakValley:false})
    assert.equal(saved.status,200)
    assert.equal(saved.config.peakIntervalMinutes,1)
    const retired=await call('POST','config',{peakValley:true})
    assert.equal(retired.status,400);assert.match(retired.error,/已退役/)
    assert.deepEqual(JSON.parse(saved.config.peakWindows),slots)
    assert.deepEqual((await call('GET','config')).windows,slots) // config endpoint returns current windows
    const invalid=await call('POST','config',{peakWindows:'[{"start":"25:00","end":"02:00"}]'})
    assert.equal(invalid.status,400)
    assert.deepEqual((await call('GET','config')).windows,slots)
    const old=await call('POST','config',{noon:true,night:true})
    assert.equal(old.status,200)
    assert.deepEqual((await call('GET','config')).windows,slots)
    const zero=await call('POST','config',{peakIntervalMinutes:0})
    assert.equal(zero.status,200)
    assert.equal(zero.config.peakIntervalMinutes,30) // 老 0 配置安全升级到 30，而非高频运行
    const cleared=await call('POST','config',{peakWindows:'[]'})
    assert.equal(cleared.status,200)
    assert.deepEqual((await call('GET','config')).windows,[])
  } finally { rmSync(home,{recursive:true,force:true}) }
})

test('旧峰谷时段仅保留兼容解析，前端不再提供旧定时启动',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  assert.match(index,/peakWindows: z\.string\(\)\.default\('\[\]'\)/)
  assert.match(index,/readPeakWindows\(cfg\.peakWindows\)/)
  assert.doesNotMatch(index,/noon: z\.|night: z\.|\['noon', 'night'\]/)
  assert.doesNotMatch(client,/定时自主刷视频（可选）/)
  assert.match(client,/作者与开源致谢/)
  assert.doesNotMatch(client,/定时自主刷视频（可选）/)
  assert.doesNotMatch(client,/saveSchedule \}/)
  assert.doesNotMatch(client,/Math\.max\(30/)
})
