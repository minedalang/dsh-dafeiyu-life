import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'

const root = new URL('../',import.meta.url)
test('评论附梗图的设置、host白名单与调度配置一致',async()=>{
  const home=mkdtempSync(join(tmpdir(),'bili-memes-'))
  try {
    let route
    const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(spec){route=spec;return {dispose(){}}}},effect(cb){return cb()},settings:{describe(){return []}}}
    apply(ctx,{})
    async function call(method,path,body){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let status,value;const res={writeHead(s){status=s},end(data){value=JSON.parse(data)}}
      await route.handler(req,res);return {status,value}}
    const up=await call('POST','/api/bili-duty/config',{commentMemesEnabled:true,commentMemesDebug:true,
       commentMemesPerDay:999,commentMemesPerRound:99})
    assert.equal(up.status,200)
    assert.equal(up.value.config.commentMemesEnabled,true)
    assert.equal(up.value.config.commentMemesPerDay,999)
    assert.equal(up.value.config.commentMemesPerRound,5)
    const more=await call('POST','/api/bili-duty/config',{commentMemesPerDay:999999})
    assert.equal(more.value.config.commentMemesPerDay,10000)
    const lower=await call('POST','/api/bili-duty/config',{commentMemesPerDay:0})
    assert.equal(lower.value.config.commentMemesPerDay,0)
    const files=await call('GET','/api/bili-duty/comment-memes')
    assert.equal(files.status,200)
    assert.equal(files.value.ok,true)
    assert.deepEqual(files.value.names,[])
  } finally {rmSync(home,{recursive:true,force:true})}
})
test('界面和Python MCP具备完整附图控制，默认关闭',()=>{
  const i=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const c=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  const m=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  assert.match(i,/commentMemesEnabled: false/)
  assert.match(i,/BILI_COMMENT_MEMES_PER_ROUND/)
  assert.match(i,/bili_comment_meme_list/)
  assert.match(c,/评论附表情包/)
  assert.match(readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),/表情包、梗知识和视觉/)
  assert.match(m,/meme_image_name/)
  assert.match(m,/reserve_attempt/)
})

test('WebP 在本地梗图库 HTTP 列表中可见，并允许中文文件名',async()=>{
  const {writeFileSync,mkdirSync} = await import('node:fs')
  const home=mkdtempSync(join(tmpdir(),'bili-meme-webp-'))
  try {
    mkdirSync(join(home,'bili-duty','comment-memes'),{recursive:true})
    writeFileSync(join(home,'bili-duty','comment-memes','奶龙大笑.webp'),Buffer.from('RIFF----WEBP'))
    let route
    const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(spec){route=spec;return {dispose(){}}}},effect(cb){return cb()},settings:{describe(){return []}}}
    apply(ctx,{})
    const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/comment-memes';req.headers={host:'localhost'}
    let status,value;const res={writeHead(s){status=s},end(data){value=JSON.parse(data)}}
    await route.handler(req,res)
    assert.equal(status,200)
    assert.equal(value.ok,true)
    assert.ok(value.names.includes('奶龙大笑'))
  }finally{rmSync(home,{recursive:true,force:true})}
})
