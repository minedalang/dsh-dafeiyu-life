import test from 'node:test'
import assert from 'node:assert/strict'
import {deliverJsonContext,deliverTextContext,contextDeliveryNotice} from '../lib/context-delivery.mjs'
import {continuationPrompt} from '../lib/life-continuation.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const BV='BV1234567890',ID='a'.repeat(24)

test('actual model payload is bounded and partial evidence is explicitly disclosed without private text',()=>{
  const secret='PRIVATE_DM_CONTENT_DO_NOT_LOG'
  const source=Array.from({length:14},(_,n)=>({id:`candidate-${n}`,source:'video',verified:n%2===0,body:secret.repeat(35)}))
  const {text,report}=deliverJsonContext(source,850,{scene:'candidate-evidence'})
  assert.ok(text.length<=850)
  assert.doesNotThrow(()=>JSON.parse(text))
  assert.equal(report.schema,'life-context-delivery/v1')
  assert.equal(report.status,'partial')
  assert.equal(report.sourceCounts.items,14)
  assert.ok(report.includedCounts.items<=14)
  assert.equal(report.rawContentStored,false)
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_DM|candidate-13|BV123/)
  assert.match(contextDeliveryNotice([report]),/未进入本轮模型的内容未知/)
  assert.doesNotMatch(contextDeliveryNotice([report]),/PRIVATE_DM/)
  assert.equal(source[13].body,secret.repeat(35),'source is not changed or erased')
})

test('complete, unavailable, and source-unread status cannot be confused',()=>{
  const full=deliverJsonContext([{id:'a',verified:true}],500,{scene:'verified-experience'})
  assert.equal(full.report.status,'complete')
  assert.equal(contextDeliveryNotice([full.report]),'')
  const compact=deliverTextContext('重要的更正：'.repeat(450),150,{scene:'life-voice'})
  assert.equal(compact.report.status,'partial')
  assert.match(compact.text,/省略/)
  const invalid={};invalid.self=invalid
  const missing=deliverJsonContext(invalid,350,{scene:'read-only-world'})
  assert.equal(missing.report.status,'unavailable')
  assert.ok(missing.report.missingCriticalEvidence)
  assert.doesNotMatch(JSON.stringify(missing.report),/self/)
})

test('Life continuation reports clipped voice and verified read yield without new write permission',()=>{
  const voice='开头'.repeat(1000)+'隐藏重要否定'.repeat(2000)+'末尾'.repeat(1000)
  const events={ok:true,kind:'discussion',verified:true,description:'细节'.repeat(800),novel:false}
  const menu=[{action:'observe_video',id:ID,bvid:BV,viewDepths:['standard','deep']}]
  const prompt=continuationPrompt(menu,voice,{recentVerifiedReadYield:events})
  assert.match(prompt,/life-voice:partial/)
  assert.match(prompt,/recent-verified-read:partial/)
  assert.match(prompt,/不能据此推断|不得推断已阅读/)
  assert.match(prompt,/隐藏重要否定|省略/)
  assert.match(prompt,/当前合法行动菜单/)
  assert.match(prompt,/BV1234567890/)
  assert.ok(prompt.length<11000,'model context remains bounded')
})


test('real Life willingness model receives delivery warning while exact candidate menu is preserved',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'v282-context-life-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let modelInput='',trace=[]
  const entry={voice:'生活情绪'.repeat(1000),world:'公开环境'.repeat(700),
    experience:{summary:'历史更正'.repeat(1100),verified:true}}
  const life=createLifeWillingness({dataDir:dir,getAccountTag:()=> 'a'.repeat(16),
    enabled:()=>true,getContext:async()=>entry,
    beginTrace:()=>({step:(kind,data)=>trace.push({kind,data}),finish:()=>{}}),
    invokeModel:async prompt=>{modelInput=prompt;return JSON.stringify({action:'skip',reason:'暂时想休息'})}})
  const result=await life.decide({sourceKey:'v282-context-delivery-case',trigger:'context-test',
    candidates:[{id:'candidate-a',kind:'reflect',label:'回顾今天'},
      {id:'candidate-b',kind:'rest',label:'暂停休息'}],
    evidence:{candidateEvidence:{'candidate-a':{id:'candidate-a',verified:true,details:'公开素材'.repeat(900)},
      'candidate-b':{id:'candidate-b',verified:true,details:'公开素材'.repeat(900)}}}})
  assert.equal(result.action,'skip')
  assert.ok(modelInput.includes('life-voice:partial'),'model prompt should include life-voice:partial')
  assert.ok(modelInput.includes('read-only-world:partial'),'model prompt should include read-only-world:partial')
  assert.ok(modelInput.includes('verified-experience:partial'),'model prompt should include verified-experience:partial')
  assert.ok(modelInput.includes('candidate-evidence:partial'),'model prompt should include candidate-evidence:partial')
  assert.ok(modelInput.includes('candidate-a'),'model prompt should include candidate-a')
  assert.ok(modelInput.includes('candidate-b'),'model prompt should include candidate-b')
  assert.ok(modelInput.includes('未进入本轮模型的内容未知'),'model prompt should include 未进入本轮模型的内容未知')
  assert.ok(trace.some(s=>s.kind==='journal'&&s.data.code==='life-context-partial'))
  assert.ok(trace.every(s=>!JSON.stringify(s).includes('历史更正')),'no model prose in trace')
})
