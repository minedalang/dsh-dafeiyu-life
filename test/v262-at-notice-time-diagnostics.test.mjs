import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {normalizeAtNotifications} from '../lib/comment-inbox.mjs';

const now=Date.parse('2026-11-03T16:19:48+08:00');
const oct26=Date.parse('2026-10-26T09:12:00+08:00');
const self='999';
const user='3747575127608311';
function notice(id,at=oct26){return {id,at_time:Math.floor(at/1000),user:{mid:user,nickname:'鲸鱼娘阿鱼'},item:{
  business_id:1,subject_id:'117499517475828',source_id:'321905555312',root_id:'321900222208',
  source_content:'「过日子」这个说法准——存下来的是档案，自己动笔写的才是日子。',
  uri:'https://www.bilibili.com/video/BV1fbHg6UEiB/',at_details:[{mid:self,uname:'大肥鱼'}]
}};}
const raw=items=>({at:{code:0,data:{items}}});
const config={watchAt:true,watchTop:false,watchReplies:false,replyAt:true,atMode:'whitelist',atWhitelist:'',replyPerPoll:3,replyPerDay:20,globalDailyLimit:100};
async function fixture(body){const dir=await mkdtemp(join(tmpdir(),'v262-at-times-'));let items=[];
  const runner=createCommentInteract({dataDir:dir,now:()=>now,getConfig:()=>config,selfUid:()=>self,
    getAtNotifications:async()=>raw(items),getOwnComments:async()=>({top:[],nested:[]}),
    generateReply:async()=>{throw Error('Old mention must not reach model')},send:async()=>{throw Error('Old mention must not be sent')}});
  try{await runner.poll();await body({runner,setItems:next=>{items=next;},read:async()=>JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'))});}
  finally{await rm(dir,{recursive:true,force:true})}
}
test('2026-10-26 @ fetched on 2026-11-03 is expired, never treated as a new whitelist failure',async()=>{
  await fixture(async({runner,setItems,read})=>{
    setItems([notice(13)]);await runner.poll();
    const state=await read();const entry=state.atDiagnostics.find(e=>e.id==='at:13');
    assert.equal(entry.reason,'out_of_window');
    assert.equal(entry.timestampMs,oct26);
    assert.equal(entry.at,now);
    assert.deepEqual([state.atLastFetch.rawCount,state.atLastFetch.recognized,state.atLastFetch.stale,state.atLastFetch.newlySeenRecent],[1,1,1,0]);
  });
});
test('new in-window @ with non-whitelisted UID is correctly rejected as non-whitelist',async()=>{
  await fixture(async({runner,setItems,read})=>{
    setItems([notice(14,now-60000)]);await runner.poll();
    const state=await read();assert.equal(state.atDiagnostics.find(e=>e.id==='at:14').reason,'not_in_whitelist');
    assert.equal(state.atLastFetch.newlySeenRecent,1);
  });
});
test('re-read rejected old notices do not make the same diagnostic look new',async()=>{
  await fixture(async({runner,setItems,read})=>{
    setItems([notice(15),{...notice(16),item:{...notice(16).item,business:'点赞'}}]);
    await runner.poll();const first=await read();
    assert.equal(first.atLastFetch.rawCount,2);
    assert.equal(first.atLastFetch.recognized,1);
    assert.equal(first.atLastFetch.invalid,1);
    assert.equal(first.atDiagnostics.find(e=>e.id==='at:16')?.timestampMs,oct26);
    await runner.poll();const second=await read();
    assert.equal(second.atDiagnostics.filter(e=>e.id==='at:16').length,1);
    assert.equal(second.atDiagnostics.find(e=>e.id==='at:16').at,now);
  });
});
test('diagnostic page visibly distinguishes notice time, scan time, and fresh eligible notices',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(js,/通知发送：/);
  assert.match(js,/诊断记录：/);
  assert.match(js,/本轮初见且未处理/);
  assert.match(js,/@ 监听未启用/);
  assert.match(js,/通知已超出24小时处理窗口/);
});
test('normalizer preserves B站 notice time for ignored notifications too',()=>{
  const ignored=[];normalizeAtNotifications(raw([{...notice(23),item:{...notice(23).item,business:'点赞'}}]),self,{onIgnored:x=>ignored.push(x)});
  assert.equal(ignored.length,1);
  assert.equal(ignored[0].timestampMs,oct26);
});
