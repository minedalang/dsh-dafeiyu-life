import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

import {mkdirSync} from 'node:fs'

function fixture({saved={},hostSettings=null}={}){
  const root=mkdtempSync(join(tmpdir(),'bili281-legacy-config-'))
  const home=join(root,'bili-duty');mkdirSync(home,{recursive:true})
  const file=join(home,'config.json')
  writeFileSync(file,JSON.stringify({masterEnabled:false,dmWatch:false,commentAtEnabled:false,commentWatchReplies:false,...saved}))
  let route
  const ctx={
    get:k=>k==='dshHomePath'?(...parts)=>join(root,...parts):undefined,
    logger:{info(){},warn(){},error(){}},tools:{register(){}},
    webServer:{register(spec){route=spec;return {dispose(){}}}},
    settings:{describe:()=>hostSettings?[{value:{perDay:50,mentionName:'',overlayMcp:true,...hostSettings},user:hostSettings}]:[]},
    effect(fn){return fn()},
  }
  const close=()=>rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:100})
  try{apply(ctx,{});assert.ok(route?.handler,'Plugin must install config HTTP route')}
  catch(e){close();throw e}
  async function request(method,path,body){
    const req=Readable.from(body!==undefined?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.url=path;req.headers={host:'localhost'}
    let status=200,response=''
    const res={writeHead(code){status=code},end(str){response=String(str||'')}}
    await route.handler(req,res)
    return {status,body:JSON.parse(response)}
  }
  return {request,file,close}
}

test('升级以前保存的 2/15 分钟旧值不阻断插件激活或管理页',async()=>{
 const fx=fixture({saved:{dmWatchMinutes:2,dmQuietMaxMinutes:15}})
 try{
  const before=readFileSync(fx.file,'utf8')
  const {status,body}=await fx.request('GET','/api/bili-duty/config')
  assert.equal(status,200)
  assert.equal(body.config.dmWatchMinutes,5)
  assert.equal(body.config.dmQuietMaxMinutes,15)
  assert.equal(readFileSync(fx.file,'utf8'),before,'Do not rewrite legacy file on boot or read')
  const invalid=await fx.request('POST','/api/bili-duty/config',{dmWatchMinutes:2})
  assert.notEqual(invalid.body?.config?.dmWatchMinutes,2,'Explicit user write must not bypass 5-minute floor')
  assert.equal(readFileSync(fx.file,'utf8'),before,'Rejected update must not alter old config')
 }finally{fx.close()}
})

test('以前保存的 1/1 分钟旧值安全提升生效值到 5/5 不污染存档',async()=>{
 const fx=fixture({saved:{dmWatchMinutes:1,dmQuietMaxMinutes:1}})
 try{
  const before=readFileSync(fx.file,'utf8')
  const {body}=await fx.request('GET','/api/bili-duty/config')
  assert.equal(body.config.dmWatchMinutes,5)
  assert.equal(body.config.dmQuietMaxMinutes,5)
  assert.equal(readFileSync(fx.file,'utf8'),before)
 }finally{fx.close()}
})

test('已有合法设置 5/15 不被改变，主动保存合法设置成功',async()=>{
 const fx=fixture({saved:{dmWatchMinutes:5,dmQuietMaxMinutes:15}})
 try{
  const {body}=await fx.request('GET','/api/bili-duty/config')
  assert.equal(body.config.dmWatchMinutes,5)
  assert.equal(body.config.dmQuietMaxMinutes,15)
  const accepted=await fx.request('POST','/api/bili-duty/config',{dmWatchMinutes:5,dmQuietMaxMinutes:20})
  assert.equal(accepted.body?.config?.dmQuietMaxMinutes,20)
 }finally{fx.close()}
})

test('旧 DSH 宿主设置 2/2 也能在加载时安全归一化',async()=>{
 const fx=fixture({hostSettings:{dmWatchMinutes:2,dmQuietMaxMinutes:2}})
 try{
  const {body}=await fx.request('GET','/api/bili-duty/config')
  assert.equal(body.config.dmWatchMinutes,5)
  assert.equal(body.config.dmQuietMaxMinutes,5)
 }finally{fx.close()}
})
