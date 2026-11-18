import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs';
import {createNetworkPollBackoff} from '../lib/network-poll-backoff.mjs';

const settle=()=>new Promise(r=>setTimeout(r,15));
test('neural graph is masked without ready local embedding; ordinary memory search remains available',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(html,/id="neural-embedding-mask"/);
 assert.match(html,/neural-embedding-mask\[hidden\]\{display:none/);
 assert.match(js,/syncNeuralEmbeddingMask\(localEmbeddingEnabled/);
 assert.match(js,/syncNeuralEmbeddingMask\(false,'已安装的本地模型暂时无法执行语义搜索/);
 assert.match(html,/id="main-session-history-query"/);
 assert.match(js,/\$\('neural-search-input'\)\.disabled=ready!==true/);
});
test('notification sentinels replace idle full-list polling; Life technical continuation stays targeted',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-neural-sentinel-'));let at=1_800_000_000_000,full=0,continuation=0,continuationDue=false
 const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=> 'aaaaaaaaaaaaaaaa',now:()=>at,
  getConfig:()=>({masterEnabled:true,dmWatch:true,dmActivePollEnabled:false,commentWatchReplies:false,commentAtEnabled:false}),
  readPrivateUnread:async()=>({followUnread:0,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0}),
  dm:{poll:async options=>{if(options?.continuationOnly)continuation++;else full++;return {ok:true}},
   hasDueContinuation:()=>continuationDue,nextFastUid:()=>null,status:()=>({fast:{activeCount:0}})},comments:{poll:async()=>({})}})
 try{
  scheduler.start();await new Promise(r=>setTimeout(r,15));assert.equal(full,1)
  assert.equal(scheduler.status().dmAdaptive.sentinelIntervalMinutes,5)
  at+=10*60_000;await scheduler.tick();assert.equal(full,1,'unchanged counter does not trigger another full session-list read')
  continuationDue=true;await scheduler.tick();assert.equal(continuation,1);assert.equal(full,1)
  assert.equal(scheduler.status().sentinels.private.pending,false)
 }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})

test('DM application -509 triggers longer lane backoff, persists across restart without resetting other channels',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-idle-'));
 let at=1_800_000_000_000;
 try{
  const args={dataDir:dir,getAccountTag:()=> 'a'.repeat(16),now:()=>at};
  const a=createNetworkPollBackoff(args);
  assert.equal(a.settle('dm',Error('HTTP 200 code=-509')).streak,1);
  assert.equal(createNetworkPollBackoff(args).check('dm').remainingMs,15*60_000);
  assert.equal(a.check('mentions').allowed,true);
  at+=15*60_000;
  assert.equal(a.settle('dm',Error('请求过于频繁')).streak,2);
  assert.equal(a.check('dm').remainingMs,30*60_000);
  assert.equal(a.settle('replies',Error('code=-509')).streak,1);
  assert.equal(a.check('replies').remainingMs,5*60_000);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
