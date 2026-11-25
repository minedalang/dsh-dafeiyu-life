import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

// 旧版用户升级后的持久化设置可能仍含旧键，但不能重新开启刷视频楼中楼回复。
test('旧回复设置不会恢复：配置、UI 与提示词均不再开启跑一轮回复评论', async () => {
  const home=mkdtempSync(join(tmpdir(),'dsh-split-'))
  let route
  const ctx={
    get(k){return k==='dshHomePath' ? (...xs)=>join(home,...xs) : undefined},
    logger:{info(){},warn(){}}, tools:{register(){}},
    connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(spec){route=spec;return {dispose(){}}}},
    effect(cb){return cb()}, settings:{describe(){return []}},
  }
  try{
    const persisted=join(home,'bili-duty')
    mkdirSync(persisted,{recursive:true})
    writeFileSync(join(persisted,'config.json'),JSON.stringify({replyToComments:true,replyPerRound:10,commentWatchReplies:false}))
    apply(ctx,{})
    async function request(method,path,body){
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let result,code
      const res={writeHead(c){code=c},end(x){result=JSON.parse(x)}}
      await route.handler(req,res)
      assert.equal(code,200)
      return result
    }
    const patched=await request('POST','/api/bili-duty/config',{
      replyToComments:true,replyPerRound:10, commentWatchReplies:true,
    })
    assert.equal('replyToComments' in patched.config,false)
    assert.equal('replyPerRound' in patched.config,false)
    assert.equal(patched.config.commentWatchReplies,true)
    const cfg=await request('GET','/api/bili-duty/config')
    assert.equal(cfg.config.commentWatchReplies,true)
    assert.equal('replyToComments' in cfg.config,false)
    const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
    assert.doesNotMatch(client,/replyToComments|replyPerRound|每轮最多回几条/)
    const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
    assert.match(index,/BILI_DUTY_TOP_LEVEL_ONLY/)
    assert.match(index,/rpid: 0,\s*root: 0,/)
    assert.match(index,/commentWatchReplies/)
    const security=readFileSync(new URL('../lib/headless-security.mjs',import.meta.url),'utf8')
    assert.match(security,/HEADLESS_DENY_TOOLS/)
    assert.doesNotMatch(index,/cfg\.replyToComments|cfg\.replyPerRound/)
    const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
    assert.match(charter,/只负责发顶层原创评论/)
    assert.doesNotMatch(charter,/只有开头告诉你「回复评论：开着」/)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('v2.4.2 总开关与今日评论硬配额仍保留',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  assert.match(index,/masterEnabled/)
  assert.match(index,/commentDailyLimit/)
  const mcp=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  assert.match(mcp,/public-comment-quota/)
  assert.match(client,/大肥鱼总开关/)
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(html,/公开评论全局每日硬上限/)
})
