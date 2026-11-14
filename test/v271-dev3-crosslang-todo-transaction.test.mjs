import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHmac} from 'node:crypto'
import {spawnSync,spawn} from 'node:child_process'
import {createReadActionExecutionGate,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const BV='BV1abcde1234'
const home=fn=>{const dir=mkdtempSync(join(tmpdir(),'dev3-crosslang-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
const pyPath=fileURLToPath(new URL('../vendor/bilibili-mcp/',import.meta.url))
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
const credential={dedeuserid:'12345',sessdata:'test-cookie-secret'}
const scope=`12345:1:${createHmac('sha256',credential.sessdata).update('12345').digest('hex').slice(0,16)}`
const env={...process.env,PYTHONPATH:[pyPath,process.env.PYTHONPATH].filter(Boolean).join(delimiter)}
// Windows child processes must not share the runner's console-control group.
// Keep stdout/stderr pipes and wait for close; never unref a test subprocess.
const isolatedChild={windowsHide:true,detached:process.platform==='win32'}
function init(dir){writeFileSync(join(dir,'account-binding.json'),JSON.stringify({activeUid:'12345',generation:1,reviewRequired:false,restartRequired:false}));writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credential))}
function callPy(dir,{adapter=false,bv=BV}={}){
 const source=`from read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_video_info',{'bvid':${JSON.stringify(bv)}},home=${JSON.stringify(dir)},adapter=${adapter?'True':'False'}): print('ENTERED')\nexcept ReadReservationHeld: print('HELD')\n`
 return spawnSync(python,['-c',source],{encoding:'utf8',env,timeout:6000,...isolatedChild})
}
test('independent Python cannot overlap an executing Node read; a verified Node child can use its exact parent lock',()=>home(async dir=>{
 init(dir)
 const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
 const result=await gate.run({operation:'bili_video_info',target:BV},async()=>{
   const independent=callPy(dir)
   assert.equal(independent.status,0,independent.stderr)
   assert.match(independent.stdout,/HELD/)
   const nested=callPy(dir,{adapter:true})
   assert.equal(nested.status,0,nested.stderr)
   assert.match(nested.stdout,/ENTERED/)
   return {ok:true}
 })
 assert.equal(result.ok,true)
 assert.match(callPy(dir).stdout,/ENTERED/)
}))
test('Python-held reservation blocks Node; child process crash leaves review-only lock',()=>home(async dir=>{
 init(dir)
 // Simulate an abrupt Python crash from INSIDE the child instead of sending
 // SIGKILL from Node: Windows console-control signals must not abort node --test.
 const source=`import sys,os\nfrom read_action_gate import public_read_reservation\nwith public_read_reservation('bili_video_info',{'bvid':'${BV}'},home=${JSON.stringify(dir)}):\n print('LOCKED',flush=True)\n sys.stdin.readline()\n os._exit(37)\n`
 const child=spawn(python,['-c',source],{env,stdio:['pipe','pipe','pipe'],...isolatedChild})
 const finished=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})))
 let captured=''
 try{
   await new Promise((resolve,reject)=>{
     let stderr=''
     child.stderr.on('data',x=>{stderr+=x.toString()})
     const limit=setTimeout(()=>reject(Error(`Python lock not acquired in 2500ms; stderr: ${stderr}`)),2500)
     child.stdout.on('data',x=>{
       captured+=x.toString()
       if(captured.includes('LOCKED')){clearTimeout(limit);resolve()}
     })
     child.once('error',error=>{clearTimeout(limit);reject(error)})
     child.once('close',(code,signal)=>{
       if(!captured.includes('LOCKED')){clearTimeout(limit);reject(Error(`Python exited before LOCKED (code=${code}, signal=${signal}); stderr: ${stderr}`))}
     })
   })
   const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
   await assert.rejects(gate.run({operation:'bili_video_info',target:BV},()=>Promise.resolve(true)),ReadActionHeldError)
   child.stdin.end('crash\n')
   const {code,signal}=await finished
   assert.equal(code,37,`Python fixture must crash itself (code=${code}, signal=${signal})`)
   assert.equal(gate.status().active,1)
   await assert.rejects(gate.run({operation:'bili_video_info',target:BV},()=>Promise.resolve(true)),ReadActionHeldError)
 }finally{if(child.exitCode===null && !child.stdin.destroyed)child.stdin.end('crash\n')}
}))
test('two independent Node writers retain both accepted tasks and a stale executor cannot overwrite newer attempt',()=>home(async dir=>{
 const m=new URL('../lib/owner-todos.mjs',import.meta.url).href
 const code=`import {createOwnerTodoEngine} from ${JSON.stringify(m)};const t=createOwnerTodoEngine({dataDir:process.argv[1]});for(let i=0;i<30;i++){const r=t.add({type:'search_videos',topic:process.argv[2]+'_'+i});if(!r.ok)throw Error(r.error)}`
 const run=prefix=>new Promise((resolve,reject)=>{
   const c=spawn(process.execPath,['--input-type=module','-e',code,dir,prefix],{stdio:['ignore','pipe','pipe'],...isolatedChild})
   let error='';c.stderr.on('data',x=>error+=x);c.on('error',reject);c.on('exit',n=>n===0?resolve():reject(Error(error||'child exit '+n)))
 })
 await Promise.all([run('A'),run('B')])
 const todos=createOwnerTodoEngine({dataDir:dir})
 assert.equal(todos.list({includeClosed:true,limit:100}).length,60)
 const task=todos.add({type:'search_videos',topic:'stale-result'}).item
 const a=todos.begin(task.id)
 assert.equal(a.ok,true)
 assert.equal(todos.update(task.id,'reopen').ok,false,'running state cannot be reopened under the active attempt')
 // An explicitly reviewed (interrupted) running attempt is archived before reopen.
 const recovery=todos.recoverInterrupted()
 assert.equal(recovery.recovered,1)
 assert.equal(todos.update(task.id,'reopen').ok,true)
 const b=todos.begin(task.id)
 assert.equal(b.ok,true)
 const old=todos.finish(task.id,{ok:true,summary:'old response'},a.item.attemptId)
 assert.equal(old.stale,true)
 assert.equal(todos.list({includeClosed:true,limit:100}).find(x=>x.id===task.id).status,'running')
 assert.equal(todos.finish(task.id,{ok:true,summary:'latest response'},b.item.attemptId).status,'done')
}))
