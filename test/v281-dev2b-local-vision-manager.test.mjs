import test from 'node:test'
import assert from 'node:assert/strict'
import {createLocalVisionModelManager,getLocalVisionModel,LOCAL_VISION_MODELS,getLocalVisionTestImage} from '../lib/local-vision-model-manager.mjs'
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
const ndjson=(rows)=>new Response(rows.map(x=>JSON.stringify(x)+'\n').join(''),{status:200})

test('只接受两种固定模型 ID，所有请求只访问 127.0.0.1 Ollama',async()=>{
  const urls=[]
  const manager=createLocalVisionModelManager({fetchImpl:async(url,opts)=>{
    urls.push([url,opts?.method||'GET'])
    if(url.endsWith('/api/tags'))return json({models:[{name:'qwen3.5:4b'}]})
    if(url.endsWith('/api/pull'))return ndjson([{status:'downloading',total:100,completed:50},{status:'success'}])
    if(url.endsWith('/api/chat'))return json({message:{content:'红色'}})
    throw Error('unexpected URL')
  }})
  assert.equal(getLocalVisionModel('../malicious'),null)
  assert.equal(LOCAL_VISION_MODELS.length,2)
  assert.throws(()=>manager.start('user/evil'),'不支持')
  assert.equal((await manager.list()).models[0].installed,true)
  const result=await manager.start('qwen3.5-4b')
  assert.equal(result.verified,false)
  assert.equal(result.awaitingReview,true)
  assert.equal(manager.progress().phase,'idle')
  const approved=await manager.review('qwen3.5-4b',{reviewId:result.reviewId,accepted:true})
  assert.equal(approved.verified,true)
  assert.ok(urls.every(([url])=>url.startsWith('http://127.0.0.1:11434/api/')))
  assert.ok(urls.some(([url,method])=>url.endsWith('/api/chat')&&method==='POST'))
})

test('失败的模型自检不准标记为可用，保留错误供管理台排障',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async(url)=>{
    if(url.endsWith('/api/pull'))return ndjson([{status:'success'}])
    if(url.endsWith('/api/chat'))return json({error:'runtime unsupported'},500)
    return json({models:[{name:'openbmb/minicpm-v4.7:1b'}]})
  }})
  await assert.rejects(manager.start('minicpm-v4.7-1b'),/HTTP 500/)
  const data=await manager.list()
  assert.equal(data.models.find(x=>x.id==='minicpm-v4.7-1b').verified,false)
  assert.equal(data.progress.phase,'error')
})

test('删除只允许预定义模型，不删除正在下载的资源',async()=>{
  let release
  const pending=new Promise(resolve=>release=resolve)
  let calledDelete=false
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async(url)=>{
    if(url.endsWith('/api/pull')){await pending;return ndjson([{status:'success'}])}
    if(url.endsWith('/api/delete')){calledDelete=true;return json({})}
    return json({message:{content:'红色'}})
  }})
  const job=manager.start('qwen3.5-4b')
  await assert.rejects(manager.remove('qwen3.5-4b'),/进行中/)
  assert.equal(calledDelete,false)
  release()
  await job
  const result=await manager.remove('qwen3.5-4b')
  assert.equal(result.deleted,true)
  assert.equal(calledDelete,true)
})

test('没有 Ollama 服务时明确标记不可用，不回退成云端视觉',async()=>{
  const manager=createLocalVisionModelManager({fetchImpl:async()=>{throw Error('ECONNREFUSED')}})
  const s=await manager.list()
  assert.equal(s.running,false)
  assert.equal(s.models.every(x=>!x.installed),true)
  assert.match(s.error,/Ollama/)
})

test('不做颜色关键词判定；图片有最终回答时必须等待用户人工认可',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async url=>{
    if(url.endsWith('/api/pull'))return ndjson([{status:'success'}])
    if(url.endsWith('/api/chat'))return json({message:{content:'我无法判断这是什么图片'}})
    return json({models:[{name:'qwen3.5:4b'}]})
  }})
  const result=await manager.start('qwen3.5-4b')
  assert.equal(result.awaitingReview,true)
  const state=(await manager.list()).models[0]
  assert.equal(state.verified,false)
  assert.equal(state.verification.answer,'我无法判断这是什么图片')
  assert.equal(state.verification.status,'awaiting_review')
  const rejected=await manager.review('qwen3.5-4b',{reviewId:result.reviewId,accepted:false})
  assert.equal(rejected.verified,false)
  assert.equal((await manager.list()).models[0].verification.status,'rejected')
})

test('下载进行中时禁止另开自检，以免覆盖安装状态',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve)
  const manager=createLocalVisionModelManager({fetchImpl:async url=>{
    if(url.endsWith('/api/pull')){await pending;return ndjson([{status:'success'}])}
    return json({message:{content:'红色'}})
  }})
  const job=manager.start('qwen3.5-4b')
  await assert.rejects(manager.verifyId('qwen3.5-4b'),/正在执行/)
  release();await job
})

test('生产调用与通用设置不能绕过本地模式的检查',async()=>{
  const {readFileSync}=await import('node:fs')
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(source,/visionPlan\.attempt&&\['independent_dsh','independent_local'\]\.includes/)
  assert.match(source,/body\.visionLocalModel!==cfg\.visionLocalModel/)
  assert.match(source,/await localVisionModels\.review\(id,/ )
  assert.match(source,/models\.find\(x=>x\.id===id\)\?\.verified/)
})


test('MiniCPM 1B 必须锁定 :1b 标签，旧不带标签的 latest 不视为已经安装',async()=>{
  assert.equal(getLocalVisionModel('minicpm-v4.7-1b').ollama,'openbmb/minicpm-v4.7:1b')
  const requested=[]
  const manager=createLocalVisionModelManager({fetchImpl:async(url,opts)=>{
    if(url.endsWith('/api/tags'))return json({models:[{name:'openbmb/minicpm-v4.7'}]})
    if(url.endsWith('/api/pull')){requested.push(JSON.parse(opts.body).model);return ndjson([{status:'success'}])}
    if(url.endsWith('/api/chat')){requested.push(JSON.parse(opts.body).model);return json({message:{content:'中央红色方块'}})}
    throw Error('unexpected')
  }})
  assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').installed,false)
  await manager.start('minicpm-v4.7-1b')
  assert.deepEqual(requested,['openbmb/minicpm-v4.7:1b','openbmb/minicpm-v4.7:1b'])
})

test('R2 下载失败提示保留末尾原因并提示 Ollama 代理而不是要求 DSH Provider',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async url=>{
    if(url.endsWith('/api/pull'))return ndjson([{error:'max retries exceeded: Get "https://dd20bb.r2.cloudflarestorage.com/'+('long/'.repeat(90))+'": dial tcp: lookup host: no such host'}])
    return json({models:[]})
  }})
  await assert.rejects(manager.start('qwen3.5-4b'),/模型下载失败/)
  const p=manager.progress()
  assert.match(p.error,/HTTPS_PROXY/)
  assert.match(p.error,/no such host/)
  assert.doesNotMatch(p.error,/DSH Provider/)
})

test('管理中心说明两种模型能力、体积、显存与 Windows Ollama 代理检查',async()=>{
  const {readFileSync}=await import('node:fs')
  const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const python=readFileSync(new URL('../lib/preview_vision.py',import.meta.url),'utf8')
  assert.match(page,/MiniCPM-V 4\.7 1B · 轻量视觉/)
  assert.match(page,/Qwen3\.5 4B · 中文与复杂画面/)
  assert.match(page,/约 1\.8 GB/)
  assert.match(page,/3\.3～4\.0 GB/)
  assert.match(page,/HTTPS_PROXY/)
  assert.match(page,/无需在 DSH 中另外配置 Ollama Provider/)
  assert.match(python,/openbmb\/minicpm-v4\.7:1b/)
})


test('Windows 下载说明使用仅本进程代理并标明当前文件层百分比',async()=>{
  const {readFileSync}=await import('node:fs')
  const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
  assert.match(page,/当前仅列举 Windows 环境下的方法/)
  assert.match(page,/\$env:HTTPS_PROXY = "http:\/\/127\.0\.0\.1:7890"/)
  assert.match(page,/ollama serve/)
  assert.match(page,/当前文件层的进度/)
  assert.match(js,/非模型总进度/)
  assert.doesNotMatch(page,/梯子/)
  assert.doesNotMatch(readme,/梯子/)
})


test('管理台测试图片和 Ollama 输入是用户上传的同一份原始 PNG，模型完整答复不截断',async()=>{
  const {readFileSync}=await import('node:fs')
  const original=readFileSync(new URL('../lib/assets/local-vision-selftest-dafeiyu.png',import.meta.url))
  assert.equal(original.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  assert.deepEqual(getLocalVisionTestImage(),original)
  let sentImage=null,body=null
  const answer='蓝色长发、鱼尾、女仆服、蓝色蝴蝶结和张开的手。'.repeat(200)
  const manager=createLocalVisionModelManager({fetchImpl:async(url,opts)=>{
    if(url.endsWith('/api/chat')){
      body=JSON.parse(opts.body)
      sentImage=body.messages[0].images[0]
      return json({message:{content:answer},done_reason:'stop'})
    }
    return json({models:[{name:'qwen3.5:4b'}]})
  }})
  const stateBefore=await manager.list()
  assert.equal(stateBefore.testImage.url,'/api/bili-duty/local-vision/selftest-image')
  assert.equal(stateBefore.testImage.dataUri,undefined)
  const result=await manager.verifyId('qwen3.5-4b')
  assert.equal(result.verified,false)
  assert.equal(result.awaitingReview,true)
  assert.deepEqual(Buffer.from(sentImage,'base64'),original)
  const state=await manager.list()
  assert.equal(state.models[0].verification.answer,answer)
  assert.equal(state.models[0].verification.status,'awaiting_review')
  assert.equal(state.models[0].verified,false)
  assert.equal(body.think,false)
  assert.equal(Object.hasOwn(body.options,'num_predict'),false)
  assert.match(body.messages[0].content,/大肥鱼/)
  assert.equal(state.models[0].verification.doneReason,'stop')
})

test('人工确认结果后才能通过；拒绝与过期确认不可复用',async()=>{
  const manager=createLocalVisionModelManager({fetchImpl:async url=>
    url.endsWith('/api/chat')?json({message:{content:'蓝色头发和白色围裙'}}):json({models:[{name:'qwen3.5:4b'}]})})
  const v1=await manager.verifyId('qwen3.5-4b')
  await assert.rejects(manager.review('minicpm-v4.7-1b',{reviewId:v1.reviewId,accepted:true}),/失效/)
  await assert.rejects(manager.review('qwen3.5-4b',{reviewId:'stale',accepted:true}),/失效/)
  await assert.rejects(manager.review('qwen3.5-4b',{reviewId:v1.reviewId,accepted:'true'}),/必须明确/)
  assert.equal((await manager.list()).models[0].verified,false)
  const accepted=await manager.review('qwen3.5-4b',{reviewId:v1.reviewId,accepted:true})
  assert.equal(accepted.verified,true)
  assert.equal((await manager.list()).models[0].verification.status,'approved')
  await assert.rejects(manager.review('qwen3.5-4b',{reviewId:v1.reviewId,accepted:true}),/失效/)
  const v2=await manager.verifyId('qwen3.5-4b')
  assert.equal((await manager.list()).models[0].verified,false)
  await assert.rejects(manager.review('qwen3.5-4b',{reviewId:v1.reviewId,accepted:true}),/失效/)
  await manager.review('qwen3.5-4b',{reviewId:v2.reviewId,accepted:false})
  assert.equal((await manager.list()).models[0].verified,false)
})

test('Ollama 报错或只有内部 thinking 时不能供用户人工验收',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async url=>
    url.endsWith('/api/chat')?json({message:{content:'',thinking:'internal'}}):json({models:[{name:'qwen3.5:4b'}]})})
  await assert.rejects(manager.verifyId('qwen3.5-4b'),/没有可供用户查看的最终文字/)
  const record=(await manager.list()).models[0].verification
  assert.equal(record.status,'failed')
  assert.equal(record.hadThinking,true)
  assert.doesNotMatch(JSON.stringify(record),/internal/)
  await assert.rejects(manager.review('qwen3.5-4b',{reviewId:record.reviewId,accepted:true}),/失效/)
})

test('Ollama 视觉投影器加载失败时保留具体原因',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async url=>
    url.endsWith('/api/chat')?json({error:'Failed to load CLIP model'},500):json({models:[{name:'openbmb/minicpm-v4.7:1b'}]})})
  await assert.rejects(manager.verifyId('minicpm-v4.7-1b'),/Failed to load CLIP model/)
  const record=(await manager.list()).models[1].verification
  assert.match(record.error,/HTTP 500/)
  assert.match(record.error,/Failed to load CLIP model/)
  assert.equal(record.status,'failed')
})

test('页面展示大肥鱼原图、模型完整回复与明确的用户认可按钮',async()=>{
  const {readFileSync}=await import('node:fs')
  const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(page,/id="local-vision-probe-image"/)
  assert.match(page,/id="local-vision-probe-answer"/)
  assert.match(page,/id="local-vision-approve"/)
  assert.match(page,/id="local-vision-reject"/)
  assert.match(page,/id="local-vision-verify"/)
  assert.match(page,/大肥鱼真实图片/)
  assert.match(js,/state\.testImage\?\.url/)
  assert.match(js,/local-vision\/review/)
  assert.match(js,/local-vision-probe-answer'\)\.textContent/)
  assert.match(server,/getLocalVisionTestImage\(\)/)
  assert.match(server,/state\.models\.find\(x=>x\.id===id\)\?\.verified/)
  assert.doesNotMatch(js,/testImage\?\.dataUri/)
})
