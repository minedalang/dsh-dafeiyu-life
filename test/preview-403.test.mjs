import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'

function createHost(home) {
  let route
  const ctx={
    get(k){return k==='dshHomePath' ? (...p)=>join(home,...p) : undefined},
    logger:{info(){},warn(){}}, tools:{register(){}},
    webServer:{register(spec){route=spec;return {dispose(){}}}},
    effect(cb){return cb()}, settings:{describe(){return []}},
  }
  apply(ctx,{})
  return async (method, url, body, headers={host:'localhost'})=>{
    const req=Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    req.method=method;req.url=url;req.headers=headers
    let status, result
    const res={writeHead(c){status=c},end(s){result=JSON.parse(s)}}
    await route.handler(req,res)
    return {status, result}
  }
}

test('手动测试预览：总开关关了仍允许进入预览诊断，不会因此403',async()=>{
  const home=mkdtempSync(join(tmpdir(),'dsh-vision-manual-'))
  try {
    const http=createHost(home)
    const save=await http('POST','/api/bili-duty/config',{
      masterEnabled:false,visionDebug:true,visionEnabled:false,
      pythonPath:'__missing_python_for_vision_test__',
    })
    assert.equal(save.status,200)
    assert.equal(save.result.config.masterEnabled,false)
    assert.equal(save.result.config.visionDebug,true)
    const preview=await http('POST','/api/bili-duty/vision-preview-test',{bvid:'BV1EopJ6LEth'})
    assert.equal(preview.status,200,JSON.stringify(preview))
    assert.equal(preview.result.ok,false)
    assert.match(preview.result.error,/Python 启动失败/)
    const untrusted=await http('POST','/api/bili-duty/vision-preview-test',{bvid:'BV1EopJ6LEth'},
      {host:'localhost',origin:'https://evil.example'})
    assert.equal(untrusted.status,403)
    assert.equal(untrusted.result.error,'只接受本机同源请求')
  } finally {rmSync(home,{recursive:true,force:true})}
})

test('HTTP 错误详情由服务端提供，前端不再把 403 冒充宿主错误',()=>{
  const js=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  assert.match(js,/detail\.error/)
  assert.doesNotMatch(js,/被宿主拦了/)
})
