import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createLifeActionAttribution} from '../lib/life-action-attribution.mjs'
import {lifeSubagentHandoff,subagentActionMenu,acceptedSubagentReadKinds} from '../lib/life-subagent-continuity.mjs'
import {readVerifiedCommenterPublicVideos} from '../lib/life-public-capabilities.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const T=Date.parse('2026-11-08T12:00:00Z'),A='a'.repeat(16),B='b'.repeat(16)
const BV1='BV1abcdef123',BV2='BV1abcdef124'
const dirFor=ctx=>{const d=mkdtempSync(join(tmpdir(),'dsh-dev40-'));ctx.after(()=>rmSync(d,{recursive:true,force:true}));return d}
const answer=x=>JSON.stringify({items:[{id:'0',action:'reply',reply:'答复',mood:'neutral',intensity:0,...x}]})

test('dev40 同 BV 的真实视频原创评论可与后续评论互动交接；不会重复生成事件',ctx=>{
 const d=dirFor(ctx);let scope=A;const episodes=createUniversalLifeEpisodes({stateDir:d,getAccountTag:()=>scope,now:()=>T})
 const attr=createLifeActionAttribution({episodes,getAccountTag:()=>scope})
 const base={accountTag:A,owner:'life',kind:'video',channel:'video-agent',sourceRef:'life-video:home'}
 assert.equal(attr.verified({...base,receiptId:'bili:1',action:'video_select',publicBvid:BV1}).ok,true)
 assert.equal(attr.verified({...base,receiptId:'bili:2',action:'video_read',publicBvid:BV2}).ok,true)
 assert.equal(attr.verified({...base,receiptId:'bili:3',action:'video_comment',publicBvid:BV1}).ok,true)
 const reply={...base,kind:'social',channel:'comment',sourceRef:'comment-thread:'+BV1+':123'}
 assert.equal(attr.verified({...reply,receiptId:'bili:4',action:'comment_reply',publicBvid:BV1}).ok,true)
 const duplicate=attr.verified({...reply,receiptId:'bili:4',action:'comment_reply',publicBvid:BV1})
 assert.equal(duplicate.duplicate,true)
 const bridge=lifeSubagentHandoff({agent:'comment',episodes,sourceRef:'comment-thread:'+BV1+':123',linkedPublicBvid:BV1})
 assert.deepEqual(bridge.publicVideo.history.map(x=>x.action),['video_select','video_comment','comment_reply'])
 assert.doesNotMatch(JSON.stringify(bridge),/video_read|life-video:home|comment-thread|bili:4|123/)
 const other=lifeSubagentHandoff({agent:'comment',episodes,linkedPublicBvid:BV2})
 assert.deepEqual(other.publicVideo.history.map(x=>x.action),['video_read'])
 scope=B
 assert.equal(lifeSubagentHandoff({agent:'comment',episodes,linkedPublicBvid:BV1}).publicVideo,null)
})

test('dev40 公共视频交接绝不收录私信、TODO 或未经核验的动作',ctx=>{
 const episodes=createUniversalLifeEpisodes({stateDir:dirFor(ctx),getAccountTag:()=>A,now:()=>T})
 const good={accountTag:A,owner:'life',kind:'social',publicBvid:BV1}
 assert.equal(episodes.record({...good,sourceRef:'dm-conversation:123',receiptId:'private:1',action:'dm_reply',channel:'dm'}).ok,false)
 assert.equal(episodes.record({...good,sourceRef:'life-video:test',receiptId:'bili:unknown',action:'video_comment',channel:'video-agent',outcome:'unknown'}).ok,false)
 assert.equal(episodes.publicVideoState(BV1),null)
 assert.equal(episodes.record({accountTag:A,owner:'owner',kind:'todo',sourceRef:'todo:1',receiptId:'todo:1:done',action:'todo_read',channel:'owner-todo'}).ok,true)
 assert.equal(episodes.publicVideoState(BV1),null)
})

test('dev40 不存在已提供工具时，子 Agent 不能把意愿转成外发授权',()=>{
 const owner=subagentActionMenu({agent:'owner-dm',tools:['memory_search','search']})
 assert.equal(owner.some(x=>x.action==='search'),true)
 assert.equal(owner.some(x=>x.action==='follow'),false)
 assert.equal(owner.some(x=>x.action==='skip'),false)
 const inbox=subagentActionMenu({agent:'comment',readKinds:['public_person','history']})
 assert.ok(inbox.some(x=>x.action==='read_public_person'))
 assert.deepEqual(acceptedSubagentReadKinds(['history','public_person'],inbox),['history','public_person'])
 const closed=subagentActionMenu({agent:'comment',readKinds:['history']})
 assert.equal(acceptedSubagentReadKinds(['public_person'],closed),null)
 assert.equal(acceptedSubagentReadKinds(['history','history'],closed)?.length,1)
 assert.equal(acceptedSubagentReadKinds(['history','public_person','memory','todo','meme'],inbox),null)
 const video=subagentActionMenu({agent:'video',tools:['bili_search','bili_reply','bili_favorite_folder_delete']})
 assert.equal(video.find(x=>x.action==='bili_reply')?.risk,'outbound-existing')
 assert.equal(video.find(x=>x.action==='bili_favorite_folder_delete')?.risk,'outbound-existing')
 assert.equal(video.some(x=>x.action==='bili_send_message_manual'),false)
 const social=subagentActionMenu({agent:'social',tools:['review_friend']})
 assert.equal(social.some(x=>x.action==='reach_out_friend'),false)
})

test('dev40 精简评论两段真实只读取证后自主形成终结决策；模型不能直接外发中间稿',async()=>{
 const prompts=[],reads=[];let calls=0
 const b=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=>'',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['history','public_person']}],
  loadRequestedContexts:async(rows,requests)=>{
   reads.push(requests)
   return requests.map(kinds=>({publicPersonContext:kinds.includes('public_person')?'{"videos":[{"bvid":"'+BV1+'","title":"公开视频"}]}':''}))
  },
  invoke:async prompt=>{prompts.push(prompt);calls++
   if(calls===1)return answer({action:'skip',reply:'',contextRequests:['history']})
   if(calls===2)return answer({action:'skip',reply:'',contextRequests:['public_person']})
   return answer({reply:'我看了公开作品，决定简单聊聊'})
  }
 })
 try{
  const r=await b.generate({kind:'comment',uid:'123',text:'你觉得我唱的怎么样',history:[{role:'user',text:'之前聊过翻唱'}]})
  assert.equal(r,'我看了公开作品，决定简单聊聊')
  assert.equal(calls,3)
  assert.deepEqual(reads,[[['history']],[['public_person']]])
  assert.doesNotMatch(prompts[0],/公开视频"/)
  assert.match(prompts[2],/公开视频/)
 }finally{b.stop()}
})

test('dev40 模型第三次仍想读证据、重复读取或凭空要求人物主页时，拒绝生成外发回复',async()=>{
 for(const plan of [
  [{contextRequests:['history']},{contextRequests:['history']}],
  [{contextRequests:['history']},{contextRequests:['public_person']},{contextRequests:['history']}],
  [{contextRequests:['public_person']}]
 ]){
  let calls=0,readCalls=0;const b=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',logger:{warn(){}},getPersona:()=>'',
   prepareContexts:async()=>[{availableContexts:plan.length===1?['history']:['history','public_person']}],
   loadRequestedContexts:async(rows,kinds)=>{readCalls++;return kinds.map(()=>({publicPersonContext:'公开作品'}))},
   invoke:async()=>answer({action:'skip',reply:'',...(plan[Math.min(calls++,plan.length-1)]||{})})})
  try{await assert.rejects(b.generate({kind:'comment',uid:'123',text:'随便聊聊'}),/最终决定/)}finally{b.stop()}
  if(plan.length===1)assert.equal(readCalls,0)
 }
})

test('dev40 评论者公开投稿只读需要当轮真实评论、独立开启及账号稳定，绝不能靠模型填 UID',async()=>{
 let uid='123456',tag=A,reads=0
 const getAccountUid=()=>uid,getAccountTag=()=>tag
 const opts={enabled:true,bvid:BV1,rpid:'12345678901234567890',uid:'5555',accountUid:'123456',
  getAccountUid,accountTag:A,getAccountTag,readVideos:async target=>{reads++;return {uid:target,videos:[
   {bvid:BV1,title:'原创翻唱',description:'不能读取私人资料'},{bvid:'fake',title:'错误'},
   {bvid:BV2,title:'另一条公开视频'}]}}}
 assert.equal((await readVerifiedCommenterPublicVideos({...opts,enabled:false})).ok,false)
 assert.equal((await readVerifiedCommenterPublicVideos({...opts,rpid:''})).ok,false)
 assert.equal((await readVerifiedCommenterPublicVideos({...opts,uid:'5555<script>'})).ok,false)
 assert.equal(reads,0)
 const yes=await readVerifiedCommenterPublicVideos(opts)
 assert.equal(yes.ok,true);assert.deepEqual(yes.videos.map(x=>x.bvid),[BV1,BV2])
 assert.doesNotMatch(JSON.stringify(yes),/description|5555|123456789|关注|私信/)
 uid='9999';assert.equal((await readVerifiedCommenterPublicVideos(opts)).reason,'account-changed')
 uid='123456';tag=B;assert.equal((await readVerifiedCommenterPublicVideos(opts)).reason,'account-changed')
 tag=A
 assert.equal((await readVerifiedCommenterPublicVideos({...opts,readVideos:async()=>({uid:'9999',videos:[]})})).ok,false)
})

test('dev40 所有专业上下文都必须连接到生产提示而非测试虚构；评论者公开资料读取能力固定开启，但依旧不放开发送授权',()=>{
 const root=new URL('../',import.meta.url)
 const text=file=>readFileSync(new URL(file,root),'utf8')
 assert.match(text('lib/owner-dm-agent.mjs'),/实时专业行为菜单/)
 assert.match(text('lib/autonomous-planner.mjs'),/待办子循环本轮实际候选行为/)
 assert.match(text('lib/autonomous-planner.mjs'),/当前社交专业行为菜单/)
 assert.match(text('lib/life-reflection.mjs'),/反思模块本次合法候选范围/)
 assert.match(text('index.js'),/commentPublicProfileReadEnabled:\s*z\.boolean\(\)\.default\(true\)/)
 assert.match(text('index.js'),/readVerifiedCommenterPublicVideos\(/)
 assert.match(text('index.js'),/linkedPublicBvid:String\(req\.bvid/)
 assert.doesNotMatch(text('lib/management-console.html'),/id="comment-public-person-read"/)
})
