import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
import {listSessions,fetchMsgs} from '../lib/dm.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {OWNER_CONTACT_PRESETS,ownerContactPolicy,checkOwnerContact} from '../lib/owner-contact-policy.mjs'
import {classifyReadFailure} from '../lib/read-action-diagnostics.mjs'
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}})
const cred={sessdata:'fake',bili_jct:'fake',buvid3:'fake'}
const tmp=()=>mkdtempSync(join(tmpdir(),'dsh45-'))
const t=new Date(2026,10,9,12).getTime()
const makeBudget=(dir,now=()=>t)=>createBiliReadBudget({dataDir:dir,now,logger:{warn(){}}})
test('HTTP 200 -509 on DM session list enters the shared persisted read budget and prevents later requests',async()=>{
 const dir=tmp(),old=globalThis.fetch
 let count=0
 globalThis.fetch=async()=>{count++;return json({code:-509,message:'请求过于频繁'})}
 try{
  const budget=makeBudget(dir)
  await assert.rejects(()=>listSessions(cred,{readBudget:budget}),/code=-509/)
  assert.equal(count,1,'HTTP 200 application-level limit must not retry')
  assert.equal(budget.status().reason,'platform-cooldown')
  assert.equal(budget.status().byKind.find(x=>x.kind==='dm-list')?.hour,1)
  assert.throws(()=>makeBudget(dir).acquire('cover-metadata'),BiliReadDeferredError)
  await assert.rejects(()=>fetchMsgs(cred,123,20,{readBudget:makeBudget(dir)}),BiliReadDeferredError)
  assert.equal(count,1,'shared budget prevents DM details and auxiliary B站 reads')
  assert.equal(classifyReadFailure({code:-509,message:'请求过于频繁'}).code,'platform-rate-limit')
 }finally{globalThis.fetch=old;rmSync(dir,{recursive:true,force:true})}
})
test('a -509 reply on DM message-detail endpoint is also classified and persisted',async()=>{
 const dir=tmp(),old=globalThis.fetch;let count=0
 globalThis.fetch=async()=>{count++;return json({code:-509,message:'请求过于频繁'})}
 try{
  await assert.rejects(()=>fetchMsgs(cred,123,20,{readBudget:makeBudget(dir)}),/code=-509/)
  assert.equal(makeBudget(dir).status().byKind.find(x=>x.kind==='dm-messages')?.hour,1)
  assert.equal(makeBudget(dir).status().blocked,true)
  assert.equal(count,1)
 }finally{globalThis.fetch=old;rmSync(dir,{recursive:true,force:true})}
})
test('shared budget cooldown prevents scheduler from starting another DM poll and reports next eligible time',async()=>{
 const dir=tmp();let now=t,calls=0
 try{
  const budget=makeBudget(dir,()=>now)
  budget.noteError(new Error('HTTP 200 code=-509'))
  const scheduler=createInteractionScheduler({dataDir:dir,now:()=>now,
    getAccountTag:()=> '1234567890abcdef',readBudget:budget,getConfig:()=>({masterEnabled:true,dmWatch:true,dmWatchMinutes:1}),
    dm:{poll:async()=>{calls++;return {sent:0}}},comments:{poll:async()=>({sent:0})}})
  await scheduler.tick() // stopped -> no op
  scheduler.start()
  await scheduler.tick()
  assert.equal(calls,0)
  assert.equal(scheduler.status().checks.dm.nextAt,budget.status().retryAt)
  now+=61_000;await scheduler.tick();assert.equal(calls,1)
  scheduler.stop()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('scheduler reports observed DM-list/detail requests instead of only the check interval',async()=>{
 const dir=tmp(),old=globalThis.fetch;let now=t
 globalThis.fetch=async url=>String(url).includes('get_sessions')?json({code:0,data:{session_list:[]}}):json({code:0,data:{messages:[]}})
 try{
  const budget=makeBudget(dir,()=>now)
  const scheduler=createInteractionScheduler({dataDir:dir,readBudget:budget,now:()=>now,
    getAccountTag:()=> '1234567890abcdef',getConfig:()=>({masterEnabled:true,dmWatch:true,dmWatchMinutes:1}),
    dm:{poll:async()=>{await listSessions(cred,{readBudget:budget});await fetchMsgs(cred,123,10,{readBudget:budget});return {sent:0}}},
    comments:{poll:async()=>({sent:0})}})
  scheduler.start();
  for(let wait=0;wait<30&&!scheduler.status().checks.dm.lastHttpRequests;wait++)
    await new Promise(resolve=>setTimeout(resolve,10))
  const row=scheduler.status().checks.dm.lastHttpRequests
  assert.deepEqual(row,{estimatedTotal:2,dmList:1,dmMessages:1})
  scheduler.stop()
 }finally{globalThis.fetch=old;rmSync(dir,{recursive:true,force:true})}
})
test('preset cards match 8/4/2h cooldown and silence means minimum time before considering a new contact',()=>{
 assert.equal(OWNER_CONTACT_PRESETS.quiet.cooldownMinutes,480)
 assert.equal(OWNER_CONTACT_PRESETS.natural.cooldownMinutes,240)
 assert.equal(OWNER_CONTACT_PRESETS.lively.cooldownMinutes,120)
 assert.deepEqual(ownerContactPolicy({}).preset,'natural')
 assert.equal(OWNER_CONTACT_PRESETS.quiet.silenceMinutes,120)
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'natural'},now:t,attempts:[{at:t-60_000}]}).reason,'cooldown')
})
test('new-install owner contact default on, explicit old-user off preserved; child controls disabled when parent off',()=>{
 const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(src,/ownerSpontaneousChatEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(src,/mainSessionSilenceFollowupEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(src,/ownerDmSilenceFollowupEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(src,/ownerSpontaneousChatEnabled:true, ownerContactPreset:'natural'/)
 assert.match(src,/if \('ownerSpontaneousChatEnabled' in p\) p\.ownerSpontaneousChatEnabled = p\.ownerSpontaneousChatEnabled === true/)
 for(const id of ['owner-spontaneous-chat-enabled','main-session-silence-enabled','owner-dm-silence-enabled'])
   assert.match(html,new RegExp('id="'+id+'" type="checkbox" checked'))
 assert.match(html,/id="owner-contact-options"/)
 assert.match(ui,/\$\('owner-contact-options'\)\.disabled=!enabled/)
 assert.match(ui,/contactConfig\.ownerSpontaneousChatEnabled!==false/)
 assert.match(html,/沉默 120 分钟/)
 assert.match(html,/同一轮连续发 1～3 条/)
})

test('unchanged conversations do not require fetching every user to detect new DMs',async()=>{
 const {collectDmInbox}=await import('../lib/dm-inbox.mjs')
 const sessions=Array.from({length:250},(_,i)=>({uid:200+i,unread:0,lastTs:Math.floor(t/1000)-86400}))
 let detail=0
 const rows=await collectDmInbox({sessions,ownUid:100,now:()=>t,
   shouldRead:()=>false,readConversation:async()=>{detail++;return []},logger:{warn(){}}})
 assert.equal(rows.length,0)
 assert.equal(detail,0,'an unchanged session must not require a per-user fetch')
 // A changed session alone gets its bounded detail read.
 sessions[4].lastTs=Math.floor(t/1000)
 const seen=await collectDmInbox({sessions,ownUid:100,now:()=>t,
   shouldRead:s=>s.uid===204,readConversation:async()=>{detail++;return []},logger:{warn(){}}})
 assert.equal(seen.length,0);assert.equal(detail,1)
})

test('initial inbox scan bounds detail reads even when 250 sessions have unread messages',async()=>{
 const {collectDmInbox}=await import('../lib/dm-inbox.mjs')
 const sessions=Array.from({length:250},(_,i)=>({uid:200+i,unread:1,lastTs:Math.floor(t/1000)}))
 let detail=0
 await collectDmInbox({sessions,ownUid:100,maxSessions:12,now:()=>t,
   readConversation:async()=>{detail++;return []},logger:{warn(){}}})
 assert.equal(detail,12)
})
