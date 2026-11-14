import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialInteractionRhythm} from '../lib/social-interaction-rhythm.mjs'
import {createDmPollCursor} from '../lib/dm-poll-cursor.mjs'

const root=new URL('../',import.meta.url)
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const temp=()=>mkdtempSync(join(tmpdir(),'dev52-'))

test('verified incoming reply bypasses unsolicited cross-channel pause, but not unresolved writes',()=>{
 const dir=temp();let now=Date.now();try{
 const rhythm=createSocialInteractionRhythm({dataDir:dir,getAccountUid:()=> '11111',now:()=>now,crossChannelMinutes:60})
 const dm=rhythm.reserve({uid:'22222',channel:'dm'});assert.equal(dm.ok,true)
 assert.equal(rhythm.settle(dm.id,{outcome:'sent',receiptId:'receipt-100'}).ok,true)
 const unsolicited=rhythm.reserve({uid:'22222',channel:'comment'})
 assert.equal(unsolicited.ok,false);assert.equal(unsolicited.reason,'cross-channel-cooldown')
 assert.ok(unsolicited.retryAt>now)
 const reactive=rhythm.reserve({uid:'22222',channel:'comment',verifiedReply:true})
 assert.equal(reactive.ok,true)
 const unresolved=rhythm.reserve({uid:'22222',channel:'at',verifiedReply:true})
 assert.equal(unresolved.reason,'prior-outcome-unresolved')
 assert.equal(rhythm.settle(reactive.id,{outcome:'uncertain'}).ok,true)
 assert.equal(rhythm.reserve({uid:'22222',channel:'comment',verifiedReply:true}).ok,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('DM detail cursor prioritizes owner, friend, familiar, others without extra list requests',()=>{
 const dir=temp();let now=Date.now();const tiers={'1':'owner','2':'friend','3':'familiar','4':'other'};try{
 const cursor=createDmPollCursor({dataDir:dir,now:()=>now,getPriority:id=>tiers[id]})
 for(const n of [1,2,3,4]){const row={uid:String(n),lastTs:55,unread:0};assert.equal(cursor.shouldRead(row),true);cursor.observed(row)}
 cursor.commit()
 now+=6*60_000
 for(const n of [1,2,3,4])assert.equal(cursor.shouldRead({uid:String(n),lastTs:55,unread:0}),n===1)
 now+=16*60_000
 assert.equal(cursor.shouldRead({uid:'2',lastTs:55,unread:0}),true)
 assert.equal(cursor.shouldRead({uid:'3',lastTs:55,unread:0}),false)
 // A new incoming message is checked immediately for every relationship tier.
 assert.equal(cursor.shouldRead({uid:'4',lastTs:56,unread:1}),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('Life UI removes obsolete provenance atlas and keeps memory near the top',()=>{
 const html=read('lib/management-console.html'),js=read('lib/management-console.js')
 assert.match(html,/此刻还记得的事/)
 assert.doesNotMatch(html,/id="life-evidence-atlas"|鱼鱼的生活脉络/)
 assert.doesNotMatch(js,/renderLifeEvidenceAtlas/)
 assert.match(html,/id="life-timeline-list"/)
})
test('project homepage is user-facing and dev updates are not prepended',()=>{
 const doc=read('README.md'),policy=read('AGENTS.md')
 assert.match(doc,/大肥鱼 · DSH 生活系统/)
 assert.match(doc,/2\.8\.0/)
 assert.match(doc,/神经回忆场/)
 assert.doesNotMatch(doc,/生活脉络/)
 assert.match(policy,/README 是用户首页，不是开发版本日志/)
 assert.ok(doc.length<10000,`README is ${doc.length} chars`)
 assert.doesNotMatch(doc.slice(0,300),/历史开发预览/)
})
