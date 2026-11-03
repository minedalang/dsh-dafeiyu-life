import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const START=1793600000000;
async function rig(patch={}){
  const dataDir=await mkdtemp(join(tmpdir(),'dm-rice-recovery-'));
  let clock=START;
  const cfg={enabled:true,approvalEnabled:true,approvalPhrase:'白饭🍚',whitelist:['888'],...patch};
  let serverRows=[];const sent=[];let fetches=0;
  const engine=createDmAutoReply({dataDir,now:()=>clock,selfUid:'999',getConfig:()=>cfg,
    fetchIncoming:async()=>serverRows,
    fetchApprovalHistory:async uid=>{fetches++;return serverRows.filter(r=>!uid||r.senderUid===uid)},
    generateReply:async()=> '不要在恢复时生成',send:async x=>{sent.push(x);return {ok:true}}});
  function row(uid,text,id,at=clock){return {senderUid:uid,incoming:true,system:false,messageId:uid+':'+id,text,timestampMs:at};}
  return {engine,cfg,sent,row,dataDir,get serverRows(){return serverRows},set serverRows(v){serverRows=v},get fetches(){return fetches},setClock(v){clock=v}};
}

test('已读历史米饭经双次真实取证才能补录：不自动授权、不发送、不修改旧已读数据',async()=>{
  const x=await rig();const bait=x.row('123','🍚🍚🍚🍚','a',START-3600000);
  x.serverRows=[bait];
  // Old binary has already seen the message without creating an application.
  await x.engine.poll();
  assert.equal((await x.engine.listApprovals()).length,0);
  const before=JSON.parse(await readFile(join(x.dataDir,'dm-autoreply-state.json'),'utf8'));
  assert(before.people['123'].seen.includes(bait.messageId));
  const preview=await x.engine.previewHistoricalApprovals();
  assert.equal(preview.candidates.length,1);
  assert.equal(preview.candidates[0].uid,'123');
  assert.equal(preview.candidates[0].id,bait.messageId);
  assert.equal((await x.engine.listApprovals()).length,0);
  const recovered=await x.engine.recoverHistoricalApproval('123',bait.messageId);
  assert.equal(recovered.ok,true);
  const entry=(await x.engine.listApprovals())[0];
  assert.equal(entry.status,'pending');
  assert.equal(entry.lastText,'🍚🍚🍚🍚');
  const after=JSON.parse(await readFile(join(x.dataDir,'dm-autoreply-state.json'),'utf8'));
  assert.deepEqual(after.people['123'].seen,before.people['123'].seen);
  assert.equal(after.people['123'].approval.recoveredFrom,'verified-history');
  assert.equal(x.sent.length,0);
  assert.equal((await x.engine.poll()).sent,0);
  assert.equal(x.sent.length,0);
  assert.equal(x.fetches,2);
});

test('主人显式批准后才进入受限自动接话，重复补录不覆盖审批',async()=>{
  const x=await rig();x.serverRows=[x.row('123','🍚🍚🍚🍚','k')];
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:k')).ok,true);
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:k')).ok,false);
  assert.equal((await x.engine.reviewApproval('123','approve')).ok,true);
  assert.equal((await x.engine.listApprovals())[0].autoReplyStatus,'queued');
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:k')).ok,false);
  assert.equal((await x.engine.previewHistoricalApprovals()).candidates.length,0);
});

test('不接收伪造、过期、未来、自发、其他 UID 或不符暗号的消息',async()=>{
  const x=await rig();
  x.serverRows=[x.row('123','你好🍚','wrong'),x.row('123','🍚🍚🍚🍚','old',START-73*3600000),
    x.row('123','🍚','future',START+70000),x.row('888','🍚','friend'),x.row('999','🍚','self'),
    {...x.row('123','🍚','system'),system:true},{...x.row('123','🍚','outgoing'),incoming:false}];
  assert.equal((await x.engine.previewHistoricalApprovals()).candidates.length,0);
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:old')).ok,false);
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:wrong')).ok,false);
  assert.equal((await x.engine.recoverHistoricalApproval('888','888:friend')).ok,false);
  assert.equal((await x.engine.recoverHistoricalApproval('999','999:self')).ok,false);
  assert.equal((await x.engine.listApprovals()).length,0);
});

test('浏览器预览不能冒充平台回执：恢复时必须再次命中同一消息 ID',async()=>{
  const x=await rig();x.serverRows=[x.row('123','🍚🍚🍚🍚','latest')];
  assert.equal((await x.engine.previewHistoricalApprovals('123')).candidates.length,1);
  x.serverRows=[];
  assert.match((await x.engine.recoverHistoricalApproval('123','123:latest')).error,/未能重新核实/);
  assert.equal((await x.engine.listApprovals()).length,0);
});

test('只处理未存在审核记录的陌生人；拒绝的记录不能通过重扫绕过',async()=>{
  const x=await rig();x.serverRows=[x.row('123','🍚🍚🍚🍚','rice')];
  await x.engine.recoverHistoricalApproval('123','123:rice');
  await x.engine.reviewApproval('123','reject');
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:rice')).ok,false);
  assert.equal((await x.engine.previewHistoricalApprovals()).candidates.length,0);
  assert.equal((await x.engine.listApprovals())[0].status,'rejected');
});

test('恢复开关或账号身份证据缺失时不能隐式恢复；自定义暗号不被米饭绕过',async()=>{
  const x=await rig({approvalEnabled:false});x.serverRows=[x.row('123','🍚','rice')];
  assert.equal((await x.engine.previewHistoricalApprovals()).ok,false);
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:rice')).ok,false);
  x.cfg.approvalEnabled=true;x.cfg.approvalPhrase='芝麻开门';
  assert.equal((await x.engine.previewHistoricalApprovals()).candidates.length,0);
  assert.equal((await x.engine.recoverHistoricalApproval('123','123:rice')).ok,false);
});

test('管理端确实提供独立预览、定向复查与补录接口，不复用普通私信轮询',()=>{
  const base=new URL('../',import.meta.url);
  const server=readFileSync(new URL('index.js',base),'utf8');
  const page=readFileSync(new URL('lib/management-console.html',base),'utf8');
  const client=readFileSync(new URL('lib/management-console.js',base),'utf8');
  assert.match(server,/dm-approvals\/recovery-preview/);
  assert.match(server,/dm-approvals\/recover/);
  assert.match(server,/fetchApprovalHistory:/);
  assert.match(page,/id="dm-recovery-search"/);
  assert.match(client,/补录到待审核/);
  assert.match(client,/await request\('\/dm-approvals\/recover'/);
});
