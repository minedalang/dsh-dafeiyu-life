import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'

const TAG='a'.repeat(16),T=Date.parse('2026-11-12T03:00:00Z'),BV='BV1hVWQ6ZEcw'
function make(t,{mode='active',age=10_000,kind='bilibili-dm',source='recommendation',status='open',costLimit=200,timing='now',accountChangeOnRead=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'dsh-dev5-wake-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let clock=T,turns=0,executed=0,modelOptions=[],scope=TAG
 const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,
  autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:costLimit,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
  homeRecommendationsEnabled:true}
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>clock-age,getAccountUid:()=> '3747574597028931'})
 const saved=todos.add({type:'watch_video',bvid:BV,title:'看看对方公开作品',sourceKey:'social-ai-read:test',acceptance:{timing},origin:{kind,uid:'12345',messageId:'msg1',at:T-age}}, {source})
 assert.equal(saved.created,true)
 const row=saved.item;row.status=status;row.origin.kind=kind
 // Tests here only change the in-memory view. The real source rechecks the ledger.
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>cfg,getLifeAccountTag:()=>scope,
  getTodos:()=>[row],getLifeEvents:()=>[],getLifeEventStatus:()=>({pending:0}),
  invokeModel:async prompt=>{turns++;modelOptions.push(prompt);return JSON.stringify({action:'skip',reason:'以后再考虑'})},
  executeRead:async id=>{executed++;if(accountChangeOnRead)scope='b'.repeat(16);const result=await todos.run(id,async()=>({ok:true,summary:'已核对公开元数据'}));if(result.ok)row.status='done';return result},
  updateTodo:(id,action,opts)=>todos.update(id,action,opts),reflect:async()=>({ok:true})})
 writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:1,lifeRuns:1,socialRuns:0,willingnessRuns:0,willingnessBillingVersion:2,lastAt:T-60_000,lastResult:'',lastError:'',recent:[]})+'\n')
 return {dir,row,cfg,planner,get turns(){return turns},get executed(){return executed},get prompt(){return modelOptions.at(-1)||''},now:ms=>clock+=ms}
}
test('one explicit social-model now intention executes read without a second Life model vote',async t=>{
 const x=make(t)
 assert.equal((await x.planner.tick()).skipped,'cooldown')
 assert.equal(x.turns,0)
 const got=await x.planner.tick({acceptedTodoWakeId:x.row.id})
 assert.equal(got.result,'done')
 assert.equal(got.modelCalled,false)
 assert.equal(x.turns,0,'the first social reply model already made this decision')
 assert.equal(x.executed,1)
 assert.equal(x.planner.status().lifeRuns,1,'no extra Life model quota charged')
 assert.equal((await x.planner.tick({acceptedTodoWakeId:x.row.id})).skipped,'accepted-todo-wake-unavailable')
 assert.equal(x.executed,1,'canonical TODO ledger prevents duplicate reads')
})
test('later, legacy, stale, invalid channel and disabled mode never fast execute',async t=>{
 for(const opts of [{timing:'later'},{age:10*60_000},{kind:'owner-dm'},{source:'owner'},{status:'done'},{mode:'off'}]){
  const x=make(t,opts)
  const r=await x.planner.tick({acceptedTodoWakeId:x.row.id})
  assert.equal(r.skipped,opts.mode==='off'?'life-paused':'accepted-todo-wake-unavailable',JSON.stringify(opts))
  assert.equal(x.turns,0)
  assert.equal(x.executed,0)
 }
})
test('zero daily budget and saved quota are authoritative even for direct read',async t=>{
 const x=make(t,{costLimit:1})
 assert.equal((await x.planner.tick({acceptedTodoWakeId:'fake'})).skipped,'quota')
 assert.equal((await x.planner.tick({acceptedTodoWakeId:x.row.id})).skipped,'quota')
 assert.equal(x.executed,0)
})
test('real provider model backoff blocks direct accepted read as a technical gate',async t=>{
 const x=make(t)
 const state=JSON.parse(readFileSync(join(x.dir,'autonomous-planner.json'),'utf8'))
 state.modelRetryAt=T+120_000
 writeFileSync(join(x.dir,'autonomous-planner.json'),JSON.stringify(state))
 const r=await x.planner.tick({acceptedTodoWakeId:x.row.id})
 assert.equal(r.skipped,'model-backoff')
 assert.equal(x.turns,0)
 assert.equal(x.executed,0)
})
test('Life plan cards use the existing viewer-local formatter and do not invent missing dates',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(js,/const formatLocalTime=value=>/)
 assert.match(js,/date\.toLocaleString\('zh-CN',\{hour12:false\}\)/)
 for(const label of ['发现','最近更新','完成','下次可考虑'])assert.ok(js.includes(`stamp('${label}'`))
 assert.match(js,/原始记录未提供可信时间/)
 assert.match(html,/life-plan-times/)
})
test('social DM replies remain independent of the ordinary Life 10 minute poll',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(code,/onTodoProposal:proposal=>intakeAiSocialTodo/)
 assert.match(code,/wakeAcceptedSocialTodo=id=>.*acceptedTodoWakeId:id/)
 assert.match(code,/acceptedTodoWakeId/)
 assert.match(code,/result\?\.created===true/)
 assert.match(code,/if\(fresh\?\.id\)queueAcceptedSocialTodoWake\(fresh\.id\)/)
 assert.match(code,/const fresh=r\?\.created===true/)
})

test('account change while read executes cannot settle as a successful current-account Life action',async t=>{
 const x=make(t,{accountChangeOnRead:true})
 const r=await x.planner.tick({acceptedTodoWakeId:x.row.id})
 assert.equal(x.turns,0)
 assert.equal(x.executed,1,'tool can start, but later account change must not record Life success')
 assert.equal(r.skipped,'account-changed')
})
