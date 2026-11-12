import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
import {createDmPollCursor} from '../lib/dm-poll-cursor.mjs'
import {collectDmInbox} from '../lib/dm-inbox.mjs'
import {listSessions,fetchMsgs} from '../lib/dm.mjs'
const work=()=>mkdtempSync(join(tmpdir(),'dafeiyu-262-'))
const root=resolve(import.meta.dirname,'..')

test('same account read budget limits per-minute calls, survives restart, clears after time',()=>{
  let time=1_800_000_000_000;const dir=work()
  const make=()=>createBiliReadBudget({dataDir:dir,minuteLimit:5,hourLimit:12,now:()=>time,logger:{warn(){}}})
  let q=make()
  for(let i=0;i<5;i++)q.acquire('dm-list')
  assert.equal(q.status().minuteUsed,5)
  assert.throws(()=>q.acquire('dm-conversation'),e=>e instanceof BiliReadDeferredError&&e.reason==='minute-budget')
  q=make();assert.equal(q.status().minuteUsed,5)
  time+=60_001;q.acquire('comment-replies');assert.equal(q.status().minuteUsed,1)
  assert.equal(q.status().hourUsed,6)
  time+=3_600_001;assert.equal(q.status().hourUsed,0)
  const other=createBiliReadBudget({dataDir:work(),minuteLimit:5,hourLimit:12,now:()=>time})
  assert.equal(other.status().hourUsed,0)
})

test('rate-limit/captcha response creates bounded persistent exponential cooldown, never bypasses quota',async()=>{
  let time=1_800_000_000_000;const dir=work(),make=()=>createBiliReadBudget({dataDir:dir,now:()=>time,logger:{warn(){}}})
  const first=make()
  await first.guard('read',async()=>({code:-412,message:'风控'}))
  assert.equal(first.status().blocked,true)
  assert.equal(first.status().reason,'platform-cooldown')
  const next=make();assert.throws(()=>next.acquire('dm'),BiliReadDeferredError)
  time+=60_001
  await assert.rejects(()=>next.guard('read',async()=>{throw Error('HTTP 429 请求过于频繁')}),/429/)
  assert.ok(next.status().retryAt>=time+120_000)
  time+=31*60_000;next.acquire('dm');next.noteSuccess()
  assert.equal(next.status().backoffCount,0)
})

test('budget fails closed on corrupted ledger',()=>{
  const dir=work();writeFileSync(join(dir,'bili-read-budget.json'),'{broken')
  assert.throws(()=>createBiliReadBudget({dataDir:dir}),/账本损坏/)
})

test('DM cursor commits only after successful processing, handles same-session rescan and account isolation',()=>{
  let time=1_800_000_000_000;const dir=work(),row={uid:'10001',unread:1,lastTs:1_800_000_000}
  const cursor=createDmPollCursor({dataDir:dir,now:()=>time})
  assert.equal(cursor.shouldRead(row),true)
  cursor.observed(row);cursor.discard()
  assert.equal(createDmPollCursor({dataDir:dir,now:()=>time}).shouldRead(row),true)
  cursor.observed(row);cursor.commit()
  let next=createDmPollCursor({dataDir:dir,now:()=>time})
  assert.equal(next.shouldRead(row),false)
  assert.equal(next.shouldRead({...row,lastTs:row.lastTs+1}),true)
  assert.equal(next.shouldRead({...row,unread:2}),true)
  time+=3*60_000+1;assert.equal(next.shouldRead(row),true)
  const other=createDmPollCursor({dataDir:work(),now:()=>time})
  assert.equal(other.shouldRead(row),true)
})

test('quiet cursor uses periodic safety rescan and refuses corrupted data',()=>{
  let time=1_800_000_000_000;const dir=work(),row={uid:'10002',unread:0,lastTs:1_800_000_000}
  const cursor=createDmPollCursor({dataDir:dir,now:()=>time});cursor.observed(row);cursor.commit()
  time+=15*60_000;assert.equal(cursor.shouldRead(row),false)
  time+=15*60_000+1;assert.equal(cursor.shouldRead(row),true)
  writeFileSync(join(dir,'dm-poll-cursor.json'),'{broken')
  assert.throws(()=>createDmPollCursor({dataDir:dir}),/游标损坏/)
})

test('collectDmInbox consults cursor before fetching, records only successful reads',async()=>{
  const sessions=[{uid:123,unread:1,lastTs:1_800_000_000},{uid:124,unread:0,lastTs:1_800_000_000}]
  let read=0,observed=[]
  const rows=await collectDmInbox({sessions,ownUid:999,now:()=>1_800_001_000_000,
    shouldRead:s=>Number(s.uid)===123,
    onRead:s=>observed.push(s.uid),
    readConversation:async()=>{read++;return [{fromMe:false,key:'m1',ts:1_800_000_000,text:'新消息',kind:1}]}})
  assert.equal(read,1);assert.deepEqual(observed,[123]);assert.equal(rows.length,1)
  assert.equal(rows[0].text,'新消息')
  let warning=''
  await collectDmInbox({sessions:[sessions[0]],ownUid:999,now:()=>1_800_001_000_000,
    logger:{warn:x=>warning=x},onRead:()=>{throw Error('should not mark failure')},
    readConversation:async()=>{throw Error('network error')}})
  assert.match(warning,/network error/)
})

test('DM HTTP adapter charges each actual request through shared budget; limit never retries',async()=>{
  const original=globalThis.fetch
  let calls=0,time=1_800_000_000_000
  globalThis.fetch=async url=>{
    calls++
    if(String(url).includes('get_sessions'))return new Response(JSON.stringify({code:0,data:{session_list:[]}}),{status:200})
    return new Response(JSON.stringify({code:0,data:{messages:[]}}),{status:200})
  }
  try{
    const budget=createBiliReadBudget({dataDir:work(),minuteLimit:5,now:()=>time})
    const cred={sessdata:'fake',bili_jct:'fake',buvid3:'fake'}
    await listSessions(cred,{readBudget:budget})
    for(let i=0;i<4;i++)await fetchMsgs(cred,123,20,{readBudget:budget})
    assert.equal(calls,5)
    await assert.rejects(()=>fetchMsgs(cred,123,20,{readBudget:budget}),e=>e.name==='BiliReadDeferredError')
    assert.equal(calls,5)
  }finally{globalThis.fetch=original}
})

test('UI retains unique TODO controls in a dedicated plans tab and preserves memory and polling budgets',()=>{
  const html=readFileSync(join(root,'lib/management-console.html'),'utf8')
  const js=readFileSync(join(root,'lib/management-console.js'),'utf8')
  const index=readFileSync(join(root,'index.js'),'utf8')
  assert.doesNotMatch(html,/data-tab="todos"/);assert.match(html,/data-tab="life-agent"/)
  assert.doesNotMatch(html,/<section id="panel-todos"/)
  assert.match(html,/<section id="panel-plans" hidden[\s\S]*?id="life-todo-section"/)
  const life=html.slice(html.indexOf('<section id="panel-life" hidden>'),html.indexOf('<section id="panel-diagnostics" hidden>'))
  assert.ok(life.includes('id="life-todo-section"'))
  for(const id of ['owner-todo-list','owner-todo-next','owner-todo-prev','owner-todo-remind','owner-todo-followup-check','owner-todo-add','settings-todo','main-session-history-query','main-memory-kind','personality-evolution-traits']){
    assert.equal(html.split(`id="${id}"`).length-1,1,`unique ${id}`)
  }
  assert.match(html,/data-memory-kind="interest"/)
  assert.match(js,/if\(tab==='todos'\)tab='plans'/)
  assert.match(js,/document\.querySelectorAll\('\[data-memory-kind\]'\)/)
  assert.match(html,/id="polling-budget-status"/)
  assert.match(js,/scheduler\.readBudget/)
  assert.match(index,/monitoredReadTools\.has\(toolName\)/)
  assert.match(index,/maxSessions: 12/)
})

test('legacy todo-settings bookmark opens dedicated fish plans page, not memory',()=>{
  const js=readFileSync(join(root,'lib/management-console.js'),'utf8')
  assert.match(js,/legacySettingsTarget==='settings-todo'\?'plans':'life'/)
})

test('DM cursor only commits after auto-reply dedupe safely persists and prevents duplicate messages',async()=>{
  const {createDmAutoReply}=await import('../lib/dm-autoreply.mjs')
  let clock=1_800_000_000_000, last=1_800_000_000
  const dir=work(), cursor=createDmPollCursor({dataDir:dir,now:()=>clock})
  const session=()=>({uid:'200',unread:0,lastTs:last})
  const inbox=[]; const sent=[]
  const fetchIncoming=async()=>{
    cursor.discard()
    if(!cursor.shouldRead(session()))return []
    cursor.observed(session())
    return inbox
  }
  const make=()=>createDmAutoReply({dataDir:dir,fetchIncoming,
    send:async value=>{sent.push(value);return {ok:true}},generateReply:async()=> '收到啦',
    onScanSettled:()=>cursor.commit(),selfUid:'999',now:()=>clock,
    getConfig:()=>({enabled:true,strangerEnabled:false,whitelist:['200'],whitelistCooldownSeconds:0}),
    logger:{warn(){},error(){}}})
  const agent=make()
  assert.equal((await agent.poll()).initialized,true)
  assert.equal(cursor.shouldRead(session()),false)
  inbox.push({senderUid:'200',messageId:'m1',text:'你好鱼鱼',timestampMs:clock,incoming:true})
  last++
  assert.equal((await agent.poll()).sent,1)
  assert.equal(sent.length,1)
  assert.equal(cursor.shouldRead(session()),false)
  assert.equal((await make().poll()).sent,0)
  clock+=31*60_000
  assert.equal(cursor.shouldRead(session()),true)
  assert.equal((await make().poll()).sent,0,'safety rescan must not re-send a persisted message')
  assert.equal(sent.length,1)
})

test('DM failed inbox processing never commits cursor; subsequent poll may safely retry',async()=>{
  const {createDmAutoReply}=await import('../lib/dm-autoreply.mjs')
  const dir=work(),cursor=createDmPollCursor({dataDir:dir})
  const session={uid:'222',unread:0,lastTs:1_800_000_000}
  let fail=true
  const agent=createDmAutoReply({dataDir:dir,selfUid:'999',
    fetchIncoming:async()=>{cursor.discard();if(fail){cursor.observed(session);throw Error('HTTP 503')}cursor.observed(session);return []},
    onScanSettled:()=>cursor.commit(),send:async()=>({ok:true}),getConfig:()=>({enabled:true}),
    logger:{warn(){},error(){}}})
  assert.match((await agent.poll()).error,/503/)
  assert.equal(createDmPollCursor({dataDir:dir}).shouldRead(session),true)
  fail=false
  assert.equal((await agent.poll()).initialized,true)
  assert.equal(createDmPollCursor({dataDir:dir}).shouldRead(session),false)
})

test('read budget recognizes explicit MCP error envelope but does not scan ordinary content for quota words',async()=>{
  let clock=1_800_000_000_000
  const bd=createBiliReadBudget({dataDir:work(),now:()=>clock,logger:{warn(){}}})
  await bd.guard('video',async()=>({title:'HTTP 429 is a common API status',code:0}))
  assert.equal(bd.status().blocked,false)
  await bd.guard('video',async()=>({error:'HTTP 412 风控'}))
  assert.equal(bd.status().reason,'platform-cooldown')
  assert.throws(()=>bd.acquire('dm'),BiliReadDeferredError)
})

test('DM cursor refuses poisoned timestamps and cannot silently suppress a conversation',()=>{
  const dir=work();writeFileSync(join(dir,'dm-poll-cursor.json'),JSON.stringify({version:1,people:{'123':{lastTs:1,unread:0,at:'broken'}}}))
  assert.throws(()=>createDmPollCursor({dataDir:dir}),/游标损坏/)
})

test('cursor write failure keeps in-memory scan eligible and does not create a partial ledger',()=>{
  const dir=work(),cursor=createDmPollCursor({dataDir:dir})
  const row={uid:'11223',unread:0,lastTs:1_800_000_000}
  cursor.observed(row)
  mkdirSync(join(dir,`dm-poll-cursor.json.${process.pid}.tmp`))
  assert.throws(()=>cursor.commit(),/EISDIR|directory/i)
  assert.equal(cursor.shouldRead(row),true,'failed commit cannot suppress next retry')
  assert.throws(()=>readFileSync(join(dir,'dm-poll-cursor.json'),'utf8'),/ENOENT/)
})
