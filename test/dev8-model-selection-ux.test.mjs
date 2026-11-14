import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')

class FakeElement {
  constructor(){this.value='';this.textContent='';this.children=[];this.events=new Map();this.disabled=false;this.parentNode=null}
  appendChild(child){
    // Real DOM re-parents existing <option> nodes instead of copying them.
    if(child.parentNode){
      const siblings=child.parentNode.children;
      const index=siblings.indexOf(child);
      if(index>=0)siblings.splice(index,1);
    }
    child.parentNode=this;this.children.push(child);return child;
  }
  replaceChildren(...children){
    for(const child of this.children)child.parentNode=null;
    this.children=[];
    for(const child of children)this.appendChild(child);
  }
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
 const ids=['models-default-provider','model-videoModelProvider','model-interactionModelProvider',
   'model-dailyDynamicModelProvider','model-ownerDmAgentModelProvider',
   'model-mainSessionReflectionModelProvider','model-visionModelProvider',
   'model-memeRulesModelProvider','main-memory-model-provider'];
 for(const id of ids){
   assert.deepEqual($(id).children.map(x=>x.value),['','claude','deepseek-official'],id+' should retain its own Provider option nodes');
   assert.equal($(id).children.length,3,id);
   assert.equal($(id).children.every(x=>x.parentNode===$(id)),true,id+' nodes should belong to this select');
 }
 // Shared option DOM nodes would end up only in the last select.
 assert.equal(new Set(ids.flatMap(id=>$(id).children)).size,ids.length*3);
})

test('历史 Provider 回填在默认及全部任务下拉中均保持可见，不冒充已验证',()=>{
 const {$,controls}=ui();controls.renderModelDropdowns({
   pluginDefaultModelProvider:'old-gateway',pluginDefaultModelId:'old-model',
   interactionModelProvider:'backup-gateway',interactionModelId:'backup-model',
 });
 const ids=['models-default-provider','model-videoModelProvider','model-interactionModelProvider',
   'model-dailyDynamicModelProvider','model-ownerDmAgentModelProvider',
   'model-mainSessionReflectionModelProvider','model-visionModelProvider',
   'model-memeRulesModelProvider','main-memory-model-provider'];
 for(const id of ids){
   assert.deepEqual($(id).children.map(x=>x.value),['','claude','deepseek-official','old-gateway','backup-gateway'],id);
   assert.match($(id).children.find(x=>x.value==='old-gateway').textContent,/未验证/,id);
 }
 assert.equal($('models-default-provider').value,'old-gateway');
 assert.equal($('model-interactionModelProvider').value,'backup-gateway');
 assert.equal($('model-interactionModelId').value,'backup-model');
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
