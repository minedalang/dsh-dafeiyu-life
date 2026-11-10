import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEmbeddingMemoryIndex} from '../lib/embedding-memory-index.mjs'
import {memoryNeuralProjection,neuralProjectionKey} from '../lib/memory-neural-projection.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'

test('本地已有 Embedding 向量：实际降维投影、归一化和过期文本拒绝；不额外调用模型',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-neural49-'))
 let calls=0
 const provider={embedDocuments:async texts=>{calls++;return texts.map((_,i)=>[i+.7,(i%3)*.8,Math.sin(i+1),Math.cos(i+2)])},embedQuery:async()=>{throw Error('禁止查询模型')}}
 try{
  const idx=createEmbeddingMemoryIndex({dataDir:dir,provider,modelId:'test-dev49',dimension:4,logger:{warn(){}}})
  assert.equal((await idx.sync([{id:'memory:1',text:'观察视频'},{id:'memory:2',text:'跨日兴趣'},
   {id:'episode:3',text:'评论互动'},{id:'memory:4',text:'记录认识'}])).ok,true)
  const requested=[
   {nodeId:'ab0123456789abcd',corpusId:'memory:1',text:'观察视频'},
   {nodeId:'bc0123456789abcd',corpusId:'memory:2',text:'跨日兴趣'},
   {nodeId:'cd0123456789abcd',corpusId:'episode:3',text:'评论互动'},
   {nodeId:'de0123456789abcd',corpusId:'memory:4',text:'记录认识'}]
  const r=idx.projectPoints(requested)
  assert.equal(r.mode,'embedding-pca-3d');assert.equal(r.matched,4)
  assert.equal(Object.keys(r.coordinates).length,4)
  assert.ok(Object.values(r.coordinates).every(x=>['x','y','z'].every(k=>Number.isFinite(x[k])&&Math.abs(x[k])<=1.61)))
  assert.equal(calls,1,'显示图谱不得触发新的 embedding API 请求')
  const stale=idx.projectPoints(requested.map(x=>({...x,text:'不是原文'})))
  assert.equal(stale.mode,'structured');assert.equal(stale.matched,0)
  assert.equal(JSON.stringify(r).includes('memory:1'),false,'投影不得回传索引内部键名')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('神经图谱保持对当前真实记忆的稳定匿名锚点',()=>{
 const m={id:'x1',text:'今天读过公开视频',gardenKind:'experience',createdAt:'2026-11-10T02:00:00Z'}
 assert.equal(memoryNeuralProjection({gardenRows:[m]}).nodes[0].id,neuralProjectionKey(m))
 assert.equal(memoryNeuralProjection({gardenRows:[m],query:'不存在'}).nodes.length,0)
})

test('监控列出三个真实轮询渠道、错误类别、不同重试时间；不泄露错误原文',()=>{
 const now=Date.parse('2026-11-10T05:00:00Z')
 const r=systemHealthSnapshot({now,scheduler:{running:true,networkBackoff:{
  dm:{category:'rate-limit',streak:4,nextAt:now+300_000},
  replies:{category:'network',streak:2,nextAt:now+120_000},
  mentions:{category:'network',streak:3,nextAt:now+420_000}
 }}})
 const x=r.issues.find(i=>i.id==='network')
 assert.deepEqual(x.channels.map(y=>y.label),['后台私信','评论回复','被 @ 提及'])
 assert.equal(x.channels[0].reason,'B站限流')
 assert.equal(x.channels[1].reason,'网络请求失败')
 assert.equal(x.retryAt,now+120_000)
 assert.equal(JSON.stringify(x).includes('cookie'),false)
})

test('管理页具备可全屏的交互三维记忆空间、明确颜色图例、点击详情同步；删除顶部生活播报',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/neural-memory-fullscreen/)
 assert.match(html,/neural-memory-reset/)
 assert.match(html,/neural-layout-mode/)
 assert.match(html,/neural-swatch\.relationship/)
 assert.match(html,/蓝 · 生活经历/)
 assert.match(js,/pointermove/)
 assert.match(js,/setPointerCapture/)
 assert.match(js,/addEventListener\('wheel'/)
 assert.match(js,/renderNeuralScene/)
 assert.match(js,/neural-memory-results/)
 assert.match(js,/getBoundingClientRect\(\)/)
 assert.match(js,/requestFullscreen/)
 assert.match(js,/embedding-pca-3d/)
 assert.doesNotMatch(html,/🐟 生活播报/)
 assert.doesNotMatch(js,/refreshActivityTicker/)
 assert.match(html,/life-health-channels/)
})
