import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDualContextAgency,relationshipTrustBonus} from '../lib/dual-context-agency.mjs'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'
import {receiveRecommendations,isVideoInvitation,listRecommendationCandidates} from '../lib/video-recommendations.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {rankAcceptedTodos} from '../lib/autonomous-planner.mjs'
const T=1793268650070, DAY=86400000, BV='BV1mzso6uEZh'
const withDir=async fn=>{const home=mkdtempSync(join(tmpdir(),'dev2-p4-'));try{await fn(home)}finally{rmSync(home,{recursive:true,force:true})}}
const row=(uid,msg='m1',text='有空看看 '+BV,at=T)=>({incoming:true,senderUid:uid,senderName:'普通用户',messageId:msg,text,source:'B站评论分享',timestampMs:at})
const gate=(api)=>({uid,messageId,bvid,text,channel})=>api.decide({source:channel==='comment'?'bili-comment':'bili-dm',uid,messageId:'video-proposal:'+messageId+':'+bvid,text,intent:'explore',target:bvid})
test('dev.2 relation growth changes social willingness, never permission role',async()=>withDir(home=>{
 const index=createSocialRelationshipIndex({dataDir:home,now:()=>T})
 try{
  // Six real active days over two weeks, with both directions and 12 distinct events.
  for(let day=0;day<6;day++)for(let turn=0;turn<2;turn++){
    const at=T-(17-day*3)*DAY+turn*10_000
    assert.equal(index.observe({uid:'522504190',source:'comment',direction:turn?'outgoing':'incoming',eventId:`${day}/${turn}`,at}).added,1)
  }
  const r=index.get('522504190')
  assert.equal(r.stage,'friend')
  assert.equal(r.socialFriend,true)
  assert.equal(r.permissionRole,'stranger')
  assert.ok(relationshipTrustBonus(r)>relationshipTrustBonus({stage:'new',score:8}))
  const emotion={energy:45,sociality:40,curiosity:30,valence:0}
  const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>emotion,getRelationship:uid=>index.preferenceHint(uid)})
  const mk=uid=>api.decide({source:'bili-comment',uid,messageId:'proposal:'+uid,text:'有空看看这个视频',intent:'explore',target:BV})
  const known=mk('522504190'),newcomer=mk('111111')
  assert.ok(known.score>newcomer.score)
  assert.equal(index.get('111111'),null)
 }finally{index.close()}
}))
test('incoming share is not a TODO; only already-allowed, verified proposal enters the queue',async()=>withDir(home=>{
 const emotion={energy:5,sociality:5,curiosity:5,valence:-30}
 const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>emotion})
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const req=row('522504190')
 const blocked=receiveRecommendations(home,[req],{now:T,decide:gate(api)})
 assert.equal(blocked.added,1)
 assert.equal(blocked.accepted,0)
 assert.equal(blocked.acceptedEntries.length,0)
 assert.ok(!readFileSync(join(home,'video-recommendations.json'),'utf8').includes('有空看看'))
 assert.equal(todos.syncRecommendations(blocked.entries,{requireAccepted:true}).added,0)
 assert.equal(todos.list().length,0)
 // A duplicate poll is not a second opportunity to persuade.
 assert.equal(receiveRecommendations(home,[req],{now:T,decide:gate(api)}).accepted,0)
 assert.equal(api.activity().total,1)
 // A genuine later invitation may be reconsidered, never on the same message ID.
 Object.assign(emotion,{energy:90,sociality:90,curiosity:90,valence:30})
 const changed=receiveRecommendations(home,[row('522504190','m2','拜托，有空看看 '+BV)],{now:T,decide:gate(api)})
 assert.equal(changed.updated,1)
 assert.equal(changed.acceptedEntries.length,1)
 assert.equal(todos.syncRecommendations(changed.acceptedEntries,{requireAccepted:true}).added,1)
 const [item]=todos.list()
 assert.equal(item.type,'watch_video')
 assert.equal(item.ownerAuthorized,false)
 assert.equal(item.source,'recommendation')
 assert.equal(item.origin.quotedText,'') // No stranger body in the accepted TODO.
 assert.equal(item.recommendationSources[0].uid,'522504190')
 assert.equal(todos.syncRecommendations(changed.acceptedEntries,{requireAccepted:true}).added,0)
 assert.equal(todos.list().length,1)
}))
test('negated suggestions, bare BVs and unverified IDs never bypass willingness',async()=>withDir(home=>{
 const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>({energy:100,sociality:100,curiosity:100})})
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 assert.equal(isVideoInvitation('不要看这个视频 '+BV),false)
 assert.equal(isVideoInvitation('只有一个BV号 '+BV),false)
 for(const r of [row('123','m1','不要看 '+BV),row('123','m2',BV),row('','m3','推荐 '+BV)]){
  const received=receiveRecommendations(home,[r],{now:T,decide:gate(api)})
  todos.syncRecommendations(received.acceptedEntries,{requireAccepted:true})
 }
 assert.equal(todos.list().length,0)
 assert.equal(api.activity().total,0)
}))
test('unaccepted selection leads expire in 48h, accepted tasks persist through restart',async()=>withDir(home=>{
 const api=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>({energy:5,sociality:5,curiosity:5})})
 receiveRecommendations(home,[row('12345')],{now:T,decide:gate(api)})
 assert.equal(listRecommendationCandidates(home,{now:T+DAY}).length,1)
 assert.equal(listRecommendationCandidates(home,{now:T+3*DAY}).length,0)
 const todo=createOwnerTodoEngine({dataDir:home,now:()=>T})
 todo.add({type:'watch_video',bvid:BV,sourceKey:'existing-owner-task'},{source:'owner'})
 assert.equal(createOwnerTodoEngine({dataDir:home,now:()=>T+15*DAY}).list().length,1)
}))
test('planner attention order uses current relationship, not a stored authority flag',()=>{
 const current=[
  {id:'stranger',type:'watch_video',source:'recommendation',createdAt:T,origin:{uid:'111'}},
  {id:'friend',type:'watch_video',source:'recommendation',createdAt:T,origin:{uid:'222'}},
  {id:'owner',type:'watch_video',source:'owner',createdAt:T},
 ]
 const hints=uid=>uid==='222'?{stage:'friend',score:90}:{stage:'new',score:8}
 const ranked=rankAcceptedTodos(current,{relationshipHint:hints,now:T})
 assert.equal(ranked[0].id,'friend')
 assert.ok(ranked.find(x=>x.id==='friend').priorityHint>ranked.find(x=>x.id==='stranger').priorityHint)
 // Relationship promotion on the same store changes next planning turn; no permission change.
 const promoted=rankAcceptedTodos(current,{relationshipHint:()=>({stage:'friend',score:96}),now:T})
 assert.equal(promoted.length,3)
})
test('production wiring gates DM/comment recommendations and preserves collected motive schema',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(code,/getRelationship:\(uid\)=>\{\s*try\{const hint=existingRelationshipIndex\(\)\?\.preferenceHint/)
 assert.match(code,/receiveRecommendations\(stateDir,incoming,\{decide:intakeRecommendation\}\)/)
 assert.match(code,/receiveRecommendations\(stateDir,\[\{incoming:true,senderUid:req.uid[\s\S]*?\}\],\{decide:intakeRecommendation\}\)/)
 assert.match(code,/syncRecommendations\(reco.acceptedEntries,\{requireAccepted:true\}\)/)
 assert.match(code,/getRelationshipHint:uid=>/)
 assert.match(py,/motivation: str = 'other'/)
 assert.match(py,/if motivation not in \('interest','rewatch','curiosity','memory','social','other'\)/)
})
