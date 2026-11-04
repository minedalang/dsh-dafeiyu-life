import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities,deriveDiscussionOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const BV='BV1abcde1234',BV2='BV1abcde1235'
const now=Date.parse('2026-11-04T08:00:00.000Z')
const credA={dedeuserid:'12345',sessdata:'secret-a'},credB={dedeuserid:'45678',sessdata:'secret-b'}
const dayLocal=at=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const withHome=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-opportunity-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const event=(account,{bvid=BV,at=now-3600_000,kind='comment_list_read',status='read',count=5,reaction='curious',question='为什么大家有不同看法？'}={})=>
  kind==='provisional_fish_reaction'?{v:1,account,bvid,at:new Date(at).toISOString(),kind,reaction,question,count}:
  {v:1,account,bvid,at:new Date(at).toISOString(),kind,status,count}
function seed(dir,credential=credA,{bv=BV,includeRead=true,emptyRead=false,foreign=false,at=now-3600_000}={}){
  const tag=discussionAccountTag(foreign?credB:credential),rows=[]
  if(includeRead)rows.push(event(tag,{bvid:bv,at,count:emptyRead?0:5}))
  rows.push(event(tag,{bvid:bv,at:at+1000,kind:'provisional_fish_reaction'}))
  const folder=join(dir,'video-discussion-reads');mkdirSync(folder,{recursive:true})
  writeFileSync(join(folder,dayLocal(at)+'.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n')
}
const coordinator=(dir,credential=credA,current=()=>now)=>createLifeOpportunities({stateDir:dir,getCredential:()=>credential,now:current})
function planner(dir,opportunity,{response=()=>({action:'inspect_opportunity',id:opportunity.list()[0]?.id,reason:'我想确认这段讨论的背景'}),read=async bv=>({ok:true,bvid:bv,title:'公开视频事实资料'}),nowFn=()=>now}={}){
  let calls=0,reads=0
  const agent=createAutonomousPlanner({dataDir:dir,now:nowFn,
    getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:5,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],invokeModel:async prompt=>{calls++;return JSON.stringify(response(prompt))},
    executeRead:async()=>{throw Error('不可执行其它待办')},
    updateTodo:async()=>{throw Error('不可改写待办')},reflect:async()=>({ok:true}),reflectionStatus:()=>({pending:0}),
    getLifeOpportunities:()=>opportunity.list(),recordOpportunityDecision:(id,action,options)=>opportunity.decide(id,action,options),
    executeOpportunityRead:async bv=>{reads++;return read(bv)}})
  return {agent,get calls(){return calls},get reads(){return reads}}
}

test('real comment list preceding subjective note produces one bounded opportunity',async()=>withHome(async dir=>{
  seed(dir)
  const o=coordinator(dir),rows=o.list()
  assert.equal(rows.length,1)
  assert.equal(rows[0].bvid,BV)
  assert.equal(rows[0].subjective,true)
  assert.equal(rows[0].verifiedRead,true)
  assert.equal(rows[0].eligible,true)
  assert.equal(o.status().accountReady,true)
}))
test('without actual nonempty read or matching BV, subjective text cannot become opportunity',async()=>{
 const t=new Date(now-3600_000).toISOString(),later=new Date(now-3599_000).toISOString()
 const note={kind:'provisional_fish_reaction',bvid:BV,at:later,reaction:'curious',subjective:true}
 assert.equal(deriveDiscussionOpportunities([note],now).length,0)
 assert.equal(deriveDiscussionOpportunities([{kind:'comment_list_read',status:'read',verified:true,bvid:BV2,count:5,at:t},note],now).length,0)
 assert.equal(deriveDiscussionOpportunities([{kind:'comment_list_read',status:'failed',verified:false,bvid:BV,count:5,at:t},note],now).length,0)
 assert.equal(deriveDiscussionOpportunities([{kind:'comment_list_read',status:'read',verified:true,bvid:BV,count:0,at:t},note],now).length,0)
})
test('different login/account cannot inspect old account decisions',async()=>withHome(async dir=>{
 seed(dir)
 const a=coordinator(dir,credA),b=coordinator(dir,credB)
 assert.equal(a.list().length,1)
 assert.equal(b.list().length,0)
 assert.equal(b.decide(a.list()[0].id,'inspect').ok,false)
}))
test('planner autonomously verifies public metadata, never creates a task or sends',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op)
 const result=await p.agent.tick({force:true,opportunitiesOnly:true})
 assert.equal(result.action,'inspect_opportunity')
 assert.equal(result.result,'verified-metadata')
 assert.equal(p.calls,1);assert.equal(p.reads,1)
 assert.equal(op.list().length,0)
 assert.equal(op.recentReads()[0].scope,'video-metadata-only')
 assert.equal(op.recentReads()[0].bvid,BV)
 assert.equal(op.status().opportunities[0].status,'inspect')
 assert.equal((await p.agent.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
}))
test('platform read mismatch cannot create verified experience; failure is deferred',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op,{read:async()=>({ok:true,bvid:BV2,title:'错误的视频'})})
 const result=await p.agent.tick({force:true,opportunitiesOnly:true})
 assert.equal(result.result,'failed')
 assert.equal(op.recentReads().length,0)
 assert.equal(op.status().opportunities[0].status,'defer')
 assert.equal(op.list().length,0)
}))
test('defer and dismiss are real decisions; deferred cannot be reconsidered immediately',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op,{response:()=>({action:'defer',id:op.list()[0]?.id,reason:'暂时没兴趣'})})
 assert.equal((await p.agent.tick({force:true,opportunitiesOnly:true})).action,'defer')
 assert.equal(op.list().length,0)
 assert.equal((await p.agent.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
 assert.equal(op.status().opportunities[0].status,'defer')
}))
test('model-created opportunity ID cannot trigger any read operation',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op,{response:()=>({action:'inspect_opportunity',id:'fake',reason:'bad'})})
 const result=await p.agent.tick({force:true,opportunitiesOnly:true})
 assert.equal(result.action,'skip')
 assert.equal(p.reads,0)
 assert.equal(op.status().opportunities[0].status,'pending')
}))
test('no source evidence does not consume model budget',async()=>withHome(async dir=>{
 const op=coordinator(dir),p=planner(dir,op)
 assert.equal((await p.agent.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
 assert.equal(p.calls,0)
 assert.equal(p.agent.status().runs,0)
}))
test('existing TODO reminder remains todosOnly and never consumes opportunity',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op)
 assert.equal((await p.agent.tick({force:true,todosOnly:true})).skipped,'nothing-to-do')
 assert.equal(op.list().length,1)
 assert.equal(p.calls,0)
}))

test('malformed model response is an error, not an invented fish decision',async()=>withHome(async dir=>{
 seed(dir)
 const op=coordinator(dir),p=planner(dir,op,{response:()=>({action:'fake_tool',id:op.list()[0]?.id})})
 const result=await p.agent.tick({force:true,opportunitiesOnly:true})
 assert.equal(result.ok,false)
 assert.equal(result.action,'skip')
 assert.equal(p.reads,0)
 assert.equal(op.list()[0].status,'pending')
}))
