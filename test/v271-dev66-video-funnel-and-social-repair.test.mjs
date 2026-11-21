import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {summarizeVideoFunnel,consumeVideoFunnel,videoFunnelReport} from '../lib/video-round-funnel.mjs'
import {classifyVideoCommentRound} from '../lib/video-comment-readiness.mjs'
import {mcpIntegrity} from '../lib/mcp-reviewed-repair.mjs'

const a='BV1abcDEF123',b='BV1defABC456',c='BV1xyzDEF789'

test('real tool outcomes create a bounded, non-sensory video funnel',()=>{
  const events=[
    {tool:'bili_search',ok:true,candidates:[a,b,c,a]},
    {tool:'bili_video_info',bvid:a,ok:true,stat:{view:2000,like:40,reply:4}},
    {tool:'bili_subtitle',bvid:a,ok:true,content:true},
    {tool:'bili_comments',bvid:a,ok:true,content:true},
    {tool:'bili_ledger_mark',bvid:a,ok:true,status:'picked',recorded:true},
    {tool:'bili_video_info',bvid:b,ok:true,stat:{view:50,like:1,reply:0}},
    {tool:'bili_ledger_mark',bvid:b,ok:true,status:'skipped',duplicate:false},
    {tool:'bili_video_info',bvid:c,ok:false}
  ]
  const result=summarizeVideoFunnel(events,{views:1000,likes:10,replies:3})
  assert.equal(result.candidates,3)
  assert.equal(result.metadataVerified,2)
  assert.equal(result.contentRead,1)
  assert.equal(result.selected,1)
  assert.equal(result.heatInsufficient,1)
  assert.equal(result.metadataFailed,1)
  assert.equal(result.notDeepRead,2)
  assert.match(videoFunnelReport(result,{targetRead:8,targetPick:8}),/工具真实回执/)
  assert.ok(!JSON.stringify(result).includes('评论正文'))
})

test('only the named round sidecar is consumed; no sidecar means unknown',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-dev66-'))
  try{
    const id='a'.repeat(24),folder=join(dir,'video-round-observations')
    mkdirSync(folder)
    const file=join(folder,id+'.jsonl')
    writeFileSync(file,JSON.stringify({tool:'bili_video_info',bvid:a,ok:true,stat:{view:20,like:0,reply:0}})+'\n')
    const data=consumeVideoFunnel({stateDir:dir,roundId:id,config:{minVideoViews:1000,minVideoLikes:10,minVideoReplies:3}})
    assert.equal(data.metadataVerified,1)
    assert.equal(data.heatInsufficient,1)
    assert.equal(existsSync(file),false)
    assert.equal(consumeVideoFunnel({stateDir:dir,roundId:id}),null)
    assert.equal(consumeVideoFunnel({stateDir:dir,roundId:'../bad'}),null)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('one rejected comment review cannot be relabeled as voluntary silence',()=>{
  const diagnosed=classifyVideoCommentRound({gate:'configured',pickedCount:2,exitCode:0,
    review:{reviewed:1,passed:1,reviewRejected:1}})
  assert.equal(diagnosed.code,'comment-review-rejected')
})

test('repair and runtime gate require identical reviewed Python modules',()=>{
  const repair=readFileSync(new URL('../lib/mcp-reviewed-repair.mjs',import.meta.url),'utf8')
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  for(const name of ['mcp_server.py','read_action_gate.py','life_metadata_diagnostics.py',
    'vision_fallback_evidence.py','outbound_action_gate.py']){
    assert.match(repair,new RegExp(name.replace('.','\\.')))
    assert.match(host,new RegExp(name.replace('.','\\.')))
  }
  assert.equal(typeof mcpIntegrity,'function')
})


test('vision receipt is optional at any point in a video round, with per-BV dedup and no fabricated view',()=>{
 const visual=(bv,ok)=>({tool:'bili_preview_vision',bvid:bv,ok,visual:ok})
 const events=[
  {tool:'bili_video_info',bvid:a,ok:true,stat:{view:3000,like:50,reply:12}},
  {tool:'bili_comments',bvid:a,ok:true,content:true},
  {tool:'bili_ledger_mark',bvid:a,ok:true,status:'picked',recorded:true},
  visual(a,true),visual(a,true), // visual choice after selecting and reading discussion
  {tool:'bili_video_info',bvid:b,ok:true,stat:{view:5000,like:55,reply:20}},
  visual(b,false), // failed frames are attempts, not verified observations
  visual(c,true) // a curious, genuinely observed BV need not be selected
 ]
 const result=summarizeVideoFunnel(events,{views:1000,likes:10,replies:3})
 assert.equal(result.selected,1)
 assert.equal(result.visualAttempted,3)
 assert.equal(result.visualVerified,2)
 assert.equal(result.contentRead,1,'visual proof is not confused with subtitle/comment evidence')
 assert.equal(result.toolErrors,1)
 assert.match(videoFunnelReport(result),/视觉观察 3 条 BV，其中 2 条/)
 assert.equal(result.rows.find(x=>x.bvid===b).visualVerified,false)
 assert.ok(result.rows.some(x=>x.bvid===c&&x.visualVerified===true))
 const withoutVision=summarizeVideoFunnel([{tool:'bili_ledger_mark',bvid:a,ok:true,status:'picked',recorded:true}])
 assert.equal(withoutVision.visualVerified,0,'selected does not imply watching')
})

test('video agent can still elect a visual tool after comments or picking; it is not a fixed next step',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(host,/已选片\/已读评论不是视觉选择机会的结束信号/)
 assert.match(host,/读评论区后、挑中视频后/)
 assert.match(host,/if \(cfg\.visionEnabled\) list\.push\('bili_preview_vision'\)/)
 assert.match(py,/_VIDEO_FUNNEL_TOOLS[\s\S]{0,180}'bili_preview_vision'/)
 assert.match(py,/data\.get\('status'\) in \('analyzed', 'cached'\)/)
 assert.match(py,/len\(str\(data\.get\('description'\) or ''\)\.strip\(\)\) >= 8/)
})
