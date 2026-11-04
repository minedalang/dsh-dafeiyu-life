import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {pruneDmContext,dmOlderContextText} from '../lib/dm-context-retention.mjs';
import {ownerDmLiveContext} from '../lib/owner-dm-agent.mjs';

const DAY=86400_000, AT=1800000000000;
const quiet={warn(){},error(){}};
const fixture=async(config={},time=AT)=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-dm-'));
  const inbox=[],sent=[],calls=[];
  let clock=time;
  const ctrl=createDmAutoReply({dataDir,selfUid:'999',logger:quiet,now:()=>clock,
    getConfig:()=>({enabled:true,whitelist:['100','200'],historyLimit:2,whitelistCooldownSeconds:0,...config}),
    fetchIncoming:async()=>inbox,send:async req=>(sent.push(req),true),
    generateReply:async req=>(calls.push(req),'收到')});
  const state=async()=>JSON.parse(await readFile(join(dataDir,'dm-autoreply-state.json'),'utf8'));
  return {ctrl,inbox,sent,calls,state,dataDir,setClock:v=>clock=v};
};

test('过期上下文与无日期旧片段被清理，拒联/去重/审核/回执保留',async()=>{
  const x=await fixture({enabled:false});
  const old=AT-30*DAY,recent=AT-3600_000;
  const original={version:1,initialized:true,sentAt:[recent],people:{'100':{
    seen:['already-processed'],lastRepliedAt:recent,dmContactBoundaries:{'999':{status:'stop',at:old,sourceMessageId:'already-processed'}},
    approval:{status:'approved',approvedAt:old},approvedUsage:{total:4,day:'',daily:0},
    history:[{role:'user',text:'早就该忘记的原文',at:old},{role:'user',text:'今天的内容',at:recent}],
    olderContext:['旧版没有日期的敏感片段',{text:'过期片段',at:old},{text:'近期片段',at:recent}],
  }}};
  await writeFile(join(x.dataDir,'dm-autoreply-state.json'),JSON.stringify(original));
  const preview=await x.ctrl.contextGovernance();
  assert.equal(preview.staleCount,3);
  const result=await x.ctrl.pruneExpiredContext();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  const next=await x.state(),person=next.people['100'];
  assert.deepEqual(person.seen,['already-processed']);
  assert.equal(person.dmContactBoundaries['999'].status,'stop');
  assert.equal(person.approval.status,'approved');
  assert.equal(person.approvedUsage.total,4);
  assert.deepEqual(next.sentAt,[recent]);
  assert.deepEqual(person.history.map(x=>x.text),['今天的内容']);
  assert.deepEqual(person.olderContext.map(x=>x.text),['近期片段']);
  assert.equal((await x.ctrl.pruneExpiredContext()).changed,false);
  assert.equal(x.calls.length,0);assert.equal(x.sent.length,0);
});

test('配置为0条上下文，后台不持久保存新旧私信原文但保留去重',async()=>{
  const x=await fixture({historyLimit:0});
  await x.ctrl.poll();
  x.inbox.push({incoming:true,senderUid:'100',messageId:'a1',timestampMs:AT,text:'你好'});
  assert.equal((await x.ctrl.poll()).sent,1);
  assert.equal(x.calls.length,1);assert.deepEqual(x.calls[0].history,[]);assert.equal(x.calls[0].olderContext,'');
  const p=(await x.state()).people['100'];
  assert.deepEqual(p.history,[]);assert.deepEqual(p.olderContext,[]);assert.deepEqual(p.seen,['a1']);
  assert.equal((await x.ctrl.poll()).sent,0);
});

test('旧消息按时间淘汰，新消息可以生成受限的7天旧上下文且不跨 UID',async()=>{
  const x=await fixture();await x.ctrl.poll();
  for(let i=0;i<5;i++){
    x.inbox.push({incoming:true,senderUid:'100',messageId:'a'+i,timestampMs:AT+i,text:'同一个人'+i});
    await x.ctrl.poll();
  }
  x.inbox.push({incoming:true,senderUid:'200',messageId:'b0',timestampMs:AT+5,text:'另一个人的私事'});
  await x.ctrl.poll();
  x.inbox.push({incoming:true,senderUid:'100',messageId:'a6',timestampMs:AT+6,text:'继续'});
  await x.ctrl.poll();
  const last=x.calls.at(-1);
  assert.equal(last.uid,'100');assert.match(last.olderContext,/同一个人0/);
  assert.doesNotMatch(last.olderContext,/另一个人的私事/);
  x.setClock(AT+8*DAY);
  const after=await x.ctrl.contextGovernance();
  assert.equal(after.olderCount,0);
  const clean=await x.ctrl.pruneExpiredContext();assert.ok(clean.olderRemoved>0);
  const p=(await x.state()).people['100'];assert.equal(p.olderContext.length,0);
  x.setClock(AT+16*DAY);await x.ctrl.pruneExpiredContext();
  assert.equal((await x.state()).people['100'].history.length,0);
});

test('旧版无日期原文不能重新作为可回忆经历，空白和未来时间被拒',()=>{
  const p={history:[{role:'user',text:'老版未记录时间'},
    {role:'assistant',text:'未来消息',at:AT+2*DAY},
    {role:'user',text:'有效的近期消息',at:AT-1000}],
    olderContext:['无限期旧片段',{text:'旧原文',at:AT-10*DAY},{text:'近来讨论',at:AT-1000}]};
  const r=pruneDmContext(p,{atNow:AT,historyLimit:40});
  assert.equal(r.changed,true);
  assert.equal(p.history.length,1);
  assert.deepEqual(p.olderContext.map(x=>x.text),['近来讨论']);
  assert.equal(dmOlderContextText(p),'近来讨论');
});

test('管理中心能观察来源/清理结果，但无发送权限扩张',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(index,/path === '\/api\/bili-duty\/dm-memory-governance'/);
  assert.match(index,/path === '\/api\/bili-duty\/dm-memory-prune'/);
  assert.match(index,/PRUNE_EXPIRED_DM_CONTEXT/);
  assert.match(html,/id="dm-context-governance"/);
  assert.match(html,/主人专属私信 Agent、人生记忆、好友画像各有独立来源与权限/);
  assert.match(js,/loadDmMemoryGovernance/);
  assert.match(js,/staleContextEntries/);
});

test('主人专属 DM Agent 的短期原文单独按时间衰减，不恢复久远聊天',()=>{
  const history=[{role:'user',text:'很久以前的原话',at:AT-30*DAY},
    {role:'user',text:'近期主人的话',at:AT-1000},
    {role:'assistant',text:'之前我已回应',at:AT-2*DAY,source:'confirmed-followup'},
    {role:'assistant',text:'今天真实发出的回访',at:AT-2000,source:'confirmed-followup'}];
  const rows=ownerDmLiveContext(history,{atNow:AT});
  assert.deepEqual(rows.map(x=>x.text),['近期主人的话','今天真实发出的回访']);
});
