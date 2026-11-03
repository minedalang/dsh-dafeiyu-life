import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmAutoReply, isDmApprovalBait} from '../lib/dm-autoreply.mjs';

async function rig(configPatch={}) {
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-rice-bait-'));
  const cfg={enabled:true,strangerEnabled:true,strangerMaxReplies:1,approvalEnabled:true,
    approvalPhrase:'白饭🍚',whitelist:[],whitelistCooldownSeconds:0,maxPerPoll:5,...configPatch};
  const inbox=[],sent=[],generated=[];
  let t=1_790_000_000_000,sequence=0;
  const handler=createDmAutoReply({dataDir,selfUid:'999',getConfig:()=>cfg,now:()=>++t,
    fetchIncoming:async()=>inbox,
    generateReply:async x=>{generated.push(x);return '正常回复';},
    send:async x=>{sent.push(x);return {ok:true};},
    logger:{warn(){},error(){}}});
  function add(uid,text) {
    inbox.push({senderUid:uid,messageId:`message-${++sequence}`,timestampMs:++t,text,incoming:true});
  }
  await handler.poll(); // 初次建基线，不重放旧消息
  return {handler,cfg,inbox,sent,generated,add,dataDir};
}

test('默认白饭暗号兼容 1～12 碗米饭、变体选择符、空白、少量结尾语气符',()=>{
  for(const input of ['白饭🍚','白饭','白饭🍙','🍚','🍚🍚🍚🍚',' 🍚 🍚 🍚 🍚 ','🍚️🍚','白饭🍚🍚','🍚🍚！']){
    assert.equal(isDmApprovalBait(input,'白饭🍚'),true,input);
  }
  for(const input of ['', '🍚'.repeat(13),'你好🍚🍚','今天一起吃🍚','我想投喂🍚','🍚谢谢','🍙🍙','🍚🍚视频']){
    assert.equal(isDmApprovalBait(input,'白饭🍚'),false,input);
  }
});

test('自定义暗号仍按精确匹配，不能被通用米饭表情绕过',()=>{
  assert.equal(isDmApprovalBait('大米🍙','大米🍙'),true);
  assert.equal(isDmApprovalBait('🍚🍚🍚🍚','大米🍙'),false);
  assert.equal(isDmApprovalBait('🍚🍚🍚🍚','芝麻开门'),false);
  assert.equal(isDmApprovalBait('🍚🍚🍚🍚','🍚'),true);
  assert.equal(isDmApprovalBait('芝麻开门','芝麻开门'),true);
});

test('用完陌生人免费回复额度后，连续投喂产生可见待审申请，重复轮询不重复入队',async()=>{
  const x=await rig();
  x.add('100','你好');assert.equal((await x.handler.poll()).sent,1);
  x.add('100','🍚🍚🍚🍚');assert.equal((await x.handler.poll()).sent,0);
  let applications=await x.handler.listApprovals();
  assert.equal(applications.length,1);
  assert.equal(applications[0].status,'pending');
  assert.equal(applications[0].lastText,'🍚🍚🍚🍚');
  assert.equal((await x.handler.poll()).sent,0);
  applications=await x.handler.listApprovals();
  assert.equal(applications.length,1);
  assert.equal(x.sent.length,1);
  const ledger=JSON.parse(await readFile(join(x.dataDir,'dm-autoreply-state.json'),'utf8'));
  assert.equal(ledger.people['100'].approval.lastMessageId,'message-2');
});

test('提前投喂无需先耗尽免费回复额度：直接申请，不触发 AI 或私信发送',async()=>{
  const x=await rig({strangerMaxReplies:3});
  x.add('101','🍚🍚🍚🍚');
  assert.equal((await x.handler.poll()).sent,0);
  assert.equal(x.generated.length,0);
  assert.equal(x.sent.length,0);
  assert.equal((await x.handler.listApprovals())[0].status,'pending');
  x.add('101','你看到我投喂了吗');
  assert.equal((await x.handler.poll()).sent,0);
  assert.equal(x.sent.length,0);
  assert.equal((await x.handler.listApprovals()).length,1);
});

test('陌生人普通聊天提到米饭不作为申请，仍走原有首次正常回复',async()=>{
  const x=await rig();
  x.add('102','🍚🍚好香');
  assert.equal((await x.handler.poll()).sent,1);
  assert.equal((await x.handler.listApprovals()).length,0);
  assert.equal(x.generated.length,1);
});

test('关闭申请权限时连续米饭不会入队；关闭自动回复但开放申请时可正常审核',async()=>{
  const off=await rig({approvalEnabled:false,strangerEnabled:false});
  off.add('103','🍚🍚🍚🍚');
  assert.equal((await off.handler.poll()).sent,0);
  assert.equal((await off.handler.listApprovals()).length,0);
  const on=await rig({approvalEnabled:true,strangerEnabled:false});
  on.add('104','🍚🍚🍚🍚');
  assert.equal((await on.handler.poll()).sent,0);
  assert.equal((await on.handler.listApprovals())[0].status,'pending');
});

test('申请后只有主人明确批准才能安排下一轮受限回复',async()=>{
  const x=await rig();
  x.add('105','🍚🍚🍚🍚');
  await x.handler.poll();
  assert.equal(x.sent.length,0);
  assert.equal((await x.handler.reviewApproval('105','approve')).ok,true);
  assert.equal((await x.handler.listApprovals())[0].autoReplyStatus,'queued');
  assert.equal((await x.handler.poll()).sent,1);
  assert.equal(x.generated.at(-1).mode,'approval-resume');
  assert.equal((await x.handler.poll()).sent,0);
  assert.equal(x.sent.length,1);
});

test('旧消息初次建基线不自动补录、避免升级后历史私信被重新申请',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-rice-baseline-'));
  const cfg={enabled:true,strangerEnabled:true,approvalEnabled:true,approvalPhrase:'白饭🍚'};
  const message={senderUid:'110',incoming:true,text:'🍚🍚🍚🍚',messageId:'historic',timestampMs:1_790_000_000_000};
  const handler=createDmAutoReply({dataDir,getConfig:()=>cfg,now:()=>1_790_000_001_000,selfUid:'999',
    fetchIncoming:async()=>[message],send:async()=>({ok:true}),generateReply:async()=> 'reply'});
  assert.equal((await handler.poll()).initialized,true);
  assert.equal((await handler.listApprovals()).length,0);
  assert.equal((await handler.poll()).sent,0);
  assert.equal((await handler.listApprovals()).length,0);
});
