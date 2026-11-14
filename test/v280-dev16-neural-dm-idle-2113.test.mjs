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
test('regular DM polling slows progressively after verified idle scans and returns to base on incoming work',async()=>{
 let at=1_800_000_000_000,count=0,incoming=false;
 const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:2,commentWatchReplies:false,commentAtEnabled:false,dmActivePollEnabled:false};
 const dm={poll:async()=>{count++;return {sent:incoming?1:0,conversations:incoming?1:0,ignored:0,failed:0,deferred:0}}};
 const sched=createInteractionScheduler({dm,comments:{poll:async()=>{}},getConfig:()=>cfg,now:()=>at});
 try{
  sched.start();await settle();assert.equal(count,1);
  assert.equal(sched.status().dmAdaptive.intervalMinutes,2);
  at+=14*60_000;await sched.tick();assert.equal(count,2);
  at+=2*60_000;await sched.tick();assert.equal(sched.status().checks.dm.intervalMinutes,5);
  const afterTwo=count;
  at+=1*60_000;await sched.tick();assert.equal(count,afterTwo); // no 2-minute spam
  at+=4*60_000;await sched.tick();assert.equal(count,afterTwo+1);
  at+=41*60_000;await sched.tick();assert.equal(sched.status().dmAdaptive.intervalMinutes,10);
  incoming=true;at+=10*60_000;await sched.tick();assert.equal(sched.status().dmAdaptive.intervalMinutes,2);
 }finally{sched.stop()}
});
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
