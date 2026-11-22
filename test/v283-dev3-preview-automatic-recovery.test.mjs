import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createReadActionExecutionGate,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'

const BV='BV1abcde1234',scope='account-scope-A:cred-digest-00001'
const digest=value=>createHash('sha256').update(value).digest('hex')
const action={operation:'bili_preview_frames',target:BV}
const fixture=fn=>{const home=mkdtempSync(join(tmpdir(),'dsh-preview-auto-'))
  return Promise.resolve().then(()=>fn(home)).finally(()=>rmSync(home,{recursive:true,force:true}))}
const gate=(home,account=scope)=>createReadActionExecutionGate({dataDir:home,getAccountScope:()=>account})
const lock=(home,act=action,account=scope)=>{
  const id=digest(JSON.stringify([account,'public',act.operation,act.target]))
  const folder=join(home,'read-action-executions','locks',id)
  mkdirSync(folder,{recursive:true})
  const row={version:1,id,scopeHash:digest(account).slice(0,20),operation:act.operation,
    source:'python-video-agent',at:Date.now()-31*60_000,pid:2147483647,state:'executing'}
  writeFileSync(join(folder,'entry.json'),JSON.stringify(row)+'\n')
  return {id,folder,row}
}

test('dead, old preview reservation is closed automatically as unverified, without replay',()=>fixture(async home=>{
  const {id}=lock(home)
  const g=gate(home)
  const s=g.status()
  assert.equal(s.active,0)
  assert.equal(s.recent[0].state,'auto-recovered-unverified')
  assert.equal(s.recent[0].id,id)
  let networkCalls=0
  assert.equal(await g.run(action,async()=>{networkCalls++;return {ok:true}}).then(x=>x.ok),true)
  assert.equal(networkCalls,1,'only the explicit new request executes')
}))

test('an old preview lock owned by a live process cannot be auto-released',()=>fixture(async home=>{
  const {row,folder}=lock(home)
  row.pid=process.pid
  writeFileSync(join(folder,'entry.json'),JSON.stringify(row)+'\n')
  const g=gate(home)
  assert.equal(g.status().active,1)
  await assert.rejects(g.run(action,async()=>{throw Error('must not execute')}),ReadActionHeldError)
}))

test('dead reads of other operations are never auto-released',()=>fixture(async home=>{
  const act={operation:'bili_video_info',target:BV}
  lock(home,act)
  const g=gate(home)
  assert.equal(g.status().active,1)
  await assert.rejects(g.run(act,async()=>{throw Error('must not execute')}),ReadActionHeldError)
}))

test('unknown and other-account preview rows never gain cross-account release',()=>fixture(async home=>{
  const {id}=lock(home)
  const alternate=gate(home,'account-scope-B:cred-digest-00002')
  assert.equal(alternate.status().active,0)
  const pending=gate(home).status()
  assert.ok(pending.recent.some(x=>x.id===id&&x.state==='auto-recovered-unverified'))
}))

test('only debug visibility changes: no user-facing manual release, developer endpoint remains',()=>{
  const base=new URL('../',import.meta.url)
  const ui=readFileSync(new URL('lib/management-console.js',base),'utf8')
  const html=readFileSync(new URL('lib/management-console.html',base),'utf8')
  const server=readFileSync(new URL('index.js',base),'utf8')
  assert.doesNotMatch(ui,/已检查，解除这条中断的只读预约/)
  assert.match(ui,/auto-recovered-unverified/)
  assert.match(html,/无需手动解锁/)
  assert.match(server,/系统将自动核查中断的只读预约/)
  assert.match(server,/readActionGate\.acknowledge/)
  assert.match(server,/DSH_DEV_READ_ACTION_UNLOCK!=='1'/)
})
