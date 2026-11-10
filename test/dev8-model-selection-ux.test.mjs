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
  const controls=runInNewContext(`(()=>{${snippet}\nreturn {renderModelDropdowns,updateRouteDescription,applyDefaultModelToAllRoutes}})()`,{
    modelDefs,headlessCurrentCatalog:catalog,headlessDefaultModel:{provider:'claude',model:'sonnet'},mobileViewOnly:false,
    $,
    document:{createElement:()=>new FakeElement()},
    message:text=>{feedback=text},
  })
  return {controls,$,feedback:()=>feedback}
}

test('官方 Provider 不是必做清单：仅首次设置要求一个真实连接回执',()=>{
  assert.match(html,/快速设置只需任选一个模型验证成功，不必验证全部 Provider/)
  assert.match(js,/headlessGlobalVerified=r\.anyVerified===true/)
  assert.match(js,/!headlessGlobalVerified\)details\.open=true/)
  assert.doesNotMatch(js,/必须点击验证，才能完成首次设置/)
  assert.match(js,/按需验证 · /)
  assert.match(server,/defaultModel:provider&&model\?\{provider,model\}:null/)
  assert.match(readFileSync(new URL('../lib/first-start.mjs',import.meta.url),'utf8'),/headlessSync\.hasAnyVerified\(\)/)
})

test('实际模型目录生成明确的默认模型与独立任务下拉框',()=>{
 const {$,controls}=ui();controls.renderModelDropdowns({})
 assert.equal($('models-default-provider').value,'claude')
 assert.equal($('models-default-model').value,'sonnet')
 assert.equal($('model-videoModelProvider').value,'claude')
 assert.equal($('model-videoModelId').value,'sonnet')
 assert.deepEqual($('model-videoModelProvider').children.map(x=>x.value),['','claude','deepseek-official'])
})
test('一键同步全部八项任务，同时重置思考深度',()=>{
 const {$,controls}=ui();controls.renderModelDropdowns({})
 $('models-default-provider').value='deepseek-official';$('models-default-provider').trigger('change')
 $('models-default-model').value='v4-pro';$('models-default-model').trigger('change')
 for(const group of ['video','interaction','dailyDynamic','ownerDmAgent','reflection','vision','memeRules']){
  const def=group==='reflection'?'mainSessionReflection':group
  assert.equal($('model-'+def+'ModelProvider').value,'deepseek-official',group)
  assert.equal($('model-'+def+'ModelId').value,'v4-pro',group)
  assert.equal($('model-'+def+'ReasoningEffort').value,'',group)
 }
 assert.equal($('main-memory-model-provider').value,'deepseek-official')
 assert.equal($('main-memory-model-id').value,'v4-pro')
 assert.equal($('main-memory-model-effort').value,'')
})
