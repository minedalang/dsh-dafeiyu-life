import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

const root=join(import.meta.dirname,'..')
const pythonExecutable=process.env.PYTHON||'python3'
const exporter=readFileSync(join(root,'tools','导出B站日志.bat'),'utf8').replace(/\r\n/g,'\n')
const start=exporter.indexOf("  $pythonBody = @'\n")
const end=exporter.indexOf("\n'@\n  [System.IO.File]::WriteAllText($helper",start)
assert.ok(start>0&&end>start,'Find embedded offline diagnostic helper')
const python=exporter.slice(start+"  $pythonBody = @'\n".length,end)

async function helper(t,url){
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-live-export-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const duty=join(dir,'duty'),out=join(dir,'out')
 mkdirSync(duty);mkdirSync(out)
 const file=join(dir,'helper.py');writeFileSync(file,python)
 const child=spawn(pythonExecutable,[file,duty,out,url||''],{env:{...process.env,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'},stdio:['ignore','ignore','pipe']})
 let stderr='';child.stderr.on('data',v=>{stderr+=v.toString()})
 const [code]=await once(child,'close')
 assert.equal(code,0,stderr.slice(-1500))
 const read=name=>JSON.parse(readFileSync(join(out,'_diagnostics',name),'utf8'))
 return {out,read}
}

test('live exporter requests only the fixed read-only loopback endpoint and limits output',async t=>{
 let urls=[]
 const server=createServer((req,res)=>{
   urls.push(req.url)
   res.writeHead(200,{'content-type':'application/json'})
   res.end(JSON.stringify({ok:true,schemaVersion:1,observedAt:1800000000000,processUptimeSeconds:123,
     secret:'SHOULD_NOT_EXPORT',config:{cookie:'SHOULD_NOT_EXPORT'},
     planner:{running:false,busy:true,masterEnabled:true,enabled:true,expected:true,mode:'active',nextDecisionAt:1800000060000,
       schedulerPulse:{checks:42,lastCheckAt:1800000000000,lastModelTurnAt:1799999900000,stale:true,lastSkipReason:'outside-hours',secret:'SHOULD_NOT_EXPORT'}},
     interaction:{checks:{dm:{polling:false,lastStartedAt:1800000000000,lastResult:'ok',uid:'SHOULD_NOT_EXPORT'}}}}))
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(()=>server.close())
 const url=`http://127.0.0.1:${server.address().port}/api/bili-duty/manage?tab=activity`
 const {read,out}=await helper(t,url)
 const availability=read('live-status-availability.json')
 assert.equal(availability.captured,true)
 assert.equal(availability.schedulerRunning,false)
 assert.equal(availability.schedulerExpected,true)
 assert.equal(availability.schedulerStale,true)
 const live=read('live-status-snapshot.json')
 assert.equal(live.scheduler.running,false)
 assert.equal(live.scheduler.schedulerPulse.checks,42)
 assert.deepEqual(urls,['/api/bili-duty/life-agent/scheduler-snapshot'])
 assert.doesNotMatch(JSON.stringify(live),/SHOULD_NOT_EXPORT/)
})

test('missing or unsafe status URL does not silently claim a live timer',async t=>{
 const noUrl=await helper(t,'')
 assert.equal(noUrl.read('live-status-availability.json').captured,false)
 const unsafe=await helper(t,'https://example.com/api/bili-duty/manage')
 assert.equal(unsafe.read('live-status-availability.json').captured,false)
 assert.equal(unsafe.read('live-status-availability.json').reason,'ValueError')
})

test('scheduler exporter rejects redirected localhost status and never follows the Location target',async t=>{
 let count=0
 const server=createServer((req,res)=>{
   count++
   res.writeHead(302,{location:'https://example.com/exfiltrate'})
   res.end('redirect')
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(()=>server.close())
 const result=await helper(t,`http://127.0.0.1:${server.address().port}/api/bili-duty/manage`)
 assert.equal(result.read('live-status-availability.json').captured,false)
 assert.equal(count,1)
})

test('runtime scheduler endpoint reports the actual timer without ensureStarted side effect',async t=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-live-endpoint-'))
 t.after(()=>rmSync(home,{recursive:true,force:true}))
 let handler
 apply({get:key=>key==='dshHomePath'?(...p)=>join(home,...p):undefined,
  logger:{info(){},warn(){}},tools:{register(){}},
  webServer:{register(x){handler=x.handler;return {dispose(){}}}},
  effect:fn=>fn(),settings:{describe(){return []}}},{})
 const request=async path=>{
  const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/'+path
  req.headers={host:'127.0.0.1:8761',origin:'http://127.0.0.1:8761'}
  let code,output
  await handler(req,{writeHead(c){code=c},end(s){output=JSON.parse(s)}})
  return {code,output}
 }
 const first=await request('life-agent/scheduler-snapshot')
 assert.equal(first.code,200)
 assert.equal(first.output.schemaVersion,1)
 assert.equal(typeof first.output.planner.running,'boolean')
 assert.equal(typeof first.output.planner.schedulerPulse.stale,'boolean')
 assert.ok(!Object.hasOwn(first.output,'config'))
 assert.ok(!Object.hasOwn(first.output,'account'))
 const p=readFileSync(join(root,'index.js'),'utf8')
 const body=p.slice(p.indexOf("if(req.method==='GET'&&path==='/api/bili-duty/life-agent/scheduler-snapshot')"),
  p.indexOf("if(req.method==='GET'&&path==='/api/bili-duty/autonomous-planner')"))
 assert.doesNotMatch(body,/ensureStarted\(|\.tick\(/)
})
