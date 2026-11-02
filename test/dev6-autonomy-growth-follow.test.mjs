import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'

const time=Date.parse('2026-11-02T11:00:00Z'),BV='BV1234567890'
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev6-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const base={masterEnabled:true,autonomousPlannerEnabled:false,autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:2,autonomousPlannerStartHour:22,autonomousPlannerEndHour:23,mainSessionReflectionMinCandidates:6}

// A reminder may wake one read-only decision even when automatic runs are off.
test('dev.6 管理提醒只是一次自主决策，不能强制指定任务或外部写入',()=>withDir(async dir=>{
 let decisions=0,executions=0
 const items=[{id:'todo1',type:'watch_video',status:'open',bvid:BV,createdAt:time}]
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>time,getConfig:()=>base,getTodos:()=>items,
  invokeModel:async()=>{decisions++;return JSON.stringify({action:'skip',reason:'鱼鱼想先休息'})},
  executeRead:async()=>{executions++;return {ok:true}},updateTodo:async()=>{},reflect:async()=>({ok:true}),reflectionStatus:()=>({pending:0})})
 assert.equal((await planner.tick()).skipped,'disabled')
 assert.equal(planner.status().nextDecisionAt,null)
 const response=await planner.tick({force:true,todosOnly:true})
 assert.equal(response.action,'skip');assert.equal(decisions,1);assert.equal(executions,0)
 assert.equal((await planner.tick({force:true,todosOnly:true})).action,'skip')
 assert.equal((await planner.tick({force:true,todosOnly:true})).skipped,'quota')
}))

test('dev.6 手动提醒也必须遵守总开关、只读范围和真正待办',()=>withDir(async dir=>{
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>time,getConfig:()=>({...base,masterEnabled:false}),getTodos:()=>[{id:'write',type:'follow_creator',status:'open'}],
  invokeModel:async()=>{throw Error('not allowed')},executeRead:async()=>{throw Error('not allowed')},updateTodo:async()=>{},reflect:async()=>{},reflectionStatus:()=>({pending:100})})
 assert.equal((await planner.tick({force:true,todosOnly:true})).skipped,'disabled')
}))

test('dev.6 预计自动决策时间遵守小时窗口和额度，不承诺必定执行',()=>withDir(async dir=>{
 let ms=time
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>ms,getConfig:()=>({...base,autonomousPlannerEnabled:true}),getTodos:()=>[],
  invokeModel:async()=>'{"action":"skip"}',executeRead:async()=>{},updateTodo:async()=>{},reflect:async()=>{},reflectionStatus:()=>({pending:0})})
 const next=planner.status().nextDecisionAt
 assert.ok(next>time)
 assert.equal(new Date(next).getHours(),22)
 assert.match(planner.status().nextDecisionNote,/不保证执行/)
}))

test('dev.6 真实选片形成每天最多一次轻量探索观察，三天后才是发展中；私密和模糊经历不能刷分',()=>withDir(async dir=>{
 const ts=['2026-10-29T12:00:00Z','2026-10-30T12:00:00Z','2026-10-31T12:00:00Z']
 const episodes=ts.map((at,i)=>({key:'watch:'+i,id:'e-'+i,kind:'watch',stage:'clear',text:'我曾经选中视频《动画科普》',bvid:BV,at}))
 episodes.push({key:'private',id:'p1',kind:'private-social',stage:'clear',text:'私聊',bvid:BV,at:ts[0]})
 episodes.push({key:'forgotten',id:'f1',kind:'watch',stage:'forgotten',text:'已忘',bvid:BV,at:ts[0]})
 const gateway={reflectionEvidence:keys=>episodes.filter(e=>keys.includes(e.key))}
 const personality=createPersonalityEvolution({dataDir:dir,memoryGateway:gateway,now:()=>time});personality.setEnabled(true)
 const row=i=>({id:'c-'+i,key:'watch:'+i,kind:'watch'})
 const first=personality.observeVerifiedExploration([row(0),row(0),{id:'p1',key:'private',kind:'private-social'}, {id:'c-forgot',key:'forgotten',kind:'watch'}])
 assert.equal(first.observed,1)
 assert.equal(personality.observeVerifiedExploration([row(0)]).observed,0)
 assert.equal(personality.status().traits.find(x=>x.id==='curiosity').stage,'observed')
 assert.equal(personality.observeVerifiedExploration([row(1),row(2)]).observed,2)
 const curiosity=personality.status().traits.find(x=>x.id==='curiosity')
 assert.equal(curiosity.evidenceCount,3);assert.equal(curiosity.stage,'developing')
 const file=readFileSync(join(dir,'personality-evolution/v1.json'),'utf8')
 assert.doesNotMatch(file,/私聊|鱼鱼自主选中的公开视频|BV1234567890/)
}))

test('dev.6 模型没有长期领悟，不代表有证据的探索观察必须是零',()=>withDir(async dir=>{
 const record={kind:'watch',key:'watch:real:one',bvid:BV,day:'2026-11-02',title:'真正入选的视频'}
 const episode={key:record.key,id:'e-current',kind:'watch',stage:'clear',text:'我曾经选中视频《当天真实入选》',bvid:BV,at:time}
 const gateway={reflectionEvidence:keys=>keys.includes(record.key)?[episode]:[]}
 const personality=createPersonalityEvolution({dataDir:dir,memoryGateway:gateway,now:()=>time});personality.setEnabled(true)
 const reflection=createLifeReflection({dataDir:dir,memoryGateway:gateway,getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true}),now:()=>time,
  invokeModel:async()=>JSON.stringify({memories:[],trait_proposals:[]}),commitMemories:()=>({added:0,rows:[]}),
  getPersonalityEnabled:()=>personality.status().enabled,
  onPersonalityProposals:(p,b)=>personality.applyProposals(p,b),
  onPersonalityObservations:b=>personality.observeVerifiedExploration(b)})
 reflection.addEvents([record]);const result=await reflection.reflect({force:true})
 assert.equal(result.ok,true);assert.equal(result.created,0);assert.equal(result.personalityProposed,0)
 assert.equal(result.personalityObserved,1);assert.equal(result.personalityAccepted,0)
 assert.equal(reflection.status().recentPublicRun.personalityObserved,1)
}))

test('dev.6 界面和服务端不再强制执行待办：提醒、预计时间与关注诊断具备接线',()=>{
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.doesNotMatch(ui,/btn\('现在执行'/)
 assert.doesNotMatch(ui,/action:'run'/)
 assert.match(html,/id="owner-todo-remind"/)
 assert.match(html,/id="autonomous-planner-next"/)
 assert.match(server,/autonomous-planner\/remind/)
 assert.match(server,/tick\(\{force:true,todosOnly:true\}\)/)
 assert.match(server,/if\(action==='run'\)return sendJson\(res,403/)
 assert.match(server,/follow-readiness/)
 assert.match(html,/bili-agent-follow-readiness/)
})

test('dev.6 多天与不同陌生人的确认回复可累积低权重社交观察，但单人刷屏/未回复/主人聊天不能刷分',()=>withDir(async dir=>{
 const episodes=[
  {key:'social:a',id:'e-social-a',kind:'social',stage:'clear',text:'鱼鱼与陌生人真实交流',incomingText:'你好',confirmedReply:true,actorUid:'110001',socialTier:'stranger',at:'2026-10-20T12:00:00Z'},
  {key:'social:b',id:'e-social-b',kind:'social',stage:'clear',text:'鱼鱼与陌生人真实交流',incomingText:'你好',confirmedReply:true,actorUid:'110002',socialTier:'stranger',at:'2026-10-21T12:00:00Z'},
  {key:'social:c',id:'e-social-c',kind:'social',stage:'clear',text:'鱼鱼与陌生人真实交流',incomingText:'你好',confirmedReply:true,actorUid:'110001',socialTier:'stranger',at:'2026-10-22T12:00:00Z'},
  {key:'social:spam',id:'e-spam',kind:'social',stage:'clear',text:'重复',incomingText:'又来了',confirmedReply:true,actorUid:'110001',socialTier:'stranger',at:'2026-10-20T12:01:00Z'},
  {key:'social:no-reply',id:'e-no-reply',kind:'social',stage:'clear',text:'用户留言',incomingText:'你好',confirmedReply:false,actorUid:'110003',socialTier:'stranger',at:'2026-10-23T12:00:00Z'},
  {key:'social:owner',id:'e-owner',kind:'social',stage:'clear',text:'与主人聊天',incomingText:'你好',confirmedReply:true,actorUid:'110004',socialTier:'owner',at:'2026-10-24T12:00:00Z'},
 ]
 const gateway={reflectionEvidence:keys=>episodes.filter(e=>keys.includes(e.key))}
 const personality=createPersonalityEvolution({dataDir:dir,memoryGateway:gateway,now:()=>time});personality.setEnabled(true)
 const rows=episodes.map(e=>({id:'c-'+e.key,key:e.key,kind:'social'}))
 assert.equal(personality.observeVerifiedExploration(rows).observed,3)
 const trait=personality.status().traits.find(x=>x.id==='social_openness')
 assert.equal(trait.stage,'developing');assert.equal(trait.supportivePeople,2);assert.equal(trait.supportiveStrangers,2)
 assert.equal(personality.observeVerifiedExploration(rows).observed,0)
 const file=readFileSync(join(dir,'personality-evolution/v1.json'),'utf8')
 for(const forbidden of ['110001','110002','你好','鱼鱼与陌生人真实交流'])assert.ok(!file.includes(forbidden))
}))
