import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {gunzipSync} from 'node:zlib'
import {validateBackup} from '../lib/data-backup.mjs'
import {apply} from './helpers/ready-host.mjs'

function fixture(){
 const home=mkdtempSync(join(tmpdir(),'bili-console-'))
 let handler=null
 const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
   logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
 apply(ctx,{})
 async function call(method,path,body,headers={host:'127.0.0.1:7012'},options={}){
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
   req.url='/api/bili-duty/'+path;req.method=method;req.headers=headers;if(options.local)req.socket={remoteAddress:'127.0.0.1'}
   let code,headersOut,payload=''
   const res={writeHead(c,h){code=c;headersOut=h},end(x){payload+=String(x??'')}};if(options.stream)res.write=x=>{payload+=String(x);return true}
   await handler(req,res)
   return {code,headers:headersOut,text:payload,json(){return JSON.parse(payload)}}
 }
 return {home,call,close:()=>rmSync(home,{recursive:true,force:true})}
}

test('manage HTML and JS are served from same DSH route without extra port or process',async()=>{
 const fx=fixture();try{
   const h=await fx.call('GET','manage')
   assert.equal(h.code,200)
   assert.match(h.headers['content-type'],/text\/html/)
   assert.match(h.headers['content-security-policy'],/script-src 'self'/)
   assert.match(h.headers['content-security-policy'],/img-src 'self'/,'same-origin image previews must be allowed by CSP')
   assert.match(h.text,/成长记忆/)
   assert.match(h.text,/梗知识库/)
   assert.match(h.text,/历史严格审核记录（只读/)
   assert.match(h.text,/manage\.js/)
   assert.match(h.text,/运行诊断/)
   assert.match(h.text,/运行日志/)
   assert.match(h.text,/后台私信/)
   assert.match(h.text,/最近评论/)
   assert.match(h.text,/测试私信接口连接/)
   const js=await fx.call('GET','manage.js')
   assert.equal(js.code,200)
   assert.match(js.headers['content-type'],/javascript/)
   assert.match(js.text,/meme-memory\/review/)
   assert.match(js.text,/dm-approvals/)
   assert.match(js.text,/mention-diagnostics/)
   assert.match(js.text,/meme-diagnostics/)
   assert.match(js.text,/recent-comments/)
   assert.match(js.text,/dm-recent/)
   assert.ok(!js.text.includes('.innerHTML ='))
   assert.ok(!h.text.includes('18763'))
   const recentComments=await fx.call('GET','recent-comments?limit=20')
   assert.equal(recentComments.code,200)
   assert.equal(recentComments.json().ok,true)
   assert.ok(Array.isArray(recentComments.json().rows))
   const dmRecent=await fx.call('GET','dm-recent')
   assert.equal(dmRecent.code,200)
   assert.equal(dmRecent.json().ok,true)
   assert.ok(Array.isArray(dmRecent.json().conversations))
   const dmNetwork=await fx.call('POST','dm-network-check',{})
   assert.equal(dmNetwork.code,200)
   assert.equal(dmNetwork.json().ok,false)
   assert.match(dmNetwork.json().error,/登录凭证/)
   const client=await import('node:fs').then(m=>m.readFileSync(new URL('../client.js',import.meta.url),'utf8'))
   assert.match(client,/const onOpenManage = async/)
   assert.match(client,/fetch\(path, \{credentials: 'same-origin'/)
   assert.match(client,/window\.location\.assign\(insideTarget\)/);assert.match(client,/insideTarget=path\+\(safeTab/);assert.match(client,/link\.href=insideTarget;link\.target='_self'/)
 }finally{fx.close()}
})


test('最近评论 API 只返回判重表中保存的 BV/rpid/时间/短摘要',async()=>{
 const fx=fixture();try{
   const seen=join(fx.home,'bili-duty','seen.md')
   writeFileSync(seen,[
     '# 视频判重表',
     '## 评论记录',
     '| BV | rpid | root | 时间 | 正文前20字 |',
     '|---|---:|---:|---|---|',
     '| BV1234567890 | 321798740304 | 0 | 2026-10-25T10:00:00 | 白米饭都拿出来了 |',
     '## 看过的视频',
   ].join('\n'),'utf8')
   const res=await fx.call('GET','recent-comments?limit=10')
   assert.equal(res.code,200)
   assert.equal(res.json().rows.length,1)
   assert.equal(res.json().rows[0].bvid,'BV1234567890')
   assert.equal(res.json().rows[0].rpid,'321798740304')
   assert.match(res.json().rows[0].snippet,/白米饭都拿出来了/)
 }finally{fx.close()}
})

test('management page API rejects different localhost port and hostile web origin',async()=>{
 const fx=fixture();try{
   const hostile=await fx.call('GET','manage',undefined,{host:'127.0.0.1:7012',origin:'https://evil.example'})
   assert.equal(hostile.code,403)
   const otherPort=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:9812'})
   assert.equal(otherPort.code,403)
   const okay=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:7012'})
   assert.equal(okay.code,200)
 }finally{fx.close()}
})

test('meme moderation invalid writes are rejected; empty library is safe',async()=>{
 const fx=fixture();try{
   const listing=await fx.call('GET','meme-memory?q=奶蛙')
   assert.equal(listing.code,200)
   assert.equal(listing.json().total,0)
   const bad=await fx.call('POST','meme-memory/review',{id:-3,status:'approved'})
   assert.equal(bad.code,400)
 }finally{fx.close()}
})


test('管理中心拒绝开启旧版人工私信审批，历史旧配置只能显式关闭',async()=>{
 const fx=fixture();try{
  const initial=(await fx.call('GET','config')).json();
  assert.equal(initial.ok,true);
  const rejected=await fx.call('POST','config',{dmApprovalEnabled:true,dmApprovalPhrase:'白饭🍚'});
  assert.equal(rejected.code,409);
  assert.match(rejected.json().error,/人工严格私信审批已停止/);
  const change=await fx.call('POST','config',{dmApprovalEnabled:false,dmApprovedDailyLimit:3,dmApprovedTotalLimit:12});
  assert.equal(change.code,200);
  const saved=(await fx.call('GET','config')).json().config;
  assert.equal(saved.dmApprovalEnabled,false);
  assert.equal(saved.dmApprovedDailyLimit,undefined,'已移除获批用户个人每日限额，不得继续暗中保存');
  assert.equal(saved.dmApprovedTotalLimit,undefined,'已移除获批用户个人累计限额，不得继续暗中保存');
 }finally{fx.close()}
});

test('runtime controls and logs require owner intent and return actual persisted pause state',async()=>{
 const fx=fixture();try{
  const headers={host:'127.0.0.1:7012','x-dafeiyu-management-intent':'1'};
  assert.equal((await fx.call('GET','runtime-controls')).code,403);
  const before=await fx.call('GET','runtime-controls',undefined,headers);assert.equal(before.code,200);assert.equal(before.json().repliesEnabled,true);
  const result=await fx.call('POST','runtime-controls',{control:'replies',enabled:false,revision:before.json().revision},headers);assert.equal(result.code,200,result.text);assert.equal(result.json().localVerified,true);assert.equal(result.json().repliesEnabled,false);
  assert.equal((await fx.call('POST','runtime-controls',{control:'replies',enabled:true,revision:before.json().revision},headers)).code,409);
  assert.equal((await fx.call('GET','runtime-controls',undefined,headers)).json().repliesEnabled,false);
  const log=await fx.call('GET','runtime-logs?level=error&export=1',undefined,headers);assert.equal(log.code,200);assert.equal(log.json().rawIncluded,false);
  assert.equal((await fx.call('GET','runtime-logs',undefined,{...headers,origin:'https://example.org'})).code,403);
 }finally{fx.close()}
})


test('local backup HTTP exports deliver real stages, final on-disk receipt and legacy JSON; invalid directory never reports completion',async()=>{
 const fx=fixture();const headers={host:'127.0.0.1:7012','x-dafeiyu-management-intent':'1',accept:'application/x-ndjson'},opts={local:true,stream:true}
 try{
  const blocked=await fx.call('POST','main-session/memory/backup/export',{},headers,opts);const events=blocked.text.trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'error');assert.equal(events.some(e=>e.type==='result'),false)
  const dir=join(fx.home,'backups');const loc=await fx.call('POST','data-backup/location',{directory:dir},headers,opts);assert.equal(loc.code,200,loc.text)
  const exported=await fx.call('POST','main-session/memory/backup/export',{},headers,opts);assert.match(exported.headers['content-type'],/ndjson/)
  const lines=exported.text.trim().split('\n').map(JSON.parse);assert.deepEqual(lines.filter(e=>e.type==='progress').map(e=>e.stage),['prepare','files','manifest','publish']);const final=lines.at(-1);assert.equal(final.type,'result',exported.text);assert.equal(JSON.parse(readFileSync(final.data.filePath,'utf8')).format,'dafeiyu-life-memory-backup')
  const legacy=await fx.call('POST','main-session/memory/backup/export',{},headers,{local:true});assert.equal(legacy.json().ok,true);assert.ok(legacy.json().filePath)
  const business=await fx.call('POST','data-backup/export',{},headers,opts);const stages=business.text.trim().split('\n').map(JSON.parse);assert.equal(stages.at(-1).type,'result',business.text);assert.deepEqual(stages.filter(e=>e.type==='progress').map(e=>e.stage),['prepare','sqlite','files','manifest','publish']);assert.ok(stages.at(-1).data.filePath.endsWith('.json.gz'));const bundle=JSON.parse(gunzipSync(readFileSync(stages.at(-1).data.filePath)));assert.equal(validateBackup(bundle).integrity,'sha256-verified');assert.equal(bundle.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version)
  const master=await fx.call('GET','runtime-controls',undefined,headers);const pause=await fx.call('POST','runtime-controls',{control:'master',enabled:false,revision:master.json().revision},headers);assert.equal(pause.code,200,pause.text);assert.equal(pause.json().masterEnabled,false);assert.equal((await fx.call('GET','config')).json().config.masterEnabled,false)
 }finally{fx.close()}
})
