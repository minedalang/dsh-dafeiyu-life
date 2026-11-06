// Isolated Node process for the offline Life Planner ownership/quota test.
import {appendFileSync} from 'node:fs'
import {createAutonomousPlanner} from '../../lib/autonomous-planner.mjs'
const [dataDir,logFile,who]=process.argv.slice(2)
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'off',
  autonomousPlannerDailyLimit:1,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const planner=createAutonomousPlanner({dataDir,getConfig:()=>cfg,
  getTodos:()=>[{id:'123e4567-e89b-12d3-a456-426614174000',type:'watch_video',status:'open',title:'Offline read only',createdAt:Date.now()}],
  getLifeAccountTag:()=>who==='a'?'a'.repeat(16):'b'.repeat(16),
  invokeModel:async()=>{appendFileSync(logFile,who+'\n');await new Promise(resolve=>setTimeout(resolve,650));return '{"action":"skip"}'},
  executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
try{const result=await planner.tick({force:true,todosOnly:true});console.log(JSON.stringify({worker:who,result}))}
catch(e){console.error(String(e));process.exitCode=1}
