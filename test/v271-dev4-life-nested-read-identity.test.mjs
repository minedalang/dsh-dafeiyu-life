import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {execFileSync,spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createReadActionExecutionGate} from '../lib/read-action-execution-gate.mjs'
const BV='BV1abcde1234'
const vendor=new URL('../vendor/bilibili-mcp/',import.meta.url).pathname
const python=process.env.PYTHON|| (process.platform==='win32'?'python':'python3')
const hasPython=spawnSync(python,['--version'],{stdio:'ignore'}).status===0
const grandchild=`import os,sys\nfrom read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_video_info',{'bvid':'${BV}'},home=sys.argv[1],adapter=os.environ.get('BILI_JS_MCP_ADAPTER')=='1'):\n  print('ENTERED')\nexcept ReadReservationHeld as e:\n print('HELD:'+e.reason)`
const shim=`import os,sys,subprocess\nchild=subprocess.run([sys.executable,'-c',sys.argv[2],sys.argv[1]],capture_output=True,text=True,env=os.environ.copy())\nprint(child.stdout.strip())\nif child.returncode:print(child.stderr,file=sys.stderr);sys.exit(child.returncode)`

test('verified nested MCP child may reuse exact Node reservation even behind a Python launcher', {skip:!hasPython},async()=>{
  const home=mkdtempSync(join(tmpdir(),'life-verified-nested-read-'))
  try{
    const uid='12345678',sessdata='synthetic-test-secret',generation=1
    const tag=createHmac('sha256',sessdata).update(uid).digest('hex').slice(0,16)
    const scope=`${uid}:${generation}:${tag}`,token=randomBytes(32).toString('hex')
    writeFileSync(join(home,'account-binding.json'),JSON.stringify({activeUid:uid,generation,reviewRequired:false,restartRequired:false}))
    writeFileSync(join(home,'bili_credential.json'),JSON.stringify({dedeuserid:uid,sessdata}))
    const gate=createReadActionExecutionGate({dataDir:home,getAccountScope:()=>scope,getAdapterToken:()=>token})
    const launch=(env={})=>execFileSync(python,['-c',shim,home,grandchild],{encoding:'utf8',timeout:10000,
      env:{...process.env,PYTHONPATH:vendor,BILI_JS_MCP_ADAPTER:'1',BILI_JS_READ_GATE_TOKEN:token,...env}}).trim()
    const result=await gate.run({operation:'bili_video_info',target:BV,source:'life-planner'},async()=>{
      assert.equal(launch(),'ENTERED','grandchild must not be rejected by strict direct-parent PID check')
      assert.equal(launch({BILI_JS_READ_GATE_TOKEN:randomBytes(32).toString('hex')}),'HELD:adapter-proof-mismatch')
      assert.equal(launch({BILI_JS_READ_GATE_TOKEN:''}),'HELD:adapter-proof-mismatch')
      assert.equal(launch({BILI_JS_MCP_ADAPTER:'0'}),'HELD:other-reservation')
      return {ok:true}
    })
    assert.deepEqual(result,{ok:true})
    const receipts=readFileSync(join(home,'read-action-executions','receipts',
      (await import('node:fs')).readdirSync(join(home,'read-action-executions','receipts'))[0]),'utf8')
    assert.ok(!receipts.includes(token),'adapter secret must never enter receipts')
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('typed Python reservation denial retains only bounded proof reason in Life diagnostics',async()=>{
  const {verifyLifePublicMetadata,lifeMetadataDiagnostics}=await import('../lib/life-public-metadata.mjs')
  const row=verifyLifePublicMetadata(BV,{ok:false,status:'reservation-held',reservationReason:'adapter-proof-mismatch',error:'private-cookie'})
  assert.equal(row.code,'metadata-read-busy')
  assert.equal(row.diagnosticOrigin,'platform-read-gate')
  assert.equal(row.reservationReason,'adapter-proof-mismatch')
  assert.equal(lifeMetadataDiagnostics(row,BV).reservationReason,'adapter-proof-mismatch')
  assert.equal(JSON.stringify(row).includes('private-cookie'),false)
  const hostile=verifyLifePublicMetadata(BV,{ok:false,status:'reservation-held',reservationReason:'SECRET-CREDENTIAL'})
  assert.equal(hostile.reservationReason,undefined)
  const {classifyReadFailure}=await import('../lib/read-action-diagnostics.mjs')
  assert.deepEqual(classifyReadFailure({ok:false,status:'reservation-held',reservationReason:'adapter-proof-mismatch'}),
    {failed:true,code:'reservation-held',reservationReason:'adapter-proof-mismatch'})
  assert.equal(classifyReadFailure({ok:false,status:'reservation-held',reservationReason:'SECRET-CREDENTIAL'}).reservationReason,undefined)
})

test('production embedded MCP passes rotating proof only to its child and not to model or UI',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/readAdapterToken=randomBytes\(32\)/)
  assert.match(src,/BILI_JS_READ_GATE_TOKEN:\s*readAdapterToken/)
  assert.match(src,/getAdapterToken:\(\)=>readAdapterToken/)
  assert.doesNotMatch(readFileSync(new URL('../lib/life-decision-trace.mjs',import.meta.url),'utf8'),/adapterToken|adapterProof/)
})
