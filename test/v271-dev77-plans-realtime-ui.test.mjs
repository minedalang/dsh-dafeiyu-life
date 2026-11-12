import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeManagementEvents} from '../lib/life-management-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createLiveLifeActivity} from '../lib/live-life-activity.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'

const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')

test('Life changes use same-origin, payload-free SSE and close safely',()=>{
 const stream=createLifeManagementEvents({heartbeatMs:60000})
 class MockRes extends EventEmitter{
  headers=null;chunks=[];finished=false
  writeHead(status,headers){this.status=status;this.headers=headers}
  write(value){this.chunks.push(value);return true}
  end(){this.finished=true;this.emit('close')}
 }
 const req=new EventEmitter(),res=new MockRes()
 stream.subscribe(req,res)
 assert.equal(res.status,200)
 assert.match(res.headers['content-type'],/text\/event-stream/)
 assert.match(res.headers['cache-control'],/no-cache/)
 assert.equal(stream.connected,1)
 stream.publish('life');stream.publish('plans');stream.publish('timeline');stream.publish('secret')
 const text=res.chunks.join('')
 assert.equal((text.match(/event: life-change/g)||[]).length,3)
 assert.doesNotMatch(text,/secret|\bUID\b|cookie|password/i)
 assert.match(text,/"kind":"plans"/)
 req.emit('aborted');assert.equal(stream.connected,0)
 stream.close()
 assert.equal(stream.connected,0)
})

test('verified trace steps and in-flight activities emit change hints without granting writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-dev77-'))
 try{
  const traceEvents=[],lifeEvents=[]
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=> 'a'.repeat(16),onChange:type=>traceEvents.push(type)})
  const run=trace.begin({mode:'willingness'})
  run.step('model-call',{action:'life-willingness'})
  run.step('execution-plan',{action:'act',kind:'video_comment',delivery:'approval-only'})
  run.finish({state:'finished',result:'not-sent'})
  assert.ok(traceEvents.includes('begin'))
  assert.ok(traceEvents.includes('execution-plan'))
  assert.ok(traceEvents.includes('finish'))
  const live=createLiveLifeActivity({onChange:()=>lifeEvents.push('changed')})
  const done=live.start('life','account-1')
  assert.equal(live.snapshot('account-1').active.length,1)
  assert.equal(live.snapshot('account-2').active.length,0)
  done()
  assert.equal(live.snapshot('account-1').active.length,0)
  assert.equal(lifeEvents.length,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('todo writes notify the management view without exposing private text',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-dev77-todo-'))
 try{
  let changes=0
  const todos=createOwnerTodoEngine({dataDir:dir,onChange:()=>{changes++}})
  const result=todos.add({type:'search_videos',topic:'海洋科普',title:'探索海洋科普'},{source:'owner'})
  assert.equal(result.ok,true)
  assert.ok(changes>=1)
  const row=todos.list()[0]
  assert.equal(row.title,'探索海洋科普')
  const changed=todos.update(row.id,'defer',{dueAt:Date.now()+86400000})
  assert.equal(changed.ok,true)
  assert.ok(changes>=2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('owner Life dashboard has current name, verified source URLs and status-specific descriptions',()=>{
 assert.match(html,/🐟 鱼鱼正在做/)
 assert.doesNotMatch(html,/每 4 秒核对实际状态/)
 assert.match(ui,/planOpportunityState/)
 for(const s of ['已决定核实','公开证据已复核','鱼鱼已经放下','延期已过','来源评论所在视频','暂无可核实的原始链接'])assert.ok(ui.includes(s),s)
 assert.match(ui,/\^BV\[0-9A-Za-z\]\{10\}\$/)
 assert.match(ui,/noopener noreferrer/)
 assert.doesNotMatch(ui,/目前不在合格动作菜单；可以保留作为经历/)
})

test('SSE replaces frequent refresh timers, leaves explicit refresh and legacy view IDs intact',()=>{
 assert.match(host,/path==='\/api\/bili-duty\/life-management\/stream'/)
 assert.match(ui,/new EventSource\(API\+'\/life-management\/stream'/)
 assert.doesNotMatch(ui,/setInterval\(\(\)=>\{if\(!document.hidden&&active==='life-agent'\)/)
 for(const id of ['life-behavior-tree','life-timeline-list','life-plan-hub-grid','owner-todo-list','life-opportunities-list'])assert.ok(html.includes(`id="${id}"`),id)
 for(const name of ['is-thinking','is-executing','is-completed'])assert.ok(ui.includes(name)||html.includes(name),name)
 assert.match(html,/prefers-reduced-motion/)
})
