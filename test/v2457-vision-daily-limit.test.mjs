import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {apply} from '../index.js';

const root=new URL('..',import.meta.url);
const src=path=>readFileSync(new URL(path,root),'utf8');
test('独立视觉每日上限与取帧数分开保存，范围与默认值正确',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'v2457-test-'));let route;
 try{
  apply({get(key){return key==='dshHomePath'?(...names)=>join(dir,...names):undefined},logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(def){route=def;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{});
  const ask=async(method,path,body)=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.url=path;req.method=method;req.headers={host:'localhost'};
    let out;const res={writeHead(){},end(data){out=JSON.parse(data)}};await route.handler(req,res);return out;
  };
  const initial=await ask('GET','/api/bili-duty/config');
  assert.equal(initial.config.visionDailyLimit,30);
  assert.equal(initial.config.visionFrames,2);
  let saved=await ask('POST','/api/bili-duty/config',{visionDailyLimit:90,visionFrames:3});
  assert.equal(saved.config.visionDailyLimit,90);assert.equal(saved.config.visionFrames,3);
  saved=await ask('POST','/api/bili-duty/config',{visionDailyLimit:500,visionFrames:0});
  assert.equal(saved.config.visionDailyLimit,200);assert.equal(saved.config.visionFrames,2);
  saved=await ask('POST','/api/bili-duty/config',{visionDailyLimit:0});
  assert.equal(saved.config.visionDailyLimit,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('额度表单和两条 Python 路线接入可配置上限，UI解释 0 的含义',()=>{
 const html=src('lib/management-console.html'),js=src('lib/management-console.js');
 const index=src('index.js'),py=src('lib/preview_vision.py'),dsh=src('lib/vision_dsh.py');
 assert.match(html,/id="quota-vision-daily" type="number" min="0" max="200"/);
 assert.match(js,/\['quota-vision-daily','visionDailyLimit',0,200,30\]/);
 // 旧复用视频模型入口已退役；两种独立视觉方式按真实调用计入统一额度。
 assert.match(js,/独立视觉调用/);
 assert.ok(index.split('BILI_VISION_DAILY_LIMIT').length>=3);
 assert.match(py,/def _vision_daily_limit\(env=None\)/);
 assert.match(dsh,/_vision_daily_limit\(env\)/);
 assert.doesNotMatch(js,/固定硬上限 8 次/);
});
