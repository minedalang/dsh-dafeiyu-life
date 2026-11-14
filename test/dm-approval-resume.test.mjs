import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const create = async ({ custom = {}, sendImpl, generateImpl, fetchImpl } = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-dm-resume-'));
  const inbox = [], sent = [], generated = [];
  let nextId = 0;
  let tick = 1_790_000_000_000;
  const config = {enabled:true, strangerEnabled:true, strangerMaxReplies:1, strangerFirstFixed:false,
    approvalEnabled:true, approvalPhrase:'🍚', whitelist:[], whitelistCooldownSeconds:0, maxPerPoll:4,
    maxPerHour:60, maxPerDay:0, ...custom};
  const options={dataDir, now:()=>tick, selfUid:'999', getConfig:()=>config,
    fetchIncoming:fetchImpl || (async()=>inbox),
    generateReply:async x=> { generated.push(x);return generateImpl ? generateImpl(x) : '大米饭收到啦🐳'; },
    send:async x => {sent.push(x); return sendImpl ? sendImpl(x) : {ok:true};},
    logger:{warn(){},error(){}}};
  const make = () => createDmAutoReply(options);
  const push = (uid,text) => inbox.push({senderUid:uid,messageId:'msg-'+(++nextId),timestampMs:++tick,text,incoming:true});
  const state = async()=>JSON.parse(await readFile(join(dataDir,'dm-autoreply-state.json'),'utf8'));
  await make().poll(); // baseline
  return {make,push,inbox,sent,generated,state,dataDir,config,advance:ms=>{tick+=ms}};
};
async function pending(x,uid='100') {
  x.push(uid,'你好');assert.equal((await x.make().poll()).sent,1);
  x.push(uid,'🍚');assert.equal((await x.make().poll()).sent,0);
  assert.equal((await x.make().listApprovals()).find(a=>a.uid===uid).status,'pending');
}

test('批准已消费的投喂消息后，不需新私信，下轮自动回复一次',async()=>{
  const x=await create();await pending(x);
  const result=await x.make().reviewApproval('100','approve');
  assert.deepEqual([result.ok,result.autoReplyStatus],[true,'queued']);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'queued');
  assert.equal(x.sent.length,1);
  assert.equal((await x.make().poll()).sent,1);
  assert.equal(x.sent.length,2);
  assert.equal(x.sent[1].uid,'100');
  assert.equal(x.generated.at(-1).mode,'approval-resume');
  assert.equal(x.generated.at(-1).text,'🍚');
  assert.equal((await x.make().poll()).sent,0);
  assert.equal(x.sent.length,2);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'sent');
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'sent'); // the retired per-approved-user quota counter must not be needed
});

test('重启后仍有审批待回复队列，轮询不依赖再次看到暗号',async()=>{
  // 用真实输入源完成申请后，再把远端会话模拟为空。
  const y=await create();await pending(y);
  await y.make().reviewApproval('100','approve');
  y.inbox.splice(0);
  assert.equal((await y.make().poll()).sent,1);
  assert.equal(y.sent.length,2);
});

test('批准后对方同时发来新消息，只合并回复一次，优先答新消息',async()=>{
  const x=await create();await pending(x);
  await x.make().reviewApproval('100','approve');
  x.push('100','顺便问一句，周末做什么？');
  assert.equal((await x.make().poll()).sent,1);
  assert.equal(x.sent.length,2);
  assert.equal(x.generated.at(-1).text,'顺便问一句，周末做什么？');
  assert.deepEqual(x.generated.at(-1).messages,['🍚','顺便问一句，周末做什么？']);
  assert.equal((await x.make().poll()).sent,0);
});

test('模型生成失败不消耗待回复任务，下轮可继续处理',async()=>{
  let fail=true;
  const x=await create({generateImpl:()=> {if(fail) throw new Error('model down');return '吃到了';}});
  // 首条陌生人消息同样调用模型，因此先允许第一条通过。
  fail=false;await pending(x);await x.make().reviewApproval('100','approve');
  fail=true;
  assert.equal((await x.make().poll()).failed,1);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'queued');
  fail=false;
  assert.equal((await x.make().poll()).sent,1);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'sent');
});

test('发送回执丢失后标为 uncertain 且重启不自动重复发送',async()=>{
  let fail=false;
  const x=await create({sendImpl:()=>fail ? (()=>{throw new Error('timeout');})() : {ok:true}});
  await pending(x);await x.make().reviewApproval('100','approve');
  fail=true;
  assert.equal((await x.make().poll()).failed,1);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'uncertain');
  fail=false;
  assert.equal((await x.make().poll()).sent,0);
  assert.equal(x.sent.length,2);
});

test('撤销待回复权限会取消队列',async()=>{
  const x=await create();await pending(x);
  await x.make().reviewApproval('100','approve');
  const r=await x.make().reviewApproval('100','revoke');
  assert.equal(r.autoReplyStatus,'cancelled');
  assert.equal((await x.make().poll()).sent,0);
  assert.equal(x.sent.length,1);
});

test('旧版待审批记录无 lastMessageId 也能直接排队并回复',async()=>{
  const x=await create();await pending(x);
  const s=await x.state();delete s.people['100'].approval.lastMessageId;
  await writeFile(join(x.dataDir,'dm-autoreply-state.json'),JSON.stringify(s));
  await x.make().reviewApproval('100','approve');
  x.inbox.splice(0);
  assert.equal((await x.make().poll()).sent,1);
});

test('批准后遇全局限额，任务保留到下一次有额度的轮询',async()=>{
  const x=await create({custom:{maxPerDay:1}});await pending(x);
  await x.make().reviewApproval('100','approve');
  assert.equal((await x.make().poll()).sent,0);
  assert.equal((await x.make().listApprovals())[0].autoReplyStatus,'queued');
  x.advance(86400_100);
  assert.equal((await x.make().poll()).sent,1);
});

test('旧版已批准但没有回复的申请可经主人明确补发，不能重复补发',async()=>{
  const x=await create();await pending(x);
  const s=await x.state();
  s.people['100'].approval.status='approved';
  s.people['100'].approval.approvedAt=1_790_000_000_000+100;
  delete s.people['100'].approval.reply;
  await writeFile(join(x.dataDir,'dm-autoreply-state.json'),JSON.stringify(s));
  assert.equal((await x.make().listApprovals())[0].canResume,true);
  assert.equal((await x.make().reviewApproval('100','resume')).autoReplyStatus,'queued');
  assert.equal((await x.make().reviewApproval('100','resume')).ok,false);
  assert.equal((await x.make().poll()).sent,1);
  assert.equal(x.sent.length,2);
});

test('旧版批准之后已发送过自动回复的记录不能补发',async()=>{
  const x=await create();await pending(x);
  const s=await x.state();
  s.people['100'].approval.status='approved';
  s.people['100'].approval.approvedAt=1_790_000_000_000-100;
  delete s.people['100'].approval.reply;
  await writeFile(join(x.dataDir,'dm-autoreply-state.json'),JSON.stringify(s));
  assert.equal((await x.make().listApprovals())[0].canResume,false);
  assert.equal((await x.make().reviewApproval('100','resume')).ok,false);
});
