import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createEmbeddingMemoryIndex} from '../lib/embedding-memory-index.mjs'
import {memoryNeuralProjection,neuralProjectionKey} from '../lib/memory-neural-projection.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'
import {classifyVideoCommentRound} from '../lib/video-comment-readiness.mjs'

const rows=[
 {id:'memory:A',text:'关于游戏的新发现'},
 {id:'memory:B',text:'关于游戏和好友的讨论'},
 {id:'memory:C',text:'料理做法'},
 {id:'episode:D',text:'看过的音乐话题'},
 {id:'memory:E',text:'后天形成的一个兴趣'}]
const documentVectors={
 '关于游戏的新发现':[1,0,0,0],
 '关于游戏和好友的讨论':[.8,.6,0,0],
 '料理做法':[0,1,0,0],
 '看过的音乐话题':[0,0,1,0],
 '后天形成的一个兴趣':[0,0,0,1]}

test('dev53: 本地查询 embedding 使用真实余弦分数；搜索后查询词参与同一三维投影',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dsh53-neural-'))
 let docCalls=0,queryCalls=0
 const index=createEmbeddingMemoryIndex({dataDir:folder,modelId:'test-53',dimension:4,
  provider:{embedDocuments:async text=>{docCalls++;return text.map(t=>documentVectors[t])},
    embedQuery:async q=>{queryCalls++;assert.equal(q,'游戏');return [1,0,0,0]}},logger:{warn(){}}})
 try{
  assert.equal((await index.sync(rows)).ok,true)
  const corpus=rows.map((r,i)=>({nodeId:(i+1).toString(16).padStart(16,'0'),corpusId:r.id,text:r.text}))
  const found=await index.search('游戏',rows,{limit:10,minScore:.3,readOnly:true})
  assert.equal(found.ready,true)
  assert.deepEqual(found.items.map(r=>r.id),['memory:A','memory:B'])
  assert.ok(Math.abs(found.items[0].score-1)<1e-6)
  assert.ok(Math.abs(found.items[1].score-.8)<1e-6)
  const result=index.projectPoints(corpus,{query:'游戏'})
  assert.equal(result.mode,'embedding-pca-3d')
  assert.ok(result.queryPosition&&['x','y','z'].every(k=>Number.isFinite(result.queryPosition[k])))
  assert.equal(result.matched,5)
  assert.equal(docCalls,1,'绘图和只读搜索不得对文档重新生成向量')
  assert.equal(queryCalls,1)
  assert.ok(!JSON.stringify(result).includes('memory:A'),'匿名投影不应回传原始存储 ID')
  assert.equal(index.projectPoints(corpus.map(row=>({...row,text:'已更改原文'})),{query:'游戏'}).mode,'structured','哈希不匹配的向量不得呈现')
 }finally{rmSync(folder,{recursive:true,force:true})}
})

test('dev53: 投影层只以已匹配的匿名节点 ID 接受相似度，不因几何或词面重合伪造相似度',()=>{
 const data=[
  {id:'A',text:'很久以前的一次经历',gardenKind:'experience',createdAt:'2026-11-01'},
  {id:'B',text:'从来没记录这个搜索关键词',gardenKind:'experience',createdAt:'2026-11-02'}]
 const a=neuralProjectionKey(data[0]),b=neuralProjectionKey(data[1])
 const g=memoryNeuralProjection({gardenRows:data,showAll:true,query:'游戏',
  semanticMatchIds:[a],semanticScores:{[a]:.8162,[b]:.9999}})
 assert.equal(g.matched,1)
 assert.equal(g.nodes.find(x=>x.id===a).similarity,.8162)
 assert.equal(g.nodes.find(x=>x.id===b).similarity,undefined)
 assert.equal(g.nodes.find(x=>x.id===b).matched,false)
 assert.equal(g.edges.length,0,'向量相似不代表两段经历存在相同证据来源')
})

test('dev53: 前端全屏包括搜索栏，真实高维连线绘制不使用三维距离分数',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.ok(html.indexOf('neural-search-input')>html.indexOf('class="neural-recall-board"'))
 assert.ok(html.indexOf('neural-search-input')<html.indexOf('id="neural-memory-viewport"'))
 assert.match(html,/仅在启用并成功连接<strong>本地 Embedding 模型/)
 assert.match(html,/场景理解 → 回忆意图 → 权限／遗忘过滤/)
 assert.match(js,/neuralQueryPosition/)
 assert.match(js,/m\.similarity/)
 assert.match(js,/\(\.5\+sim\*5\)/)
 assert.match(js,/高维余弦相似度/)
 assert.match(backend,/id:row\.corpusId,text:row\.text/,'search 应使用向量索引真实 corpusId')
 assert.match(backend,/corpusNodeIds\.get\(item\.id\)/,'向量命中必须映射回匿名图节点')
 assert.match(backend,/indexedText\.get\(corpusId\)/,'展示文案不能代替索引时的确切文本')
})

test('dev53: Life 额度与调度心跳可见，决策统计不调用模型或触发写入',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/life-decision-usage/)
 assert.match(html,/life-decision-next/)
 assert.match(html,/life-decision-progress/)
 assert.match(js,/request\('\/autonomous-planner'\)/)
 assert.match(js,/schedulerPulse/)
 assert.match(js,/nextDecisionAt/)
 assert.match(js,/lifeRuns/)
})

test('dev53: Life 自愿延期被单独分类，不再一律显示提出但未批准',()=>{
 assert.equal(classifyVideoCommentRound({gate:'configured',pickedCount:2,exitCode:0,
  review:{reviewed:2,wanted:1,passed:1,proposed:1,deferred:1}}).code,'life-deferred')
 assert.equal(classifyVideoCommentRound({gate:'configured',pickedCount:2,exitCode:0,
  review:{reviewed:2,wanted:1,passed:1,proposed:1,blocked:1}}).code,'comment-technically-blocked')
 assert.equal(classifyVideoCommentRound({gate:'configured',pickedCount:2,exitCode:0,
  review:{reviewed:2,wanted:1,passed:1,proposed:1}}).code,'proposed-not-approved','历史原因缺失不可猜测')
})


test('dev53: Life 心跳停滞或应运行却未运行会显眼提示；单纯没有模型决策不会误报',()=>{
 const now=Date.parse('2026-11-10T07:00:00Z')
 const ok=systemHealthSnapshot({planner:{running:true,schedulerPulse:{lastCheckAt:now-60_000,stale:false}},
  schedulerExpected:false,lifeExpected:true,now})
 assert.equal(ok.issues.some(x=>x.id==='life-scheduler'),false)
 const stale=systemHealthSnapshot({planner:{running:true,schedulerPulse:{lastCheckAt:now-200_000,stale:true}},
  schedulerExpected:false,lifeExpected:true,now})
 assert.equal(stale.issues.find(x=>x.id==='life-scheduler').code,'life-scheduler-stale')
 const stopped=systemHealthSnapshot({planner:{running:false},schedulerExpected:false,lifeExpected:true,now})
 assert.equal(stopped.issues.find(x=>x.id==='life-scheduler').code,'life-scheduler-stopped')
 assert.equal(systemHealthSnapshot({planner:{running:false},schedulerExpected:false,lifeExpected:false,now}).issues.length,0,
  '用户主动关闭 Life 不应被报告为异常')
})
