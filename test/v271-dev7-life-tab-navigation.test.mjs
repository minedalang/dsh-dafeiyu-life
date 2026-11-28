import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const html=read('lib/management-console.html')
const js=read('lib/management-console.js')

const tabSource=js.match(/const tabNames=(\[[^;]+\]);/)
assert.ok(tabSource,'the management tab registry must be present')
const tabs=runInNewContext(tabSource[1])

test('all visible tabs have a registered route, distinct panel and loader',()=>{
  const buttons=[...html.matchAll(/<button\s+data-tab="([^"]+)"/g)].map(x=>x[1])
  const panels=[...html.matchAll(/<section\s+id="panel-([^"]+)"/g)].map(x=>x[1])
  for(const [label,values] of [['button',buttons],['panel',panels],['registry',tabs]]){
    assert.equal(new Set(values).size,values.length,`duplicate ${label}`)
  }
  assert.deepEqual([...buttons].sort(),[...tabs].sort(),'every navigation button must be reachable')
  assert.deepEqual([...panels].sort(),[...tabs].sort(),'every registered tab must have one page')
  assert.ok(tabs.includes('life-agent'),'Life must be registered, not only rendered as a hidden panel')
  const loaderBlock=js.slice(js.indexOf('const loaders='),js.indexOf('// 直接刷新或复制管理页链接'))
  assert.match(loaderBlock,/'life-agent':async/,'Life route must load its data')
  assert.match(html,/<button data-tab="life-agent" aria-selected="false">🐟 鱼鱼正在做<\/button>/)
})

test('clicking real Life tab runs the production switchTab path and reveals its panel',async()=>{
  const start=js.indexOf('  const tabNames=')
  const end=js.indexOf('  // Cross-page deep links',start)
  assert.ok(start>0&&end>start)
  const switchTabSource=js.slice(start,end)
  const registration=js.match(/  document\.querySelectorAll\('\[data-tab\]'\)\.forEach\(b=>b\.addEventListener\('click',\(\)=>\{if\(!favoriteEditing\)switchTab\(b\.dataset\.tab\)\}\)\);/)
  assert.ok(registration,'production click registration must be present')
  const panels=Object.fromEntries(tabs.map(t=>['panel-'+t,{hidden:t!=='persona'}]))
  panels['management-shell']={dataset:{setupWizard:'true'}}
  const buttons=Object.fromEntries(tabs.map(t=>[t,{
    dataset:{tab:t},attributes:{},setAttribute(name,value){this.attributes[name]=value},
    addEventListener(name,fn){this[name]=fn}
  }]))
  const loads=[],urls=[]
  const document={
    querySelector(selector){return buttons[selector.match(/data-tab="([^"]+)"/)?.[1]]||null},
    querySelectorAll(selector){assert.equal(selector,'[data-tab]');return Object.values(buttons)}
  }
  runInNewContext([
    "let active='persona',firstNavigation=false,favoriteEditing=false",
    'const haltSandboxTimer=()=>{}',
    'const loadRuntimeControls=()=>{loads.push("runtime-controls");return Promise.resolve()}',
    'const restoreWizardControls=()=>{loads.push("restore-wizard")}',
    'const message=()=>{}',
    'const settingDrafts=new Map()',
    'const $=id=>panels[id]',
    'const refresh=()=>{loads.push(active);return Promise.resolve()}',
    'const run=fn=>fn()',
    switchTabSource,"onboarding={ok:true,welcomeCompleted:true,requiredReady:true,localMemoryReady:true,capabilities:{ok:true,available:true,active:{platform:true,autonomous:true,persona:true,automaticMemory:true,bridge:true},requested:{platform:true,autonomous:true,persona:true,automaticMemory:true,bridge:true},revision:0,restartRequired:false}}",registration[0]
  ].join('\n'),{
    panels,document,loads,URL,
    location:{href:'http://localhost/manage?tab=home'},
    history:{state:null,replaceState(_state,_title,url){urls.push(String(url))}}
  })
  assert.equal(typeof buttons['life-agent'].click,'function')
  buttons['life-agent'].click()
  assert.equal(panels['panel-life-agent'].hidden,false,'Life page must become visible')
  assert.equal(panels['panel-persona'].hidden,true,'previous page must become hidden')
  assert.equal(buttons['life-agent'].attributes['aria-selected'],'true')
  assert.equal(panels['management-shell'].dataset.setupWizard,'false')
  assert.deepEqual(loads,['restore-wizard','runtime-controls','life-agent'],'runtime control and Life loaders must be invoked')
  assert.ok(urls.at(-1).includes('tab=life-agent'),'deep link must preserve Life tab')
  buttons.life.click()
  assert.equal(panels['panel-life-agent'].hidden,true)
  assert.equal(panels['panel-life'].hidden,false)
})

test('direct Life link accepts same registered route and is not removed by the onboarding guard',()=>{
  const saved=new URL('http://localhost/manage?tab=life-agent').searchParams.get('tab')
  assert.ok(tabs.includes(saved))
  assert.match(js,/else if\(tabNames\.includes\(saved\)\)initialTab=saved/)
  assert.match(js,/if\(!tabAvailable\(tab\)\)tab='firststart'/)
  const start=js.indexOf('  const capabilityKeys='),end=js.indexOf('  const skipFirstStart=',start);const allowed=runInNewContext(js.slice(start,end)+'\ntabAvailable',{tabNames:tabs})
  const local={ok:true,welcomeCompleted:true,requiredReady:true,localMemoryReady:true,capabilities:{ok:true,available:true,active:{platform:false,autonomous:false,persona:false,automaticMemory:false,bridge:false},requested:{platform:false,autonomous:false,persona:false,automaticMemory:false,bridge:false},revision:0,restartRequired:false}}
  assert.equal(allowed('life-agent',local),false);assert.equal(allowed('life',local),true);assert.equal(allowed('home',local),true)
  const paused={...local,capabilities:{ok:true,available:true,active:{...local.capabilities.active,platform:true},requested:{...local.capabilities.active,platform:true},revision:0,restartRequired:false}}
  assert.equal(allowed('life-agent',paused),false);assert.equal(allowed('life',paused),true);assert.equal(allowed('bili',paused),true)
  assert.equal(allowed('life-agent',{...paused,capabilities:{...paused.capabilities,restartRequired:true}}),false)
  assert.match(html,/data-open-tab="life-agent"/)
})


test('custom favorites retain one canonical route and never duplicate settings or bypass navigation guards',()=>{
  const primary=html.split('<div class="tab-cluster tab-primary">')[1].split('</div>')[0]
  assert.deepEqual([...primary.matchAll(/data-(?:favorite-)?tab="([^"]+)"/g)].map(m=>m[1]),['home','firststart','models'])
  const other=html.slice(html.indexOf('<div class="tab-cluster"><span class="tab-cluster-label">🏠'),html.indexOf('</nav>',html.indexOf('<div class="tab-cluster tab-primary">')))
  for(const tab of ['models','life-agent','life'])assert.match(other,new RegExp(`data-tab="${tab}"`))
  assert.doesNotMatch(other,/data-tab="(?:home|firststart)"/)
  const start=js.indexOf('fixedFavorites=new Set('),end=js.indexOf(';',start)
  const fixed=js.slice(start,end),normalize=js.match(/const normalizeFavorites=items=>[^;]+;/)[0]
  const cleaned=runInNewContext('const '+fixed+';'+normalize+'normalizeFavorites(items)',{tabNames:tabs,items:['home','firststart','models','life','life-agent','diagnostics','unknown','backup','diagnostics',4]})
  assert.deepEqual([...cleaned],['life','life-agent','diagnostics','backup'])
  assert.match(js,/remove.dataset.favoriteRemove=t/)
  assert.match(js,/localStorage\.setItem\(favoriteKey,JSON\.stringify\(customFavorites\)\)/)
  assert.match(js,/b\.hidden=!tabAvailable\(t\)/)
  assert.match(js,/if\(link&&!favoriteEditing&&tabAvailable\(link\.dataset\.favoriteTab\)\)switchTab\(link\.dataset\.favoriteTab\)/)
  assert.match(js,/link\.dataset\.tab\|\|link\.dataset\.favoriteTab/)
  assert.match(js,/favoriteHost\.replaceChildren\(\)/)
  assert.match(js,/primaryNav\?\.addEventListener\('drop'/)
})
