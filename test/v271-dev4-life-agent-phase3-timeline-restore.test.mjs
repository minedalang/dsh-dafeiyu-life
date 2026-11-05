import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createColdSnapshot,verifyColdSnapshot,restoreColdSnapshot} from '../lib/cold-state-snapshot.mjs'
import {createBackup,validateBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
import {createAccountBinding} from '../lib/account-binding.mjs'
const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-05T12:00:00Z')
const withDir=async f=>{const d=mkdtempSync(join(tmpdir(),'dsh-dev4-phase3-'));try{await f(d)}finally{rmSync(d,{recursive:true,force:true})}}
const put=(root,name,content)=>{const path=join(root,name);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,content)}
function plannerFor(root,events,{model=()=>JSON.stringify({action:'skip',reason:'今天先休息'})}={}){
  return createAutonomousPlanner({dataDir:root,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'shadow',autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,autonomousPlannerMinutes:5}),
    getTodos:()=>[],getLifeAccountTag:()=>A,getLifeEvents:()=>events.peek(4),offerLifeWake:x=>events.offer(x),
    settleLifeEvents:(ids,why)=>events.settle(ids,why),getLifeEventStatus:()=>events.status(),
    recordLifeDecision:decision=>events.recordDecision(decision),getLifeCapabilities:()=>[],
    invokeModel:async prompt=>model(prompt),executeRead:()=>({ok:true}),updateTodo:()=>({ok:true}),reflect:()=>({ok:true}),now:()=>T})
}
test('phase2 legacy event ledger upgrades without losing pending social wakes',()=>withDir(async root=>{
  put(root,`life-agent-events/${A}.json`,JSON.stringify({version:1,events:[{id:'f'.repeat(24),kind:'dm-received',platform:'bilibili',at:T,state:'pending'}],videoStarts:[]}))
  const events=createLifeAgentEvents({stateDir:root,getAccountTag:()=>A,now:()=>T})
  assert.equal(events.status().pendingSocial,1)
  assert.deepEqual(events.status().timeline,[])
  const planner=plannerFor(root,events)
  const out=await planner.tick({force:true})
  assert.equal(out.action,'skip')
  assert.equal(events.status().pendingSocial,0)
  const timeline=events.status().timeline
  assert.equal(timeline.length,1)
  assert.deepEqual(timeline[0].kinds,['dm-received'])
  assert.equal(timeline[0].action,'skip')
  assert.equal(timeline[0].result,'no-action-receipt')
  const disk=readFileSync(join(root,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(disk,/今天先休息|UID|私信正文/)
  assert.equal(JSON.parse(disk).version,1)
}))
test('decisions keep bounded cross-round continuation without raw target identifier; account isolation',()=>withDir(async root=>{
  let account=A
  const events=createLifeAgentEvents({stateDir:root,getAccountTag:()=>account,now:()=>T})
  events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'UID:123:BV123'})
  const inEvent=events.peek().map(x=>x.id)
  events.recordDecision({eventIds:inEvent,action:'begin_exploration',result:'verified-search-results',targetId:'sensitive-user-or-bvid',mode:'shadow'})
  events.recordDecision({eventIds:[],action:'inspect_exploration',result:'verified-metadata',targetId:'sensitive-user-or-bvid',mode:'shadow'})
  const rows=events.status().timeline
  assert.equal(rows[0].continued,true)
  assert.equal(rows[1].continued,false)
  assert.deepEqual(rows[1].kinds,['comment-received'])
  const disk=readFileSync(join(root,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(disk,/UID:123|BV123|sensitive-user-or-bvid/)
  account=B;assert.deepEqual(events.status().timeline,[])
  account=A;assert.equal(events.status().timeline.length,2)
}))
test('full cold snapshot retains all old user state and credentials; restores exact file bytes',()=>withDir(async parent=>{
  const root=join(parent,'bili-duty'),backup=join(parent,'private-backup'),mkdir=()=>mkdirSync(root)
  mkdir()
  put(root,'character-identity.json',JSON.stringify({id:'11111111-1111-1111-1111-111111111111'}))
  put(root,'life-memory/episodic.json','{"episodes":[{"kind":"watch","title":"中文鱼"}]}')
  put(root,'owner-todos.json','{"todos":[{"status":"open"}]}')
  put(root,'accounts/333/credential.json','SECRET_COOKIE')
  put(root,'life-agent-events/'+A+'.json','{"version":1,"events":[],"videoStarts":[]}')
  put(root,'runtime/new-future-format.bin','\0\x01\x02DATA')
  assert.throws(()=>createColdSnapshot({root,destination:backup}),/必须先停止/)
  assert.equal(createColdSnapshot({root,destination:backup,stoppedConfirmed:true}).files,6)
  assert.equal(verifyColdSnapshot(backup).files,6)
  put(root,'owner-todos.json','new accidental data')
  put(root,'state.json','unsaved state')
  assert.throws(()=>restoreColdSnapshot({root,snapshot:backup,stoppedConfirmed:true,confirm:'NO'}),/必须停机/)
  const result=restoreColdSnapshot({root,snapshot:backup,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'})
  assert.equal(result.restored,true)
  assert.ok(existsSync(result.safeguardPath))
  assert.equal(readFileSync(join(root,'owner-todos.json'),'utf8'),'{"todos":[{"status":"open"}]}')
  assert.equal(readFileSync(join(root,'accounts/333/credential.json'),'utf8'),'SECRET_COOKIE')
  assert.equal(readFileSync(join(root,'runtime/new-future-format.bin'),'utf8'),'\0\x01\x02DATA')
  assert.equal(existsSync(join(root,'state.json')),false)
  assert.equal(JSON.parse(readFileSync(join(root,'restore-freeze.json'),'utf8')).reviewRequired,true)
  assert.equal(readFileSync(join(result.safeguardPath,'state.json'),'utf8'),'unsaved state')
}))
test('cold restore blocks legacy account automatic operations until explicit same-UID re-review',()=>withDir(async parent=>{
  const root=join(parent,'state'),snapshot=join(parent,'snapshot');mkdirSync(root)
  const id='33333333-3333-3333-3333-333333333333'
  put(root,'character-identity.json',JSON.stringify({version:1,id,createdAt:T}))
  put(root,'account-binding.json',JSON.stringify({version:1,characterId:id,createdAt:T,activeUid:'333',generation:1,
    accounts:[{uid:'333',boundAt:T}],reviewRequired:false,restartRequired:false,cutoverAt:0,lastSwitchAt:0,legacyUid:'333'}))
  put(root,'bili_credential.json',JSON.stringify({dedeuserid:'333',sessdata:'test',bili_jct:'test'}))
  createColdSnapshot({root,destination:snapshot,stoppedConfirmed:true})
  restoreColdSnapshot({snapshot,root,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'})
  const binding=createAccountBinding({dataDir:root})
  assert.equal(binding.status().blocked,true)
  assert.equal(binding.status().reason,'restore-review-required')
  assert.equal(binding.status().reviewRequired,true)
  assert.throws(()=>binding.assertReady(),/冻结/)
  assert.throws(()=>binding.resume({expectedUid:'444'}),/不一致/)
  assert.equal(binding.resume({expectedUid:'333'}).blocked,false)
  assert.equal(existsSync(join(root,'restore-freeze.json')),false)
}))
test('tampering and a different fish identity are rejected before restore',()=>withDir(async parent=>{
  const root=join(parent,'state'),backup=join(parent,'private-backup');mkdirSync(root)
  put(root,'character-identity.json',JSON.stringify({id:'11111111-1111-1111-1111-111111111111'}))
  put(root,'owner-todos.json','old')
  createColdSnapshot({root,destination:backup,stoppedConfirmed:true})
  put(root,'character-identity.json',JSON.stringify({id:'22222222-2222-2222-2222-222222222222'}))
  assert.throws(()=>restoreColdSnapshot({root,snapshot:backup,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'}),/身份不一致/)
  assert.equal(readFileSync(join(root,'owner-todos.json'),'utf8'),'old')
  put(backup+'/payload','owner-todos.json','tampered')
  assert.throws(()=>verifyColdSnapshot(backup),/校验失败/)
  assert.throws(()=>restoreColdSnapshot({root,snapshot:backup,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'}),/校验失败/)
}))
test('legacy portable business backup remains restorable and does not include credentials',()=>withDir(async parent=>{
  const root=join(parent,'old'),target=join(parent,'new');mkdirSync(root);mkdirSync(target)
  put(root,'life-memory/episodic.json',JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:0}))
  put(root,'owner-todos.json','{"version":1,"items":[]}')
  put(root,'accounts/333/credential.json','PRIVATE')
  const backup=createBackup({root,config:{masterEnabled:false},sqlite:{},version:'2.7.1-dev.3'})
  assert.equal(validateBackup(backup).integrity,'sha256-verified')
  assert.equal(backup.files['accounts/333/credential.json'],undefined)
  assert.equal(restoreBackupFiles(target,backup),2)
  assert.equal(readFileSync(join(target,'owner-todos.json'),'utf8'),'{"version":1,"items":[]}')
}))
test('management center exposes anonymous life timeline with no raw model reason',()=>{
  const {readFileSync}=requireFilesystem()
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/id="life-agent-timeline"/)
  assert.match(js,/life\.timeline/)
  assert.match(js,/life-agent-timeline/)
})
function requireFilesystem(){return {readFileSync}}
