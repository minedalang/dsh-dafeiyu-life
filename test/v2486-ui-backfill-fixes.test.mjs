import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'

const read = file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('原生日常页底部：项目仓库、第三方声明、作者主页、开源致谢依次展示',()=>{
  const ui=read('client.js')
  const origin=ui.indexOf("'作者与开源致谢'")
  const links=["'项目仓库 ↗'","'第三方声明 ↗'","'作者的 B站主页'","'长条动物'","'开源来源与致谢'"]
  assert.ok(origin>0)
  for(const x of links){const i=ui.indexOf(x,origin);assert.ok(i>origin||ui.includes(x.replace(/^'|'$/g,'')),`${x} must exist in the attribution section`)}
  assert.ok(ui.indexOf("'项目仓库 ↗'",origin)<ui.indexOf("'开源来源与致谢'",origin))
  assert.match(ui,/https:\/\/github\.com\/minedalang\/dsh-dafeiyu-life\/blob\/main\/THIRD_PARTY_NOTICES\.md/)
})

test('统一模型页所访问的 checked DOM 都存在，旧自动模式安全回退且兼容视觉 Debug',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js')
  const region=js.slice(js.indexOf('const loadModels='),js.indexOf('const biliFields='))
  for(const [,id] of region.matchAll(/\$\('([^']+)'\)\.checked/g)){
    assert.ok(html.includes('id="'+id+'"'),`${id} is missing in the HTML`)
  }
  for(const id of ['models-vision-enabled','models-vision-debug','models-vision-mode'])assert.ok(html.includes('id="'+id+'"'))
  assert.match(html,/<option value="independent_dsh">/);assert.match(html,/<option value="independent_local">/);assert.doesNotMatch(html.slice(html.indexOf('id="models-vision-mode"'),html.indexOf('</select>',html.indexOf('id="models-vision-mode"'))),/<option value="auto">/)
  assert.doesNotMatch(region,/payload\.visionEnabled=.*\n\s*payload\.visionMode=.*\n\s*payload\.visionEnabled=/)
})

test('真实模拟打开模型页刷新时不会因缺失 DOM 的 checked 属性报错',async()=>{
  const html=read('lib/management-console.html'),script=read('lib/management-console.js')
  const htmlIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]))
  const registry=new Map(),listeners=new Map()
  class Element{
    constructor(){this.value='';this.textContent='';this.style={};this.dataset={};this.hidden=false;this.checked=false;this.parentElement=this;this.classList={toggle(){}}}
    set id(value){this._id=value;registry.set(value,this)}get id(){return this._id}
    addEventListener(name,fn){if(this.id)listeners.set(this.id+':'+name,fn)}
    appendChild(child){child.parentElement=this;return child}
    replaceChildren(){}
    setAttribute(){}
  }
  for(const id of htmlIds){const e=new Element();e.id=id}
  const document={getElementById:id=>registry.get(id)||null,createElement:()=>new Element(),querySelectorAll:()=>[],querySelector:()=>new Element(),addEventListener(){}}
  const fetchCalls=[]
  const fetch=async(path,options={})=>{fetchCalls.push({path,options});return {ok:true,status:200,json:async()=>({ok:true,localVerified:true,config:{visionEnabled:true,visionDebug:true,visionMode:'auto',mainSessionMemoryModelId:'retriever',mainSessionReflectionModelProvider:'reflect-provider',mainSessionReflectionModelId:'reflect-model',mainSessionReflectionReasoningEffort:'high'}})}}
  runInNewContext(script,{document,window:{addEventListener(){}},fetch,console,setTimeout,clearTimeout,confirm:()=>true,Date,URL,Blob,TextDecoder,Uint8Array}, {timeout:1500})
  const refresh=listeners.get('models-refresh:click');assert.equal(typeof refresh,'function')
  refresh()
  await new Promise(resolve=>setTimeout(resolve,15))
  assert.equal(registry.get('models-vision-enabled').checked,true)
  assert.equal(registry.get('models-vision-debug').checked,true)
  assert.equal(registry.get('models-vision-mode').value,'independent_dsh')
  assert.equal(registry.get('main-memory-model-id').value,'retriever')
  assert.equal(registry.get('model-mainSessionReflectionModelProvider').value,'reflect-provider')
  assert.equal(registry.get('model-mainSessionReflectionModelId').value,'reflect-model')
  assert.equal(registry.get('model-mainSessionReflectionReasoningEffort').value,'high')
  const save=listeners.get('models-save:click');assert.equal(typeof save,'function');save()
  await new Promise(resolve=>setTimeout(resolve,15))
  const post=fetchCalls.find(x=>x.options.method==='POST'&&x.path.endsWith('/config'))
  assert.ok(post,'saving model page must POST config')
  const payload=JSON.parse(post.options.body)
  assert.equal(payload.mainSessionReflectionModelProvider,'reflect-provider')
  assert.equal(payload.mainSessionReflectionModelId,'reflect-model')
  assert.equal(payload.mainSessionReflectionReasoningEffort,'high')
  assert.notEqual(registry.get('message').style.color,'var(--bad)')
})

test('历史回填仅向前回看，自动同步关闭时手动加入队列但不发送，重复补历史不再重复入队',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2486-backfill-'))
  const calls=[]
  try{
    const cfg={mainSessionBridgeEnabled:false,mainSessionAutoSync:false,mainSessionId:'abc',mainSessionIncludeComments:false}
    const watched=[{day:'2026-10-24',bvid:'BV1234567890',title:'本周记录',picked:true,status:'挑中'}]
    const agent={id:'abc',followup:async msg=>calls.push(msg)}
    const bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:()=>cfg,getWatched:()=>watched,getComments:()=>({rows:[]}),now:()=>Date.parse('2026-10-27T14:00:00')})
    bridge.collect()
    assert.equal(bridge.status().pending,0)
    const r=bridge.collect({backfillDays:7,forceQueue:true})
    assert.equal(r.added,1)
    assert.equal(bridge.status().pending,1)
    assert.equal(calls.length,0)
    const repeat=bridge.collect({backfillDays:7,forceQueue:true})
    assert.equal(repeat.added,0)
    assert.equal(bridge.status().pending,1)
    assert.equal((await bridge.deliver()).skipped,'disabled')
    assert.equal(calls.length,0)
    const sent=await bridge.deliver({force:true})
    assert.equal(sent.ok,true)
    assert.equal(sent.sent,1)
    assert.equal(calls.length,1)
    assert.equal(bridge.status().pending,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
  const html=read('lib/management-console.html'),js=read('lib/management-console.js'),index=read('index.js')
  assert.match(html,/把过去 7 天遗漏的经历加入待汇报/)
  assert.match(html,/从现在往回数 7 天/)
  assert.match(js,/本次未发送消息/)
  assert.match(index,/collect\(\{backfillDays:days,forceQueue:true\}\)/)
  assert.match(index,/请先在「大肥鱼的家」选择并保存主 Session/)
})
