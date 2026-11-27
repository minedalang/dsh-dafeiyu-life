import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs'
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

async function helper(t,url,{prepare=()=>{},full=false,binary=false,expected=0}={}){
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-live-export-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const duty=join(dir,'duty'),out=join(dir,'out')
 mkdirSync(duty);mkdirSync(out)
 await prepare({dir,duty,out})
 const file=join(dir,'helper.py');writeFileSync(file,python)
 const child=spawn(pythonExecutable,[file,duty,out,url||''],{env:{...process.env,BILI_EXPORT_FULL_MEMORY:full?'1':'0',BILI_EXPORT_BINARY_EVIDENCE:binary?'1':'0',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'},stdio:['ignore','ignore','pipe']})
 let stderr='';child.stderr.on('data',v=>{stderr+=v.toString()})
 const [code]=await once(child,'close')
 assert.equal(code,expected,stderr.slice(-1500))
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
  connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},
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


test('explicit full memory export follows verified relocated core and memory partition, preserves raw evidence and excludes auth and model files',async t=>{
 let target,mem
 const json=(p,o)=>writeFileSync(p,JSON.stringify(o))
 const {out,read}=await helper(t,'',{full:true,prepare:async({dir,duty})=>{
  target=join(dir,'active-core');mem=join(dir,'active-memory');mkdirSync(target);mkdirSync(mem)
  json(join(dir,'.bili-duty-location-v1.json'),{version:1,source:duty,target,nonce:'core'})
  json(join(target,'.bili-duty-migration-v1.json'),{version:1,source:duty,target,nonce:'core',ok:true})
  json(join(target,'storage-layout-v1.json'),{version:1,domains:{memory:{target:mem,nonce:'memory',mode:'copy'}}})
  json(join(mem,'.dafeiyu-storage-domain-v1.json'),{version:1,base:target,target:mem,domain:'memory',nonce:'memory',mode:'copy',verified:true})
  for(const base of [target,duty,mem])mkdirSync(join(base,'life-memory'))
  json(join(duty,'life-memory','episodic.json'),{episodes:['stale-original']});json(join(target,'life-memory','episodic.json'),{episodes:['stale-core']})
  json(join(mem,'life-memory','episodic.json'),{episodes:['private fixture'],associations:[{type:'concept'}],pendingVisualDetails:[]})
  mkdirSync(join(mem,'life-memory','details','v1','test'),{recursive:true})
  json(join(mem,'life-memory','details','v1','test','episode.json'),{content:'actual detail fixture'})
  for(const name of ['long-term-memory','detail-protection','embedding-memory-index'])mkdirSync(join(mem,name))
  json(join(mem,'long-term-memory','dafeiyu.json'),{memories:[{text:'owner-only fixture'}]})
  json(join(mem,'detail-protection','revocations-v1.json'),{revoked:['test']})
  writeFileSync(join(mem,'embedding-memory-index','vectors-test.f32'),Buffer.from([1,2,3,4]))
  json(join(mem,'embedding-memory-index','manifest.json'),{vectorFile:'vectors-test.f32',entries:[{id:'memory'}]})
  writeFileSync(join(mem,'life-memory','details','v1','test','evidence.jpg'),'actual memory attachment')
  for(const [folder,file] of [['life-video-gallery/test','storyboard-00.jpg'],['vision-perception-captures/test','storyboard-01.JPG'],['comment-memes/test','meme.png'],['dafeiyu-scene-test','public-video.mp4']]){
   mkdirSync(join(target,folder),{recursive:true});writeFileSync(join(target,folder,file),'asset');json(join(target,folder,'manifest.json'),{evidence:'retained metadata'})
  }
  mkdirSync(join(target,'.vision-env-old'));writeFileSync(join(target,'.vision-env-old','package.py'),'unused runtime')
  mkdirSync(join(target,'__pycache__'));writeFileSync(join(target,'__pycache__','test.pyc'),'cache')
  writeFileSync(join(target,'bili-duty-logs-old.zip'),'previous export')
  json(join(target,'neural-recall-activity.json'),{paths:[],activities:[{state:'no-association'}]})
  mkdirSync(join(target,'life-decision-traces','test'),{recursive:true});json(join(target,'life-decision-traces','test','trace.json'),{at:123,steps:[{type:'context-evidence',kind:'ai-visual-association',code:'ai-association-offered',provided:3},{type:'context-evidence',kind:'ai-visual-association',code:'ai-association-confirmed',observations:1}]})
  json(join(target,'config.json'),{name:'fish',apiKey:'FAKE_AUTH_SECRET',nested:{password:'FAKE_AUTH_SECRET'}})
  json(join(target,'bili_credential.json'),{cookie:'FAKE_AUTH_SECRET'})
  writeFileSync(join(target,'model.gguf'),'fake model')
  mkdirSync(join(target,'accounts','test'),{recursive:true});json(join(target,'accounts','test','owner-dm-agent.json'),{messages:['private chat fixture']})
  const child=spawn(pythonExecutable,['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.execute('create table t(v)');c.execute('insert into t values (1)');c.commit();c.close()",join(mem,'life-memory','example.db')]);assert.equal((await once(child,'close'))[0],0)
 }})
 const diag=read('association-diagnostics.json');assert.equal(diag.eventCounts['ai-visual-association/ai-association-offered'],1);assert.equal(diag.reportedTotals['ai-visual-association/ai-association-confirmed/observations'],1)
 const coverage=read('memory-export-coverage.json');assert.equal(coverage.complete,true,JSON.stringify(coverage.errors));assert.equal(coverage.coreRoot,target);assert.equal(coverage.memoryRoot,mem)
 assert.equal(coverage.episodic.associations,1);assert.deepEqual(coverage.recallActivity.states,{'no-association':1})
 const raw=join(out,'_expanded-state'),load=name=>JSON.parse(readFileSync(join(raw,name),'utf8'))
 assert.deepEqual(load('life-memory/episodic.json').episodes,['private fixture']);assert.equal(load('life-memory/details/v1/test/episode.json').content,'actual detail fixture')
 assert.equal(load('long-term-memory/dafeiyu.json').memories[0].text,'owner-only fixture');assert.equal(load('accounts/test/owner-dm-agent.json').messages[0],'private chat fixture')
 assert.equal(load('config.json').apiKey,'[credential excluded]');assert.equal(load('config.json').nested.password,'[credential excluded]');assert.equal(load('config.json').name,'fish')
 assert.equal(existsSync(join(raw,'bili_credential.json')),false);assert.equal(existsSync(join(raw,'model.gguf')),false)
 assert.equal(existsSync(join(raw,'embedding-memory-index','vectors-test.f32')),false)
 assert.equal(load('embedding-memory-index/manifest.json').vectorFile,'vectors-test.f32')
 assert.equal(readFileSync(join(raw,'life-memory/details/v1/test/evidence.jpg'),'utf8'),'actual memory attachment')
 for(const [folder,file] of [['life-video-gallery/test','storyboard-00.jpg'],['vision-perception-captures/test','storyboard-01.JPG'],['comment-memes/test','meme.png'],['dafeiyu-scene-test','public-video.mp4']]){
  assert.equal(existsSync(join(raw,folder,file)),false);assert.equal(load(folder+'/manifest.json').evidence,'retained metadata')
  assert.ok(coverage.skipped.some(row=>row.path===folder+'/'+file&&row.bytes===5&&row.reason.startsWith('optional-')))
 }
 assert.equal(coverage.binaryEvidence.includedByRequest,false);assert.equal(coverage.binaryEvidence.omittedFiles,5);assert.equal(coverage.binaryEvidence.omittedRawBytes,24)
 assert.deepEqual(coverage.binaryEvidence.byReason['rebuildable-embedding-vectors'],{files:1,rawBytes:4})
 assert.equal(existsSync(join(raw,'.vision-env-old/package.py')),false);assert.equal(existsSync(join(raw,'__pycache__/test.pyc')),false);assert.equal(existsSync(join(raw,'bili-duty-logs-old.zip')),false)
 assert.equal(existsSync(join(raw,'life-memory/example.db')),false);assert.equal(existsSync(join(out,'sqlite-snapshots/life-memory/example.db')),true)
 assert.equal(coverage.sqliteSnapshots[0].integrityCheck,'ok')
})

test('binary evidence opt-in retains resource files without enabling auth or cache export',async t=>{
 assert.match(exporter,/--include-binary-evidence" \(\n  set "BILI_EXPORT_FULL_MEMORY=1"\n  set "BILI_EXPORT_BINARY_EVIDENCE=1"/)
 const {out,read}=await helper(t,'',{full:true,binary:true,prepare:({duty})=>{
  for(const folder of ['life-memory','embedding-memory-index','life-video-gallery','vision-perception-captures','comment-memes','dafeiyu-scene-test','__pycache__'])mkdirSync(join(duty,folder))
  writeFileSync(join(duty,'life-memory','episodic.json'),'{}')
  for(const path of ['embedding-memory-index/vectors-test.f32','life-video-gallery/storyboard.jpg','vision-perception-captures/storyboard.jpg','comment-memes/meme.png','dafeiyu-scene-test/public-video.mp4','comment-memes/cookie.png','__pycache__/test.pyc','model.gguf'])writeFileSync(join(duty,path),'fixture')
 }})
 const raw=join(out,'_expanded-state'),coverage=read('memory-export-coverage.json')
 assert.equal(coverage.complete,true,JSON.stringify(coverage.errors));assert.equal(coverage.binaryEvidence.includedByRequest,true);assert.equal(coverage.binaryEvidence.omittedFiles,0)
 for(const path of ['embedding-memory-index/vectors-test.f32','life-video-gallery/storyboard.jpg','vision-perception-captures/storyboard.jpg','comment-memes/meme.png','dafeiyu-scene-test/public-video.mp4'])assert.equal(readFileSync(join(raw,path),'utf8'),'fixture')
 for(const path of ['comment-memes/cookie.png','__pycache__/test.pyc','model.gguf'])assert.equal(existsSync(join(raw,path)),false)
})

test('full exporter never reads stale memory after split disk loss; invalid core pointer refuses old root',async t=>{
 const result=await helper(t,'',{full:true,prepare:({dir,duty})=>{
  mkdirSync(join(duty,'life-memory'));writeFileSync(join(duty,'life-memory','episodic.json'),'{}')
  writeFileSync(join(duty,'storage-layout-v1.json'),JSON.stringify({version:1,domains:{memory:{target:join(dir,'missing'),mode:'copy',nonce:'memory'}}}))
 }})
 assert.equal(result.read('memory-export-coverage.json').complete,false);assert.equal(result.read('memory-export-coverage.json').memoryRoot,null)
 assert.equal(existsSync(join(result.out,'_expanded-state/life-memory/episodic.json')),false)
 assert.ok(result.read('diagnostic-coverage.json').partialReasons?.includes('full-memory-export-incomplete')||JSON.stringify(result.read('diagnostic-coverage.json')).includes('full-memory-export-incomplete'))
 const bad=await helper(t,'',{full:true,expected:2,prepare:({dir,duty})=>writeFileSync(join(dir,'.bili-duty-location-v1.json'),JSON.stringify({version:1,source:duty,target:join(dir,'lost'),nonce:'core'}))})
 assert.equal(bad.read('resolved-export-root.json').ok,false);assert.equal(existsSync(join(bad.out,'_expanded-state')),false)
})

test('default summary export does not copy private memory or full config',async t=>{
 const result=await helper(t,'',{prepare:({duty})=>{mkdirSync(join(duty,'life-memory'));writeFileSync(join(duty,'life-memory','episodic.json'),JSON.stringify({episodes:['private fixture']}))}})
 assert.equal(existsSync(join(result.out,'_expanded-state')),false);assert.equal(existsSync(join(result.out,'_diagnostics/memory-export-coverage.json')),false)
})
