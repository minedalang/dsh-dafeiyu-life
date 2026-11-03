import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {avToBv,bvToAv} from '../lib/bv-to-av.mjs';
import {normalizeAtNotifications,atNoticeVideoReference} from '../lib/comment-inbox.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const me='900000',sender='485221842',bv='BV17x411w7KC',aid=bvToAv(bv);
const clock=Date.parse('2026-11-03T16:33:40+08:00');
const payload=(id,props={})=>({id:String(id),at_time:Math.floor((clock-15_000)/1000),
  user:{mid:sender,nickname:'Zoroxs'},item:{business_id:1,business:'评论',source_id:String(id+45000),
   root_id:'0',target_id:'0',subject_id:aid,
   uri:`https://www.bilibili.com/video/${bv}/`,at_details:[{mid:me,nickname:'大肥鱼'}],
   source_content:'',...props}});
const wrap=items=>({at:{code:0,data:{items}}});
const config={watchAt:true,replyAt:true,atMode:'all',replyPerPoll:3,replyPerDay:20,globalDailyLimit:100};
const fixture=async body=>{const dir=await mkdtemp(join(tmpdir(),'dsh-at-recovery-'));try{await body(dir)}finally{await rm(dir,{recursive:true,force:true})}};

// The notification is NOT the original comment. A missing body must not silently
// become an @-only invitation, nor should it be emitted as an empty model prompt.
test('Zoroxs: an @ with missing notification body is preserved for verified-source lookup',()=>{
  const notices=normalizeAtNotifications(wrap([payload(11)]),me);
  assert.equal(notices.length,1);
  assert.equal(notices[0].uid,sender);
  assert.equal(notices[0].sourceTextMissing,true);
  assert.equal(notices[0].rpid,'45011');
  assert.equal(notices[0].bvid,bv);
});

test('official B站 app video deeplink restores video AID; unrelated URLs/titles never become evidence',()=>{
  const raw=payload(12,{subject_id:'',uri:'',native_uri:'bilibili://video/av170001?comment_root_id=45012'});
  assert.deepEqual(atNoticeVideoReference(raw),{bvid:'BV17x411w7KC',aid:'170001'});
  const malicious=payload(13,{subject_id:'',uri:'https://evil.invalid/video/'+bv,native_uri:'',bvid:'',title:`视频${bv}`});
  assert.equal(atNoticeVideoReference(malicious).bvid,'');
  const drop=[];const items=normalizeAtNotifications(wrap([malicious]),me,{onIgnored:x=>drop.push(x)});
  assert.equal(items.length,0);assert.equal(drop[0].reason,'video_reference_missing');
  assert.equal(drop[0].uid,sender);assert.equal(drop[0].rpid,'45013');
});

test('verified source recovers real comment text before social inbound and AI; no forced send',async()=>fixture(async dir=>{
  let notices=[payload(20,{source_content:'@大肥鱼'})];let fetched=0,sendCount=0;
  const generated=[],incoming=[];
  const engine=createCommentInteract({dataDir:dir,now:()=>clock,
    selfUid:()=>me,getConfig:()=>config,getAtNotifications:async()=>wrap(notices),
    getOwnComments:async()=>({top:[],nested:[]}),socialTier:()=> 'friend',
    getAtSource:async x=>{fetched++;return {ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,topLevel:true,
      text:'@大肥鱼 这期视频的字幕挺有意思，鱼鱼怎么看？'}},
    getVideoContext:async()=>({usable:true,text:'本轮视频评论上下文已核实'}),
    onIncoming:async x=>{incoming.push(x.text);return {consumed:false}},
    generateReply:async req=>{generated.push(req);return '我想先看看字幕里说了什么呀'},
    send:async()=>{sendCount++;return {ok:true,rpid:'89232'}}});
  await engine.poll({notifications:false,top:false,mentions:true}); // first start baselines history
  assert.equal(fetched,0);assert.equal(sendCount,0);
  notices.push(payload(21));
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(fetched,1);assert.equal(sendCount,1);
  assert.equal(incoming.at(-1),'这期视频的字幕挺有意思，鱼鱼怎么看？');
  assert.equal(generated.length,1);
  assert.equal(generated[0].text,incoming.at(-1));
  assert.equal(engine.status().atDiagnostics.find(x=>x.id==='at:21').reason,'sent');
}));

test('verified source with contiguous @ nickname does not claim there was no message',async()=>fixture(async dir=>{
  let notices=[payload(30)];const inputs=[];
  const engine=createCommentInteract({dataDir:dir,now:()=>clock,
    selfUid:()=>me,getConfig:()=>config,getAtNotifications:async()=>wrap(notices),
    getOwnComments:async()=>({top:[],nested:[]}),socialTier:()=> 'friend',
    getAtSource:async x=>({ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,topLevel:true,text:'@大肥鱼你刚刚看了那个视频吗？'}),
    getVideoContext:async()=>({usable:true,text:'视频标题已核实'}),
    generateReply:async x=>{inputs.push(x.text);return '我得先弄清楚是哪一段啦'},
    send:async()=>({ok:true,rpid:'80002'})});
  await engine.poll({notifications:false,top:false,mentions:true});
  notices=[...notices,payload(31,{source_content:'@大肥鱼你刚刚看了那个视频吗？'})];
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(inputs.length,1);
  assert.match(inputs[0],/原评论/);
  assert.match(inputs[0],/你刚刚看了那个视频吗/);
}));

test('author mismatch never lets a notification impersonate a comment or enter AI',async()=>fixture(async dir=>{
  let notices=[payload(40)];let generated=0,incoming=0,sent=0;
  const engine=createCommentInteract({dataDir:dir,now:()=>clock,
    selfUid:()=>me,getConfig:()=>config,getAtNotifications:async()=>wrap(notices),
    getOwnComments:async()=>({top:[],nested:[]}),socialTier:()=> 'friend',
    getAtSource:async x=>({ok:true,uid:'123456789',rpid:x.rpid,bvid:x.bvid,text:'假的原文'}),
    getVideoContext:async()=>({usable:true,text:'真实上下文'}),
    onIncoming:async()=>{incoming++},generateReply:async()=>{generated++;return '不能发'},
    send:async()=>{sent++;return {ok:true}}});
  await engine.poll({notifications:false,top:false,mentions:true});
  notices.push(payload(41));
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(generated,0);assert.equal(incoming,0);assert.equal(sent,0);
  assert.equal(engine.status().atDiagnostics.find(x=>x.id==='at:41').reason,'mention_source_unverified');
  assert.equal(engine.status().atDiagnostics.find(x=>x.id==='at:41').timestampMs,clock-15000);
}));


test('temporary B站 source lookup failures are retried within 24h without empty AI calls',async()=>fixture(async dir=>{
  let current=clock,notices=[payload(70)],lookups=0,sent=0;
  const engine=createCommentInteract({dataDir:dir,now:()=>current,
    selfUid:()=>me,getConfig:()=>config,getAtNotifications:async()=>wrap(notices),
    getOwnComments:async()=>({top:[],nested:[]}),socialTier:()=> 'friend',
    getAtSource:async x=>{lookups++;return lookups===1?{ok:false,reason:'临时风控'}:
      {ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,text:'@大肥鱼 说说刚才那段字幕',topLevel:true}},
    getVideoContext:async()=>({usable:true,text:'本轮视频字幕已取得'}),
    generateReply:async()=> '我再瞅瞅呀',send:async()=>{sent++;return {ok:true,rpid:'90120'}}});
  await engine.poll({notifications:false,top:false,mentions:true});
  notices.push(payload(71));
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(lookups,1);assert.equal(sent,0);
  assert.equal(engine.status().atDiagnostics.find(x=>x.id==='at:71').reason,'waiting_for_mention_source');
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(lookups,1); // within cooldown
  current+=6*60_000;
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(lookups,2);assert.equal(sent,1);
}));

test('parser v2 upgrade baselines previously excluded @ without replaying old public replies',async()=>fixture(async dir=>{
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({version:1,
    atBootstrapped:true,atParserVersion:2,notificationBootstrapped:true,seen:{},sent:[],replyRecords:[]}));
  let notices=[payload(80,{source_content:'@大肥鱼你看看这段字幕？'})],sent=0,fetched=0;
  const engine=createCommentInteract({dataDir:dir,now:()=>clock,
    selfUid:()=>me,getConfig:()=>config,getAtNotifications:async()=>wrap(notices),
    getOwnComments:async()=>({top:[],nested:[]}),socialTier:()=> 'friend',
    getAtSource:async x=>{fetched++;return {ok:true,uid:x.uid,rpid:x.rpid,bvid:x.bvid,text:'@大肥鱼 你好'}},
    getVideoContext:async()=>({usable:true,text:'公开字幕'}),
    generateReply:async()=> '你好呀',send:async()=>{sent++;return {ok:true,rpid:'89000'}}});
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(sent,0);assert.equal(fetched,0);
  assert.equal(engine.status().atDiagnostics.find(x=>x.id==='at:80').reason,'parser_upgrade_baseline');
  notices.push(payload(81,{source_content:'@大肥鱼 最近怎样'}));
  await engine.poll({notifications:false,top:false,mentions:true});
  assert.equal(sent,1);
}));
