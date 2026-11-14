import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {lifeActionSource} from '../lib/autonomous-planner.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'

const todo={id:'todo-1',source:'owner'}
const socialTodo={id:'todo-2',source:'recommendation',origin:{kind:'bilibili-dm',uid:'12345'}}
const cue={id:'cue-1',source:'discussion-read',topic:'private-subject'}
const opportunity={id:'opp-1',source:'selection-curiosity',bvid:'BV0000000001'}
const episode={id:'episode-1',source:'episode-carryover',sourceId:'original-episode-1'}
const event={id:'evt-1',kind:'dm-received',message:'do-not-leak'}
const friends={id:'friend-1',source:'relationship-metadata',personKey:'dont-leak'}
const context={candidates:[todo,socialTodo],cues:[cue],opportunities:[opportunity],intents:[episode],lifeEvents:[event],friends:[friends]}

test('all grounded Life source categories retain factual provenance',()=>{
 const samples=[
  [{action:'execute_read',id:todo.id},'owner-todo','owner-created'],
  [{action:'defer',id:socialTodo.id},'social-todo','dm-recommendation'],
  [{action:'begin_exploration',id:cue.id},'life-cue','discussion-read'],
  [{action:'inspect_opportunity',id:opportunity.id},'life-opportunity','selection-curiosity'],
  [{action:'resume_episode',id:episode.id},'life-episode','episode-carryover'],
  [{action:'consider_social',id:event.id},'social-event','dm-received'],
  [{action:'review_friend',id:friends.id},'friend-relationship','verified-relationship'],
  [{action:'browse_home'},'self-choice','homepage'],
  [{action:'reflect'},'reflection','eligible-experiences'],
  [{action:'review_video_feedback'},'video-round','confirmed-round-receipt'],
  [{action:'talk_to_owner',id:'owner-idle'},'self-choice','owner-chat'],
 ]
 for(const [choice,origin,layer] of samples){const row=lifeActionSource(choice,context);assert.equal(row.origin,origin);assert.equal(row.layer,layer)}
})

test('never invent source from unbound delegation, missing targets or conflicting ids',()=>{
 assert.equal(lifeActionSource({action:'use_capability',capability:'bilibili.video-explore'},context).origin,'unknown')
 assert.equal(lifeActionSource({action:'execute_read',id:'missing'},context).origin,'unknown')
 assert.equal(lifeActionSource({action:'inspect_exploration',id:'cue-1'},context).origin,'unknown')
 assert.equal(lifeActionSource({action:'skip',invalid:true},context).layer,'invalid-decision')
 const conflict={...context,opportunities:[{id:todo.id,source:'discussion-read'}]}
 assert.equal(lifeActionSource({action:'dismiss',id:todo.id},conflict).layer,'ambiguous-target')
})

test('diagnostic persistence keeps opaque source fingerprint, never raw account details',()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-source-trace-'))
 try{
  const journal=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=> 'abcdefabcdefabcd'})
  const run=journal.begin({mode:'active'})
  run.step('execution-plan',{action:'execute_read',origin:'social-todo',layer:'dm-recommendation',sourceRef:'0123456789abcdef',targetRef:'fedcba9876543210',note:'a private message',uid:'12345',bvid:'BV0000000001'})
  run.finish({state:'finished'})
  const row=journal.list().runs[0].steps.find(x=>x.type==='execution-plan')
  assert.equal(row.origin,'social-todo');assert.equal(row.layer,'dm-recommendation');assert.equal(row.sourceRef,'0123456789abcdef')
  assert.ok(!('note'in row)&&!('uid'in row)&&!('bvid'in row))
  assert.equal(row.targetRef,'fedcba9876543210')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('tree renders dedicated source stage and handles historical records without guessing',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/id="life-action-origin"/)
 assert.match(js,/历史决策未记录来源/)
 assert.match(js,/const sourceText=latest\?lifeOriginLabel\(plan\)/)
 assert.match(js,/来源无法确认/)
})
