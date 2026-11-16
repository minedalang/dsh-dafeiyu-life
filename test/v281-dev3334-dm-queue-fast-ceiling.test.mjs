import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmDetailQueue} from '../lib/dm-detail-queue.mjs'
import {collectDmInbox} from '../lib/dm-inbox.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
const stamp=1800000000000
const sessions=Array.from({length:7},(_,i)=>({uid:String(2000+i),unread:1,lastTs:stamp}))
async function scope(fn){const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-queue-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const msg=[{key:'id-1',ts:stamp,kind:1,text:'测试消息',fromMe:false}]
test('normal DM scan persists overflow, serially fetches only three, then resumes across restarts',async()=>await scope(async dir=>{
 let queue=createDmDetailQueue({dataDir:dir,now:()=>stamp}),t=0,calls=[],waits=[]
 const fetch=async id=>{t++;calls.push(id);return msg}
 const read=()=>collectDmInbox({sessions,ownUid:'999',maxSessions:3,detailQueue:queue,
   readConversation:fetch,spacingMs:1500,wait:async ms=>{waits.push(ms)},now:()=>stamp,logger:{warn(){}}})
 assert.equal((await read()).length,3);assert.deepEqual(calls,['2000','2001','2002']);assert.deepEqual(waits,[1500,1500]);assert.equal(queue.status().pending,4)
 assert.equal(existsSync(join(dir,'dm-detail-queue.json')),true)
 const disk=readFileSync(join(dir,'dm-detail-queue.json'),'utf8')
 assert.equal(disk.includes('测试消息'),false)
 queue=createDmDetailQueue({dataDir:dir,now:()=>stamp+1000})
 await read();assert.deepEqual(calls.slice(3),['2003','2004','2005']);assert.equal(queue.status().pending,4) // prior 2000..2 are eligible again in this synthetic test
 // Real cursor shouldRead suppresses already consumed sessions, so overflow drains.
}))
test('normal cursor prevents prior completed conversations from re-entering the queue',async()=>await scope(async dir=>{
 const queue=createDmDetailQueue({dataDir:dir,now:()=>stamp});const observed=new Set(),calls=[]
 const read=()=>collectDmInbox({sessions,ownUid:'999',maxSessions:3,detailQueue:queue,
   shouldRead:s=>!observed.has(s.uid),onRead:s=>observed.add(s.uid),readConversation:async uid=>{calls.push(uid);return msg},
   spacingMs:1500,wait:async()=>{},now:()=>stamp,logger:{warn(){}}})
 await read();await read();await read()
 assert.deepEqual(calls,sessions.map(s=>s.uid));assert.equal(queue.status().pending,0)
}))
test('one failed contact rotates behind others without dropping it',async()=>await scope(async dir=>{
 const queue=createDmDetailQueue({dataDir:dir,now:()=>stamp}),calls=[]
 await collectDmInbox({sessions:sessions.slice(0,4),ownUid:'999',maxSessions:3,detailQueue:queue,
   readConversation:async uid=>{calls.push(uid);if(uid==='2000')throw Error('ECONNRESET');return msg},
   wait:async()=>{},logger:{warn(){}}})
 assert.deepEqual(calls,['2000','2001','2002'])
 assert.equal(queue.status().pending,2)
 let queue2=createDmDetailQueue({dataDir:dir})
 assert.deepEqual(queue2.select(sessions,2).map(s=>s.uid),['2003','2000'])
}))
test('platform -509 fails closed, keeps pending queue intact',async()=>await scope(async dir=>{
 const queue=createDmDetailQueue({dataDir:dir})
 await assert.rejects(collectDmInbox({sessions:sessions.slice(0,4),ownUid:'999',maxSessions:3,detailQueue:queue,
   readConversation:async()=>{throw Error('HTTP 200 code=-509')},wait:async()=>{},logger:{warn(){}}}),/-509/)
 assert.equal(createDmDetailQueue({dataDir:dir}).status().pending,4)
}))
test('base interval 20s is capped at 60s and default 10s at 30s',async()=>await scope(async dataDir=>{
 let time=stamp;const cfg={enabled:true,whitelist:['2000'],dmActivePollSeconds:20,dmActiveWindowSeconds:600}
 const raw=[{senderUid:'2000',messageId:'2000:1',timestampMs:stamp,text:'hi',incoming:true}]
 const engine=createDmAutoReply({dataDir,selfUid:'999',getConfig:()=>cfg,now:()=>time,
   fetchIncoming:async()=>raw,send:async()=>({ok:true,receiptId:'confirmed'}),generateReply:async()=>({action:'skip',messages:[]}),logger:{warn(){}}})
 await engine.poll();raw.push({senderUid:'2000',messageId:'2000:2',timestampMs:stamp+1,text:'new',incoming:true})
 await engine.poll();assert.equal(engine.status().fast.nextIntervalSeconds,20)
 for(const expected of [40,60,60]){
   time+=engine.status().fast.nextIntervalSeconds*1000
   const next=engine.nextFastUid();assert.equal(next,'2000')
   await engine.poll({fastUid:next})
   assert.equal(engine.status().fast.nextIntervalSeconds,expected)
 }
 cfg.dmActivePollSeconds=10;assert.equal(engine.status().fast.nextIntervalSeconds,30)
}))
