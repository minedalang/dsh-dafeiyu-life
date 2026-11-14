import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync,readdirSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createReadActionExecutionGate,readToolAction,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'
const home=fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-read-action-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{force:true,recursive:true}))}
const BV='BV1abcde1234',account='account-scope-A:cred-digest-00001'
const make=(dir,scope=()=>account,now=Date.now)=>createReadActionExecutionGate({dataDir:dir,getAccountScope:scope,now})

test('validates comparable public reads without conflating reads with writes or changing semantic strength',()=>{
  assert.deepEqual(readToolAction('bili_video_info',{bvid:BV}),{operation:'bili_video_info',target:BV})
  assert.notDeepEqual(readToolAction('bili_video_info',{bvid:BV}),readToolAction('bili_creator_relation_status',{bvid:BV}))
  assert.equal(readToolAction('bili_follow_creator',{bvid:BV}),null)
  assert.notEqual(readToolAction('bili_search',{keyword:'  GAME  MUSIC ',num:10}).target,readToolAction('bili_search',{keyword:'game music',num:20}).target)
  assert.equal(readToolAction('bili_search',{keyword:'  GAME  MUSIC ',num:10}).target,readToolAction('bili_search',{keyword:'game music',num:10}).target)
  assert.throws(()=>readToolAction('bili_video_info',{bvid:'forged'}))
  assert.throws(()=>readToolAction('bili_search',{keyword:''}))
})

test('only one of two independent gate instances may call the same read while it is reserved',()=>home(async dir=>{
  const a=make(dir),b=make(dir);let release
  const started=new Promise(resolve=>{release=resolve})
  let calls=0
  const running=a.run({operation:'bili_video_info',target:BV,source:'owner-todo',obligationId:'promise-1'},async()=>{calls++;await started;return {ok:true,bvid:BV}})
  await assert.rejects(b.run({operation:'bili_video_info',target:BV,source:'life-planner'},async()=>{calls++;return {ok:true}}),ReadActionHeldError)
  assert.equal(a.status().active,1)
  release()
  assert.equal((await running).bvid,BV)
  assert.equal(b.status().active,0)
  assert.equal(b.status().recent[0].state,'tool-returned')
  assert.equal(calls,1)
}))

test('different accounts and distinct read strengths remain independently executable',()=>home(async dir=>{
  let release;const hold=new Promise(r=>{release=r})
  const a=make(dir),b=make(dir,()=> 'account-scope-B:cred-digest-00002')
  const p=a.run({operation:'bili_video_info',target:BV},async()=>{await hold;return 'ok'})
  assert.equal(await b.run({operation:'bili_video_info',target:BV},async()=> 'B'),'B')
  assert.equal(await a.run({operation:'bili_creator_relation_status',target:BV},async()=> 'relation'),'relation')
  assert.equal(a.status().active,1)
  assert.equal(b.status().active,0)
  release();await p
  assert.equal(a.status().recent.length,2)
  assert.equal(b.status().recent.length,1)
}))

test('untrusted targets and source identifiers are never written to disk or exposed to management diagnostics',()=>home(async dir=>{
  const g=make(dir)
  await g.run({operation:'bili_search',target:'PRIVATE DM SECRET QUERY',source:'owner-todo',sourceId:'private-uid-9988',obligationId:'promise-secret'},async()=>({ok:true}))
  const files=readdirSync(join(dir,'read-action-executions','receipts'))
  const raw=files.map(f=>readFileSync(join(dir,'read-action-executions','receipts',f),'utf8')).join('')
  assert.doesNotMatch(raw,/PRIVATE DM SECRET QUERY|private-uid-9988|promise-secret|account-scope-A/)
  assert.doesNotMatch(JSON.stringify(g.status()),/PRIVATE DM SECRET QUERY|private-uid-9988|promise-secret|account-scope-A/)
}))

test('crash-in-flight remains held after restart until explicit old-enough review; never automatically replays',()=>home(async dir=>{
  let time=Date.parse('2026-11-04T12:00:00Z');const clock=()=>time
  const action={operation:'bili_video_info',target:BV,source:'life-planner'}
  const g=make(dir,()=>account,clock)
  // Simulate process death: a persisted executing reservation and no result receipt.
  const pending=g.run(action,()=>new Promise(()=>{}))
  const restart=make(dir,()=>account,clock)
  assert.equal(restart.status().active,1)
  assert.equal(restart.status().interrupted,0)
  assert.equal(restart.acknowledge(restart.status().pending[0].id,{confirm:true}).ok,false)
  time+=31*60_000
  assert.equal(restart.status().interrupted,1)
  let calls=0
  await assert.rejects(restart.run(action,async()=>{calls++;return {ok:true}}),ReadActionHeldError)
  assert.equal(calls,0)
  const id=restart.status().pending[0].id
  assert.match(restart.acknowledge(id,{confirm:true}).error,/进程仍在运行/)
  // Model an actual dead process after restart (without executing its callback).
  const file=join(dir,'read-action-executions','locks',id,'entry.json')
  const entry=JSON.parse(readFileSync(file,'utf8'));entry.pid=2147483647;writeFileSync(file,JSON.stringify(entry))
  assert.equal(restart.acknowledge(id,{confirm:true}).status,'manual-review-no-replay')
  assert.equal(restart.status().active,0)
  assert.equal(await restart.run(action,async()=>{calls++;return 'fresh read'}),'fresh read')
  assert.equal(calls,1)
  void pending
}))

test('credential scope changing mid-read never forwards old-account response and seals unverified result',()=>home(async dir=>{
  let active=account,time=100_000;const g=make(dir,()=>active,()=>time)
  await assert.rejects(g.run({operation:'bili_video_info',target:BV},async()=>{active='account-scope-B:cred-digest-00002';return {ok:true,title:'private-account-A-only'}}),/账号作用域变化/)
  active=account
  assert.equal(g.status().active,1,'unverified returned result remains sealed')
  await assert.rejects(g.run({operation:'bili_video_info',target:BV},async()=>({ok:true})),ReadActionHeldError)
  time+=31*60_000
  assert.equal(g.status().interrupted,1)
}))

test('malformed and symlinked lock roots fail closed',()=>home(async dir=>{
  const root=join(dir,'read-action-executions');writeFileSync(root,'malicious')
  const g=make(dir)
  await assert.rejects(g.run({operation:'bili_video_info',target:BV},async()=>({ok:true})),/不安全|EEXIST|ENOTDIR/)
}))

test('reservation really blocks another Node process using the same state directory',()=>home(async dir=>{
  const parent=make(dir)
  let release;const hold=new Promise(r=>{release=r})
  const pending=parent.run({operation:'bili_video_info',target:BV},async()=>{await hold;return {ok:true}})
  const source=`import {createReadActionExecutionGate} from ${JSON.stringify(new URL('../lib/read-action-execution-gate.mjs',import.meta.url).href)};
    const g=createReadActionExecutionGate({dataDir:process.argv[1],getAccountScope:()=>${JSON.stringify(account)}});
    try {await g.run({operation:'bili_video_info',target:${JSON.stringify(BV)}},async()=>({ok:true}));process.exitCode=2}
    catch(e){if(e.code!=='reservation-held')process.exitCode=3}`
  const child=spawn(process.execPath,['--input-type=module','-e',source,dir],{stdio:['ignore','pipe','pipe']})
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code)=>resolve(code))})
  release();await pending
  assert.equal(exit,0)
}))

test('production wiring includes the common JS MCP dispatch, pre-running TODO reservation and a visible management path',()=>{
  const base=new URL('../',import.meta.url)
  const index=readFileSync(new URL('index.js',base),'utf8')
  const html=readFileSync(new URL('lib/management-console.html',base),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',base),'utf8')
  assert.match(index,/readActionGate\.run\(\{\.\.\.action,source:context\.source/)
  assert.match(index,/preAction\?await readActionGate\.run\(/)
  assert.match(index,/preReservedAction:preAction/)
  assert.match(index,/path==='\/api\/bili-duty\/read-action-executions'/)
  assert.match(html,/id="read-action-executions-status"/)
  assert.match(js,/request\('\/read-action-executions'\)/)
  assert.match(js,/request\('\/read-action-executions\/acknowledge'/)
})
