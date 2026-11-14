import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveExistingDmContact} from '../lib/manual-dm-contact.mjs'
import {readOwnedVideoLedgerForComment,explainCommentSelection} from '../lib/video-owned-ledger.mjs'
import {apply} from './helpers/ready-host.mjs'

const OWNER='12345',USER='3567890',NAME='入站联系人甲',BV='BV1xTxh6FEtJ',ROUND='b'.repeat(24)
const mk=fn=>{const d=mkdtempSync(join(tmpdir(),'dev65-'));try{return fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
function fixture(dir,edit=()=>{}){
 const people={[USER]:{nickname:NAME,seen:['verified-inbound-message-id'],history:[{role:'user',text:'private message must never be returned',at:1794315585000}],lastRepliedAt:0,stranger:null}}
 edit(people)
 writeFileSync(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,people,sentAt:[]}),'utf8')
 return {runtimeDir:dir,accountUid:OWNER,receiverName:NAME}
}
test('known inbound name resolves to the correct UID without returning private content or changing whitelist',()=>mk(dir=>{
 const args=fixture(dir)
 const result=resolveExistingDmContact(args)
 assert.equal(result.ok,true);assert.equal(result.uid,USER)
 assert.equal(result.sourceMessageId,'verified-inbound-message-id')
 assert.doesNotMatch(JSON.stringify(result),/private message/)
}))
test('unknown, ambiguous, opted-out or already replied contact never gets a manual reply proof',()=>mk(dir=>{
 const args=fixture(dir)
 assert.equal(resolveExistingDmContact({...args,receiverName:'陌生人'}).ok,false)
 assert.equal(resolveExistingDmContact({...args,receiverUid:'9999'}).ok,false)
 fixture(dir,p=>{p['88888']={...p[USER]}})
 assert.equal(resolveExistingDmContact(args).reason,'recipient-name-ambiguous')
 fixture(dir,p=>{p[USER].dmContactBoundaries={[OWNER]:{status:'stop'}}})
 assert.equal(resolveExistingDmContact(args).reason,'recipient-requested-no-contact')
 fixture(dir,p=>{p[USER].lastRepliedAt=1794315585001})
 assert.equal(resolveExistingDmContact(args).reason,'incoming-already-replied')
}))
test('asynchronous ledger check retries ONE transient local-only busy read, not network or AI',async()=>{
 const successes={ok:true,rows:[{bvid:BV,picked:true,roundId:ROUND}]}
 let calls=0
 const runner=async()=>{calls++;return {stdout:JSON.stringify(calls===1?{ok:false,code:'selection-ledger-busy',rows:[]}:successes)}}
 const r=await readOwnedVideoLedgerForComment({home:'/safe/data',uid:OWNER,runner})
 assert.equal(r.ok,true);assert.equal(r.attempts,2);assert.equal(calls,2)
 assert.equal(explainCommentSelection(r,BV,ROUND).ok,true);assert.equal(explainCommentSelection(r,BV,ROUND).recovered,false)
})
test('missing ledger fails closed without retry; timeout retry is bounded at 2',async()=>{
 let calls=0
 const missing=await readOwnedVideoLedgerForComment({home:'/safe',uid:OWNER,runner:async()=>{calls++;return {stdout:JSON.stringify({ok:false,code:'selection-ledger-missing',rows:[]})}}})
 assert.equal(missing.ok,false);assert.equal(calls,1)
 assert.equal(explainCommentSelection(missing,BV,ROUND).ok,false)
 calls=0
 const timeout=await readOwnedVideoLedgerForComment({home:'/safe',uid:OWNER,runner:async()=>{calls++;throw Object.assign(new Error('simulated'),{killed:true})}})
 assert.equal(timeout.ok,false);assert.equal(timeout.code,'selection-reader-timeout');assert.equal(calls,2)
})
test('main Session new reply tool is separate from ordinary whitelist-only manual DM tool',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dev65-host-'));try{
 const duty=join(home,'bili-duty');mkdirSync(duty,{recursive:true})
 writeFileSync(join(duty,'bili_credential.json'),JSON.stringify({dedeuserid:OWNER}))
 const registered=[]
 const ctx={get(key){return key==='dshHomePath'?(...parts)=>join(home,...parts):undefined},
  logger:{info(){},warn(){}},tools:{register(spec){registered.push(spec);return spec}},
  webServer:{register(){return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}},slots:{inject(){},register(){}}}
 apply(ctx,{})
 const by=Object.fromEntries(registered.map(t=>[t.name,t]))
 assert.ok(by.bili_dm_contact_lookup);assert.ok(by.bili_reply_existing_dm_manual)
 assert.ok(by.bili_send_message_manual)
 const old=await by.bili_send_message_manual.execute({receiver_uid:Number(USER),text:'请好',confirm:true})
 assert.equal(old.ok,false);assert.match(old.error,/白名单/)
 // Without an authenticated inbound record, the exceptional owner path stays shut.
 const missing=await by.bili_reply_existing_dm_manual.execute({receiver_name:NAME,receiver_uid:USER,text:'请好',confirm:true})
 assert.equal(missing.ok,false);assert.equal(missing.blocked,true)
 const noConfirm=await by.bili_reply_existing_dm_manual.execute({receiver_name:NAME,text:'请好'})
 assert.equal(noConfirm.needsConfirmation,true)
 assert.match(readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8'),/BILI_SESSION_MANUAL_EXISTING_DM_REPLY_ENABLED/)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('real subprocess reads three account-bound picks in the same round, no model or send needed',async()=>{
 const {execFileSync}=await import('node:child_process')
 const dir=mkdtempSync(join(tmpdir(),'dev65-ledger-'))
 try{
  const script=`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE selected_videos(account TEXT,bvid TEXT,day TEXT,round_id TEXT,status TEXT,recorded_at_ms INTEGER)');c.execute('CREATE TABLE seen_observations(account TEXT,bvid TEXT,day TEXT,title TEXT,up TEXT,status TEXT,recorded_at_ms INTEGER)');c.execute('CREATE TABLE comment_receipts(account TEXT,bvid TEXT,rpid TEXT,day TEXT)');\nfor i,bv in enumerate(['BV1xTxh6FEtJ','BV1Q3W76wExW','BV1edWM63Ewd']):c.execute('INSERT INTO selected_videos VALUES(?,?,?,?,?,?)',('12345',bv,'2026-11-11','${ROUND}','挑中',1794370100000+i*1000));\nc.commit();c.close()`
  execFileSync('python',['-c',script,join(dir,'video-actions.sqlite3')])
  const result=await readOwnedVideoLedgerForComment({home:dir,uid:OWNER})
  assert.equal(result.ok,true);assert.equal(result.attempts,1)
  for(const bv of ['BV1xTxh6FEtJ','BV1Q3W76wExW','BV1edWM63Ewd'])assert.equal(explainCommentSelection(result,bv,ROUND).ok,true)
  const foreign=await readOwnedVideoLedgerForComment({home:dir,uid:'99999'})
  assert.equal(foreign.ok,true);assert.equal(foreign.rows.length,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('Life video approval gateway awaits async receipt check and fails closed before model on unavailable ledger',async t=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 let llm=0,checks=0
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>OWNER,getAccountTag:()=> 'f'.repeat(16),
   choose:async()=>{llm++;return {ok:false,action:'skip'}},verify:()=>({ok:false}),receipt:()=>{},
   onCommentReview:async()=>{checks++;await new Promise(r=>setTimeout(r,20));return {ok:false,reason:'comment-selection-ledger-unavailable'}}})
 t.after(()=>bridge.stop())
 await bridge.start()
 const env=bridge.env()
 const r=await fetch(env.BILI_LIFE_ACTION_URL+'/life-comment-review',{method:'POST',
   headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
   body:JSON.stringify({uid:OWNER,roundId:ROUND,bvid:BV,decision:'consider',draft:'',
      evidence:'经过真实读取的视频内容证据：当前这条视频由专业 Agent 阅读了详情和字幕，向 Life 提供材料。'})})
 assert.equal(r.status,409)
 assert.equal((await r.json()).reason,'comment-selection-ledger-unavailable')
 assert.equal(checks,1);assert.equal(llm,0)
})
