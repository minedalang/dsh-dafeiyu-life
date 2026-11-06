import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createHmac} from 'node:crypto'
import {readToolAction,createReadActionExecutionGate,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'
import {runDev3OfflineAcceptance} from './helpers/dev3-offline-acceptance.mjs'

const BV='BV1abcde1234'
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
const pyBase=fileURLToPath(new URL('../vendor/bilibili-mcp/',import.meta.url))
const pyEnv={...process.env,PYTHONPATH:[pyBase,process.env.PYTHONPATH].filter(Boolean).join(delimiter)}
const isolatedChild={windowsHide:true,detached:process.platform==='win32'}
const credential={dedeuserid:'12345',sessdata:'fake-local-test-cookie'}
const scope=`12345:1:${createHmac('sha256',credential.sessdata).update('12345').digest('hex').slice(0,16)}`
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-discussion-lock-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const py=(script,dir)=>spawnSync(python,['-c',script],{encoding:'utf8',timeout:7000,env:{...pyEnv,BILI_DUTY_HOME:dir},...isolatedChild})
const fixture=dir=>{
  writeFileSync(join(dir,'account-binding.json'),JSON.stringify({activeUid:'12345',generation:1,reviewRequired:false,restartRequired:false}))
  writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credential))
}

test('comment and thread action identity is stable and distinguishes targets and scopes',()=>{
  const comments=readToolAction('bili_comments',{bvid:BV,num:10})
  const thread=readToolAction('bili_comment_thread',{bvid:BV,root:123,num:20,target_rpid:56})
  assert.deepEqual(comments,{operation:'bili_comments',target:JSON.stringify([BV,10])})
  assert.deepEqual(thread,{operation:'bili_comment_thread',target:JSON.stringify([BV,'123',20,'56'])})
  assert.notDeepEqual(comments,readToolAction('bili_comments',{bvid:BV,num:20}))
  assert.notDeepEqual(thread,readToolAction('bili_comment_thread',{bvid:BV,root:124,num:20,target_rpid:56}))
  assert.notDeepEqual(thread,readToolAction('bili_comment_thread',{bvid:BV,root:123,num:20,target_rpid:57}))
  for(const [tool,args] of [['bili_comments',{bvid:'x'}],['bili_comments',{bvid:BV,num:0}],['bili_comment_thread',{bvid:BV,root:0}],['bili_comment_thread',{bvid:BV,root:123,target_rpid:'8.0'}]])
    assert.throws(()=>readToolAction(tool,args))
  assert.equal(readToolAction('bili_reply',{bvid:BV}),null,'writes never become read reservations')
})

test('Python and Node agree on discussion tool reservation target bytes',()=>{
  const pairs=[['bili_comments',{bvid:BV,num:10}],['bili_comment_thread',{bvid:BV,root:123,num:20,target_rpid:56}]]
  for(const [tool,args] of pairs){
    const script=`import json;from read_action_gate import read_action;print(json.dumps(read_action(${JSON.stringify(tool)},json.loads(${JSON.stringify(JSON.stringify(args))})),ensure_ascii=False))`
    const result=py(script,'.')
    assert.equal(result.status,0,result.stderr)
    assert.deepEqual(JSON.parse(result.stdout),Object.values(readToolAction(tool,args)))
  }
})

test('Node-held comments reservation blocks independent Python but not verified nested Python',()=>home(async dir=>{
  fixture(dir)
  const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
  const action=readToolAction('bili_comments',{bvid:BV,num:5})
  await gate.run(action,async()=>{
    for(const adapter of [false,true]){
      const script=`from read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_comments',{'bvid':'${BV}','num':5},home=${JSON.stringify(dir)},adapter=${adapter?'True':'False'}):print('ENTERED')\nexcept ReadReservationHeld: print('HELD')`
      const result=py(script,dir)
      assert.equal(result.status,0,result.stderr)
      assert.match(result.stdout,adapter?/ENTERED/:/HELD/)
    }
    return {ok:true}
  })
}))

test('Python-held thread lock blocks Node and preserves independent comment-list identity',()=>home(async dir=>{
  fixture(dir)
  const scopeGate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
  const script=`import sys\nfrom read_action_gate import public_read_reservation\nwith public_read_reservation('bili_comment_thread',{'bvid':'${BV}','root':123,'num':20,'target_rpid':56},home=${JSON.stringify(dir)}):\n print('ENTERED',flush=True)\n sys.stdin.readline()`
  // The independent process owns a real filesystem reservation, no B站 calls.
  const {spawn}=await import('node:child_process')
  const child=spawn(python,['-c',script],{env:pyEnv,stdio:['pipe','pipe','pipe'],...isolatedChild})
  const finished=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
  try{
    await new Promise((resolve,reject)=>{
      let stdout='',stderr=''
      child.stderr.on('data',x=>{stderr+=x.toString()})
      const limit=setTimeout(()=>reject(Error(`Python fixture did not start in 3000ms; stderr: ${stderr}`)),3000)
      child.stdout.on('data',x=>{stdout+=x.toString();if(stdout.includes('ENTERED')){clearTimeout(limit);resolve()}})
      child.once('error',error=>{clearTimeout(limit);reject(error)})
      child.once('close',(code,signal)=>{
        if(!stdout.includes('ENTERED')){clearTimeout(limit);reject(Error(`Python exited before ENTERED (code=${code}, signal=${signal}); stderr: ${stderr}`))}
      })
    })
    const same=readToolAction('bili_comment_thread',{bvid:BV,root:123,target_rpid:56})
    await assert.rejects(scopeGate.run(same,async()=>({ok:true})),ReadActionHeldError)
    const other=readToolAction('bili_comments',{bvid:BV})
    assert.equal((await scopeGate.run(other,async()=>({ok:true}))).ok,true)
    // Let the Python context manager release the lock itself, without a
    // console-level kill signal that could interrupt Node's Windows test runner.
    child.stdin.end('release\n')
    const {code,signal}=await finished
    assert.equal(code,0,`Python fixture must close normally (code=${code}, signal=${signal})`)
  }finally{if(child.exitCode===null && !child.stdin.destroyed)child.stdin.end('release\n')}
}))

test('offline management acceptance uses synthetic state and reports actual checks',async()=>{
  const result=await runDev3OfflineAcceptance()
  assert.equal(result.ok,true)
  assert.equal(result.total,5)
  assert.equal(result.passed,5)
  assert.equal(result.platformCalls,0)
  assert.equal(result.aiCalls,0)
})

test('production includes real comment tool gates and an actionable diagnostic endpoint and page',()=>{
  const readFileSync=fsRead
  const root=new URL('../',import.meta.url)
  const server=readFileSync(new URL('vendor/bilibili-mcp/mcp_server.py',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')
  assert.match(server,/@_gate_read\('bili_comments'\)/)
  assert.match(server,/@_gate_read\('bili_comment_thread'\)/)
  assert.doesNotMatch(index,/path==='\/api\/bili-duty\/dev3\/acceptance\/local'/)
  assert.match(ui,/life-traces-refresh/)
  assert.match(html,/id="life-decision-traces-section"/)
})
import {readFileSync as fsRead} from 'node:fs'
