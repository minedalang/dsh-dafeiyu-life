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

test('dev40/dev46 模型重复读取或凭空要求人物主页时，拒绝生成外发回复',async()=>{
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

test('dev46 同一个 Life 社交工具循环允许评论和私信自主组合三步以上，累计证据完整且仅参数化记忆可再次提供',async()=>{
 for(const [kind,role] of [['comment','stranger'],['dm','owner'],['dm','friend'],['dm','stranger']]){
  const reads=[],prompts=[];let calls=0
  const plan=[['history','memory'],['meme'],['portrait'],[kind==='comment'?'hot_comments':'todo']]
  const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},
   prepareContexts:async()=>[{availableContexts:plan.flat()}],
   authorizeContextRead:async({readKinds})=>({ok:true,allowedReadKinds:readKinds}),
   loadRequestedContexts:async(_rows,requests)=>{reads.push(requests[0]);return [{memoryContext:'真实历史记忆',memeContext:'真实梗证据',portraitContext:'真实画像',hotCommentsContext:'真实热评'}]},
   invoke:async prompt=>{prompts.push(prompt);const step=calls++
    if(step<plan.length)return answer({action:'skip',reply:'',contextRequests:plan[step],recallQueries:['旧主题']})
    return answer({reply:'已经理解',memoryDisclosure:'share'})}
  })
  try{
   assert.equal(await b.generate({kind,role,uid:'123',text:'之前的话题',history:[{role:'user',text:'真实历史来信'}],todoProgressContext:'真实待办'}),'已经理解')
   assert.deepEqual(reads,plan);assert.equal(calls,5)
   const item=JSON.parse(prompts.at(-1).split('\n消息：').at(-1))[0]
   assert.deepEqual(Object.keys(item.retrievalStatus),plan.flat());assert.deepEqual(item.availableContexts,['memory'])
   assert.equal(item.memoryContext,'真实历史记忆');assert.equal(item.memeContext,'真实梗证据');assert.equal(item.portraitContext,'真实画像')
   assert.equal(item.readBudget.toolsRemaining,3)
   if(kind==='comment')assert.equal(item.hotCommentsContext,'真实热评');else assert.equal(item.todoProgressContext,'真实待办')
  }finally{b.stop()}
 }
})

test('dev46 陌生人不能借多步工具循环取得主人能力，混合未知工具整批拒绝',async()=>{
 for(const request of [['owner_todos'],['history','arbitrary_shell']]){
  let reads=0;const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},
   prepareContexts:async()=>[{availableContexts:['history','owner_todos']}],
   loadRequestedContexts:async()=>{reads++;return [{}]},invoke:async()=>answer({action:'skip',reply:'',contextRequests:request})})
  try{await assert.rejects(b.generate({kind:'dm',role:'stranger',uid:'123',text:'你好'}),/最终决定/);assert.equal(reads,0)}finally{b.stop()}
 }
})

test('dev46 多轮工具读取遇到账号代际变化立即停止，不交付失效证据',async()=>{
 let live=true,calls=0,reads=0
 const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},captureReadScope:()=>()=>live,
  prepareContexts:async()=>[{availableContexts:['history','meme','memory']}],
  loadRequestedContexts:async()=>{if(++reads===3)live=false;return [{memoryContext:'不能交付的旧账号数据'}]},
  invoke:async()=>answer({action:'skip',reply:'',contextRequests:[['history','meme','memory'][calls++]],recallQueries:['旧主题']})})
 try{await assert.rejects(b.generate({kind:'dm',role:'stranger',uid:'123',text:'你好'}),/scope|最终决定/);assert.equal(calls,3);assert.equal(reads,3)}finally{b.stop()}
})

test('dev46 每项独立预算到达六轮后菜单清空，未终结请求不执行也不外发',async()=>{
 const kinds=['history','meme','memory','portrait','todo','recommendation','owner_todos'];let calls=0,reads=0
 const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:kinds}],loadRequestedContexts:async()=>{reads++;return [{}]},
  invoke:async prompt=>{if(calls===6){const item=JSON.parse(prompt.split('\n消息：').at(-1))[0];assert.equal(item.readBudget.roundsRemaining,0);assert.deepEqual(item.availableContexts,[])}return answer({action:'skip',reply:'',contextRequests:[kinds[calls++]],recallQueries:['旧主题']})}})
 try{await assert.rejects(b.generate({kind:'dm',role:'owner',uid:'123',text:'你好'}),/最终决定/);assert.equal(reads,6);assert.equal(calls,7)}finally{b.stop()}
})


test('dev47 同一轮主人/好友/陌生人/评论可自主换检索参数，累计证据与逐次回执保留',async()=>{
 for(const [kind,role] of [['dm','owner'],['dm','friend'],['dm','stranger'],['comment','stranger']]){
  let calls=0;const reads=[]
  const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},
   prepareContexts:async()=>[{availableContexts:['memory','history']}],
   loadRequestedContexts:async(rows,requests)=>{assert.deepEqual(requests,[['memory']]);reads.push(rows[0].recallQueries);return [{memoryContext:['先前真实证据','第二次真实证据',''][reads.length-1]}]},
   invoke:async prompt=>{const step=calls++
    if(step===0)return answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['画鸟']})
    const item=JSON.parse(prompt.split('\n消息：').at(-1))[0]
    assert.equal(item.readBudget.toolsRemaining,8-step)
    assert.equal(item.readBudget.memoryReadsRemaining,3-step)
    assert.equal(item.memoryReadHistory.length,step)
    if(step===1)return answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['翅膀结构']})
    if(step===2)return answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['另一条线索']})
    assert.deepEqual(item.availableContexts,['history'])
    assert.equal(item.memoryContext,'先前真实证据\n第二次真实证据')
    assert.deepEqual(item.memoryReadHistory.map(x=>x.status),['found','found','not-found'])
    return answer({reply:'根据真实结果聊聊',memoryDisclosure:'share'})}
  })
  try{assert.equal(await b.generate({kind,role,uid:'123',text:'你还记得那段经历吗'}),'根据真实结果聊聊');assert.deepEqual(reads,[['画鸟'],['翅膀结构'],['另一条线索']]);assert.equal(calls,4)}finally{b.stop()}
 }
})

test('dev47 规范化相同检索参数、超过记忆调用预算、非法细节参数均不执行或外发',async()=>{
 for(const [plan,expected] of [[
  [{recallQueries:['Bird','羽毛']},{recallQueries:['羽毛',' bird ']}],1],
  [[{recallQueries:['甲项']},{recallQueries:['乙项']},{recallQueries:['丙项']},{recallQueries:['丁项']}],3],
  [[{recallQueries:['画鸟'],recall:{detail:{bvid:'fake'}}}],0]]){
  let reads=0,calls=0
  const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},prepareContexts:async()=>[{availableContexts:['memory']}],
   loadRequestedContexts:async()=>{reads++;return [{memoryContext:'真实结果'}]},
   invoke:async()=>answer({action:'skip',reply:'',contextRequests:['memory'],...plan[Math.min(calls++,plan.length-1)]})})
  try{await assert.rejects(b.generate({kind:'dm',role:'owner',uid:'123',text:'回忆'}),/最终决定/);assert.equal(reads,expected)}finally{b.stop()}
 }
})

test('dev47 后续读取不能覆盖首轮视觉证据遗忘保护；新结果无权恢复过期证据',async()=>{
 let current=true,reads=0,calls=0
 const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},prepareContexts:async()=>[{availableContexts:['memory']}],
  loadRequestedContexts:async()=>{reads++;if(reads===1)return [{memoryContext:BV1+' 真实旧观察',validateRecall:()=>current,publicVideoBvids:[BV1]}];current=false;return [{memoryContext:'第二条结果',validateRecall:()=>true}]},
  invoke:async()=>answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:[['旧观察','新观察'][calls++]]})})
 try{await assert.rejects(b.generate({kind:'dm',role:'owner',uid:'123',text:'回忆'}),/最终决定/);assert.equal(reads,2);assert.equal(calls,2)}finally{b.stop()}
})

test('dev47 主人独立拒绝披露时，重新生成不含任一次记忆正文或查询回执',async()=>{
 let calls=0,reads=0
 const b=createInteractionBatcher({delayMs:1,getPersona:()=>'',requireVoluntaryReads:true,logger:{warn(){}},prepareContexts:async()=>[{availableContexts:['memory']}],
  loadRequestedContexts:async()=>[{memoryContext:['PRIVATE_RECALL_ONE','PRIVATE_RECALL_TWO'][reads++]}],
  invoke:async prompt=>{const step=calls++;if(step<2)return answer({action:'skip',reply:'',contextRequests:['memory'],recallQueries:[['PRIVATE_QUERY_ONE','PRIVATE_QUERY_TWO'][step]]});if(step===2){assert.match(prompt,/PRIVATE_RECALL_ONE/);assert.match(prompt,/PRIVATE_RECALL_TWO/);return answer({reply:'PRIVATE_RECALL_ONE',memoryDisclosure:'retain'})}
   assert.doesNotMatch(prompt,/PRIVATE_RECALL_|PRIVATE_QUERY_/);return answer({reply:'这次我想自己保留'})}})
 try{assert.equal(await b.generate({kind:'dm',role:'owner',uid:'123',text:'想聊聊吗'}),'这次我想自己保留');assert.equal(calls,4)}finally{b.stop()}
})
