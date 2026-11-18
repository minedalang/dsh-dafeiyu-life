import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {readProductionVisionStatus} from '../lib/vision-production-status.mjs'
import {symlinkOrSkip} from './test-platform-fixtures.mjs'

const root=new URL('../',import.meta.url)
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')

test('未人工验收文字与按钮紧邻且显著红色，仅状态可见时显示',()=>{
 assert.match(html,/id="local-vision-review-inline"[^>]*>\s*<strong id="local-vision-review-label">尚未人工验收<\/strong>\s*<button[^>]*id="local-vision-review-jump"/)
 assert.match(html,/\.local-vision-review-inline strong\{color:#c62828/)
 assert.match(html,/\.local-vision-review-action\{background:#fff0f0/)
 assert.match(ui,/const needsReview=state.running===true&&model\?\.installed===true&&model\?\.verified!==true/)
 assert.match(ui,/\$\('local-vision-review-inline'\)\.hidden=!needsReview/)
})

test('记忆统计来自真实衰减副本，今日遗忘只统计实际新发生的转换',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3b13-memory-'))
 let clock=Date.parse('2026-11-15T12:00:00Z')
 let gate
 try{
  gate=createLifeMemoryGateway({dataDir:dir,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
  gate.recordEvents([{kind:'watch',key:'watch:dev3b13',bvid:'BV1234567890',at:clock,title:'真实公开视频'}])
  const a=gate.status();assert.equal(a.total,1);assert.equal(a.todayAdded,1);assert.equal(a.todayForgotten,0)
  clock+=150*86400000
  const b=gate.status();assert.equal(b.total,1);assert.equal(b.todayAdded,0);assert.equal(b.todayForgotten,1);assert.equal(b.counts.forgotten,1)
  clock+=86400000
  const c=gate.status();assert.equal(c.todayForgotten,0)
  assert.ok(!('text' in JSON.parse(readFileSync(gate.file,'utf8')).episodes[0])||JSON.parse(readFileSync(gate.file,'utf8')).episodes[0].text==='')
 }finally{gate?.close();rmSync(dir,{recursive:true,force:true})}
 assert.match(html,/id="neural-fading-total"/)
 assert.match(html,/id="neural-fading-new"/)
 assert.match(html,/id="neural-fading-forgot"/)
 assert.match(ui,/request\('\/life-memory\/status'\)/)
})

test('视觉生产状态只接受固定字段与合法结果，不执行识图',()=>{
 const d=mkdtempSync(join(tmpdir(),'dev3b13-vision-'))
 try{
  const f=join(d,'vision-production-last.json')
  assert.equal(readProductionVisionStatus(d),null)
  writeFileSync(f,JSON.stringify({version:1,at:Date.now(),ok:true,status:'analyzed',mode:'independent_local',model:'minicpm-v4.7'}))
  assert.equal(readProductionVisionStatus(d)?.ok,true)
  writeFileSync(f,JSON.stringify({version:1,at:Date.now(),ok:false,status:'timeout',mode:'independent_dsh',model:'DSH'}))
  assert.equal(readProductionVisionStatus(d)?.status,'timeout')
  writeFileSync(f,JSON.stringify({version:1,at:Date.now(),ok:true,status:'cached',mode:'independent_local'}))
  assert.equal(readProductionVisionStatus(d),null)

 }finally{rmSync(d,{recursive:true,force:true})}
 assert.match(py, /if debug or not isinstance\(result, dict\):/)
 assert.match(py,/if status not in \('analyzed', 'vision_unavailable'/)
})

// This is a separate security assertion: a Windows user without SeCreateSymbolicLinkPrivilege
// cannot create the malicious file fixture, but must not be credited as PASS.
test('视觉生产状态拒绝真实文件符号链接，不跟随外部结果',t=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3b13-vision-link-'))
 try{
  const external=join(dir,'outside.json'),link=join(dir,'vision-production-last.json')
  writeFileSync(external,JSON.stringify({version:1,at:Date.now(),ok:true,status:'analyzed',mode:'independent_local'}))
  if(!symlinkOrSkip(t,external,link,'file'))return
  assert.equal(readProductionVisionStatus(dir),null)
  assert.equal(readFileSync(external,'utf8').includes('analyzed'),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
