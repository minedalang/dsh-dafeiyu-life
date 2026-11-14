import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createLifeActionAttribution} from '../lib/life-action-attribution.mjs'
import {lifeSubagentHandoff} from '../lib/life-subagent-continuity.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
const T=Date.parse('2026-11-08T12:00:00Z'),A='a'.repeat(16),B='b'.repeat(16)
const temp=(ctx)=>{const d=mkdtempSync(join(tmpdir(),'life-dev39-'));ctx.after(()=>rmSync(d,{recursive:true,force:true}));return d}
const makeLedger=(ctx)=>{const d=temp(ctx);let account=A;const episodes=createUniversalLifeEpisodes({stateDir:d,getAccountTag:()=>account,now:()=>T});return {d,episodes,setAccount:x=>account=x,getAccount:()=>account}}
test('dev39 同源、同账号的主人私信/待办 Episode 能交接；其它 UID/类型不能通过 sourceRef 借读',ctx=>{
 const {episodes,setAccount}=makeLedger(ctx)
 const attr=createLifeActionAttribution({episodes,getAccountTag:()=>A})
 assert.equal(attr.verified({accountTag:A,channel:'owner-dm',owner:'owner',sourceRef:'owner-dm-conversation:123',receiptId:'bili-owner-dm:345',action:'owner_dm_reply',kind:'social'}).ok,true)
 assert.equal(attr.verified({accountTag:A,channel:'owner-todo',owner:'owner',sourceRef:'todo:task-1',receiptId:'todo-done:task-1:now',action:'todo_read',kind:'todo'}).ok,true)
 assert.equal(lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'owner-dm-conversation:123'}).source.history[0].action,'owner_dm_reply')
 assert.equal(lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'owner-dm-conversation:456'}).source,null)
 assert.equal(lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'todo:task-1'}).source,null)
 assert.equal(lifeSubagentHandoff({agent:'todo',episodes,sourceRef:'owner-dm-conversation:123'}).source,null)
 assert.equal(lifeSubagentHandoff({agent:'todo',episodes,sourceRef:'todo:task-1'}).source.history[0].action,'todo_read')
 assert.doesNotMatch(JSON.stringify(lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'owner-dm-conversation:123'})),/123|345/)
 setAccount(B)
 assert.equal(lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'owner-dm-conversation:123'}).source,null)
 assert.equal(lifeSubagentHandoff({agent:'todo',episodes,sourceRef:'todo:task-1'}).source,null)
})
test('dev39 社交快速唤醒不混入私信/评论，反思也不获得私密对话 Episode',ctx=>{
 const {episodes}=makeLedger(ctx)
 for(const [source,receipt,action,kind,channel] of [
  ['dm-conversation:123','bili-dm:r01','dm_reply','social','dm'],
  ['comment-thread:BV1abcdef123:123','bili-comment:r02','comment_reply','social','comment'],
  ['social-receipt:public-1','verified-social:r03','review_friend','social','social-agent'],
  ['reflection:reflection-run:public-1','reflection-run:public-1','reflect','reflection','reflection-public'],
  ['reflection:reflection-run:legacy-private','reflection-run:legacy-private','private_reflect','reflection','reflection'],
  ['todo:task-1','todo-done:task-1:now','todo_read','todo','owner-todo']]){
  assert.equal(episodes.record({accountTag:A,sourceRef:source,receiptId:receipt,action,kind,channel,outcome:'verified',owner:'life'}).ok,true)
 }
 const social=lifeSubagentHandoff({agent:'social',episodes})
 assert.deepEqual(social.recent.flatMap(e=>e.history.map(x=>x.action)),['review_friend'])
 assert.doesNotMatch(JSON.stringify(social),/123|dm_reply|comment_reply/)
 const reflection=lifeSubagentHandoff({agent:'reflection',episodes})
 assert.deepEqual(reflection.recent.flatMap(e=>e.history.map(x=>x.action)),['reflect'])
 assert.doesNotMatch(JSON.stringify(reflection),/private_reflect|legacy-private/)
 assert.doesNotMatch(JSON.stringify(reflection),/dm_reply|comment_reply|123/)
 const todo=lifeSubagentHandoff({agent:'todo',episodes})
 assert.deepEqual(todo.recent.flatMap(e=>e.history.map(x=>x.action)),['todo_read'])
})
test('dev39 主人私信 Agent 自己读取同一主人 Episode，并在读工具结果后继续决定；不能通过 Episode 产生新写操作',async ctx=>{
 const {d,episodes}=makeLedger(ctx)
 episodes.record({accountTag:A,sourceRef:'owner-dm-conversation:123',receiptId:'owner-receipt-111',action:'owner_dm_reply',kind:'social',channel:'owner-dm',owner:'owner',outcome:'verified'})
 const prompts=[],reads=[],replies=[{action:'search',query:'爵士'}, {action:'reply',text:'查到了相关公开视频资料'}]
 let receipt=''
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,ownerDmActionsEnabled:false}
 const agent=createOwnerDmAgent({dataDir:d,getConfig:()=>cfg,now:()=>T,
  getEpisodeContext:({uid})=>lifeSubagentHandoff({agent:'owner-dm',episodes,sourceRef:'owner-dm-conversation:'+uid}),
  invokeModel:async prompt=>{prompts.push(prompt);return JSON.stringify(replies.shift()||{action:'reply',text:'今天先不继续'})},
  executeRead:async step=>{reads.push(step.action);return {ok:true,summary:'已核实公开视频资料',data:{result:[]}}},
  executeWrite:async()=>{throw Error('模型不能通过 Episode 取得写权限')},
  send:async()=>({ok:true,receiptId:'confirmed-888'}),onConfirmedReply:async args=>{receipt=args.receiptId}
 })
 agent.primeInbox([])
 const result=await agent.processMessage({incoming:true,senderUid:'123',messageId:'new-123',timestampMs:T,text:'帮我搜搜爵士'})
 assert.equal(result.ok,true);assert.deepEqual(reads,['search']);assert.equal(prompts.length,2)
 assert.match(prompts[0],/owner_dm_reply/);assert.match(prompts[1],/之前工具执行结果/)
 assert.equal(receipt,'confirmed-888')
 assert.doesNotMatch(prompts.join(' '),/owner-receipt-111|owner-dm-conversation:123/)
})
test('dev39 公开反思会看到匿名 Episode 节奏，私密反思不能读取公开反思历史',async ctx=>{
 const dir=temp(ctx),observed=[],cfg={mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2}
 const gateway={reflectionEvidence:keys=>keys.map(key=>({key,stage:'clear',text:'经核验的公开生活事实',importance:.5,at:T}))}
 const reflection=createLifeReflection({dataDir:dir,getConfig:()=>cfg,now:()=>T,memoryGateway:gateway,
  getPublicEpisodeContext:()=>({recent:[{history:[{action:'reflect',outcome:'verified'}]}]}),
  invokeModel:async prompt=>{observed.push(prompt);return JSON.stringify({memories:[],note:'暂时没有新的领悟'})},
  commitMemories:()=>({added:0,rows:[]}),logger:{warn(){}}})
 reflection.addEvents([{kind:'watch',day:'2026-11-08',bvid:'BV1abcdef123',title:'公开一',key:'watch:1'},
  {kind:'watch',day:'2026-11-08',bvid:'BV1abcdef124',title:'公开二',key:'watch:2'}])
 assert.equal((await reflection.reflect({force:true})).ok,true)
 assert.match(observed[0],/公开反思历史中的已核验匿名动作摘要/)
 assert.match(observed[0],/"action":"reflect"/)
})
