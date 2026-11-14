import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs';
import {apply} from '../index.js';

const delay=()=>new Promise(r=>setTimeout(r,10));
test('后台只轮询私信、评论通知和@；旧热评开关不再触发轮询',async()=>{
  let clock=1_800_000_000_000,dmCalls=0,commentCalls=[];
  const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:1,commentWatchReplies:true,commentReplyWatchMinutes:3,
    commentAtEnabled:true,commentAtWatchMinutes:7,commentWatchTop:true,commentTopWatchMinutes:5};
  const s=createInteractionScheduler({dm:{poll:async()=>{dmCalls++;return {sent:0}}},comments:{poll:async args=>{commentCalls.push(args);return {sent:1}}},getConfig:()=>cfg,now:()=>clock});
  try{
    s.start();await delay();
    assert.equal(dmCalls,1);assert.equal(commentCalls.length,1);
    assert.deepEqual(commentCalls[0],{notifications:true,mentions:true,top:false});
    let state=s.status();assert.equal(state.checks.mentions.intervalMinutes,7);
    assert.equal(state.checks.replies.lastStartedAt,clock);
    assert.equal(state.checks.replies.lastFinishedAt,clock);
    assert.equal(state.checks.replies.nextAt,clock+3*60_000);
    clock+=60_000;await s.tick();assert.equal(dmCalls,2);assert.equal(commentCalls.length,1);
    clock+=2*60_000;await s.tick();assert.equal(dmCalls,3);assert.equal(commentCalls.length,2);
    assert.deepEqual(commentCalls.at(-1),{notifications:true,mentions:false,top:false});
    clock+=2*60_000;await s.tick();assert.equal(commentCalls.length,2); // no top polling at 5-minute mark
    clock+=2*60_000;await s.tick();assert.deepEqual(commentCalls.at(-1),{notifications:true,mentions:true,top:false});
  }finally{s.stop()}
});
test('修改间隔动态生效，关闭后不排下次，重新启用不清除上次检查',async()=>{
  let clock=1_800_000_000_000,calls=0;
  const cfg={masterEnabled:true,dmWatch:false,commentWatchReplies:true,commentReplyWatchMinutes:20,commentAtEnabled:false,commentWatchTop:false};
  const s=createInteractionScheduler({dm:{poll:async()=>{}},comments:{poll:async()=>{calls++;return {sent:0}}},getConfig:()=>cfg,now:()=>clock});
  try {
    s.start();await delay();assert.equal(calls,1);
    clock+=120_000;cfg.commentReplyWatchMinutes=1;assert.equal(s.status().checks.replies.nextAt,clock);
    await s.tick();assert.equal(calls,2);
    cfg.commentWatchReplies=false;assert.equal(s.status().checks.replies.nextAt,null);
    clock+=360_000;await s.tick();assert.equal(calls,2);
    cfg.commentWatchReplies=true;await s.tick();assert.equal(calls,3);
    cfg.masterEnabled=false;assert.equal(s.status().checks.replies.enabled,false);
    clock+=360_000;await s.tick();assert.equal(calls,3);
  }finally{s.stop()}
});
test('执行失败和跳过分别显示状态，不能误报成功',async()=>{
  let clock=1_800_000_000_000;
  const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:1,commentAtEnabled:false,commentWatchReplies:true,commentReplyWatchMinutes:1,commentWatchTop:false};
  const s=createInteractionScheduler({dm:{poll:async()=>({error:'网络断开'})},comments:{poll:async()=>({skipped:'global-quota-exhausted'})},getConfig:()=>cfg,now:()=>clock});
  try {s.start();await delay();const x=s.status();assert.equal(x.checks.dm.lastResult,'error');assert.equal(x.checks.dm.lastError,'网络断开');assert.equal(x.checks.replies.lastResult,'skipped');assert.equal(x.checks.replies.lastDetails.skipped,'global-quota-exhausted');}
  finally{s.stop()}
});
test('插件 HTTP 配置保存四项轮询分钟数并合理钳制，无需改旧私信字段',async()=>{
  const home=mkdtempSync(join(tmpdir(),'v2453-ui-'));let route;
  try{
    apply({get(k){return k==='dshHomePath'?(...x)=>join(home,...x):undefined},logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{});
    async function req(method,path,body){const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
      request.method=method;request.url=path;request.headers={host:'localhost'};
      let out;const response={writeHead(){},end(v){out=JSON.parse(v)}};await route.handler(request,response);return out;
    }
    let c=await req('GET','/api/bili-duty/config');
    assert.equal(c.config.commentReplyWatchMinutes,2);assert.equal(c.config.commentAtWatchMinutes,2);assert.equal(c.config.dmQuietMaxMinutes,15);assert.equal(c.config.commentTopWatchMinutes,5);
    c=await req('POST','/api/bili-duty/config',{dmWatchMinutes:4,dmQuietMaxMinutes:40,commentReplyWatchMinutes:8,commentAtWatchMinutes:2,commentTopWatchMinutes:18});
    assert.equal(c.config.dmWatchMinutes,4);assert.equal(c.config.dmQuietMaxMinutes,40);assert.equal(c.config.commentReplyWatchMinutes,8);
    assert.equal(c.config.commentAtWatchMinutes,2);assert.equal(c.config.commentTopWatchMinutes,18);
    c=await req('POST','/api/bili-duty/config',{commentAtWatchMinutes:999,commentTopWatchMinutes:0});
    assert.equal(c.config.commentAtWatchMinutes,120);assert.equal(c.config.commentTopWatchMinutes,5);
  }finally{rmSync(home,{recursive:true,force:true})}
});
test('管理中心只有后台轮询可以修改间隔，并显示上次下次和异常',()=>{
 const h=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 for(const id of ['polling','dm-interval','dm-quiet-max','poll-replies-minutes','poll-at-minutes','polling-status-list'])assert.match(h,new RegExp(`id="${id}"|data-tab="${id}"`));
 for(const key of ['dmWatchMinutes','dmQuietMaxMinutes','commentReplyWatchMinutes','commentAtWatchMinutes','nextAt','lastFinishedAt'])assert.match(js,new RegExp(key));
 assert.doesNotMatch(js,/\['dm-interval','dmWatchMinutes',1,120,1\]/);
 assert.match(h,/name="polling-choice"/);assert.doesNotMatch(h,/id="poll-top-minutes"/);
 assert.equal((h.match(/id="dm-interval"/g)||[]).length,1);
});
