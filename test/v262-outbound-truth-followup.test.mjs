import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {unsupportedVideoAuthorship,unsupportedVideoExperience} from '../lib/claim-provenance.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {naturalFollowupText} from '../lib/life-experience-continuity.mjs'
const BV='BV1abc234568',noise='BV1abc234567',uid='11111'
const inDir=async(fn)=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v262-truth-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('真实截图中的“自己做的那期入选推荐”须拦截，但别人的作品与链接分享不应误伤',()=>{
 assert.equal(unsupportedVideoExperience('嘿，跟你说个小事～我自己做的那期《鲸鲸的日记04》居然入选推荐了，有点开心。'),true)
 assert.equal(unsupportedVideoExperience('我发布过一个视频'),true)
 assert.equal(unsupportedVideoExperience('我听完了大肥鱼翻唱的歌'),true)
 assert.equal(naturalFollowupText('我自己做的那期视频入选推荐了'), '')
 for(const msg of ['我找到了一个别人拍的视频','这是别人做的视频，我只是选中了','我发给你的视频链接是真的','我分享的别人的视频入选了'])assert.equal(unsupportedVideoAuthorship(msg),false,msg)
})

test('模型把视频入选说成自己投稿：社交分享从草稿生成阶段拒绝且不发送',()=>inDir(async dir=>{
 let sent=0,modelCalls=0
 const config={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,
  socialOutreachDailyLimit:10,dmOwnerUid:uid,friendDirectory:JSON.stringify([{uid,dm:true,recommend:'both'}])}
 const social=createSocialIntentEngine({dataDir:dir,getConfig:()=>config,invokeModel:async()=>{
   modelCalls++;return JSON.stringify({action:'draft',message:'我自己做的那期《鲸鲸的日记04》居然入选推荐了，跟你分享一下！',reason:'分享'})
 },sendMessage:async()=>{sent++;return {ok:true}}})
 const result=await social.reflectOnWatched([{picked:true,bvid:BV,title:'鲸鲸的日记04'}])
 assert.equal(modelCalls,1)
 assert.equal(result.created,0)
 assert.equal(sent,0)
 const item=social.status().items[0]
 assert.equal(item.status,'skipped')
 assert.match(item.reason,/选片|创作/)
}))

test('已存储的旧虚假投稿草稿不能绕过发送前核验',()=>inDir(async dir=>{
 let sent=0
 const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,dmOwnerUid:uid,friendDirectory:JSON.stringify([{uid,dm:true,recommend:'both'}])}
 writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,sent:[],items:[{id:'legacy-1',status:'draft',uid,type:'interest-share',bvid:BV,title:'鲸鲸的日记04',text:'我自己做的那期视频刚刚入选推荐了'}]}))
 const social=createSocialIntentEngine({dataDir:dir,getConfig:()=>cfg,invokeModel:async()=>'',sendMessage:async()=>{sent++;return true}})
 assert.match((await social.send('legacy-1',{automatic:true})).error,/禁止发送/)
 assert.equal(sent,0)
}))

test('本轮明确搜索视频允许准确链接；下一轮反问发布经历不得塞入上轮教程链接',()=>inDir(async dir=>{
 const messages=[],bvTitle='【大肥鱼】原创主题曲',steps=[
  {action:'search',query:'大肥鱼 歌曲'},
  {action:'reply',text:'找到了一首可能相关的公开视频'},
  {action:'reply',text:'我没有发布过视频，上次说法不准确。'}]
 let i=0
 const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>({masterEnabled:true,dmWatch:true,dmOwnerUid:uid,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true}),
  invokeModel:async()=>JSON.stringify(steps[i++]||{action:'reply',text:'我没有投稿视频'}),
  executeRead:async()=>({ok:true,summary:'搜索完成',data:{result:[{bvid:noise,title:'大肥鱼 DeepSeek QQ 唱歌教程'},{bvid:BV,title:bvTitle}]}}),
  executeWrite:async()=>{throw Error('禁止写入')},send:async x=>{messages.push(x.text);return {ok:true}}})
 agent.primeInbox([])
 const t=Date.now()
 await agent.processMessage({incoming:true,senderUid:uid,messageId:'a',timestampMs:t,text:'找一个大肥鱼歌曲视频发给我'})
 assert.match(messages[0],new RegExp(BV));assert.doesNotMatch(messages[0],new RegExp(noise))
 await agent.processMessage({incoming:true,senderUid:uid,messageId:'b',timestampMs:t+100,text:'你啥时候偷偷发视频了？'})
 assert.doesNotMatch(messages[1],/bilibili\.com\/video\/|DeepSeek QQ/)
 assert.match(messages[1],/没有发布过视频/)
}))

test('完成回访状态显示原始父待办标题、ID与子任务完成数，不再只有UID',()=>inDir(async dir=>{
 const now=Date.parse('2026-11-03T13:00:00Z')
 const todo=createOwnerTodoEngine({dataDir:dir,now:()=>now})
 const origin={kind:'owner-dm',uid,messageId:'m01'}
 const parent=todo.add({type:'search_videos',title:'听听大肥鱼翻唱的歌',topic:'大肥鱼 歌曲',origin},{source:'owner'}).item
 const child=todo.add({type:'watch_video',bvid:BV,title:'大肥鱼 主题曲',parentTodoId:parent.id,sourceKey:`owner-ai-watch:${parent.id}:${BV}`,topic:'大肥鱼 歌曲',origin},{source:'owner'}).item
 todo.update(child.id,'done')
 const follow=createOwnerTodoFollowup({dataDir:dir,getConfig:()=>({masterEnabled:true,dmOwnerUid:uid,ownerTodoCompletionFollowupEnabled:true}),getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>now,send:async()=>true})
 follow.queue(child,{ok:true,data:{info:{title:'大肥鱼主题曲'}}})
 const pending=follow.status().recent.find(x=>x.status==='pending')
 assert.equal(pending.groupRoot,parent.id)
 assert.equal(pending.parentTitle,'听听大肥鱼翻唱的歌')
 assert.equal(pending.originalMessageId,'m01')
 assert.equal(pending.groupDone,1)
 assert.equal(pending.groupTotal,1)
}))

test('回访模型不再以人生记忆检索为空作为唯一的永久延期理由，双栏只按真实父子ID关联',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(host,/if\(!evidence\.length&&!verified\.length\)return/)
 assert.match(host,/收到成功回执/)
 assert.match(ui,/todo-parent-child-layout/)
 assert.match(ui,/parentTodoId/)
 assert.match(ui,/selectedTodoRoot/)
 assert.match(html,/grid-template-columns:minmax\(210px,34%\)/)
 assert.match(html,/id="autonomous-planner-recommended"/)
 assert.match(ui,/autonomous-planner-recommended/)
 assert.match(ui,/今日模型决策额度耗尽/)
})

test('README 是面向用户的特色体验说明，详细版本信息移出首页',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
 for(const heading of ['她的生活有什么不同','首次使用教程','未来规划'])assert.ok(readme.includes(heading),heading)
 for(const feature of ['两种生活，两种意愿','自由结识世界里的每个人','模拟心情','会回忆，会遗忘，也会成长','有自己的待办','可以换 B站账号'])assert.ok(readme.includes(feature),feature)
 assert.doesNotMatch(readme,/\bP6\b|## .*2\.6\.0-dev|生活能力列表/)
 assert.ok(readme.split('\n').length<115)
})
