import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
import {createHmac} from 'node:crypto'
import {readToolAction,createReadActionExecutionGate,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'

const BV='BV1abcde1234'
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
const pyDir=fileURLToPath(new URL('../vendor/bilibili-mcp/',import.meta.url))
const pyEnv={...process.env,PYTHONPATH:[pyDir,process.env.PYTHONPATH].filter(Boolean).join(delimiter)}
const isolatedChild={windowsHide:true,detached:process.platform==='win32'}
const credentials={dedeuserid:'12345',sessdata:'fake-dev3-danmaku-cookie'}
const scope=`12345:1:${createHmac('sha256',credentials.sessdata).update('12345').digest('hex').slice(0,16)}`
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev3-danmaku-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const fixture=dir=>{
  writeFileSync(join(dir,'account-binding.json'),JSON.stringify({activeUid:'12345',generation:1,reviewRequired:false,restartRequired:false}))
  writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credentials))
}
const py=(source)=>spawnSync(python,['-c',source],{encoding:'utf8',timeout:7000,env:pyEnv,...isolatedChild})

const pyRead=(tool,args)=>{
  const source=`import json;from read_action_gate import read_action;print(json.dumps(read_action(${JSON.stringify(tool)},json.loads(${JSON.stringify(JSON.stringify(args))})),ensure_ascii=False))`
  const r=py(source)
  assert.equal(r.status,0,r.stderr||String(r.error))
  return JSON.parse(r.stdout)
}

test('danmaku read identity includes BV and exact requested count, with no write-action expansion',()=>{
  const defaultAction=readToolAction('bili_danmaku',{bvid:BV})
  assert.deepEqual(defaultAction,{operation:'bili_danmaku',target:JSON.stringify([BV,100])})
  assert.deepEqual(readToolAction('bili_danmaku',{bvid:BV,num:25}),{operation:'bili_danmaku',target:JSON.stringify([BV,25])})
  assert.notDeepEqual(defaultAction,readToolAction('bili_danmaku',{bvid:BV,num:25}))
  assert.notDeepEqual(defaultAction,readToolAction('bili_comments',{bvid:BV,num:100}))
  for(const args of [{bvid:'not-a-bv'},{bvid:BV,num:0},{bvid:BV,num:301},{bvid:BV,num:1.5},{bvid:BV,num:'010'},{bvid:BV,num:-1}])
    assert.throws(()=>readToolAction('bili_danmaku',args))
  assert.equal(readToolAction('bili_reply',{bvid:BV}),null)
})

test('Python and Node produce exactly the same danmaku read identity and reject malformed counts',()=>{
  for(const args of [{bvid:BV},{bvid:BV,num:25},{bvid:BV,num:300},{bvid:BV,num:'50'}])
    assert.deepEqual(pyRead('bili_danmaku',args),Object.values(readToolAction('bili_danmaku',args)))
  const source=`from read_action_gate import read_action\ntry:\n read_action('bili_danmaku',{'bvid':'${BV}','num':301})\nexcept ValueError:\n print('REJECTED')`
  const r=py(source)
  assert.equal(r.status,0,r.stderr)
  assert.match(r.stdout,/REJECTED/)
})

test('Node reservation blocks independent Python danmaku; verified exact-parent adapter may enter',()=>home(async dir=>{
  fixture(dir)
  const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
  await gate.run(readToolAction('bili_danmaku',{bvid:BV,num:25}),async()=>{
    for(const [adapter,result] of [[false,'HELD'],[true,'ENTERED']]){
      const source=`from read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_danmaku',{'bvid':'${BV}','num':25},home=${JSON.stringify(dir)},adapter=${adapter?'True':'False'}): print('ENTERED')\nexcept ReadReservationHeld: print('HELD')`
      const r=py(source)
      assert.equal(r.status,0,r.stderr||String(r.error))
      assert.match(r.stdout,new RegExp(result))
    }
    const wrongCount=py(`from read_action_gate import public_read_reservation\nwith public_read_reservation('bili_danmaku',{'bvid':'${BV}','num':50},home=${JSON.stringify(dir)},adapter=True): print('NEW-READ')`)
    assert.equal(wrongCount.status,0,wrongCount.stderr)
    assert.match(wrongCount.stdout,/NEW-READ/)
    return {ok:true}
  })
  assert.equal(gate.status().active,0)
}))

test('Python-held danmaku lock blocks Node and releases normally without console signals',()=>home(async dir=>{
  fixture(dir)
  const source=`import sys\nfrom read_action_gate import public_read_reservation\nwith public_read_reservation('bili_danmaku',{'bvid':'${BV}','num':25},home=${JSON.stringify(dir)}):\n print('LOCKED',flush=True)\n sys.stdin.readline()`
  const child=spawn(python,['-c',source],{env:pyEnv,stdio:['pipe','pipe','pipe'],...isolatedChild})
  const finished=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
  let stdout='',stderr=''
  const started=new Promise((resolve,reject)=>{
    const limit=setTimeout(()=>reject(new Error('Python did not acquire danmaku reservation: '+stderr)),4000)
    child.stderr.on('data',x=>{stderr+=x.toString()})
    child.stdout.on('data',x=>{stdout+=x.toString();if(stdout.includes('LOCKED')){clearTimeout(limit);resolve()}})
    child.once('error',e=>{clearTimeout(limit);reject(e)})
    child.once('close',(code,signal)=>{if(!stdout.includes('LOCKED')){clearTimeout(limit);reject(new Error(`Python exited before LOCKED: ${code}/${signal} ${stderr}`))}})
  })
  try{
    await started
    const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
    await assert.rejects(gate.run(readToolAction('bili_danmaku',{bvid:BV,num:25}),async()=>({ok:true})),ReadActionHeldError)
    assert.equal((await gate.run(readToolAction('bili_video_info',{bvid:BV}),async()=>({ok:true}))).ok,true)
    child.stdin.end('release\n')
    const {code,signal}=await finished
    assert.equal(code,0,`Python exited with code=${code}, signal=${signal}, stderr=${stderr}`)
    assert.equal((await gate.run(readToolAction('bili_danmaku',{bvid:BV,num:25}),async()=>({ok:true}))).ok,true)
  }finally{if(child.exitCode===null&&!child.stdin.destroyed)child.stdin.end('release\n')}
}))

test('production Python and JS tool paths both wire the same danmaku reservation',()=>{
  const base=new URL('../',import.meta.url)
  const index=readFileSync(new URL('index.js',base),'utf8')
  const pythonServer=readFileSync(new URL('vendor/bilibili-mcp/mcp_server.py',base),'utf8')
  assert.match(index,/readToolAction\(toolName,args\)/)
  assert.match(index,/\bbili_danmaku\b/)
  assert.match(pythonServer,/@tool\(\)\s+@_gate_read\('bili_danmaku'\)\s+async def bili_danmaku/)
})
