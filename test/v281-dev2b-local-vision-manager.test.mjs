import test from 'node:test'
import assert from 'node:assert/strict'
import {createLocalVisionModelManager,getLocalVisionModel,LOCAL_VISION_MODELS} from '../lib/local-vision-model-manager.mjs'
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
  assert.equal(result.verified,true)
  assert.equal(manager.progress().phase,'ready')
  assert.ok(urls.every(([url])=>url.startsWith('http://127.0.0.1:11434/api/')))
  assert.ok(urls.some(([url,method])=>url.endsWith('/api/chat')&&method==='POST'))
})

test('失败的模型自检不准标记为可用，保留错误供管理台排障',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async(url)=>{
    if(url.endsWith('/api/pull'))return ndjson([{status:'success'}])
    if(url.endsWith('/api/chat'))return json({error:'runtime unsupported'},500)
    return json({models:[{name:'openbmb/minicpm-v4.7'}]})
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

test('图片自检必须识别指定颜色，不能拿随便一段模型输出冒充通过',async()=>{
  const manager=createLocalVisionModelManager({logger:{warn:()=>{}},fetchImpl:async url=>{
    if(url.endsWith('/api/pull'))return ndjson([{status:'success'}])
    if(url.endsWith('/api/chat'))return json({message:{content:'我无法判断图片'}})
    return json({models:[{name:'qwen3.5:4b'}]})
  }})
  await assert.rejects(manager.start('qwen3.5-4b'),/颜色自检未通过/)
  assert.equal(manager.progress().phase,'error')
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
  assert.match(source,/await localVisionModels\.verifyId\(id\)/)
})
