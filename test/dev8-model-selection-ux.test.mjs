import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')

class FakeElement {
  constructor(){this.value='';this.textContent='';this.children=[];this.events=new Map();this.disabled=false}
  appendChild(child){this.children.push(child);return child}
  replaceChildren(...children){this.children=children}
  addEventListener(name,handler){this.events.set(name,handler)}
  trigger(name){this.events.get(name)?.()}
}
function ui(){
  const elements=new Map(), $=id=>{if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id)}
  const modelDefs=[
    ['video','videoModelProvider','videoModelId','videoReasoningEffort'],
    ['interaction','interactionModelProvider','interactionModelId','interactionReasoningEffort'],
    ['dailyDynamic','dailyDynamicModelProvider','dailyDynamicModelId','dailyDynamicReasoningEffort'],
    ['ownerDmAgent','ownerDmAgentModelProvider','ownerDmAgentModelId','ownerDmAgentReasoningEffort'],
    ['reflection','mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort'],
    ['vision','visionModelProvider','visionModelId','visionReasoningEffort'],
    ['memeRules','memeRulesModelProvider','memeRulesModelId','memeRulesReasoningEffort'],
  ]
  const catalog=[
    {id:'claude',models:['haiku','sonnet'],kind:'custom',verifiedModels:['haiku']},
    {id:'deepseek-official',models:['flash','v4-pro'],kind:'registered',verifiedModels:[]},
  ]
  const snippet=js.slice(js.indexOf('  const modelRouteControls='),js.indexOf('  const loadModels=async()=>{'))
  let feedback=''
  const controls=runInNewContext(`(()=>{${snippet}\nreturn {renderModelDropdowns,updateRouteDescription}})()`,{
    modelDefs,headlessCurrentCatalog:catalog,headlessDefaultModel:{provider:'claude',model:'sonnet'},mobileViewOnly:false,
    $,
    document:{createElement:()=>new FakeElement()},
    message:text=>{feedback=text},
  })
  return {controls,$,feedback:()=>feedback}
}

test('官方 Provider 不是必做清单：仅首次设置要求一个真实连接回执',()=>{
  assert.match(html,/首次设置只需任选一个模型验证成功，不必验证全部 Provider/)
  assert.match(js,/headlessGlobalVerified=r\.anyVerified===true/)
  assert.match(js,/!headlessGlobalVerified\)details\.open=true/)
  assert.doesNotMatch(js,/必须点击验证，才能完成首次设置/)
  assert.match(js,/按需验证 · /)
  assert.match(server,/defaultModel:provider&&model\?\{provider,model\}:null/)
  assert.match(readFileSync(new URL('../lib/first-start.mjs',import.meta.url),'utf8'),/headlessSync\.hasAnyVerified\(\)/)
})

test('从实际模型目录生成 Provider 与模型下拉选项，展示继承路由',()=>{
  assert.match(js,/node\(i<2\?'select':'input'\)/)
  assert.match(html,/<select id="main-memory-model-provider"><\/select>/)
  assert.match(html,/<select id="main-memory-model-id"><\/select>/)
  const {$,controls}=ui()
  controls.renderModelDropdowns({})
  const provider=$('model-videoModelProvider'), model=$('model-videoModelId')
  assert.deepEqual(provider.children.map(x=>x.value),['','claude','deepseek-official'])
  assert.deepEqual(model.children.map(x=>x.value),['','haiku','sonnet'])
  assert.match($('models-video-effective').textContent,/claude \/ sonnet/)
  assert.equal(provider.value,'')
  assert.equal(model.value,'')
  assert.match($('models-default-summary').textContent,/DSH 当前默认模型：claude \/ sonnet/)
  assert.match($('models-recommendation-note').textContent,/已验证模型/)
  assert.match($('models-video-effective').textContent,/已保存配置/)
  provider.value='deepseek-official';provider.trigger('change')
  assert.deepEqual(model.children.map(x=>x.value),['','flash','v4-pro'])
  assert.equal(model.value,'flash')
  assert.match($('models-video-effective').textContent,/deepseek-official \/ flash/)
})

test('自动继承保持宿主默认，恢复继承不误选首个已验证的 Claude',()=>{
  const {$,controls,feedback}=ui()
  controls.renderModelDropdowns({mainSessionReflectionModelProvider:'legacy',mainSessionReflectionModelId:'legacy-model',interactionModelProvider:'claude',interactionModelId:'haiku'})
  assert.equal($('model-mainSessionReflectionModelProvider').value,'legacy')
  assert.match($('models-dailyDynamic-effective').textContent,/claude \/ haiku/)
  $('models-reset-inheritance').trigger('click')
  for(const group of ['video','interaction','dailyDynamic','ownerDmAgent','reflection','vision','memeRules']){
    const [provider,model]=group==='reflection'?['model-mainSessionReflectionModelProvider','model-mainSessionReflectionModelId']:[`model-${group}ModelProvider`,`model-${group}ModelId`]
    assert.equal($(provider).value,'',group)
    assert.equal($(model).value,'',group)
  }
  // Semantic retrieval is not a runtime-inheritable model, so reset leaves it untouched.
  assert.equal($('main-memory-model-provider').value,'')
  assert.match($('models-dailyDynamic-effective').textContent,/claude \/ sonnet/)
  assert.match(feedback(),/尚未保存/)
})

test('更改上游互动模型时，下游的继承下拉框与待保存预览一起刷新',()=>{
 const {$,controls}=ui()
 controls.renderModelDropdowns({})
 const upstream=$('model-interactionModelProvider');upstream.value='claude';upstream.trigger('change')
 const model=$('model-interactionModelId');model.value='haiku';model.trigger('change')
 for(const target of ['dailyDynamic','ownerDmAgent']){
   const select=$(`model-${target}ModelId`)
   assert.match(select.children[0].textContent,/自动继承（claude \/ haiku）/)
   assert.match($(`models-${target}-effective`).textContent,/待保存预览：claude \/ haiku/)
 }
 upstream.value='';upstream.trigger('change')
 for(const target of ['dailyDynamic','ownerDmAgent']){
   assert.match($(`model-${target}ModelId`).children[0].textContent,/自动继承（claude \/ sonnet）/)
 }
})
