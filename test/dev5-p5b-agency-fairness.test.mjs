import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {createAutonomousPlanner,rankAcceptedTodos,diversePlannerCandidates} from '../lib/autonomous-planner.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'

const T=Date.parse('2026-11-01T14:00:00Z'),BV='BV19SJi6VEj1';
const inDir=async f=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-p5b-'));try{return await f(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const settings={masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerMinutes:15,autonomousPlannerDailyLimit:3,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,mainSessionReflectionMinCandidates:6};

test('dev.6 单次意愿：情绪波动不在执行阶段再次否决；仍检查任务客观资格',()=>inDir(dir=>{
  let state={energy:3,curiosity:5,sociality:2,valence:-80};
  const gate=createDualContextAgency({dataDir:dir,getEmotion:()=>state,getRelationship:()=>({stage:'friend',score:100})});
  const task={id:'ok',type:'watch_video',status:'open',source:'recommendation',origin:{uid:'23456'}};
  assert.equal(gate.assessReadExecution({task}).decision,'allow');
  assert.equal(existsSync(join(dir,'dual-context-agency.json')),false,'不应为了复核新建/打开意愿账本');
  state={energy:78,curiosity:70,sociality:64,valence:40};
  assert.equal(gate.assessReadExecution({task}).decision,'allow');
  assert.equal(gate.assessReadExecution({task:{...task,type:'dm_friend'}}).decision,'blocked');
  assert.equal(gate.assessReadExecution({task:{...task,status:'uncertain'}}).decision,'blocked');
  state={enabled:false,energy:0,curiosity:0};
  assert.equal(gate.assessReadExecution({task}).reason,'prior-life-intent-retained');
}));

test('dev.6 生活模型选中后情绪变化不会被第二评分器否决，仍验证原任务资格',()=>inDir(async dir=>{
  let feeling={energy:75,curiosity:65,sociality:55,valence:30};let fired=0,now=T,prompt='';
  const engine=createOwnerTodoEngine({dataDir:dir,now:()=>now});
  const item=engine.add({type:'watch_video',bvid:BV,origin:{kind:'bilibili-dm',uid:'23456'}},{source:'recommendation'}).item;
  const gate=createDualContextAgency({dataDir:dir,getEmotion:()=>feeling,now:()=>now});
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>settings,now:()=>now,
    getTodos:()=>engine.list({limit:500}),getLifeState:()=>feeling,recheckWillingness:task=>gate.assessReadExecution({task}),
    invokeModel:async p=>{prompt=p;feeling={energy:0,curiosity:2,sociality:2,valence:-80};return JSON.stringify({action:'execute_read',id:item.id})},
    executeRead:async()=>{fired++;return {ok:true}},updateTodo:(...args)=>engine.update(...args),
    reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})});
  const result=await planner.tick();
  assert.equal(result.action,'execute_read');assert.equal(fired,1);
  const saved=engine.list({limit:500,includeClosed:true}).find(x=>x.id===item.id);
  assert.equal(saved.status,'open','测试中的模拟执行器没有写入真实完成回执，不可伪称已完成');
  assert.match(prompt,/"energy":75/);assert.doesNotMatch(prompt,/quotedText|私信原文/);
}));

test('dev.5 关系优先不是永远压制：等待久的普通用户任务可追上新朋友；多发起人进入候选',()=>{
  const newcomer={id:'new',createdAt:T,source:'recommendation',origin:{uid:'123'},type:'watch_video'},
    old={id:'old',createdAt:T-30*86400000,source:'recommendation',origin:{uid:'456'},type:'watch_video'};
  const ranked=rankAcceptedTodos([newcomer,old],{relationshipHint:uid=>uid==='123'?{stage:'friend',score:98}:{stage:'new',score:0},now:T});
  assert.equal(ranked[0].id,'old','30 天老任务应获得有限反饥饿优势');
  const crowded=Array.from({length:12},(_,i)=>({id:'same-'+i,createdAt:T-i*1000,source:'recommendation',origin:{uid:'123'},priorityHint:99-i}));
  const different={id:'different',createdAt:T,source:'recommendation',origin:{uid:'456'},priorityHint:5};
  const chosen=diversePlannerCandidates([...crowded,different],8);
  assert.equal(chosen.length,8);assert.ok(chosen.some(x=>x.id==='different'));
});

test('dev.5 计划时间与外部写入在旧状态下不能通过直接执行',()=>inDir(async dir=>{
  let now=T,executed=0;
  const engine=createOwnerTodoEngine({dataDir:dir,now:()=>now});
  const valid=engine.add({type:'watch_video',bvid:BV}).item;
  engine.add({type:'like_video',bvid:BV,ownerAuthorized:true});
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>settings,now:()=>now,
    getTodos:()=>engine.list({limit:500}),invokeModel:async()=>{
      engine.update(valid.id,'defer',{dueAt:now+3600000});
      return JSON.stringify({action:'execute_read',id:valid.id});
    },executeRead:async()=>{executed++;return {ok:true}},updateTodo:(...args)=>engine.update(...args),reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})});
  assert.equal((await planner.tick()).ok,false);assert.equal(executed,0);
}));
