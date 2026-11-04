import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {recordInterestEvents,selectionInterests} from '../lib/life-interests.mjs'

const ROOT=new URL('../',import.meta.url)
const source=p=>readFileSync(new URL(p,ROOT),'utf8')

test('新视频互动默认关闭且设置路由真正保存、可撤销',async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'dafeiyu-v2484-config-'))
  let handler
  const ctx={get:k=>k==='dshHomePath'?(...p)=>join(tmp,...p):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(spec){handler=spec.handler;return{dispose(){}}}},
    effect:x=>x(),settings:{describe(){return[]}},slots:{register(){},inject(){}}}
  try{
    apply(ctx,{})
    const call=async(method,body)=>{
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url='/api/bili-duty/config';req.headers={host:'localhost'}
      let code=0,output
      const res={writeHead(n){code=n},end(x){output=JSON.parse(x)}}
      await handler(req,res)
      assert.equal(code,200)
      return output.config
    }
    let c=await call('GET')
    assert.equal(c.autoVideoLike,false)
    assert.equal(c.autoVideoCollect,false)
    c=await call('POST',{autoVideoLike:true,autoVideoCollect:true})
    assert.equal(c.autoVideoLike,true)
    assert.equal(c.autoVideoCollect,true)
    c=await call('POST',{autoVideoLike:false,autoVideoCollect:false})
    assert.equal(c.autoVideoLike,false)
    assert.equal(c.autoVideoCollect,false)
    const saved=JSON.parse(readFileSync(join(tmp,'bili-duty','config.json'),'utf8'))
    assert.equal(saved.autoVideoLike,false)
    assert.equal(saved.autoVideoCollect,false)
  }finally{rmSync(tmp,{recursive:true,force:true})}
})

test('真实兴趣先于主人额外关键词，兴趣为空安全冷启动',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'dafeiyu-v2484-interest-'))
  try{
    assert.deepEqual(selectionInterests(tmp),[])
    const now=Date.parse('2026-10-27T12:00:00Z')
    const titles=['美食 料理教学','做饭料理新手','今天做饭下厨']
    const events=titles.map((title,i)=>({kind:'watch',bvid:'BV'+String(i+1).padStart(10,'0'),title,tier:'值得看',autonomousSelected:true,time:new Date(now-(i===0?0:86400000)).toISOString()}))
    assert.equal(recordInterestEvents(tmp,events,now).added,3)
    const selected=selectionInterests(tmp,now)
    assert.equal(selected[0].topic,'白饭与美食')
    assert.equal(selected[0].query,'美食 料理')
    assert.match(source('index.js'),/const videoSearchPlan='兴趣主导搜索：'/)
    assert.match(source('client.js'),/主人额外指定的关注主题/)
  }finally{rmSync(tmp,{recursive:true,force:true})}
})

test('主开关和白名单同时保护点赞收藏，退出了整轮无差别收藏',()=>{
  const js=source('index.js'),py=source('vendor/bilibili-mcp/mcp_server.py'),charter=source('prompts/duty.md')
  assert.match(js,/if \(cfg\.autoVideoLike\) list\.push\('bili_video_like'\)/)
  assert.match(js,/if \(cfg\.autoVideoCollect\) list\.push\('bili_video_collect'\)/)
  assert.match(js,/BILI_AUTO_VIDEO_LIKE/)
  assert.match(js,/BILI_AUTO_VIDEO_COLLECT/)
  assert.doesNotMatch(js,/favToday\('auto'\)/)
  assert.match(py,/_guard\('bili_video_collect'\)/)
  assert.match(py,/_guard\('bili_video_like'\)/)
  assert.match(py,/_claim_video_action\(uid,bv,'like',limit\)/)
  assert.match(py,/_claim_video_action\(uid,bv,'collect',5\)/)
  assert.match(charter,/不必收藏/)
})

test('梗经证据校验直接获批；第4点梗/人生反思合并没有实现',()=>{
  const py=source('vendor/bilibili-mcp/mcp_server.py'),prompt=source('prompts/duty.md'),life=source('lib/life-reflection.mjs')
  assert.match(py,/VALUES\(\?,\?,\?,\?,\?,\?,\?, \?, 'approved'\)/)
  assert.match(py,/_MEME_FORBIDDEN/)
  assert.match(py,/source_type == '低清预览'/)
  assert.match(prompt,/无需主人逐条审批/)
  assert.doesNotMatch(life,/meme-memory\.sqlite3|meme_category|梗类别/)
})

test('完整业务备份含新增点赞收藏账本与原梗库',()=>{
  assert.match(source('lib/data-backup-sqlite.py'),/video-actions\.sqlite3/)
  assert.match(source('lib/data-backup.mjs'),/video-actions\.sqlite3/)
  assert.match(source('lib/data-backup-sqlite.py'),/meme-memory\.sqlite3/)
})
