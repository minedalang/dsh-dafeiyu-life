import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const t0=1_800_000_000_000
const incoming=id=>({senderUid:'200',messageId:'200:'+id,timestampMs:t0,text:'内容',incoming:true})
const snapshot=id=>({fromMe:false,key:id,ts:t0/1000,text:'内容',kind:1})
const scope=async fn=>{const dir=mkdtempSync(join(tmpdir(),'rc281-dm-read-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('several delayed Life messages from one contact reuse one authenticated snapshot per scan',()=>scope(async dir=>{
 let time=t0, rows=[], calls=0
 const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>time,
   getConfig:()=>({enabled:true,whitelist:['200'],whitelistCooldownSeconds:0}),
   fetchIncoming:async()=>rows,
   fetchContactSnapshot:async()=>{calls++;return [snapshot('a'),snapshot('b')]},
   generateReply:async()=>{throw Error('life-choice-queue-timeout')},
   send:async()=>{throw Error('must not send')},logger:{warn(){},error(){}}})
 await engine.poll() // one-time baseline
 rows=[incoming('a'),incoming('b')]
 assert.equal((await engine.poll()).failed,1)
 time+=91_000;rows=[]
 assert.equal((await engine.poll()).failed,1)
 assert.equal(calls,1,'two due messages from same user must share one snapshot')
}))

test('old technical retries do not refresh the fast lane as if a new message arrived',()=>scope(async dir=>{
 let time=t0,rows=[]
 const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>time,
   getConfig:()=>({enabled:true,whitelist:['200'],whitelistCooldownSeconds:0,dmActivePollSeconds:10,dmActiveWindowSeconds:180}),
   fetchIncoming:async()=>rows,
   fetchContactSnapshot:async()=>[snapshot('a')],
   generateReply:async()=>{throw Error('life-choice-queue-timeout')},
   send:async()=>{throw Error('must not send')},logger:{warn(){},error(){}}})
 await engine.poll();rows=[incoming('a')];await engine.poll();rows=[]
 assert.equal(engine.nextFastUid(),'') // just marked active; 10s gap
 time+=91_000
 await engine.poll() // old message from same contact is re-verified and deferred again
 time+=95_000
 assert.equal(engine.nextFastUid(),'','old retry must not extend 180s active window indefinitely')
}))

test('visual permissions have independent, affirmative, mirrored toggles, no double save in video form',()=>{
 const html=source('lib/management-console.html'),js=source('lib/management-console.js')
 for(const id of ['models-vision-enabled','bili-video-vision-enabled','models-incoming-image-enabled','bili-disable-incoming-vision'])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
 assert.match(html,/自主发表原创评论/)
 assert.doesNotMatch(html,/禁止自主发表原创评论|禁用评论和私信图片理解/)
 assert.match(js,/pairedVisionToggles/)
 assert.match(js,/request\('\/config',\{\[item\.key\]:value\}\)/)
 assert.match(js,/\$\('bili-disable-incoming-vision'\)\.checked=c\.incomingImageRecognitionEnabled===true/)
 assert.doesNotMatch(js,/\['bili-disable-incoming-vision','incomingImageRecognitionEnabled'\]/)
 const htmlModels=html.indexOf('id="models-vision-enabled"'),bili=html.indexOf('id="bili-video-vision-enabled"')
 assert.ok(htmlModels>=0&&bili>htmlModels)
})

test('native DSH settings have header actions separate from full-width capability panels',()=>{
 const s=source('client.js')
 assert.match(s,/data-bd-header-actions/)
 assert.match(s,/data-bd-header-copy/)
 assert.match(s,/data-bd-feature-panel':'release'/)
 assert.match(s,/data-bd-feature-panel':'core'/)
})

test('a busy Life admission blocks only redundant delayed-message rereads, not normal inbox discovery',()=>{
 const sourceText=source('index.js')
 const start=sourceText.indexOf('getRecoveryReadGate:()=>{')
 const end=sourceText.indexOf('fetchApprovalHistory:',start)
 const segment=sourceText.slice(start,end)
 assert.match(segment,/lifeWillingness\?\.inspectSocialReadiness\(\{kind:'dm_reply'\}\)/)
 assert.match(segment,/network\.allowed===true&&life\?\.ok===true/)
 assert.doesNotMatch(segment,/life\.notBefore/)
 assert.match(sourceText,/const sessions = fastUid\?\[\]:await dmList\(cred,\{readBudget:biliReadBudget\}\)/)
})
