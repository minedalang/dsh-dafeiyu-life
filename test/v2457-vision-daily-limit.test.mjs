import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {apply} from '../index.js';

const root=new URL('..',import.meta.url);
const src=path=>readFileSync(new URL(path,root),'utf8');
test('旧每日视觉限额不再影响取帧卡片，历史字段写入无效',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'v2457-test-'));let route;
 try{
  apply({get(key){return key==='dshHomePath'?(...names)=>join(dir,...names):undefined},logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(def){route=def;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{});
  const ask=async(method,path,body)=>{
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=method;req.headers={host:'localhost'};
   let out;const res={writeHead(){},end(data){out=JSON.parse(data)}};await route.handler(req,res);return out;
  };
  const initial=await ask('GET','/api/bili-duty/config');
  assert.equal(initial.config.visionDailyLimit,undefined);
  assert.equal(initial.config.visionFrames,24);
  let saved=await ask('POST','/api/bili-duty/config',{visionDailyLimit:0,visionFrames:48});
  assert.equal(saved.config.visionDailyLimit,undefined,'旧字段不能继续禁用视觉模型');
  assert.equal(saved.config.visionFrames,48);
  saved=await ask('POST','/api/bili-duty/config',{visionFrames:12});
  assert.equal(saved.config.visionFrames,12);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('视觉每日上限在配置、UI、本地和 DSH 执行路径中全部撤销',()=>{
 const html=src('lib/management-console.html'),js=src('lib/management-console.js');
 const index=src('index.js'),py=src('lib/preview_vision.py'),dsh=src('lib/vision_dsh.py');
 for(const text of [html,js,index,py,dsh]){
   assert.doesNotMatch(text,/BILI_VISION_DAILY_LIMIT|_claim_vision_quota|def _vision_daily_limit/);
 }
 assert.doesNotMatch(html,/quota-vision-daily|每天最多额外调用独立视觉模型/);
 assert.doesNotMatch(js,/visionDailyLimit/);
 assert.doesNotMatch(index,/visionDailyLimit/);
 assert.match(html,/data-vision-frame-plan="12"/);
 assert.match(html,/data-vision-frame-plan="24"/);
 assert.match(html,/data-vision-frame-plan="48"/);
 assert.match(py,/def _record_vision_attempt\(home\)/);
 assert.match(dsh,/_record_vision_attempt\(home\)/);
});
