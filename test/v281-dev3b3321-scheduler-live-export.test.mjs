import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync,utimesSync,symlinkSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {once,EventEmitter} from 'node:events'
import {collectManagementDiagnostics} from '../lib/management-diagnostics.mjs'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

const root=join(import.meta.dirname,'..')
const pythonExecutable=process.env.PYTHON||'python3'
const exporter=readFileSync(join(root,'tools','导出B站日志.bat'),'utf8').replace(/\r\n/g,'\n')
const start=exporter.indexOf("  $pythonBody = @'\n")
const end=exporter.indexOf("\n'@\n  [System.IO.File]::WriteAllText($helper",start)
assert.ok(start>0&&end>start,'Find embedded offline diagnostic helper')
const python=exporter.slice(start+"  $pythonBody = @'\n".length,end)

async function helper(t,url,{prepare=()=>{},full=false,binary=false,expected=0,snapshotFile=''}={}){
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-live-export-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const duty=join(dir,'duty'),out=join(dir,'out')
 mkdirSync(duty);mkdirSync(out)
 await prepare({dir,duty,out})
 const file=join(dir,'helper.py');writeFileSync(file,python)
 const child=spawn(pythonExecutable,[file,duty,out,url||''],{env:{...process.env,BILI_EXPORT_LIVE_SNAPSHOT_FILE:snapshotFile,BILI_EXPORT_FULL_MEMORY:full?'1':'0',BILI_EXPORT_BINARY_EVIDENCE:binary?'1':'0',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'},stdio:['ignore','ignore','pipe']})
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
   res.end(JSON.stringify({ok:true,schemaVersion:1,observedAt:1800000000000,processUptimeSeconds:123,pluginVersion:"2.8.3-dev.35",
     secret:'SHOULD_NOT_EXPORT',config:{cookie:'SHOULD_NOT_EXPORT'},
     planner:{running:false,busy:true,masterEnabled:true,enabled:true,expected:true,mode:'active',nextDecisionAt:1800000060000,
       schedulerPulse:{checks:42,lastCheckAt:1800000000000,lastModelTurnAt:1799999900000,stale:true,lastSkipReason:'outside-hours',secret:'SHOULD_NOT_EXPORT'}},
     interaction:{checks:{dm:{polling:false,lastStartedAt:1800000000000,lastResult:'ok',uid:'SHOULD_NOT_EXPORT'},dmOwner:{enabled:true,polling:false,intervalSeconds:30,nextAt:1800000030000,uid:'SHOULD_NOT_EXPORT'}}}}))
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
 assert.equal(live.pluginVersion,"2.8.3-dev.35")
 assert.equal(availability.pluginVersion,live.pluginVersion)
 assert.equal(live.pollChecks.dmOwner.intervalSeconds,30)
 assert.equal(live.pollChecks.dmOwner.nextAt,1800000030000)
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
 const request=async (path,{method='GET',body,origin='http://127.0.0.1:8761'}={})=>{
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);req.method=method;req.url='/api/bili-duty/'+path
  req.headers={host:'127.0.0.1:8761',origin,'content-type':'application/json'}
  let code,output
  await handler(req,{writeHead(c){code=c},end(s){output=JSON.parse(s)}})
  return {code,output}
 }
 const first=await request('life-agent/scheduler-snapshot')
 assert.equal(first.code,200)
 assert.equal(first.output.schemaVersion,1)
 assert.equal(first.output.pluginVersion,JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version)
 assert.equal(typeof first.output.interaction.checks.dmOwner.enabled,'boolean')
 assert.equal(typeof first.output.interaction.checks.dmOwner.intervalSeconds,'number')
 assert.ok(!Object.hasOwn(first.output.interaction.checks.dmOwner,'uid'))
 assert.equal(typeof first.output.planner.running,'boolean')
 assert.equal(typeof first.output.planner.schedulerPulse.stale,'boolean')
 assert.ok(!Object.hasOwn(first.output,'config'))
 assert.ok(!Object.hasOwn(first.output,'account'))
 assert.equal((await request('runtime-diagnostics-export',{method:'POST',body:{confirmation:'EXPORT_PRIVATE_DIAGNOSTICS'},origin:'https://example.invalid'})).code,403)
 assert.equal((await request('runtime-diagnostics-export',{method:'POST',body:{confirmation:'not-confirmed'}})).code,400)
 if(process.platform!=='win32')assert.equal((await request('runtime-diagnostics-export',{method:'POST',body:{confirmation:'EXPORT_PRIVATE_DIAGNOSTICS'}})).code,503)

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
  mkdirSync(join(target,'.vision-retired-old'));writeFileSync(join(target,'.vision-retired-old','package.py'),'isolated runtime')
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
 assert.equal(existsSync(join(raw,'.vision-retired-old/package.py')),false);assert.equal(existsSync(join(raw,'.vision-env-old/package.py')),false);assert.equal(existsSync(join(raw,'__pycache__/test.pyc')),false);assert.equal(existsSync(join(raw,'bili-duty-logs-old.zip')),false)
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


test('legacy or malformed live version remains unknown rather than inferred from a package copy',async t=>{
 let version;const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,schemaVersion:1,pluginVersion:version,planner:{},interaction:{}}))});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 for(const input of [undefined,'secret SHOULD_NOT_EXPORT']){version=input;const {read}=await helper(t,`http://127.0.0.1:${server.address().port}/api/bili-duty/manage`);const live=read('live-status-snapshot.json');assert.equal(live.pluginVersion,null);assert.doesNotMatch(JSON.stringify(live),/SHOULD_NOT_EXPORT/);}
})

import {readRuntimeLogs} from '../lib/runtime-log-view.mjs'
test('runtime summary reads rotated/install windows but never exports arbitrary private payload',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-summary-'));t.after(()=>rmSync(d,{recursive:true,force:true}))
 writeFileSync(join(d,'duty.log.1'),'2026-11-27T15:00:00.000+08:00 error ECONNRESET SECRET_COOKIE=abc\n')
 writeFileSync(join(d,'duty.log'),'2026-11-27T15:01:00.000+08:00 info 私人消息 secret-message\n2026-11-27T15:02:00.000+08:00 模型超时 ETIMEDOUT\n')
 writeFileSync(join(d,'install.log'),'2026-11-27T14:00:00.000+08:00 failed ENOSPC secret-path\n')
 writeFileSync(join(d,'config.json'),'SECRET_UNLISTED')
 const v=readRuntimeLogs(d,{errorsOnly:true,exportAll:true});assert.equal(v.errors,3);assert.equal(v.rows.length,3);assert.equal(v.rows[0].reason,'ETIMEDOUT');assert.equal(v.rawIncluded,false);assert.doesNotMatch(JSON.stringify(v),/SECRET|secret-message|secret-path|config.json/);assert.equal(v.coverage.length,4)
})

test('dev39 timestamped errors own their continuation lines; install output groups and raw secrets remain absent',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-event-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
 writeFileSync(join(d,'duty.log'),'2026-11-27T17:02:11.509+08:00 模型调用失败\n  TypeError: PRIVATE_MODEL_PROMPT\n    at C:/private/secret.js\n2026-11-27T17:02:12.509+08:00 [info] MCP 已就绪\n');
 writeFileSync(join(d,'install.log'),'pip download PRIVATE_TOKEN\nprogress\nERROR ECONNRESET\n');
 const v=readRuntimeLogs(d,{exportAll:true});assert.equal(v.rows.length,3);assert.equal(v.errors,2);const model=v.rows.find(r=>r.message==='模型调用失败');assert.equal(model.lineCount,3);assert.equal(model.exception,'TypeError');assert.match(model.detail,/TypeError/);const install=v.rows.find(r=>r.source==='install.log');assert.equal(install.time,null);assert.equal(install.lineCount,3);assert.equal(install.reason,'ECONNRESET');assert.doesNotMatch(JSON.stringify(v),/PRIVATE_|secret\.js|窗口记录/);
});

test('runtime severity follows event outcomes, not diagnostic zero counters or agent continuation prose',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-severity-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
 // Reproduce user-reported events without private titles, paths or model text.
 writeFileSync(join(d,'duty.log'),[
  '2026-11-27T17:01:12.583+08:00 评论互动错误：评论监听失败：快速设置还需在大肥鱼管理中心确认完成，所有业务功能暂时锁定。',
  '2026-11-27T17:01:41.286+08:00 本地语义运行时：llama.cpp Runtime下载源失败，尝试下一个来源：https://example.invalid/PRIVATE_TOKEN · fetch failed',
  '2026-11-27T17:01:41.287+08:00 本地语义模型安装失败：fetch failed',
  '2026-11-27T18:14:38.073+08:00 单条笔记：新写了 5 份到 PRIVATE_PATH',
  'Processing request of type CallToolRequest','模型总结：另有一条登记超时、状态未确认。PRIVATE_MESSAGE',
  '2026-11-27T18:14:49.609+08:00 本轮视频工具漏斗：候选 10，详情 8，内容证据 4，视觉描述 0，工具入选 4，工具错误 0',
  '2026-11-27T18:55:09.058+08:00 刷B站结束（life-agent，code=0）',
  '2026-11-27T18:55:09.064+08:00 本轮视频工具漏斗：候选 11，详情 5，内容证据 1，视觉描述 0，工具入选 1，工具错误 0',
  '2026-11-27T18:55:10.064+08:00 本轮视频工具漏斗：候选 11，详情 5，内容证据 1，视觉描述 0，工具入选 1，工具错误 2',
  '2026-11-27T18:55:11.058+08:00 刷B站结束（life-agent，code=1）',
  '2026-11-27T18:55:12.058+08:00 [ERROR] 模型调用失败 ECONNRESET PRIVATE_TOKEN',
  '2026-11-27T18:55:13.058+08:00 [INFO] 模型错误 0',
  ''
 ].join('\n'));
 writeFileSync(join(d,'install.log'),'Successfully installed package-error\n0 errors\nPRIVATE_PATH\n');
 writeFileSync(join(d,'asr-install.log'),'Installing packages\nERROR: Could not install packages: ENOSPC PRIVATE_TOKEN\n');
 const v=readRuntimeLogs(d,{exportAll:true});const at=prefix=>v.rows.find(r=>r.time?.includes(prefix));
 assert.equal(at('18:14:38').level,'info');assert.equal(at('18:14:38').lineCount,3);
 for(const ts of ['18:14:49','18:55:09.064']){const row=at(ts);assert.equal(row.level,'info');assert.equal(row.counts.find(c=>c.label==='工具错误').value,0)}
 assert.equal(at('18:55:10').level,'warning');assert.equal(at('18:55:10').counts.find(c=>c.label==='工具错误').value,2);
 assert.equal(at('18:55:09.058').level,'info');assert.equal(at('18:55:11').level,'error');assert.equal(at('18:55:12').reason,'ECONNRESET');assert.equal(at('18:55:13').level,'info');
 assert.equal(at('17:01:12').level,'warning');assert.equal(at('17:01:41.286').retrying,true);assert.equal(at('17:01:41.287').level,'error');assert.match(at('17:01:41.287').detail,/fetch failed/);
 assert.equal(v.rows.find(r=>r.source==='install.log').level,'info');assert.equal(v.rows.find(r=>r.source==='asr-install.log').level,'error');
 const errors=readRuntimeLogs(d,{errorsOnly:true,exportAll:true});assert.equal(errors.errors,4);assert.equal(errors.rows.length,4);assert.ok(errors.rows.every(r=>r.level==='error'));assert.doesNotMatch(JSON.stringify(v),/PRIVATE_|example\.invalid/);
});


test('management exporter reuses original payload with bounded live snapshot and cleans private temporary files',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-management-export-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const script=join(dir,'export.bat');writeFileSync(script,exporter);let temporary;
 const zip=Buffer.from('504b03041400000000000000210083dcefb70100000001000000010000007831504b010214001400000000000000210083dcefb7010000000100000001000000000000000000000000000000000078504b050600000000010001002f000000200000000000','hex');
 const snapshot={ok:true,schemaVersion:1,observedAt:1800000000000,pluginVersion:'2.8.3-dev.42',interaction:{ownerPriority:{idleSeconds:60,activeSeconds:30,checks:3,secret:'PRIVATE_SNAPSHOT'}}};
 const fake=(exe,args,opts)=>{assert.match(exe,/WindowsPowerShell/);assert.equal(opts.shell,false);assert.equal(opts.env.BILI_EXPORT_SCRIPT,script);assert.equal(opts.env.BILI_EXPORT_ROOT,dir);assert.equal(opts.env.BILI_EXPORT_FULL_MEMORY,'1');assert.equal(opts.env.BILI_EXPORT_BINARY_EVIDENCE,'0');assert.equal(opts.env.BILI_EXPORT_STATUS_URL,'');assert.match(args.at(-1),/POWERSHELL_PAYLOAD_BEGIN/);temporary=opts.env.BILI_EXPORT_DIR;assert.deepEqual(JSON.parse(readFileSync(opts.env.BILI_EXPORT_LIVE_SNAPSHOT_FILE,'utf8')),snapshot);const child=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>{writeFileSync(join(temporary,'bili-duty-logs-20261127-211151-532.zip'),zip);child.emit('close',0)});return child};
 const result=await collectManagementDiagnostics({root:dir,script,snapshot,platform:'win32',spawnProcess:fake});assert.deepEqual(result.bytes,zip);assert.equal(existsSync(temporary),false);
 await assert.rejects(collectManagementDiagnostics({root:dir,script,snapshot,platform:'linux',spawnProcess:()=>assert.fail('unsupported platform spawned')}),/不支持/);
 const snapshotFile=join(dir,'snapshot.json');writeFileSync(snapshotFile,JSON.stringify(snapshot));const {read}=await helper(t,'',{snapshotFile});const live=read('live-status-snapshot.json');assert.equal(live.captureSource,'management-local');assert.equal(live.ownerPriority.idleSeconds,60);assert.equal(live.ownerPriority.activeSeconds,30);assert.doesNotMatch(JSON.stringify(live),/PRIVATE_SNAPSHOT/);
});

import {appendRuntimeLog,pruneRuntimeLogs,RUNTIME_LOG_RETENTION} from '../lib/runtime-log-retention.mjs'
test('runtime logs expire stamped events including continuation lines and idle rotated logs',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-retention-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const now=Date.parse('2026-11-28T12:00:00Z'),old=now-9*86400000;
 writeFileSync(join(d,'duty.log'),'2026-11-19T12:00:00Z expired\n  expired stack\n2026-11-27T12:00:00Z recent\n  recent stack\n');utimesSync(join(d,'duty.log'),now/1000,now/1000);
 writeFileSync(join(d,'duty.log.1'),'old');utimesSync(join(d,'duty.log.1'),old/1000,old/1000);
 assert.equal(pruneRuntimeLogs(d,{now}).failed,0);assert.match(readFileSync(join(d,'duty.log'),'utf8'),/recent stack/);assert.doesNotMatch(readFileSync(join(d,'duty.log'),'utf8'),/expired/);assert.equal(existsSync(join(d,'duty.log.1')),false);
 const policy=readRuntimeLogs(d).retention;assert.equal(policy.days,7);assert.equal(policy.sweepMinutes,60);
});
test('host log appends bound all three active streams without a video round',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-rotate-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const cap=RUNTIME_LOG_RETENTION.maxBytes;
 for(const name of ['duty.log','install.log','asr-install.log']){
   assert.equal(appendRuntimeLog(d,name,'旧输出\n'+'a'.repeat(cap)),true);
   assert.equal(appendRuntimeLog(d,name,'新输出'+'b'.repeat(512)),true);assert.ok(statSync(join(d,name)).size<=cap);assert.match(readFileSync(join(d,name),'utf8'),/新输出/);
 }
 assert.ok(existsSync(join(d,'duty.log.1')));assert.ok(statSync(join(d,'duty.log.1')).size<=cap);assert.equal(appendRuntimeLog(d,'seen.md','forbidden'),false);
});
test('diagnostic retention respects migration, all accounts, statistical horizon and business files',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-scopes-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const now=Date.parse('2026-11-28T12:00:00Z'),old=now-50*86400000;
 const put=(name,text='x',at=old)=>{const p=join(d,name);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,text);utimesSync(p,at/1000,at/1000);return p};
 const discussion=put('video-discussion-reads/2026-10-01.jsonl'),mention=put('mention-diagnostics/2026-10-01.jsonl'),meme=put('meme-diagnostics/2026-10-01.jsonl'),usage=put('model-usage/2024-10.jsonl'),recentUsage=put('model-usage/2024-12.jsonl'),trace=put('life-decision-traces/'+'a'.repeat(24)+'/12345678-1234-1234-1234-123456789abc.json'),round=put('video-round-observations/'+'b'.repeat(24)+'.jsonl'),activeRound=put('video-round-observations/'+'c'.repeat(24)+'.jsonl');
 const journal=put('model-invocations/'+'d'.repeat(16)+'.jsonl',JSON.stringify({at:'2026-10-01T00:00:00Z'})+'\n'+JSON.stringify({at:'2026-11-27T00:00:00Z'})+'\n',now);
 const interrupted=put('model-invocations/'+'d'.repeat(16)+'.jsonl.12345678-1234-1234-1234-123456789abc.logtmp');
 const protectedFiles=['seen.md','memory.json','todos.json','backup/manual.zip','bili-duty-logs-manual.zip','custom.log'].map(n=>put(n));
 assert.equal(pruneRuntimeLogs(d,{now,activeRoundId:'c'.repeat(24)}).failed,0);
 for(const p of [discussion,meme,usage,trace,round,interrupted])assert.equal(existsSync(p),false,p);for(const p of [mention,recentUsage,activeRound,...protectedFiles])assert.equal(existsSync(p),true,p);
 assert.doesNotMatch(readFileSync(journal,'utf8'),/2026-10-01/);assert.match(readFileSync(journal,'utf8'),/2026-11-27/);
 put('comment-ledger-import-v1.json',JSON.stringify({version:1,completedAt:'2026-11-01T00:00:00Z'}));assert.equal(pruneRuntimeLogs(d,{now}).failed,0);assert.equal(existsSync(mention),false);
});
test('unsafe log paths and occupied lock cannot delete business data',t=>{
 const d=mkdtempSync(join(tmpdir(),'runtime-log-safe-'));t.after(()=>rmSync(d,{recursive:true,force:true}));const target=join(d,'seen.md');writeFileSync(target,'keep');
 try{symlinkSync(target,join(d,'duty.log'))}catch{t.skip('symlink unavailable');return}
 assert.equal(appendRuntimeLog(d,'duty.log','bad'),false);assert.ok(pruneRuntimeLogs(d).failed>0);assert.equal(readFileSync(target,'utf8'),'keep');
 writeFileSync(join(d,'.runtime-log-maintenance.lock'),JSON.stringify({pid:process.pid,token:'a'.repeat(32),at:Date.now()}));assert.equal(appendRuntimeLog(d,'install.log','busy'),false);assert.equal(existsSync(join(d,'install.log')),false);
});

test('production maintenance runs independent of video completion and all host text writers share retention',()=>{
 const code=readFileSync(join(root,'index.js'),'utf8');const start=code.indexOf('const runRuntimeLogCleanup=()=>');assert.ok(start>0);const section=code.slice(start,code.indexOf('const runVideoCacheCleanup',start));
 assert.match(section,/pruneRuntimeLogs\(stateDir/);assert.match(section,/runRuntimeLogCleanup\(\)\s+const runtimeLogTimer=setInterval/);assert.match(section,/clearInterval\(runtimeLogTimer\)/);assert.doesNotMatch(section,/masterEnabled|lifeAgentMode/);
 assert.equal([...code.matchAll(/appendRuntimeLog\(stateDir,'duty\.log'/g)].length,2);assert.match(code,/appendRuntimeLog\(stateDir,'install\.log'/);assert.match(code,/appendRuntimeLog\(stateDir,'asr-install\.log'/);assert.doesNotMatch(code,/rotateLogIfBig/);
});
