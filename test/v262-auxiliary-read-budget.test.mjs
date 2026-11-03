import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
import {resolveUid} from '../lib/uid.mjs'
import {fetchBiliCover} from '../lib/bili-cover-proxy.mjs'

const sandbox=()=>mkdtempSync(join(tmpdir(),'dsh-262-aux-'))
const budget=dir=>createBiliReadBudget({dataDir:dir,minuteLimit:5,hourLimit:20,logger:{warn(){}}})
const BV='BV1xx411c7mD'
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const fakeCred=dir=>writeFileSync(join(dir,'bili_credential.json'),JSON.stringify({sessdata:'stub-session',bili_jct:'stub-csrf',buvid3:'stub-buvid'}))

test('nickname-to-UID lookup shares the read budget, then uses cache without new calls',async()=>{
  const dir=sandbox(),guard=budget(dir);fakeCred(dir)
  const original=globalThis.fetch;let called=0
  globalThis.fetch=async()=>{called++;return json({code:0,data:{result:[{mid:12345,uname:'小鱼'}]}})}
  try{
    assert.equal(await resolveUid(dir,'小鱼',()=>{},{readBudget:guard}),12345)
    assert.equal(guard.status().minuteUsed,1)
    assert.equal(await resolveUid(dir,'小鱼',()=>{},{readBudget:guard}),12345)
    assert.equal(called,1,'cached lookup avoids extra HTTP requests')
  }finally{globalThis.fetch=original}
})

test('B站 UID lookup platform throttling records cooldown, never caches an invalid UID',async()=>{
  const dir=sandbox(),guard=budget(dir);fakeCred(dir)
  const original=globalThis.fetch
  globalThis.fetch=async()=>json({code:-412,message:'请求过于频繁'})
  try{
    assert.equal(await resolveUid(dir,'被限流的名字',()=>{},{readBudget:guard}),0)
    assert.equal(guard.status().reason,'platform-cooldown')
    assert.throws(()=>guard.acquire('dm-list'),BiliReadDeferredError)
  }finally{globalThis.fetch=original}
})

test('cover metadata and image use the same budget, preserve image bytes and forbid redirects',async()=>{
  const dir=sandbox(),guard=budget(dir),calls=[]
  const sample=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a])
  const found=await fetchBiliCover(BV,{readBudget:guard,fetchImpl:async(url,opts)=>{
    calls.push({url,opts})
    if(url.startsWith('https://api.bilibili.com/'))return json({code:0,data:{pic:'https://i0.hdslb.com/bfs/archive/test.png'}})
    return new Response(sample,{status:200,headers:{'content-type':'image/png'}})
  }})
  assert.equal(found.type,'image/png')
  assert.deepEqual(found.buf,sample)
  assert.equal(guard.status().minuteUsed,2)
  assert.equal(calls[1].opts.redirect,'error')
  assert.equal(calls[0].opts.signal instanceof AbortSignal,true)
})

test('cover proxy blocks untrusted platform pic URL before outbound fetch',async()=>{
  for(const pic of ['http://127.0.0.1/private','https://example.com/secret','https://i0.hdslb.com.evil.com/secret','file:///etc/passwd','https://i0.hdslb.com:9443/x']){
    const dir=sandbox(),guard=budget(dir);let calls=0
    const result=await fetchBiliCover(BV,{readBudget:guard,fetchImpl:async()=>{calls++;return json({code:0,data:{pic}})}})
    assert.equal(result,null,pic)
    assert.equal(calls,1,pic)
    assert.equal(guard.status().minuteUsed,1)
  }
})

test('cover bytes are bounded even if server omits Content-Length; image content type is checked',async()=>{
  const dir=sandbox(),guard=budget(dir)
  const fetchImpl=async(url)=>url.startsWith('https://api.bilibili.com/')
    ?json({code:0,data:{pic:'https://i1.hdslb.com/bfs/archive/large.jpg'}})
    :new Response(Buffer.alloc(64),{headers:{'content-type':'image/jpeg'}})
  assert.equal(await fetchBiliCover(BV,{readBudget:guard,fetchImpl,maxBytes:16}),null)
  assert.equal(guard.status().minuteUsed,2)
})

test('cover metadata throttling blocks subsequent requests instead of silently retrying',async()=>{
  const dir=sandbox(),guard=budget(dir)
  const result=await fetchBiliCover(BV,{readBudget:guard,fetchImpl:async()=>json({code:-352,message:'access denied'})})
  assert.equal(result,null)
  assert.equal(guard.status().blocked,true)
  await assert.rejects(()=>fetchBiliCover(BV,{readBudget:guard,fetchImpl:async()=>{throw Error('must not send network request')}}),BiliReadDeferredError)
})

test('DM overflow never commits the unread cursor but still surfaces retrieved messages',async()=>{
  const {collectDmInbox}=await import('../lib/dm-inbox.mjs')
  const session={uid:'10203',unread:80,lastTs:1_800_000_000}
  const warnings=[];let observed=0,reads=0
  const received=await collectDmInbox({sessions:[session],ownUid:'999',now:()=>1_800_000_000_001,
    readConversation:async()=>{reads++;return Array.from({length:50},(_,i)=>({fromMe:false,key:String(i),ts:1_800_000_000,text:'你好',kind:1}))},
    onRead:()=>{observed++},logger:{warn:msg=>warnings.push(msg)}})
  assert.equal(received.length,50)
  assert.equal(reads,1)
  assert.equal(observed,0,'partial window cannot be acknowledged as fully read')
  assert.match(warnings.join(' '),/未推进游标/)
})

test('DM complete window commits the conversation cursor normally',async()=>{
  const {collectDmInbox}=await import('../lib/dm-inbox.mjs')
  let observed=0
  const rows=await collectDmInbox({sessions:[{uid:'10203',unread:3,lastTs:1_800_000_000}],ownUid:'999',now:()=>1_800_000_000_001,
    readConversation:async()=>Array.from({length:3},(_,i)=>({fromMe:false,key:String(i),ts:1_800_000_000,text:'你好',kind:1})),
    onRead:()=>{observed++}})
  assert.equal(rows.length,3)
  assert.equal(observed,1)
})

test('owner DM parsing failures cannot turn an uncommitted inbox into a successful empty scan',async()=>{
  const {readFileSync}=await import('node:fs')
  const {resolve}=await import('node:path')
  const file=readFileSync(resolve(import.meta.dirname,'../index.js'),'utf8')
  assert.match(file,/主人私信 Agent 基线建立失败，本轮不确认私信游标/)
  assert.match(file,/主人私信 Agent 批量接收失败，本轮不确认私信游标/)
  assert.match(file,/dmPollCursor\.discard\(\)\s*\n\s*throw new Error\('主人私信 Agent/)
  assert.match(file,/dmFetch\(cred, uid, 50,\{readBudget:biliReadBudget\}\)/)
})

test('request diagnostics include privacy-preserving per-kind counts',async()=>{
  const dir=sandbox(),guard=budget(dir)
  guard.acquire('dm-list');guard.acquire('dm-messages');guard.acquire('cover-image')
  const report=guard.status()
  assert.equal(report.byKind.length,3)
  assert.equal(report.byKind.reduce((sum,row)=>sum+row.hour,0),report.hourUsed)
  assert.deepEqual(report.byKind.find(row=>row.kind==='dm-list'),{kind:'dm-list',minute:1,hour:1})
  const {readFileSync}=await import('node:fs')
  const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(ui,/id="polling-budget-by-kind"/)
  assert.match(js,/budget\.byKind/)
  assert.match(js,/minute-budget/)
})

test('HTTP 403 refusal from an auxiliary B站 API enters cooldown, not endless fallbacks',async()=>{
  const dir=sandbox(),guard=budget(dir);fakeCred(dir)
  const original=globalThis.fetch;let calls=0
  globalThis.fetch=async()=>{calls++;return json({code:-403,message:'access refused'},403)}
  try{
    assert.equal(await resolveUid(dir,'访客名称',()=>{},{readBudget:guard}),0)
    assert.equal(calls,1)
    assert.equal(guard.status().reason,'platform-cooldown')
  }finally{globalThis.fetch=original}
})
