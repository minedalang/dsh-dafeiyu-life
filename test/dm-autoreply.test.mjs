import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDmAutoReply } from '../lib/dm-autoreply.mjs';
const mk = async (args = {}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'plus-dm-test-'));
  const inbox = [];
  const sent = [];
  let clock = 1_790_000_000_000;
  const config = { enabled:true, strangerEnabled:true, whitelist:['200'], whitelistCooldownSeconds:0, ...args.config };
  const historyCalls = [];
  const params = {dataDir, selfUid:'999', now:()=>clock, logger:{warn(){}, error(){}},
    getConfig:()=>config, fetchIncoming:async()=>inbox,
    send: async (item) => { sent.push(item); return {ok:true}; },
    generateReply: async (req) => { historyCalls.push(req); return 'AI:' + req.text; },
  };
  return { inbox, sent, config, params, historyCalls,
    make: (override={})=>createDmAutoReply({...params,...override}),
    clockForward:(ms)=>{clock+=ms},
    path:dataDir };
};
const msg = (senderUid, messageId, text, extra={}) => ({senderUid, messageId, text, timestampMs:1_790_000_000_000, incoming:true, ...extra});

test('first poll baselines history; stranger may continue autonomously when strict approval is off', async()=>{
  const m=await mk(); const agent=m.make();
  m.inbox.push(msg('100','old','之前发的'));
  assert.deepEqual(await agent.poll(), {initialized:true,baselined:1,sent:0});
  m.inbox.push(msg('100','2','你好'));
  assert.equal((await agent.poll()).sent,1);
  m.inbox.push(msg('100','3','在吗'));
  assert.equal((await m.make().poll()).sent,1);
  assert.equal(m.sent.length,2);
  const state=JSON.parse(await readFile(join(m.path,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['100'].stranger.status,'sent');
  assert.equal(state.people['100'].stranger.count,2);
});

test('turning off optional strict approval means an old pending code request no longer blocks an explicitly authorized DM conversation',async()=>{
  const m=await mk({config:{whitelist:[],approvalEnabled:false,strangerMaxReplies:1}});const agent=m.make();
  await agent.poll();
  const file=join(m.path,'dm-autoreply-state.json');
  const state=JSON.parse(await readFile(file,'utf8'));
  state.people['200']={nickname:'',seen:[],history:[],olderContext:[],lastRepliedAt:0,
    approval:{status:'pending',requestedAt:m.params.now(),lastText:'🍚'}};
  await writeFile(file,JSON.stringify(state));
  m.inbox.push(msg('200','1','我们继续聊刚才的话题'));
  assert.equal((await agent.poll()).sent,1);
  assert.equal((await agent.listApprovals())[0].status,'pending','historical approval record remains visible, but is not a gate while strict mode is off');
});

test('DM sender uses the central SocialPolicyGate callback and does not generate when it denies permission',async()=>{
  const m=await mk();let generated=0,gateCalls=0;
  const agent=m.make({canSendDm:()=>{gateCalls++;return {allowed:false,reason:'test-policy-denied'};},
    generateReply:async()=>{generated++;return '不应生成';}});
  await agent.poll();m.inbox.push(msg('200','1','你好'));
  assert.equal((await agent.poll()).sent,0);
  assert.equal(generated,0);
  assert.equal(gateCalls,1);
});

test('a DM permission revoked after generation but before the first send restores the previous stranger state',async()=>{
  const m=await mk();let gateCalls=0,sendCalls=0;
  const agent=m.make({canSendDm:()=>({allowed:++gateCalls===1,reason:'test'}),
    generateReply:async()=> '这条不应发出去',send:async item=>{sendCalls++;m.sent.push(item);return {ok:true};}});
  await agent.poll();m.inbox.push(msg('200','1','你好'));
  assert.equal((await agent.poll()).sent,0);
  assert.equal(sendCalls,0);
  const state=JSON.parse(await readFile(join(m.path,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['200'].stranger,null,'permission denial before a remote send must not leave a stuck pending/uncertain marker');
});

test('whitelist receives ongoing AI replies with persistent context', async()=>{
  const m=await mk(); const agent=m.make(); await agent.poll();
  m.inbox.push(msg('200','1','第一句'));
  assert.equal((await agent.poll()).sent,1);
  m.inbox.push(msg('200','2','第二句'));
  assert.equal((await m.make().poll()).sent,1);
  assert.equal(m.sent.length,2);
  assert.deepEqual(m.historyCalls[1].history.map(x=>x.text), ['第一句','AI:第一句']);
});

test('ignores outgoing / self messages / system and does not loop', async()=>{
  const m=await mk(); await m.make().poll();
  m.inbox.push(msg('200','1','我自己的', {incoming:false}),msg('999','2','自己', {incoming:true}),msg('300','3','系统',{system:true}));
  assert.equal((await m.make().poll()).sent,0);
  assert.equal(m.sent.length,0);
});

test('stranger failed send is reserved; no automatic repeat', async()=>{
  const m=await mk(); await m.make().poll(); m.inbox.push(msg('101','1','hi'));
  const failing=m.make({send:async()=>{throw new Error('timeout');}});
  assert.equal((await failing.poll()).failed,1);
  assert.equal((await m.make().poll()).sent,0);
  const state=JSON.parse(await readFile(join(m.path,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['101'].stranger.status,'uncertain');
});

test('disabled mode sends nothing, first enable establishes baseline', async()=>{
  const m=await mk({config:{enabled:false}}); m.inbox.push(msg('100','1','老消息'));
  assert.equal((await m.make().poll()).skipped,'disabled');
  m.config.enabled=true;
  assert.equal((await m.make().poll()).baselined,1);
  assert.equal(m.sent.length,0);
});

test('lock prevents a second instance from replying concurrently', async()=>{
  const m=await mk(); await m.make().poll(); m.inbox.push(msg('100','1','hi'));
  let release; let entered;
  const waiting=new Promise(r=>{release=r});
  const gotIn=new Promise(r=>{entered=r});
  const one=m.make({send:async(item)=>{entered(); await waiting; m.sent.push(item); return true;}});
  const pending=one.poll(); await gotIn;
  assert.equal((await m.make().poll()).skipped,'locked');
  release(); await pending;
  assert.equal(m.sent.length,1);
});

test('rate limit defers whitelist without consuming incoming message',async()=>{
  const m=await mk({config:{maxPerPoll:1}}); await m.make().poll();
  m.inbox.push(msg('200','1','a'),msg('201','1','b'));
  m.config.whitelist=['200','201'];
  assert.equal((await m.make().poll()).sent,1);
  assert.equal((await m.make().poll()).sent,1);
  assert.deepEqual(m.sent.map(x=>x.uid),['200','201']);
});

test('stranger daily cap is respected without consuming deferred messages', async()=>{
  const m=await mk({config:{maxPerDay:1,whitelist:[],strangerMaxReplies:2}})
  await m.make().poll()
  m.inbox.push(msg('200','1','A'),msg('201','1','B'))
  assert.equal((await m.make().poll()).sent,1)
  assert.equal((await m.make().poll()).sent,0)
  m.clockForward(86400_001)
  assert.equal((await m.make().poll()).sent,1)
})

test('new incoming stranger messages get a new AI decision once; repeated polls never resend the same IDs', async()=>{
  const m=await mk({config:{whitelist:[]}})
  await m.make().poll()
  m.inbox.push(msg('300','2','你好'))
  assert.equal((await m.make().poll()).sent,1)
  m.inbox.push(msg('300','3','还在吗'),msg('300','4','ping'))
  assert.equal((await m.make().poll()).sent,1)
  for(let i=0;i<3;i++) assert.equal((await m.make().poll()).sent,0)
  assert.equal(m.sent.length,2)
})


test('recent conversation list returns only bounded local snippets', async()=>{
  const m=await mk();const agent=m.make();await agent.poll();
  m.inbox.push(msg('200','1','最近一条消息'));
  assert.equal((await agent.poll()).sent,1);
  const rows=await agent.listRecentConversations(10);
  assert.equal(rows.length,1);
  assert.equal(rows[0].uid,'200');
  assert.equal(rows[0].recent.at(-1).role,'assistant');
  assert.match(rows[0].recent.at(-1).text,/AI:最近一条消息/);
  assert.equal(rows[0].strangerRepliesLimit,null,'strict approval disabled means no fixed stranger reply cap');
});

test('one DM turn can send up to three natural bubbles and reserve one delayed supplement',async()=>{
  const m=await mk();const agent=m.make({generateReply:async req=>{
    assert.equal(req.socialAutonomy,true);assert.equal(req.trigger,'incoming');assert.equal(req.threadKey,'dm:200');
    return {action:'reply',messages:['第一句','第二句'],followUpMinutes:5};
  },send:async item=>{m.sent.push(item);return {ok:true,receiptId:'platform-'+m.sent.length};}});
  await agent.poll();m.inbox.push(msg('200','1','今天有点开心'));
  assert.equal((await agent.poll()).sent,2);
  assert.deepEqual(m.sent.map(x=>x.text),['第一句','第二句']);
  const ledger=JSON.parse(await readFile(join(m.path,'social-continuity','intentions.json'),'utf8'));
  assert.equal(ledger.entries.length,1);
  assert.equal(ledger.entries[0].purpose,'delayed-supplement');
  assert.equal(ledger.entries[0].status,'scheduled');
});

test('a newer message arriving between bubbles stops the remaining burst and is handled next poll',async()=>{
  const m=await mk();let injected=false,turn=0;
  const agent=m.make({generateReply:async()=>{turn++;return {action:'reply',messages:turn===1?['先说一句','准备补充第二句','还有第三句']:['接住新问题']};},
    send:async item=>{m.sent.push(item);if(!injected){injected=true;m.inbox.push(msg('200','2','我刚刚又想到一个问题'));}return {ok:true,receiptId:'bubble-'+m.sent.length};}});
  await agent.poll();m.inbox.push(msg('200','1','有个问题想聊'));
  assert.equal((await agent.poll()).sent,1);
  assert.deepEqual(m.sent.map(x=>x.text),['先说一句']);
  assert.equal((await agent.poll()).sent,1,'the new message is handled as a fresh turn on the next poll');
  assert.equal(m.sent.length,2);
});

test('a newer message arriving while the model is thinking cancels the stale draft before the first send',async()=>{
  const m=await mk();let calls=0;
  const agent=m.make({generateReply:async()=>{
    calls++;
    if(calls===1){m.inbox.push(msg('200','2','等等，我补充一下'));return '基于旧上下文的回复';}
    return '把你刚补充的也一起接住';
  }});
  await agent.poll();m.inbox.push(msg('200','1','我想问你一个问题'));
  assert.equal((await agent.poll()).sent,0);
  assert.equal(m.sent.length,0);
  assert.equal((await agent.poll()).sent,1);
  assert.equal(m.sent[0].text,'把你刚补充的也一起接住');
  assert.equal(calls,2);
});

test('DM defer creates a reconsideration; due wakeup re-evaluates and requires a real receipt',async()=>{
  const m=await mk();let turn=0;
  const agent=m.make({generateReply:async req=>{
    turn++;
    if(turn===1){assert.equal(req.trigger,'incoming');return {action:'defer',notBefore:m.params.now()+5*60_000};}
    assert.equal(req.trigger,'scheduled');assert.equal(req.scheduledPurpose,'silence-reconsideration');
    return {action:'reply',messages:['过了一会儿，我又想起来一件事。']};
  },send:async item=>{m.sent.push(item);return {ok:true,receiptId:'verified-msg-key'};}});
  await agent.poll();m.inbox.push(msg('200','1','刚才想问你一个问题'));
  assert.equal((await agent.poll()).sent,0);
  assert.equal((await agent.listRecentConversations())[0].recent.at(-1).role,'user');
  m.clockForward(5*60_000+1);
  assert.equal((await agent.poll()).sent,1);
  assert.equal(m.sent.length,1);
  const ledger=JSON.parse(await readFile(join(m.path,'social-continuity','intentions.json'),'utf8'));
  assert.equal(ledger.entries[0].status,'sent');
  assert.ok(ledger.entries[0].receiptHash);
});

test('a newer incoming DM cancels an older deferred intention before it can send',async()=>{
  const m=await mk();let calls=0;
  const agent=m.make({generateReply:async()=>{calls++;return calls===1
    ?{action:'defer',notBefore:m.params.now()+5*60_000}:'接住你刚刚的新话题';}});
  await agent.poll();m.inbox.push(msg('200','1','先前的话题'));
  await agent.poll();m.clockForward(5*60_000+1);m.inbox.push(msg('200','2','我换个问题'));
  assert.equal((await agent.poll()).sent,1);
  assert.equal(calls,2,'only the new incoming message is generated; the old scheduled task is cancelled');
  const ledger=JSON.parse(await readFile(join(m.path,'social-continuity','intentions.json'),'utf8'));
  assert.equal(ledger.entries[0].status,'cancelled');
});

test('legacy one-shot stranger permission does not silently become ongoing chat on 2.7.0 upgrade',async()=>{
  const m=await mk({config:{whitelist:[],strangerEnabled:true,legacyStrangerOnce:true,strangerMaxReplies:1,approvalEnabled:false}});
  const legacyGate=({trusted,approved,strangerEnabled,legacyStrangerOnce,strangerReplies,strangerMaxReplies})=>({
    allowed:trusted||approved||(strangerEnabled&&(!legacyStrangerOnce||strangerReplies<strangerMaxReplies))
  });
  await m.make({canSendDm:legacyGate}).poll();
  m.inbox.push(msg('321','a','第一次和鱼鱼聊天'));
  assert.equal((await m.make({canSendDm:legacyGate}).poll()).sent,1);
  m.inbox.push(msg('321','b','第二次来问候'));
  assert.equal((await m.make({canSendDm:legacyGate}).poll()).sent,0);
  assert.equal(m.sent.length,1);
  assert.equal((await m.make({canSendDm:legacyGate}).listRecentConversations())[0].strangerRepliesRemaining,0);
  m.config.legacyStrangerOnce=false; // explicit new opt-in, not an automatic migration
  m.inbox.push(msg('321','c','现在主人允许持续自主交流'));
  assert.equal((await m.make({canSendDm:legacyGate}).poll()).sent,1);
});


test('legacy one-shot consent does not allow multi-bubble sends, delayed supplements or deferred wakeups',async()=>{
  const m=await mk({config:{whitelist:[],strangerEnabled:true,legacyStrangerOnce:true,strangerMaxReplies:2}});
  let n=0;
  const agent=m.make({generateReply:async()=>{n++;return n===1
    ?{action:'reply',messages:['老版首句','不可按新 P6 额外连发'],followUpMinutes:5}
    :{action:'defer',notBefore:m.params.now()+5*60_000};}});
  await agent.poll();m.inbox.push(msg('100','1','第一次来信'));
  assert.equal((await agent.poll()).sent,1);
  assert.equal(m.sent.length,1);
  m.inbox.push(msg('100','2','第二次来信'));
  assert.equal((await agent.poll()).sent,0);
  m.clockForward(6*60_000);
  assert.equal((await agent.poll()).sent,0);
  assert.equal(m.sent.length,1);
  assert.equal(n,2,'legacy mode must never wake up to generate a scheduled outbound DM');
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(join(m.path,'social-continuity','intentions.json')),false);
});


test('DM configurable P6 max bubbles is respected without changing stranger authorization',async()=>{
  const m=await mk({config:{p6Enabled:true,p6MaxBubbles:1,whitelist:['200']}});
  const agent=m.make({generateReply:async()=>({action:'reply',messages:['允许的一段','不允许的第二段'],followUpMinutes:0})});
  await agent.poll();m.inbox.push(msg('200','p6cap-1','测试每轮限制'));
  assert.equal((await agent.poll()).sent,1);
  assert.equal(m.sent.length,1);assert.equal(m.sent[0].text,'允许的一段');
});

test('DM configured delay range rejects a too-soon defer without reserving a future send',async()=>{
  const m=await mk({config:{p6Enabled:true,delayMinMinutes:30,delayMaxMinutes:60,whitelist:['200']}});
  const agent=m.make({generateReply:async()=>({action:'defer',notBefore:m.params.now()+5*60_000})});
  await agent.poll();m.inbox.push(msg('200','p6delay-1','时间尚未到'));
  assert.equal((await agent.poll()).sent,0);
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync(join(m.path,'social-continuity','intentions.json')),false);
});
