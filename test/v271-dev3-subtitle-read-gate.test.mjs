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
const credentials={dedeuserid:'12345',sessdata:'fake-dev3-subtitle-cookie'}
const scope=`12345:1:${createHmac('sha256',credentials.sessdata).update('12345').digest('hex').slice(0,16)}`
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev3-subtitle-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const fixture=dir=>{
  writeFileSync(join(dir,'account-binding.json'),JSON.stringify({activeUid:'12345',generation:1,reviewRequired:false,restartRequired:false}))
  writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credentials))
}
const py=source=>spawnSync(python,['-c',source],{encoding:'utf8',timeout:7000,env:pyEnv,...isolatedChild})
const pyRead=(tool,args)=>{
  const source=`import json;from read_action_gate import read_action;print(json.dumps(read_action(${JSON.stringify(tool)},json.loads(${JSON.stringify(JSON.stringify(args))})),ensure_ascii=False))`
  const r=py(source)
  assert.equal(r.status,0,r.stderr||String(r.error))
  return JSON.parse(r.stdout)
}

test('subtitle identity uses verified BV for both text-only and optional vision paths',()=>{
  const plain=readToolAction('bili_subtitle',{bvid:BV})
  assert.deepEqual(plain,{operation:'bili_subtitle',target:BV})
  assert.deepEqual(readToolAction('bili_subtitle',{bvid:BV,auto_vision_on_missing:false}),plain)
  assert.deepEqual(readToolAction('bili_subtitle',{bvid:BV,auto_vision_on_missing:true}),plain)
  assert.notDeepEqual(plain,readToolAction('bili_video_info',{bvid:BV}))
  assert.notDeepEqual(plain,readToolAction('bili_subtitle',{bvid:'BV1abcde9999'}))
  assert.equal(readToolAction('bili_preview_vision',{bvid:BV}),null,'vision still requires its own existing permission and quota')
  for(const args of [{bvid:'bad'},{bvid:BV,auto_vision_on_missing:'true'},{bvid:BV,auto_vision_on_missing:1},{bvid:BV,auto_vision_on_missing:null}])
    assert.throws(()=>readToolAction('bili_subtitle',args))
})

test('Python and Node agree on subtitle identity and strictly reject invalid vision flags',()=>{
  for(const args of [{bvid:BV},{bvid:BV,auto_vision_on_missing:false},{bvid:BV,auto_vision_on_missing:true}])
    assert.deepEqual(pyRead('bili_subtitle',args),Object.values(readToolAction('bili_subtitle',args)))
  for(const args of [{bvid:'INVALID'},{bvid:BV,auto_vision_on_missing:'true'},{bvid:BV,auto_vision_on_missing:1},{bvid:BV,auto_vision_on_missing:null}]){
    const script=`import json\nfrom read_action_gate import read_action\ntry:\n read_action('bili_subtitle',json.loads(${JSON.stringify(JSON.stringify(args))}))\nexcept ValueError:\n print('REJECTED')`
    const r=py(script)
    assert.equal(r.status,0,r.stderr||String(r.error))
    assert.match(r.stdout,/REJECTED/)
  }
})

test('Node subtitle lock blocks independent Python; same-parent adapter can read, even with different fallback option',()=>home(async dir=>{
  fixture(dir)
  const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
  await gate.run(readToolAction('bili_subtitle',{bvid:BV,auto_vision_on_missing:false}),async()=>{
    for(const [adapter,result] of [[false,'HELD'],[true,'ENTERED']]){
      const script=`from read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_subtitle',{'bvid':'${BV}','auto_vision_on_missing':True},home=${JSON.stringify(dir)},adapter=${adapter?'True':'False'}): print('ENTERED')\nexcept ReadReservationHeld: print('HELD')`
      const r=py(script)
      assert.equal(r.status,0,r.stderr||String(r.error))
      assert.match(r.stdout,new RegExp(result))
    }
    return {ok:true}
  })
  assert.equal(gate.status().active,0)
  assert.equal(gate.status().recent[0].operation,'bili_subtitle')
}))

test('Python-held subtitle lock blocks Node until a verified normal release',()=>home(async dir=>{
  fixture(dir)
  const script=`import sys\nfrom read_action_gate import public_read_reservation\nwith public_read_reservation('bili_subtitle',{'bvid':'${BV}','auto_vision_on_missing':False},home=${JSON.stringify(dir)}):\n print('LOCKED',flush=True)\n sys.stdin.readline()`
  const child=spawn(python,['-c',script],{env:pyEnv,stdio:['pipe','pipe','pipe'],...isolatedChild})
  const finished=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
  let stdout='',stderr=''
  const started=new Promise((resolve,reject)=>{
    const limit=setTimeout(()=>reject(new Error('Python did not acquire subtitle reservation: '+stderr)),4000)
    child.stderr.on('data',x=>{stderr+=x.toString()})
    child.stdout.on('data',x=>{stdout+=x.toString();if(stdout.includes('LOCKED')){clearTimeout(limit);resolve()}})
    child.once('error',e=>{clearTimeout(limit);reject(e)})
    child.once('close',(code,signal)=>{if(!stdout.includes('LOCKED')){clearTimeout(limit);reject(new Error(`Python exited before LOCKED: ${code}/${signal} ${stderr}`))}})
  })
  try{
    await started
    const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
    await assert.rejects(gate.run(readToolAction('bili_subtitle',{bvid:BV,auto_vision_on_missing:true}),async()=>({ok:true})),ReadActionHeldError)
    assert.equal((await gate.run(readToolAction('bili_danmaku',{bvid:BV,num:25}),async()=>({ok:true}))).ok,true)
    child.stdin.end('release\n')
    const {code,signal}=await finished
    assert.equal(code,0,`Python exited with code=${code}, signal=${signal}, stderr=${stderr}`)
    assert.equal((await gate.run(readToolAction('bili_subtitle',{bvid:BV}),async()=>({ok:true}))).ok,true)
  }finally{if(child.exitCode===null&&!child.stdin.destroyed)child.stdin.end('release\n')}
}))

test('production routes subtitle through shared reservation and retains separate vision consent',()=>{
  const base=new URL('../',import.meta.url)
  const js=readFileSync(new URL('index.js',base),'utf8')
  const pyServer=readFileSync(new URL('vendor/bilibili-mcp/mcp_server.py',base),'utf8')
  assert.match(js,/readToolAction\(toolName,args\)/)
  assert.match(js,/call\('bili_subtitle',\{bvid,auto_vision_on_missing:false\}\)/)
  assert.match(pyServer,/@tool\(\)\s+@_gate_read\('bili_subtitle'\)\s+async def bili_subtitle/)
  assert.match(pyServer,/if auto_vision_on_missing and os\.environ\.get\('BILI_VISION_ENABLED'\) == '1':/)
  assert.match(pyServer,/observed = await bili_preview_vision\(bvid\)/)
})
