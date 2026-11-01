import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'

test('主 Session 注册单条手动点赞工具，并要求真实 BV、总开关、登录与每日额度',async()=>{
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-v2493-like-'))
  const registered=[];let route
  const ctx={
    get(key){return key==='dshHomePath'?(...parts)=>join(home,...parts):undefined},
    logger:{info(){},warn(){}},
    tools:{register(spec){registered.push(spec);return spec}},
    webServer:{register(spec){route=spec;return {dispose(){}}}},
    effect(callback){return callback()},settings:{describe(){return []}},slots:{inject(){},register(){}},
  }
  try{
    apply(ctx,{})
    const spec=registered.find(x=>x?.name==='bili_video_like')
    assert.ok(spec,'主 Session 应注册 bili_video_like')
    assert.match(spec.description,/主人明确要求/)
    const invalid=await spec.execute({bvid:'not-a-bv'})
    assert.equal(invalid.ok,false);assert.match(invalid.error,/BV/)
    // A valid BV without explicit owner confirmation is blocked before any action.
    const noConfirm=await spec.execute({bvid:'BV1pXHK6mE6z'})
    assert.equal(noConfirm.ok,false);assert.equal(noConfirm.needsConfirmation,true)
    // Losing credentials invalidates First Start, so no manually authorized action runs.
    rmSync(join(home,'bili-duty','bili_credential.json'))
    const noLogin=await spec.execute({bvid:'BV1pXHK6mE6z',confirm:true})
    assert.equal(noLogin.ok,false);assert.match(noLogin.error,/首次设置|未登录/)
    const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
    const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
    assert.match(index,/call\('bili_video_like_manual'/)
    assert.match(py,/async def bili_video_like_manual/)
    assert.match(index,/BILI_SESSION_MANUAL_LIKE_ENABLED: '1'/)
    assert.match(index,/Number\(cfg\.autoVideoLikeDailyLimit\) <= 0/)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('自动刷视频的 MCP 白名单仍不开放主 Session 手动点赞工具',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const body=index.slice(index.indexOf('const mcpWhitelist = () =>'),index.indexOf('// 不依赖模型自觉'))
  assert.doesNotMatch(body,/bili_video_like_manual/)
  assert.match(body,/if \(cfg\.autoVideoLike\) list\.push\('bili_video_like'\)/)
})
