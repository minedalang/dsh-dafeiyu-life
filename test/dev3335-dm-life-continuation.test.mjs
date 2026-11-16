import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmLifeInbox} from '../lib/dm-life-inbox.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const make=async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'dev3335-life-'));
 let t=1_800_000_000_000;let incoming=[],snapshots=[],sent=0,generations=0,fail=true;
 const args={dataDir,selfUid:'999',now:()=>t,getConfig:()=>({enabled:true,whitelist:['200'],whitelistCooldownSeconds:0}),
   fetchIncoming:async()=>incoming,fetchContactSnapshot:async()=>snapshots,
   send:async()=>{sent++;return {ok:true}},generateReply:async()=>{generations++;if(fail)throw Error('life-choice-queue-timeout');return '模型自然回复';},logger:{warn(){},error(){}}};
 return {args,dataDir,agent:()=>createDmAutoReply(args),time:ms=>{t+=ms},setIncoming:rows=>{incoming=rows},
   setSnapshot:rows=>{snapshots=rows},setFail:v=>{fail=v},counts:()=>({sent,generations}),
   status:()=>createDmLifeInbox({dataDir,now:()=>t}).status()};
};
const incoming=(id,text='今天的事')=>({senderUid:'200',messageId:'200:'+id,timestampMs:1_800_000_000_000,text,incoming:true});
const remote=(id,text='今天的事')=>({fromMe:false,key:id,ts:1_800_000_000,text,kind:1});

test('Life failed queue survives cursor-advanced empty polls and restart; no repeat model call before cooldown',async()=>{
 const m=await make();await m.agent().poll();m.setIncoming([incoming('m1')]);
 const first=await m.agent().poll();assert.equal(first.failed,1);assert.equal(m.status().technicalDeferred,1);
 m.setIncoming([]);m.setSnapshot([remote('m1')]);
 assert.equal((await m.agent().poll()).sent,0);assert.equal(m.counts().generations,1);
 m.time(91_000);m.setFail(false);
 const recovered=await m.agent().poll();assert.equal(recovered.sent,1);
 assert.deepEqual(m.counts(),{sent:1,generations:2});assert.equal(m.status().technicalDeferred,0);
 assert.equal((await m.agent().poll()).sent,0,'a confirmed delivery never replays');
});

test('missing original message on targeted read is review-required rather than hallucinated response',async()=>{
 const m=await make();await m.agent().poll();m.setIncoming([incoming('m1')]);await m.agent().poll();
 m.setIncoming([]);m.setSnapshot([remote('different','其他人的消息')]);m.time(91_000);
 assert.equal((await m.agent().poll()).sent,0);assert.equal(m.status().reviewRequired,1);
 assert.equal(m.counts().generations,1);
});

test('platform send with lost receipt freezes instead of retrying',async()=>{
 const m=await make();await m.agent().poll();m.setIncoming([incoming('m1')]);m.setFail(false);
 m.args.send=async()=>{throw Error('HTTP timeout after send')};
 assert.equal((await m.agent().poll()).failed,1);assert.equal(m.status().sendUnknown,1);
 m.setIncoming([]);m.setSnapshot([remote('m1')]);m.time(20*60_000);
 assert.equal((await m.agent().poll()).sent,0);assert.equal(m.counts().generations,1);
});

test('metadata ledger stores no private content and holds a crashed model lease safely',async()=>{
 const d=await mkdtemp(join(tmpdir(),'dev3335-ledger-'));let now=1_800_000_000_000;
 const l=()=>createDmLifeInbox({dataDir:d,now:()=>now});const a=l();
 a.observe([{uid:'200',id:'m1',time:now,text:'THIS_IS_PRIVATE'}]);
 assert.equal(a.claim('200','m1'),true);assert.equal(l().eligible('200','m1'),false);
 now+=5*60_000;
 assert.equal(l().eligible('200','m1'),true);
 const raw=await readFile(join(d,'dm-life-inbox.json'),'utf8');assert.equal(raw.includes('THIS_IS_PRIVATE'),false);
 assert.deepEqual(Object.keys(JSON.parse(raw).rows[0]).sort(),['at','attempts','id','retryAt','sourceAt','status','uid']);
});
