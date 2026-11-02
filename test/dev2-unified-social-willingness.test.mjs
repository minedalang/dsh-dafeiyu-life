import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDualContextAgency,relationshipTrustBonus} from '../lib/dual-context-agency.mjs'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'
import {receiveRecommendations,listRecommendationCandidates} from '../lib/video-recommendations.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {rankAcceptedTodos} from '../lib/autonomous-planner.mjs'
const T=1793268650070,DAY=86400000,BV='BV1mzso6uEZh'
const withDir=async fn=>{const home=mkdtempSync(join(tmpdir(),'dev2-p4-'));try{await fn(home)}finally{rmSync(home,{recursive:true,force:true})}}
const row=(uid,msg='m1',text='有空看看 '+BV,at=T)=>({incoming:true,senderUid:uid,senderName:'普通用户',messageId:msg,text,source:'B站私信分享',timestampMs:at})
test('dev.2 relation growth changes social willingness, never permission role',async()=>withDir(home=>{
 const index=createSocialRelationshipIndex({dataDir:home,now:()=>T})
 try{
  for(let day=0;day<6;day++)for(let turn=0;turn<2;turn++){
   const at=T-(17-day*3)*DAY+turn*10_000
   assert.equal(index.observe({uid:'522504190',source:'comment',direction:turn?'outgoing':'incoming',eventId:`${day}/${turn}`,at}).added,1)
  }
  const r=index.get('522504190');assert.equal(r.stage,'friend');assert.equal(r.socialFriend,true);assert.equal(r.permissionRole,'stranger')
  assert.ok(relationshipTrustBonus(r)>relationshipTrustBonus({stage:'new',score:8}))
  const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>({energy:45,sociality:40,curiosity:30,valence:0}),getRelationship:uid=>index.preferenceHint(uid)})
  const known=api.decide({source:'bili-comment',uid:'522504190',messageId:'proposal',text:'有空看看这个视频',intent:'explore',target:BV})
  const newcomer=api.decide({source:'bili-comment',uid:'111111',messageId:'proposal',text:'有空看看这个视频',intent:'explore',target:BV})
  assert.ok(known.score>newcomer.score);assert.equal(index.get('111111'),null)
 }finally{index.close()}
}))
test('共享 BV 只进入短期候选池，不再由关键词/链接自动变成待办',async()=>withDir(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T});let calls=0
 const req=row('522504190')
 const received=receiveRecommendations(home,[req],{now:T,decide:()=>{calls++;return {decision:'allow'}}})
 assert.equal(received.added,1);assert.equal(received.acceptedEntries.length,0);assert.equal(calls,0)
 assert.equal(todos.syncRecommendations(received.acceptedEntries,{requireAccepted:true}).added,0)
 assert.equal(todos.list().length,0)
 const file=readFileSync(join(home,'video-recommendations.json'),'utf8')
 assert.ok(!file.includes('有空看看'));assert.ok(!file.includes('sourceText'))
 assert.equal(receiveRecommendations(home,[req],{now:T}).added,0)
 assert.equal(listRecommendationCandidates(home,{now:T}).length,1)
}))
test('候选 BV 只作同 UID AI 上下文，48 小时后过期',async()=>withDir(home=>{
 receiveRecommendations(home,[row('12345')],{now:T})
 assert.equal(listRecommendationCandidates(home,{now:T+DAY}).length,1)
 assert.equal(listRecommendationCandidates(home,{now:T+3*DAY}).length,0)
 const todo=createOwnerTodoEngine({dataDir:home,now:()=>T})
 todo.add({type:'watch_video',bvid:BV,sourceKey:'existing-owner-task'},{source:'owner'})
 assert.equal(createOwnerTodoEngine({dataDir:home,now:()=>T+15*DAY}).list().length,1)
}))
test('无 UID/消息 ID 的链接不进入候选池',async()=>withDir(home=>{
 assert.equal(receiveRecommendations(home,[row('','')],{now:T}).added,0)
 assert.equal(receiveRecommendations(home,[{...row('123'),messageId:''}],{now:T}).added,0)
}))
test('planner attention order uses current relationship, not a stored authority flag',()=>{
 const current=[{id:'stranger',type:'watch_video',source:'recommendation',createdAt:T,origin:{uid:'111'}},{id:'friend',type:'watch_video',source:'recommendation',createdAt:T,origin:{uid:'222'}},{id:'owner',type:'watch_video',source:'owner',createdAt:T}]
 const hints=uid=>uid==='222'?{stage:'friend',score:90}:{stage:'new',score:8}
 const ranked=rankAcceptedTodos(current,{relationshipHint:hints,now:T})
 assert.equal(ranked[0].id,'friend');assert.ok(ranked.find(x=>x.id==='friend').priorityHint>ranked.find(x=>x.id==='stranger').priorityHint)
 const promoted=rankAcceptedTodos(current,{relationshipHint:()=>({stage:'friend',score:96}),now:T});assert.equal(promoted.length,3)
})
test('生产入口不再把链接候选或关键词解析当作接受决策',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(code,/recommendationEligible=incoming\.filter/)
 assert.match(code,/receiveRecommendations\(stateDir,recommendationEligible\)/)
 assert.doesNotMatch(code,/intakeRecommendation|hasExplicitVideoRecommendation|isVideoInvitation|syncRecommendations\(received/)
 assert.match(code,/intakeAiSocialTodo/)
 assert.match(code,/getRelationshipHint:uid=>/)
 assert.match(py,/motivation: str = 'other'/)
 assert.match(py,/if motivation not in \('interest','rewatch','curiosity','memory','social','other'\)/)
})

test('同一条社交消息的聊天与探索是两个独立意愿，不会互相覆盖',async()=>withDir(home=>{
 const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>({energy:80,sociality:80,curiosity:80,valence:10})})
 const chat=api.decide({source:'bili-comment',uid:'12345',messageId:'same-event',text:'有空了解下天文学',intent:'chat'})
 const explore=api.decide({source:'bili-comment',uid:'12345',messageId:'same-event',text:'有空了解下天文学',intent:'explore'})
 assert.notEqual(chat.decision,'blocked');assert.notEqual(explore.decision,'blocked')
 assert.equal(api.activity().total,2)
}))
