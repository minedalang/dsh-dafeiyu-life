import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'
import {listCommentMemes} from '../lib/comment-meme-library.mjs'

test('diagnostics reads actual preview receipts from fixed home directories',async()=>{
 const home=mkdtempSync(join(tmpdir(),'bili-vision-'))
 try{
  let route
  const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
    tools:{register(){}},webServer:{register(spec){route=spec;return {dispose(){}}}},effect(cb){return cb()},settings:{describe(){return []}}}
  apply(ctx,{visionDebug:true,visionEnabled:true})
  const day=new Date().toLocaleDateString('sv-SE')
  const events=join(home,'bili-duty','vision-events');mkdirSync(events,{recursive:true})
  writeFileSync(join(events,day+'.jsonl'),JSON.stringify({time:new Date().toISOString(),bvid:'BV1234567890',source:'video_agent_frames',status:'frames_ready',ok:true,debug_saved:true,times:[21,100]})+'\n')
  const jpeg=join(home,'bili-duty','vision-debug','BV1234567890');mkdirSync(jpeg,{recursive:true});writeFileSync(join(jpeg,'01_21s.jpg'),'safe')
  const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/vision-diagnostics';req.headers={host:'localhost'}
  let code,body;await route.handler(req,{writeHead(x){code=x},end(x){body=JSON.parse(x)}})
  assert.equal(code,200);assert.equal(body.ok,true);assert.equal(body.attempts,1);assert.equal(body.savedJpegs,1)
  assert.equal(body.events[0].status,'frames_ready')
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('management UI distinguishes debug file saving from tool calls, current trigger is less conservative',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(html,/预览识图诊断/);assert.match(js,/vision-diagnostics/)
 assert.match(source,/不要整个轮次惯性拒绝/)
 assert.match(source,/bili_comments\(bvid,num=10\)/)
})
test('catalog can provide representative images across folders even with a large folder',()=>{
 const home=mkdtempSync(join(tmpdir(),'bili-vision-'))
 try {
  for (const cat of ['一个很多图的目录','表情'])mkdirSync(join(home,cat),{recursive:true})
  for (let i=0;i<135;i++)writeFileSync(join(home,'一个很多图的目录',String(i).padStart(3,'0')+'.png'),'png')
  writeFileSync(join(home,'表情','无语.png'),'png')
  const result=listCommentMemes(home,{limit:100,balanced:true})
  assert.equal(result.names.length,100)
  assert.ok(result.names.includes('表情/无语'))
 }finally{rmSync(home,{recursive:true,force:true})}
})
