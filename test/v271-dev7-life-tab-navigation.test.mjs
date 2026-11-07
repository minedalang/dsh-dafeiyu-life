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
  assert.match(html,/<button data-tab="life-agent" aria-selected="false">🐟 鱼鱼此刻<\/button>/)
})

test('clicking real Life tab runs the production switchTab path and reveals its panel',async()=>{
  const start=js.indexOf('  const tabNames=')
  const end=js.indexOf('  // Cross-page deep links',start)
  assert.ok(start>0&&end>start)
  const switchTabSource=js.slice(start,end)
  const registration=js.match(/  document\.querySelectorAll\('\[data-tab\]'\)\.forEach\(b=>b\.addEventListener\('click',\(\)=>switchTab\(b\.dataset\.tab\)\)\);/)
  assert.ok(registration,'production click registration must be present')
  const panels=Object.fromEntries(tabs.map(t=>['panel-'+t,{hidden:t!=='persona'}]))
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
    "let active='persona',firstNavigation=false",
    'const haltSandboxTimer=()=>{}',
    'const message=()=>{}',
    'const $=id=>panels[id]',
    'const refresh=()=>{loads.push(active);return Promise.resolve()}',
    'const run=fn=>fn()',
    switchTabSource,registration[0]
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
  assert.deepEqual(loads,['life-agent'],'Life loader must be invoked')
  assert.ok(urls.at(-1).includes('tab=life-agent'),'deep link must preserve Life tab')
  buttons.life.click()
  assert.equal(panels['panel-life-agent'].hidden,true)
  assert.equal(panels['panel-life'].hidden,false)
})

test('direct Life link accepts same registered route and is not removed by the onboarding guard',()=>{
  const saved=new URL('http://localhost/manage?tab=life-agent').searchParams.get('tab')
  assert.ok(tabs.includes(saved))
  assert.match(js,/else if\(tabNames\.includes\(saved\)\)initialTab=saved/)
  assert.match(js,/!\['firststart','models','home'\]\.includes\(tab\)\)tab='firststart'/)
  assert.match(html,/data-open-tab="life-agent"/)
})
