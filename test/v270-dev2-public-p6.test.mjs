import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createSocialContinuityLedger} from '../lib/social-continuity-ledger.mjs';
import {createSocialInteractionRhythm} from '../lib/social-interaction-rhythm.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';

const SELF='999',PERSON='47722',BV='BV1ignA6REjB';
const timestamp=1790000000000;
const payload=(id,t=timestamp,content='@大肥鱼 有个问题想问')=>({id,at_time:Math.floor(t/1000),user:{mid:PERSON,nickname:'测试用户'},
  item:{business_id:1,subject_id:'777',source_id:String(id+500),root_id:'888',target_id:'888',
    source_content:content,uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:SELF}]}});
const raw=items=>({at:{code:0,data:{items}}});
async function fixture(run,{p6At=true,p6Comment=false,replyPerPoll=5,p6MaxBubbles=2,delayMinMinutes=5,delayMaxMinutes=360}={}){
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-public-'));
  let clock=timestamp,notices=[payload(1)],calls=[],sends=[];
  const config={watchAt:true,replyAt:true,p6At,p6Comment,p6MaxBubbles,delayMinMinutes,delayMaxMinutes,watchReplies:true,replyPerPoll,replyPerDay:20,
    globalDailyLimit:100,ownTopPerUser:15,ownNestedPerUser:15};
  let behavior=req=>({action:'skip'});
  const engine=createCommentInteract({dataDir,getConfig:()=>config,selfUid:async()=>SELF,now:()=>clock,
    getAtNotifications:async()=>raw(notices),getNotifications:async()=>({data:{replies:[]}}),
    getAtSource:async x=>({ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,text:'核实的 B站 来源评论'}),
    getOwnComments:async()=>({top:[],nested:[]}),
    getVideoContext:async()=>({usable:true,text:'已核实视频内容'}),
    generateReply:async req=>{calls.push(req);return behavior(req)},
    send:async req=>{sends.push(req);return {ok:true,rpid:String(500000+sends.length)}},
    logger:{warn(){},error(){}}});
  try{
    await engine.poll({mentions:true,notifications:false,top:false});
    await run({engine,config,sends,calls,add:(id,t=clock)=>notices.push(payload(id,t)),
      tick:milliseconds=>{clock+=milliseconds},time:()=>clock,model:fn=>{behavior=fn},
      state:async()=>JSON.parse(await readFile(join(dataDir,'comment-interact-state.json'),'utf8')),
      ledger:()=>createSocialContinuityLedger({dataDir,accountUid:SELF,now:()=>clock})});
  }finally{await rm(dataDir,{recursive:true,force:true})}
}

test('public @ P6 sends separate confirmed bubbles then reconsiders a scheduled supplement',async()=>fixture(async h=>{
  h.model(req=>req.trigger==='scheduled'?{action:'reply',messages:['稍后想到了新的点']}:
    {action:'reply',messages:['先回答一句','再补充一句'],followUpMinutes:5});
  h.add(2);const first=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(first.sent,2);assert.equal(h.sends.length,2);
  const intents=(await h.state()).p6Intents;assert.equal(Object.keys(intents).length,1);
  h.tick(5*60000+10);
  const next=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(next.sent,1);assert.equal(h.sends.length,3);
  assert.equal(h.calls.at(-1).trigger,'scheduled');
  assert.equal(h.ledger().status().counts.sent,1);
}));

test('public @ P6 silence defers a real comment and can choose to reply at wakeup',async()=>fixture(async h=>{
  h.model(req=>req.trigger==='scheduled'?{action:'reply',messages:['等了一会儿，现在有想法了']}:
    {action:'defer',notBefore:h.time()+5*60000});
  h.add(3);assert.equal((await h.engine.poll({mentions:true,notifications:false,top:false})).sent,0);
  assert.equal(h.sends.length,0);assert.equal(h.ledger().status().counts.scheduled,1);
  h.tick(5*60000+10);assert.equal((await h.engine.poll({mentions:true,notifications:false,top:false})).sent,1);
  assert.equal(h.sends.length,1);
}));

test('new public mention cancels an old deferred intention in the same thread',async()=>fixture(async h=>{
  h.model(req=>req.trigger==='scheduled'?{action:'reply',messages:['不应发送的旧话题']}:{action:'defer',notBefore:h.time()+5*60000});
  h.add(4);await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(h.ledger().status().counts.scheduled,1);
  h.tick(5*60000+5);h.add(5,h.time());
  await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(h.sends.length,0);assert.equal(h.ledger().status().counts.cancelled,1);
}));

test('public P6 disabled still produces a single legacy reply without any scheduled send',async()=>fixture(async h=>{
  h.model(()=> '原有的一条回复');h.add(6);
  const result=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(result.sent,1);assert.equal(h.sends.length,1);
  assert.equal(h.ledger().status().counts.scheduled,0);
  assert.equal(h.calls[0].socialAutonomy,false);
},{p6At:false}));

test('public P6 additional bubbles never bypass the per-poll cap',async()=>fixture(async h=>{
  h.model(()=>({action:'reply',messages:['一','二','三']}));h.add(7);
  const result=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(result.sent,2);assert.deepEqual(h.sends.map(x=>x.text),['一','二']);
},{replyPerPoll:2}));

test('one continuity ledger filters due entries by channel so DM cannot claim a public @',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-channel-'));let clock=timestamp;
  try{
    const ledger=createSocialContinuityLedger({dataDir,accountUid:SELF,now:()=>clock});
    for(const channel of ['dm','at','comment'])assert.ok(ledger.schedule({uid:PERSON,channel,threadKey:channel+':111',sourceEventId:channel+'-1',
      purpose:'delayed-supplement',notBefore:clock+60000,expiresAt:clock+86400000}).ok);
    clock+=61000;
    assert.equal(ledger.due({channels:['dm']}).length,1);
    assert.equal(ledger.due({channels:['at','comment']}).length,2);
  }finally{await rm(dataDir,{recursive:true,force:true})}
});

test('cross-channel rhythm enforces a shared per-UID cooldown and stops uncertain duplicate attempts',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-rhythm-'));let clock=timestamp;
  try{
    const rhythm=createSocialInteractionRhythm({dataDir,getAccountUid:()=>SELF,now:()=>clock,crossChannelMinutes:30});
    const dm=rhythm.reserve({uid:PERSON,channel:'dm'});assert.equal(dm.ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'at'}).reason,'prior-outcome-unresolved');
    assert.equal(rhythm.settle(dm.id,{outcome:'sent'}).reason,'missing-platform-receipt');
    assert.equal(rhythm.settle(dm.id,{outcome:'sent',receiptId:'verified-dm-key'}).ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'at'}).reason,'cross-channel-cooldown');
    clock+=31*60000;
    const at=rhythm.reserve({uid:PERSON,channel:'at'});assert.equal(at.ok,true);
    assert.equal(rhythm.settle(at.id,{outcome:'uncertain'}).ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'dm'}).reason,'prior-outcome-unresolved');
    assert.doesNotMatch(readFileSync(rhythm.file,'utf8'),new RegExp(PERSON+'|verified-dm-key'));
  }finally{await rm(dataDir,{recursive:true,force:true})}
});

test('public autonomy uses the same Life Voice and rejects public replies over 130 chars',async()=>{
  const x=createInteractionBatcher({invoke:async()=>JSON.stringify({items:[{id:'0',action:'reply',messages:['a'.repeat(131)],reply:'',mood:'neutral',intensity:0}]}),
    getPersona:()=> '唯一 Life Voice 情绪人格',delayMs:0,logger:{warn(){},error(){}}});
  const result=await x.generate({kind:'comment',uid:PERSON,text:'内容',socialAutonomy:true,socialChannel:'at',threadKey:'at:BV:1'});
  assert.equal(result.action,'skip');assert.equal(result.reason,'public-bubble-too-long');x.stop();
});

test('dev.2 UI keeps exact original anchor IDs and defaults both public P6 toggles off',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  assert.match(html,/<details id="comments-settings-collapse"/);
  assert.match(html,/<details id="dm-settings-collapse"/);
  for(const id of ['comments-configuration','comment-at-section','dm-settings-section','comments-records','dm-recent-conversations'])
    assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.ok(html.indexOf('id="comments-settings-collapse"')<html.indexOf('id="comments-records"'));
  assert.ok(html.indexOf('id="dm-settings-collapse"')<html.indexOf('id="dm-recent-conversations"'));
  assert.doesNotMatch(html,/当前视频评论上下文（不再独立轮询热评）/);
  assert.match(script,/revealTarget\(target\)/);
  assert.match(index,/commentP6Enabled: z\.boolean\(\)\.default\(false\)/);
  assert.match(index,/commentAtP6Enabled: z\.boolean\(\)\.default\(false\)/);
  assert.match(index,/dmP6Enabled: z\.boolean\(\)\.default\(true\)/);
});


test('public P6 configurable max bubble limit reduces outgoing sends even if AI proposes three',async()=>fixture(async h=>{
  h.model(()=>({action:'reply',messages:['第一段','第二段','第三段']}));h.add(31);
  const res=await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(res.sent,1);assert.deepEqual(h.sends.map(x=>x.text),['第一段']);
},{p6MaxBubbles:1}));

test('public P6 configured minimum delay rejects premature model scheduling',async()=>fixture(async h=>{
  h.model(()=>({action:'defer',notBefore:h.time()+5*60_000}));h.add(32);
  await h.engine.poll({mentions:true,notifications:false,top:false});
  assert.equal(h.sends.length,0);
  assert.equal(h.ledger().status().counts.scheduled,0);
},{delayMinMinutes:15}));

test('cross-channel policy changes apply to subsequent reservations without restart',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-dev2-dynamic-'));let clock=timestamp;
  const policy={crossChannelMinutes:30,dailyPerPerson:2};
  try{
    const rhythm=createSocialInteractionRhythm({dataDir,getAccountUid:()=>SELF,now:()=>clock,getPolicy:()=>policy});
    const a=rhythm.reserve({uid:PERSON,channel:'dm'});assert.equal(a.ok,true);
    assert.equal(rhythm.settle(a.id,{outcome:'sent',receiptId:'dm-1'}).ok,true);
    assert.equal(rhythm.reserve({uid:PERSON,channel:'at'}).reason,'cross-channel-cooldown');
    policy.crossChannelMinutes=0;
    const b=rhythm.reserve({uid:PERSON,channel:'at'});assert.equal(b.ok,true);
    assert.equal(rhythm.settle(b.id,{outcome:'sent',receiptId:'at-2'}).ok,true);
    const c=rhythm.reserve({uid:PERSON,channel:'dm'});assert.equal(c.ok,true,'retired per-person cap cannot block normal contact');
    assert.equal(rhythm.settle(c.id,{outcome:'sent',receiptId:'dm-3'}).ok,true);
    policy.dailyPerPerson=3;
    const d=rhythm.reserve({uid:PERSON,channel:'dm'});assert.equal(d.ok,true);
    assert.equal(rhythm.settle(d.id,{outcome:'sent',receiptId:'dm-4'}).ok,true);
    policy.dailyPerPerson=1;
    assert.equal(rhythm.reserve({uid:'47723',channel:'dm'}).ok,true,'other UID must have an independent rolling cap');
  }finally{await rm(dataDir,{recursive:true,force:true})}
});

test('P6 settings are persisted through one config schema and used by all three live adapters',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  for(const [key,defaultNumber] of [['dmP6MaxBubbles',3],['commentP6MaxBubbles',2],['socialP6MinDelayMinutes',5],['socialP6MaxDelayMinutes',360],['socialRhythmCrossChannelMinutes',30]]){
    assert.match(index,new RegExp(key+':\\s*z\\.natural\\(\\)\\.default\\('+defaultNumber+'\\)'));
    assert.match(index,new RegExp('cfg\\.'+key));
    assert.match(js,new RegExp(key));
  }
  // Historical daily-person setting remains in schema but is retired from execution and UI.
  assert.match(index,/socialRhythmDailyPerPerson: z\.natural\(\)\.default\(0\)/);
  assert.doesNotMatch(html,/id="social-rhythm-daily"/);
  for(const id of ['dm-p6-max-bubbles','comment-p6-max-bubbles','social-p6-min-delay','social-p6-max-delay','social-rhythm-cooldown'])
    assert.equal(html.split(`id="${id}"`).length-1,1);
  assert.match(html,/data-open-settings="dm-p6-settings"/);
  assert.match(html,/data-target-tab="dm"/);
  assert.match(js,/Promise\.resolve\(loading\)\.then/);
  assert.match(index,/dmP6Enabled: z\.boolean\(\)\.default\(true\)/);
  assert.match(index,/commentP6Enabled: z\.boolean\(\)\.default\(false\)/);
  assert.match(index,/commentAtP6Enabled: z\.boolean\(\)\.default\(false\)/);
});
