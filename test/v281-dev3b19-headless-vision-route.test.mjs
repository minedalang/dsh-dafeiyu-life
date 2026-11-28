import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHeadlessModelSync} from '../lib/headless-model-sync.mjs'
import {resolveVisionModelRoute} from '../lib/vision-model-route.mjs'

const source=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8')
const fixture=()=>{
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-vision-route-'))
  const stateDir=join(home,'bili-duty')
  const desktop=join(home,'profiles','desktop','cordis.patch.yml')
  const target=join(home,'profiles','headless','cordis.patch.yml')
  mkdirSync(stateDir,{recursive:true})
  mkdirSync(join(home,'profiles','desktop'),{recursive:true})
  mkdirSync(join(home,'profiles','headless'),{recursive:true})
  const yaml=`- id: llm-pi-ai
  config:
    providers:
      muze-gpt:
        api: openai-responses
        apiKeyEnv: MUZE_GPT_KEY
        baseURL: https://relay.example/v1
        models:
          - id: gpt-6-luna
            input: [text, image]
            reasoningEfforts:
              off:
              low: low
              medium: medium
              high: high
              xhigh: xhigh
              max: max
`
  writeFileSync(desktop,yaml)
  writeFileSync(target,'[]\n')
  return {home,stateDir,desktop,target,dispose:()=>rmSync(home,{recursive:true,force:true})}
}

test('视觉路由统一继承优先级：视觉显式 > 插件默认 > DSH 当前选择',()=>{
  const inherited=resolveVisionModelRoute({
    pluginDefaultModelProvider:'muze-gpt',pluginDefaultModelId:'gpt-6-luna',
    videoReasoningEffort:'high',
  },{provider:'other',model:'host-model',reasoningEffort:'medium'})
  assert.deepEqual(inherited,{
    mode:'independent_dsh',provider:'muze-gpt',model:'gpt-6-luna',
    reasoningEffort:'high',source:'default',complete:true,
    explicitProvider:false,explicitModel:false,
  })
  const explicit=resolveVisionModelRoute({
    visionModelProvider:'vision-provider',visionModelId:'vision-model',
    pluginDefaultModelProvider:'muze-gpt',pluginDefaultModelId:'gpt-6-luna',
    visionReasoningEffort:'low',videoReasoningEffort:'high',
  },{provider:'other',model:'host-model'})
  assert.equal(explicit.provider,'vision-provider')
  assert.equal(explicit.model,'vision-model')
  assert.equal(explicit.reasoningEffort,'low')
  assert.equal(explicit.source,'vision')
  const host=resolveVisionModelRoute({}, {provider:'host-provider',model:'host-model'})
  assert.equal(host.source,'host')
  assert.equal(host.complete,true)
})

test('Headless 状态分别暴露图片声明、思考档位、协议和安全 Base URL 主机',async t=>{
  try{await import('yaml')}catch{t.skip('yaml 生产依赖未安装');return}
  const f=fixture()
  try{
    const sync=createHeadlessModelSync({home:f.home,stateDir:f.stateDir})
    const initial=await sync.status('desktop')
    const provider=initial.providers.find(x=>x.id==='muze-gpt')
    assert.equal(provider.synced,false)
    assert.equal(provider.api,'openai-responses')
    assert.equal(provider.baseURL,'https://relay.example')
    assert.equal(provider.modelDetails[0].source.imageInputDeclared,true)
    assert.deepEqual(provider.modelDetails[0].source.reasoningEfforts,['high','low','max','medium','off','xhigh'])
    assert.equal(provider.modelDetails[0].headless,null)
    const routeBefore=sync.describeRoute({provider:'muze-gpt',model:'gpt-6-luna'})
    assert.equal(routeBefore.kind,'custom')
    assert.equal(routeBefore.synced,false)
    assert.equal(routeBefore.verified,false)
    assert.equal(routeBefore.sourceModel.imageInputDeclared,true)
    assert.equal(routeBefore.headlessModel,null)

    const plan=await sync.preview('desktop',['muze-gpt'])
    await sync.sync({profile:'desktop',selected:['muze-gpt'],previewToken:plan.previewToken})
    await sync.verified({profile:'desktop',provider:'muze-gpt',model:'gpt-6-luna',probe:async()=>{}})
    const after=await sync.status('desktop')
    const synced=after.providers.find(x=>x.id==='muze-gpt')
    assert.equal(synced.synced,true)
    assert.equal(synced.headlessApi,'openai-responses')
    assert.equal(synced.headlessBaseURL,'https://relay.example')
    assert.equal(synced.modelDetails[0].headless.imageInputDeclared,true)
    assert.deepEqual(synced.modelDetails[0].headless.reasoningEfforts,['high','low','max','medium','off','xhigh'])
    const routeAfter=sync.describeRoute({provider:'muze-gpt',model:'gpt-6-luna'})
    assert.equal(routeAfter.verified,true)
    assert.equal(routeAfter.headlessModel.imageInputDeclared,true)
    assert.equal(routeAfter.headless.api,'openai-responses')
    assert.equal(routeAfter.headless.baseURL,'https://relay.example')
  }finally{f.dispose()}
})

test('视觉验收状态绑定完整 Headless 路由，模型声明与实测不能互相替代',()=>{
  const js=source('lib/management-console.js')
  const host=source('index.js')
  const review=source('lib/dsh-vision-review.mjs')
  const mcp=source('vendor/bilibili-mcp/mcp_server.py')
  assert.match(host,/resolveVisionModelRoute\(cfg,selection\)/)
  assert.match(host,/const route=resolveVisionModelRoute\(cfg,selected\)/)
  assert.match(host,/const current=resolveVisionModelRoute\(cfg,ctx\.get\('agentDefaultModel'\)\?\.currentSelection\?\.\(\)\|\|\{\}\)/)
  assert.match(host,/headlessSync\.describeRoute/)
  assert.match(js,/resolveVisionRouteConfig=\(c=\{\}\)/)
  assert.match(js,/sameVisionRoute=\(a,b\)=>\['provider','model','effort','mode'\]/)
  assert.match(js,/sameVisionRoute\(resolveVisionRouteForm\(\),savedVisionRoute\)/)
  assert.match(js,/const mode=String\(\$\('models-vision-mode'\)/)
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(index,/The review already binds its approval to the \*resolved\* DSH route/)
  assert.doesNotMatch(index,/dshVisionReview\.clear\(\)/)
  assert.match(js,/capabilityChip\('图片输入'/)
  assert.match(js,/Headless 文字连接已验证/)
  assert.match(js,/attachmentBridge/)
  assert.match(review,/not_observable/)
  assert.match(review,/diagnostics:mergeDiagnostics/)
  assert.match(mcp,/byteLength':len\(contents\),'mimeType':'image\/png','imageBlocks':1/)
})

test('插件默认思考等级继承与视觉独立档位',()=>{
 const cfg={pluginDefaultModelProvider:'p',pluginDefaultModelId:'m'};
 assert.equal(resolveVisionModelRoute(cfg).reasoningEffort,'medium');
 assert.equal(resolveVisionModelRoute({...cfg,pluginDefaultModelReasoningEffort:'high'}).reasoningEffort,'high');
 assert.equal(resolveVisionModelRoute({...cfg,pluginDefaultModelReasoningEffort:'high',visionReasoningEffort:'low'}).reasoningEffort,'low');
 assert.equal(resolveVisionModelRoute({...cfg,visionModelProvider:'other',visionModelId:'v'}).reasoningEffort,'');
});
