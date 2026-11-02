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
  assert.equal($('models-use-recommended').disabled,false)
  provider.value='deepseek-official';provider.trigger('change')
  assert.deepEqual(model.children.map(x=>x.value),['','flash','v4-pro'])
  assert.equal(model.value,'flash')
  assert.match($('models-video-effective').textContent,/deepseek-official \/ flash/)
})

test('一键使用已验证模型只改本地待保存下拉值，不改独立视觉模式或思考深度',()=>{
  const {$,controls,feedback}=ui()
  controls.renderModelDropdowns({mainSessionReflectionModelProvider:'legacy',mainSessionReflectionModelId:'legacy-model'})
  assert.equal($('model-mainSessionReflectionModelProvider').value,'legacy')
  assert.ok($('model-mainSessionReflectionModelProvider').children.some(x=>x.value==='legacy'))
  $('models-use-recommended').trigger('click')
  for(const group of ['video','interaction','dailyDynamic','ownerDmAgent','reflection','memeRules','memory']){
    const keys=group==='memory'?['main-memory-model-provider','main-memory-model-id']:
      group==='reflection'?['model-mainSessionReflectionModelProvider','model-mainSessionReflectionModelId']:
      [`model-${group}ModelProvider`,`model-${group}ModelId`]
    assert.equal($(keys[0]).value,'claude',group)
    assert.equal($(keys[1]).value,'haiku',group)
  }
  assert.equal($('model-visionModelProvider').value,'')
  assert.match($('models-vision-effective').textContent,/claude \/ haiku/)
  assert.match(feedback(),/请检查后点击「保存全部模型配置」/)
})
