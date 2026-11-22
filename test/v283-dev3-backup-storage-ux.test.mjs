import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=join(fileURLToPath(new URL('.',import.meta.url)),'..')
const page=readFileSync(join(root,'lib/management-console.html'),'utf8')
const script=readFileSync(join(root,'lib/management-console.js'),'utf8')

function ui() {
  const start=script.indexOf('  const storageNotice=(id,state,title,detail=')
  const end=script.indexOf("  $('storage-open-relocate').addEventListener",start)
  assert.ok(start>=0&&end>start,'must find live production status renderer')
  const elements=new Map()
  const symbol={textContent:''}
  const $=id=>{
    if(!elements.has(id))elements.set(id,{
      dataset:{},textContent:'',children:[],
      replaceChildren(...nodes){this.children=nodes},
      querySelector(selector){assert.equal(selector,'.storage-overview-symbol');return symbol},
    })
    return elements.get(id)
  }
  const node=(tag,text)=>({tag,text})
  const {storageOverview,storageNotice}=new Function('node','$',script.slice(start,end)+'return {storageOverview,storageNotice}') (node,$)
  return {storageOverview,storageNotice,$,symbol}
}
const groups=[
  {key:'model',parts:[{domain:'whisper'},{domain:'embedding'},{domain:'media'}]},
  {key:'python',parts:[{domain:'python'}]},
  {key:'memory',parts:[{domain:'memory'}]},
]
const domains=[
  {key:'whisper',configured:true},{key:'embedding',configured:true},{key:'media',configured:true},
  {key:'python',configured:false},{key:'memory',configured:false},
]
const data=(migrationJob={},cleanupJob={},custom=domains)=>({groups,domains:custom,migrationJob,cleanupJob})
const snapshot=u=>({
  state:u.$('storage-overview').dataset.state,
  title:u.$('storage-overview-title').textContent,
  detail:u.$('storage-overview-detail').textContent,
})

test('backup UI keeps existing backup/restore controls and has one state overview',()=>{
  for(const id of ['storage-overview','storage-overview-title','storage-overview-detail',
    'storage-domain-list','storage-migration-job-status','storage-retained-model-check-result',
    'storage-retained-model-check','storage-retained-model-confirm-clean',
    'storage-domain','storage-target','storage-check','storage-schedule-migration',
    'backup-directory','backup-export','memory-backup-export','backup-restore','memory-backup-restore']){
    assert.equal([...page.matchAll(new RegExp(`id="${id}"`,'g'))].length,1,`duplicate or missing ${id}`)
  }
  assert.match(page,/数据与存储/)
  assert.match(page,/原数据目录的物理占用/)
  assert.match(page,/实际生效位置/)
  assert.match(page,/storage-partition-status\[data-state="success"\]/)
  assert.match(page,/@media\(prefers-color-scheme:dark\)/)
  assert.match(page,/aria-atomic="true"/)
  assert.doesNotMatch(page,/onclick=|onload=/i,'no inline handlers')
})

test('scheduled cleanup is high-visibility amber and explicitly says nothing deleted yet',()=>{
  const u=ui()
  u.storageOverview(data({status:'completed'},{status:'waiting'}))
  const state=snapshot(u)
  assert.equal(state.state,'attention')
  assert.match(state.title,/退出 DSH/)
  assert.match(state.detail,/尚未删除任何文件/)
  assert.equal(u.symbol.textContent,'!')
})

test('scheduled migration is amber and different from successful relocation',()=>{
  const u=ui()
  u.storageOverview(data({status:'waiting'}))
  assert.equal(snapshot(u).state,'attention')
  assert.match(snapshot(u).detail,/尚未复制迁移数据/)
  u.storageOverview(data({status:'completed'}))
  assert.equal(snapshot(u).state,'progress')
  assert.match(snapshot(u).title,/验证新位置/)
  assert.doesNotMatch(snapshot(u).title,/实测通过/)
})

test('failed cleanup is danger, never promises deletion or automatic retry',()=>{
  const u=ui()
  u.storageOverview(data({},{status:'failed',reason:'llama-server.exe 未退出'}))
  const state=snapshot(u)
  assert.equal(state.state,'danger')
  assert.match(state.title,/旧副本仍保留/)
  assert.match(state.detail,/llama-server\.exe/)
  assert.match(state.detail,/不会自动重试/)
})

test('verified cleanup-completion is green; idle configured state clearly shows partition count',()=>{
  const u=ui()
  u.storageOverview(data({status:'completed'},{status:'completed'}))
  assert.equal(snapshot(u).state,'success')
  assert.match(snapshot(u).title,/清理已完成/)
  u.storageOverview(data())
  assert.equal(snapshot(u).state,'success')
  assert.match(snapshot(u).title,/已独立分盘 1\/3/)
  u.storageOverview(data({}, {},domains.map(x=>({...x,configured:false}))))
  assert.equal(snapshot(u).state,'neutral')
  assert.match(snapshot(u).detail,/默认目录/)
})

test('status announcements use text nodes rather than HTML and expose correct state',()=>{
  const u=ui()
  u.storageNotice('storage-retained-model-check-result','attention','已预约清理','<script>alert(1)</script>')
  const el=u.$('storage-retained-model-check-result')
  assert.equal(el.dataset.state,'attention')
  assert.deepEqual(el.children.map(v=>v.tag),['strong','span'])
  assert.equal(el.children[1].text,'<script>alert(1)</script>')
})
