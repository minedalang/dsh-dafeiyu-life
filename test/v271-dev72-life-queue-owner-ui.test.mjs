import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createBiliReadBudget} from '../lib/bili-read-budget.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
const TAG='a'.repeat(16)
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'life-dev72-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let calls=0
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,
  getContext:()=>({voice:'同一条鱼'}),enabled:()=>true,
  invokeModel:async()=>{calls++;return JSON.stringify({action:'act',candidateId:'video_comment',publicCommentText:'有感而发',reason:'有真实证据'})},
  opportunityWindowMs:10})
 return {dir,will,calls:()=>calls}
}
const offer=n=>({sourceKey:'video-selected:'+n,candidates:[{id:'video_comment',kind:'video_comment',label:'原创评论'}]})
test('video decision does not cause comment expression to fail for normal short contention',async t=>{
 const x=setup(t)
 const first=await x.will.decide(offer(1))
 assert.equal(first.ok,true)
 const waiting=x.will.adoptSocialDecisionQueued({kind:'comment_reply',uid:'382440088',sourceKey:'comment:abc123',targetKey:'comment:dynamic:abc123',messages:['看到你啦']})
 assert.equal(x.will.status().queued,1)
 x.will.receipt(first.proof,{status:'not-sent'})
 const next=await waiting
 assert.equal(next.ok,true)
 assert.equal(x.calls(),1,'social expression already used the Life Voice decision; do not invoke a second model')
 assert.equal(x.will.verify(next.proof,'comment_reply',{uid:'382440088',targetKey:'comment:dynamic:abc123',text:'看到你啦'}).ok,true)
 x.will.receipt(next.proof,{status:'not-sent'})
})
test('independent Life decisions are serialized after the previous proof settles',async t=>{
 const x=setup(t)
 const first=await x.will.decide(offer(1))
 const second=x.will.decide(offer(2),{queueIfBusy:true})
 assert.equal(x.calls(),1)
 x.will.receipt(first.proof,{status:'not-sent'})
 const next=await second
 assert.equal(next.ok,true)
 assert.equal(x.calls(),2)
 x.will.receipt(next.proof,{status:'not-sent'})
})
test('repeated identical moods do not create a stream of owner diary cards',()=>{
 const time=Date.parse('2026-11-11T10:17:00Z')
 const emotionHistory=[{at:time-20_000,mood:'warm',label:'温暖'}, {at:time-18_000,mood:'warm',label:'温暖'},
  {at:time-12_000,mood:'calm',label:'平静'},{at:time-10_000,mood:'warm',label:'温暖'}, {at:time-5_000,mood:'warm',label:'温暖'}]
 const rows=buildLifeTimeline({emotionHistory,now:time})
 assert.deepEqual(rows.filter(x=>x.type==='emotion').map(x=>x.title),['心情转为温暖','心情转为平静','心情转为温暖'])
 assert.equal(emotionHistory.length,5,'raw history is never rewritten')
})
test('DM rate-limit streak is not reset by unrelated Bilibili success',t=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-limit-dev72-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let now=Date.parse('2026-11-11T10:00:00Z')
 const budget=createBiliReadBudget({dataDir:dir,now:()=>now,logger:{warn(){}}})
 budget.noteError(Error('code=-509'),'dm-list')
 now+=61_000
 budget.noteSuccess('comment-replies')
 assert.equal(budget.status().backoffCount,1)
 budget.noteError(Error('code=-509'),'dm-messages')
 assert.equal(budget.status().backoffCount,2)
 now+=121_000
 budget.noteSuccess('dm-list')
 assert.equal(budget.status().backoffCount,2,'different DM endpoint must not reset a -509 streak')
 budget.noteSuccess('dm-messages')
 assert.equal(budget.status().backoffCount,0)
})
test('new install allows DM friend-follow proposal but still requires Life and explicit follow capability',()=>{
 const code=file('index.js'),ui=file('lib/management-console.html')
 assert.match(code,/dmFollowAutonomyEnabled: z\.boolean\(\)\.default\(true\)/)
 assert.match(code,/cfg\.dmFollowAutonomyEnabled===true&&cfg\.agentFollowEnabled===true&&cfg\.masterEnabled===true/)
 assert.match(code,/kind:'dm_follow'/)
 assert.match(ui,/id="bili-dm-follow"[^>]*>允许 Life/)
})
test('settings search uses existing control, owner editor has a single structured body, timeline no longer adds continuity panel',()=>{
 const ui=file('lib/management-console.html'),js=file('lib/management-console.js')
 assert.match(ui,/id="settings-finder-input" type="search"/)
 assert.match(js,/const buildSettingsIndex=/)
 assert.match(js,/const editorBody=node\('div','','friend-editor-body'\)/)
 assert.doesNotMatch(js,/target\.appendChild\(node\('h4','连续的生活片段'\)\)/)
 assert.match(ui,/\.friend-editor-body\{padding:/)
})
