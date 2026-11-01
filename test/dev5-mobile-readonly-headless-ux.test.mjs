import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('Headless 同步与真实验证清楚分开，首次设置有可见的下一步提示',()=>{
  for(const id of ['headless-journey','headless-stage-source','headless-stage-sync','headless-stage-verify','headless-next-title','headless-next-description','headless-next-action','fs-headless-next']){
    assert.match(html,new RegExp(`id="${id}"`))
  }
  assert.match(html,/③ 真实连接验证/)
  assert.match(js,/已同步.*仍未完成/)
  assert.match(js,/if\(p\.synced&&pendingModel&&!headlessNextButton\)details\.open=true/)
  assert.match(js,/headlessNextButton\.click\(\)/)
  assert.match(html,/\.fs-qr\[hidden\]\{display:none!important\}/)
  assert.match(js,/仅同步不算完成/)
})

function journey(mobileViewOnly=false){
  const elements=new Map()
  const $=id=>{
    if(!elements.has(id))elements.set(id,{dataset:{},textContent:'',hidden:false})
    return elements.get(id)
  }
  const start=js.indexOf('  const renderHeadlessJourney=providers=>{')
  const end=js.indexOf("  $('headless-next-action').addEventListener",start)
  assert.ok(start>=0&&end>start)
  const fn=runInNewContext(js.slice(start,end)+'\nrenderHeadlessJourney',{ $,mobileViewOnly })
  return {fn,$}
}
test('Headless 状态机：检测 → 同步 → 验证，未验证不能显示完成',()=>{
  const app=journey()
  app.fn([])
  assert.equal(app.$('headless-journey').dataset.stage,'source')
  app.fn([{id:'p',models:['m'],synced:false,verifiedModels:[]}])
  assert.equal(app.$('headless-journey').dataset.stage,'sync')
  assert.match(app.$('headless-next-title').textContent,/下一步同步/)
  app.fn([{id:'p',models:['m'],synced:true,verifiedModels:[]}])
  assert.equal(app.$('headless-journey').dataset.stage,'verify')
  assert.equal(app.$('headless-stage-verify').dataset.state,'current')
  assert.match(app.$('headless-next-action').textContent,/立即验证一个模型/)
  assert.equal(app.$('headless-next-action').hidden,false)
  app.fn([{id:'p',models:['m'],synced:true,verifiedModels:['m']}])
  assert.equal(app.$('headless-journey').dataset.stage,'verified')
  assert.equal(app.$('headless-stage-verify').dataset.state,'done')
  assert.equal(app.$('headless-next-action').hidden,true)
})
test('Android 查看模式不提供验证主按钮，仍展示所需电脑端操作',()=>{
  const app=journey(true)
  app.fn([{id:'p',models:['m'],synced:true,verifiedModels:[]}])
  assert.equal(app.$('headless-next-action').hidden,true)
  assert.match(app.$('headless-next-description').textContent,/电脑端操作/)
  assert.match(html,/id="mobile-view-banner"/)
  assert.match(js,/if\(!button\.disabled\)button\.disabled=true;button\.classList\.add\('mobile-locked'\)/)
  assert.match(js,/if\(mobileViewOnly&&body!==undefined\)throw Error\(mobileDesktopHint\)/)
})

function makeRequest({status,body=null,mobileViewOnly=true}={}){
  const start=js.indexOf('  const request=async(path,body)=>{')
  const end=js.indexOf('  // 可访问的确认弹窗',start)
  assert.ok(start>=0&&end>start)
  const fetches=[]
  const request=runInNewContext(js.slice(start,end)+'\nrequest',{
    API:'/api/bili-duty',mobileViewOnly,mobileDesktopHint:'此项需要在电脑端完成',
    $:()=>({hidden:true}),pendingRequests:0,AbortController,setTimeout,clearTimeout,
    fetch:async(...args)=>{fetches.push(args);return {status,ok:status===200,json:async()=>body??({error:'forbidden'})}},
  })
  return {request,fetches}
}
test('Android 状态写入请求本地拦截，不会将禁止的操作发送给网关',async()=>{
  const app=makeRequest({status:403})
  await assert.rejects(app.request('/headless-model/sync',{selected:['p']}),/电脑端完成/)
  await assert.rejects(app.request('/onboarding/bili/verify',{}),/电脑端完成/)
  assert.equal(app.fetches.length,0)
})
test('Android 只读接口 403 显示可执行的电脑端提示，不直接暴露 forbidden',async()=>{
  const app=makeRequest({status:403})
  await assert.rejects(app.request('/headless-model/status'),e=>{
    assert.match(e.message,/手机端不可用.*电脑端/)
    assert.doesNotMatch(e.message,/forbidden/i)
    return true
  })
  assert.equal(app.fetches.length,1)
})
