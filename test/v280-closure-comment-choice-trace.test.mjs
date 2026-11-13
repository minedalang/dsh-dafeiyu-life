import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'

const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-comment-closure-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const uid='a'.repeat(16)

test('comment menu admission and chosen alternatives remain inspectable without storing sensitive text',()=>home(async dir=>{
  const journal=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>uid})
  const t=journal.begin({mode:'active',trigger:'automatic'})
  t.step('model-call',{action:'life-continuation',commentOffered:true,
    commentNotOfferedCode:'offered',menuActions:['comment_video','inspect_video_discussion','stop']})
  t.step('model-choice',{modelScene:'life-continuation',action:'inspect_video_discussion',
    code:'valid',reason:'Sensitive private text BV1abcde1234 1234567890'})
  t.step('candidate-detail',{kind:'life-original-comment',code:'alternative-action-selected'})
  t.finish({state:'finished'})
  const record=journal.get(t.id).run
  const call=record.steps.find(s=>s.type==='model-call')
  assert.equal(call.commentOffered,true)
  assert.equal(call.commentNotOfferedCode,'offered')
  assert.equal(record.steps.find(s=>s.type==='model-choice').modelScene,'life-continuation')
  assert.equal(record.steps.find(s=>s.kind==='life-original-comment').code,'alternative-action-selected')
  assert.doesNotMatch(JSON.stringify(record),/Sensitive|1234567890|BV1abcde1234/)
}))

test('non-offered comment diagnostics retain enumerated codes but discard arbitrary fields',()=>home(async dir=>{
  const journal=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>uid})
  const t=journal.begin()
  t.step('model-call',{commentOffered:false,commentNotOfferedCode:'no-verified-public-evidence'})
  t.step('model-call',{commentNotOfferedCode:'private-content-here'})
  t.finish({state:'finished'})
  const rows=journal.get(t.id).run.steps.filter(s=>s.type==='model-call')
  assert.equal(rows[0].commentOffered,false)
  assert.equal(rows[0].commentNotOfferedCode,'no-verified-public-evidence')
  assert.equal(rows[1].commentNotOfferedCode,undefined)
}))
