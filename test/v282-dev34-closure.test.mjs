import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHeadlessModelSync} from '../lib/headless-model-sync.mjs'
import {createLocalVisionModelManager,getLocalVisionModel} from '../lib/local-vision-model-manager.mjs'
const src=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const arrange=()=>{
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-dev34-'))
  const stateDir=join(home,'bili-duty')
  for(const d of [stateDir,join(home,'profiles','desktop'),join(home,'profiles','headless')])mkdirSync(d,{recursive:true})
  const desktop=join(home,'profiles','desktop','cordis.patch.yml')
  const target=join(home,'profiles','headless','cordis.patch.yml')
  writeFileSync(desktop,`- id: llm-pi-ai
  config:
    providers:
      example:
        api: openai-completions
        baseURL: https://example.org
        apiKeyEnv: EXAMPLE_API_KEY
        models:
          - id: alpha
          - id: beta
`)
  writeFileSync(target,`- id: other-plugin
  config: {enabled: true}
`)
  return {home,stateDir,desktop,target,dispose:()=>rmSync(home,{recursive:true,force:true})}
}
test('取消同步仅移除一个 Headless 模型；来源、其他模型、其他插件和机密变量引用保持原状',async()=>{
 const f=arrange()
 try{
  const sync=createHeadlessModelSync(f)
  const original=readFileSync(f.desktop,'utf8')
  const setup=await sync.preview('desktop',['example'])
  await sync.sync({profile:'desktop',selected:['example'],previewToken:setup.previewToken})
  await sync.verified({profile:'desktop',provider:'example',model:'alpha',probe:async()=>{}})
  await sync.verified({profile:'desktop',provider:'example',model:'beta',probe:async()=>{}})
  assert.equal(sync.assertReady({provider:'example',model:'alpha'}),true)
  const plan=await sync.previewUnsync({profile:'desktop',provider:'example',model:'alpha'})
  await assert.rejects(sync.unsync({profile:'desktop',provider:'example',model:'alpha',previewToken:'0'.repeat(64)}),/预览|变化/)
  const removed=await sync.unsync({...plan,previewToken:plan.previewToken})
  assert.equal(removed.removed,true)
  assert.equal(readFileSync(f.desktop,'utf8'),original)
  const yaml=readFileSync(f.target,'utf8')
  assert.match(yaml,/other-plugin/)
  assert.match(yaml,/apiKeyEnv: EXAMPLE_API_KEY/)
  assert.match(yaml,/- id: beta/)
  assert.doesNotMatch(yaml,/- id: alpha/)
  const status=await sync.status('desktop')
  const provider=status.providers.find(x=>x.id==='example')
  assert.equal(provider.modelDetails.find(x=>x.id==='alpha').headless,null)
  assert.equal(provider.modelDetails.find(x=>x.id==='beta').routeSynced,true)
  assert.throws(()=>sync.assertReady({provider:'example',model:'alpha'}),/尚未同步/)
  await sync.verified({profile:'desktop',provider:'example',model:'beta',probe:async()=>{}})
  assert.equal(sync.assertReady({provider:'example',model:'beta'}),true)
  await assert.rejects(sync.previewUnsync({profile:'desktop',provider:'example',model:'alpha'}),/没有此模型/)
 }finally{f.dispose()}
})
test('Desktop 能力补充只修改来源模型，不自动写入 Headless；过期令牌必须拒绝',async()=>{
 const f=arrange()
 try{
  const sync=createHeadlessModelSync(f)
  const setup=await sync.preview('desktop',['example'])
  await sync.sync({profile:'desktop',selected:['example'],previewToken:setup.previewToken})
  const headlessBefore=readFileSync(f.target,'utf8')
  const payload={profile:'desktop',provider:'example',model:'alpha',addInput:['text','image'],addReasoningEfforts:['off','medium']}
  const plan=await sync.previewSourceCapabilities(payload)
  assert.equal(plan.changed,true)
  await assert.rejects(sync.setSourceCapabilities({...payload,previewToken:'0'.repeat(64)}),/预览|变化/)
  await sync.setSourceCapabilities({...payload,previewToken:plan.previewToken})
  assert.equal(readFileSync(f.target,'utf8'),headlessBefore)
  const source=readFileSync(f.desktop,'utf8')
  assert.match(source,/image/)
  assert.match(source,/reasoningEfforts/)
  assert.match(source,/apiKeyEnv: EXAMPLE_API_KEY/)
  assert.equal((await sync.previewSourceCapabilities(payload)).changed,false)
  assert.throws(()=>sync.assertReady({provider:'example',model:'alpha'}),/尚未同步/)
 }finally{f.dispose()}
})
test('全局共享 Provider 不允许通过插件单独取消同步或修改 Desktop 来源',async()=>{
 const f=arrange()
 try{
  writeFileSync(join(f.home,'cordis.patch.yml'),readFileSync(f.desktop,'utf8'))
  const sync=createHeadlessModelSync(f)
  await assert.rejects(sync.previewUnsync({profile:'desktop',provider:'example',model:'alpha'}),/全局/)
  await assert.rejects(sync.previewSourceCapabilities({profile:'desktop',provider:'example',model:'alpha',addInput:['image']}),/全局/)
 }finally{f.dispose()}
})
test('历史 MiniCPM 可使用和删除但禁止重新下载；其他本地模型下载保留',async()=>{
 const calls=[]
 const manager=createLocalVisionModelManager({fetchImpl:async(url,opts={})=>{
  const path=new URL(url).pathname;calls.push(path)
  if(path==='/api/tags')return {ok:true,json:async()=>({models:[{name:'openbmb/minicpm-v4.7:1b',digest:'1'.repeat(64)}]})}
  if(path==='/api/delete')return {ok:true,json:async()=>({})}
  throw Error('unexpected '+path)
 }})
 assert.equal(getLocalVisionModel('minicpm-v4.7-1b').downloadable,false)
 assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').installed,true)
 assert.throws(()=>manager.start('minicpm-v4.7-1b'),/不再提供/)
 assert.equal((await manager.remove('minicpm-v4.7-1b')).deleted,true)
 assert.deepEqual(calls,['/api/tags','/api/delete'])
})
test('分镜固定12格、视频计划不提交社交权限、诊断BV不触发未保存提示',()=>{
 const html=src('lib/management-console.html'),ui=src('lib/management-console.js'),host=src('index.js'),py=src('lib/preview_vision.py')
 assert.doesNotMatch(html,/id="bili-vision-board-tiles"/)
 assert.match(html,/每张分镜固定12格/)
 assert.match(ui,/request\('\/video-vision\/plan',\{visionFrames:frames\}\)/)
 assert.match(ui,/headless-sync-board,#panel-diagnostics/)
 assert.match(host,/saveCfg\(\{visionFrames:frames,visionBoardTiles:12\}\)/)
 assert.match(host,/cfg\.visionBoardTiles=12 \/\//)
 assert.match(py,/def _preview_board_tile_count\(value=None\):[\s\S]*?return 12/)
 const frameRoute=host.slice(host.indexOf("if (req.method === 'POST' && path === '/api/bili-duty/video-vision/plan')"),host.indexOf("if (req.method === 'GET' && path === '/api/bili-duty/config')"))
 assert.doesNotMatch(frameRoute,/dmFollowAutonomyEnabled|persistCfg\(/)
})

test('取消唯一 Headless 模型时删除独立 Provider，不删除其他插件',async()=>{
 const f=arrange()
 try{
  const sync=createHeadlessModelSync(f)
  const setup=await sync.preview('desktop',['example'])
  await sync.sync({profile:'desktop',selected:['example'],previewToken:setup.previewToken})
  const first=await sync.previewUnsync({profile:'desktop',provider:'example',model:'alpha'})
  await sync.unsync({...first,previewToken:first.previewToken})
  const last=await sync.previewUnsync({profile:'desktop',provider:'example',model:'beta'})
  assert.equal(last.removeProvider,true)
  await sync.unsync({...last,previewToken:last.previewToken})
  const content=readFileSync(f.target,'utf8')
  assert.match(content,/other-plugin/)
  assert.doesNotMatch(content,/\bexample:/)
  assert.equal((await sync.status()).providers.find(x=>x.id==='example').targetExists,false)
 }finally{f.dispose()}
})
