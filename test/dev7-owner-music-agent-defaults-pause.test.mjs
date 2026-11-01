import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateOwnerAiTodo} from '../lib/owner-ai-todo.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createEmotionRecall} from '../lib/emotion-recall.mjs'
import {allowAgentStep} from '../lib/owner-dm-agent.mjs'

const root=new URL('../',import.meta.url)
const source=p=>readFileSync(new URL(p,root),'utf8')
const withTodo=cb=>{const d=mkdtempSync(join(tmpdir(),'dafeiyu-owner-music-'));try{return cb(d,createOwnerTodoEngine({dataDir:d}))}finally{rmSync(d,{recursive:true,force:true})}}
const NOW=Date.parse('2026-11-01T13:00:00.000Z')
const owner='210228238'
const row=(text,id='r1',extras={})=>({incoming:true,senderUid:owner,messageId:owner+':'+id,timestampMs:NOW,text,...extras})

test('主人自然推荐要由现有 AI 生成有证据的只读待办，不再使用固定歌手正则',()=>{
  const input={type:'search_videos',topic:'孙燕姿 歌曲',title:'有空听听孙燕姿的歌（主人推荐）',evidence:'推荐你有时候听听孙燕姿的歌'}
  const text='我也挺开心 给你更新了好几个版本 推荐你有时候听听孙燕姿的歌 好听的要死'
  assert.deepEqual(validateOwnerAiTodo(input,text),input)
  assert.equal(validateOwnerAiTodo({...input,topic:'周杰伦 歌曲'},text),null)
  assert.equal(validateOwnerAiTodo({...input,type:'dm_friend'},text),null)
  assert.doesNotMatch(source('index.js'),/queueOwnerDmMusicSuggestion/)
})

test('所有写权限新安装默认开放，但仍要主人在本条私信明确要求；主 Session 读取默认关闭',()=>{
  const index=source('index.js')
  for(const key of ['ownerDmAgentEnabled','ownerDmReadCommandsEnabled','ownerDmActionsEnabled','ownerDmLikeEnabled','ownerDmCollectEnabled','ownerDmFollowEnabled','ownerDmCommentDraftEnabled','ownerDmCommentPublishEnabled','ownerDmDynamicDraftEnabled','ownerDmDynamicPublishEnabled','ownerDmFriendMessageEnabled']){
    assert.match(index,new RegExp(key+': z\\.boolean\\(\\)\\.default\\(true\\)'))
    assert.ok(index.includes(key+':true,'),key+' in new-install defaults')
  }
  assert.match(index,/ownerDmAgentReadMainContext: z\.boolean\(\)\.default\(false\)/)
  const cfg={ownerDmActionsEnabled:true,ownerDmLikeEnabled:true,ownerDmCommentPublishEnabled:true}
  assert.equal(allowAgentStep({action:'like'},'顺便聊聊天',cfg).ok,false)
  assert.equal(allowAgentStep({action:'like'},'给这个点赞',cfg).ok,true)
  assert.equal(allowAgentStep({action:'comment_publish',text:'不要发'},'帮我评论说你好',cfg).ok,false)
})

test('2.6.0 的情绪主动分享即使曾授权也不计次、不调用模型、不发消息',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-emotion-paused-'))
  let model=0,sendDm=0,sendMain=0
  try{
    const instance=createEmotionRecall({dataDir:dir,paused:true,
      getConfig:()=>({masterEnabled:true,emotionSystemEnabled:true,mainSessionMemoryEnabled:true,emotionRecallEnabled:true,emotionRecallDmEnabled:true,emotionRecallMainEnabled:true,dmOwnerUid:owner}),
      getEmotion:()=>({enabled:true,mood:'joyful',intensity:100,updatedAt:new Date(NOW).toISOString()}),
      getRecentEvents:()=>[],getMemories:()=>[],invokeModel:async()=>{model++;return '{"action":"share"}'},
      sendDm:async()=>{sendDm++;return {ok:true}},sendMain:async()=>{sendMain++;return {ok:true}},now:()=>NOW})
    instance.start()
    assert.equal(instance.status().running,false)
    assert.equal(instance.status().config.paused,true)
    assert.equal((await instance.tick()).skipped,'paused-until-2.6.1')
    assert.equal((await instance.tick({dryRun:true})).skipped,'paused-until-2.6.1')
    assert.equal(model,0);assert.equal(sendDm,0);assert.equal(sendMain,0)
    assert.equal(instance.status().checks,0)
    instance.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理中心禁用已暂停的情绪外发控件，仍显示旧诊断',()=>{
  const html=source('lib/management-console.html'),js=source('lib/management-console.js')
  assert.match(html,/情绪驱动的自主分享 · 2\.6\.0 暂停/)
  assert.match(html,/查看已停用的旧版情绪分享设置/)
  assert.match(js,/rs\.config\?\.paused/)
  assert.match(js,/emotion-recall-preview'\]\)\$\(id\)\.disabled=true/)
  assert.match(html,/emotion-recall-diagnostics/)
})
