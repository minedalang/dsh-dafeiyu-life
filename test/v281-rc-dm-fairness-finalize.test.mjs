import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmDetailSingleflight} from '../lib/dm-detail-singleflight.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
const TAG='a'.repeat(16), OTHER='b'.repeat(16)
const t0=1_800_000_000_000
const dirOf=t=>{const dir=mkdtempSync(join(tmpdir(),'dsh-rc281-fairness-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}
const video=n=>({sourceKey:'video:dm-window-'+n,scene:'video',candidates:[{id:'video_candidate',kind:'video_like',label:'真实视频'}]})

test('soft DM decision window delays NEW non-DM Life choices, never grants platform authority',async t=>{
 const dir=dirOf(t),clock={value:Date.now()}
 const life=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,getContext:()=>({}),enabled:()=>true,
  now:()=>clock.value,invokeModel:async()=>JSON.stringify({action:'act',candidateId:'video_candidate',reason:'真实内容'})})
 const hint=life.holdIncomingDmDecision({maxMs:25_000})
 assert.equal(hint.ok,true)
 assert.equal(life.inspectSocialReadiness({kind:'dm_reply'}).ok,true,'priority is not a durable claim')
 const denied=await life.decide(video('blocked'))
 assert.equal(denied.reason,'life-dm-readiness-window')
 assert.equal(denied.proof,null)
 const sealed=await life.adoptSocialDecisionQueued({kind:'dm_reply',uid:'221',sourceKey:'dm:221:a',messages:['你好']})
 assert.equal(sealed.ok,true,'a REAL Life DM seal is still required')
 assert.equal(life.receipt(sealed.proof,{status:'not-sent'}).ok,true)
 hint.release();hint.release()
 const allowed=await life.decide(video('after-release'))
 assert.equal(allowed.ok,true)
 assert.equal(life.receipt(allowed.proof,{status:'not-sent'}).ok,true)
})

test('DM preference expires without freezing other Life tasks or touching unknown approvals',async t=>{
 const dir=dirOf(t),clock={value:Date.now()}
 const life=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,getContext:()=>({}),enabled:()=>true,
  now:()=>clock.value,invokeModel:async()=>JSON.stringify({action:'act',candidateId:'video_candidate',reason:'真实内容'})})
 const hint=life.holdIncomingDmDecision({maxMs:1000})
 assert.equal((await life.decide(video('before-expiry'))).reason,'life-dm-readiness-window')
 clock.value+=1001
 const result=await life.decide(video('after-expiry'))
 assert.equal(result.ok,true)
 life.receipt(result.proof,{status:'not-sent'})
 hint.release()
})

test('in-flight DM detail reads coalesce only for same account/contact and are NOT cached after completion',async()=>{
 let tag=TAG,calls=0
 const single=createDmDetailSingleflight({getAccountTag:()=>tag})
 let done
 const blocker=new Promise(r=>{done=r})
 const fn=()=>{calls++;return blocker}
 const a=single.read({uid:'221'},fn),b=single.read({uid:'221'},fn)
 assert.equal(a,b)
 await Promise.resolve();assert.equal(calls,1)
 done([{id:'one'}]);assert.equal((await a)[0].id,'one');assert.equal((await b)[0].id,'one')
 assert.equal(single.status().inflight,0)
 await single.read({uid:'221'},async()=>{calls++;return [{id:'two'}]})
 assert.equal(calls,2,'next read is fresh: safe pre-send recheck')
 const p=single.read({uid:'221'},async()=>{calls++;return []})
 tag=OTHER
 await assert.rejects(p,/account changed/)
 await single.read({uid:'221'},async()=>{calls++;return []})
 assert.equal(calls,4,'account switched: no cross-account reuse')
})

test('queue capacity rejections before model start never exhaust the twelve attempted Life decisions',async t=>{
 const dir=dirOf(t)
 let at=t0,rows=[]
 const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>at,
  getConfig:()=>({enabled:true,whitelist:['221'],whitelistCooldownSeconds:0,dmActivePollSeconds:10}),
  fetchIncoming:async()=>rows,
  fetchContactSnapshot:async()=>[{key:'a',ts:t0/1000,fromMe:false,kind:1,text:'问题'}],
  generateReply:async()=>{const e=new Error('resource busy');e.code='life-resource-wait-timeout';e.workNotStarted=true;throw e},
  send:async()=>{throw Error('should never send')},logger:{warn(){},error(){}}})
 await engine.poll() // only baseline, not an actual reply
 rows=[{senderUid:'221',messageId:'221:a',timestampMs:t0,text:'问题',incoming:true}]
 await engine.poll();rows=[]
 for(let i=0;i<14;i++){at+=91_000;await engine.poll()}
 const book=JSON.parse(readFileSync(join(dir,'dm-life-inbox.json'),'utf8'))
 assert.equal(book.rows.length,1)
 assert.equal(book.rows[0].attempts,0,'no provider invocation means no consumed model attempt')
 assert.equal(book.rows[0].status,'technical-deferred')
 assert.equal(engine.status().lifeQueue.reviewRequired,0)
 const state=JSON.parse(readFileSync(join(dir,'dm-autoreply-state.json'),'utf8'))
 assert.equal(state.people['221'].lastInboundOutcome.status,'model-capacity-deferred')
 assert.equal(state.people['221'].lastInboundOutcome.reason,'model-capacity-busy')
})

test('Life chose a reply but a pre-send Bilibili read failed: classified as technical, never delivered',async t=>{
 const dir=dirOf(t)
 let at=t0,rows=[],sends=0
 const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>at,
  getConfig:()=>({enabled:true,whitelist:['221'],whitelistCooldownSeconds:0}),
  fetchIncoming:async options=>{if(options?.probeOnly)throw Error('simulated platform read -509');return rows},
  generateReply:async()=>({action:'reply',messages:['可以回复你'] ,topicState:'open'}),
  send:async()=>{sends++;return {ok:true,receiptId:'should-not-occur'}},logger:{warn(){},error(){}}})
 await engine.poll()
 rows=[{senderUid:'221',messageId:'221:a',timestampMs:t0,text:'问题',incoming:true}]
 const result=await engine.poll()
 assert.equal(result.sent,0);assert.equal(sends,0)
 const state=JSON.parse(readFileSync(join(dir,'dm-autoreply-state.json'),'utf8'))
 assert.equal(state.people['221'].lastInboundOutcome.status,'pre-send-read-blocked')
 assert.equal(state.people['221'].lastInboundOutcome.reason,'platform-verification-unavailable')
 assert.equal(state.people['221'].seen.includes('221:a'),false)
 const inbox=JSON.parse(readFileSync(join(dir,'dm-life-inbox.json'),'utf8'))
 assert.equal(inbox.rows[0].status,'technical-deferred')
 assert.equal(inbox.rows[0].status==='send-unknown',false)
})

test('actual production DM paths use account-scoped in-flight-only read coalescing',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/createDmDetailSingleflight\(\{getAccountTag:/)
 assert.match(source,/const readDmDetail=\(cred,uid,limit=50\)=>dmDetailSingleflight\.read/)
 assert.match(source,/if\(probeOnly\)/)
 assert.match(source,/const messages=await readDmDetail\(cred,target,50\)/)
 assert.match(source,/const remote=await readDmDetail\(cred,target,50\)/)
 assert.match(source,/readConversation:\s*\(uid\)\s*=>\s*\{accountBinding\.assertReady\(\);return readDmDetail\(cred,uid,50\)/)
})

test('soft DM preference never overrides an already-approved video proof or human review fence',async t=>{
 const dir=dirOf(t),clock={value:Date.now()}
 const life=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,getContext:()=>({}),enabled:()=>true,
  now:()=>clock.value,invokeModel:async()=>JSON.stringify({action:'act',candidateId:'video_candidate',reason:'视频已验证'})})
 const videoProof=await life.decide(video('approved'))
 assert.equal(videoProof.ok,true)
 const hint=life.holdIncomingDmDecision({maxMs:45_000})
 assert.equal(hint.ok,false)
 assert.equal(life.inspectSocialReadiness().ok,false)
 const path=join(dir,'life-willingness-admission.json')
 assert.equal(JSON.parse(readFileSync(path,'utf8')).version,1)
 life.receipt(videoProof.proof,{status:'not-sent'})
 assert.equal(life.inspectSocialReadiness().ok,true)
})
