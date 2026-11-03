import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {intakeAiReadProposal} from '../lib/social-todo-intake.mjs'
import {validateOwnerAiTodo} from '../lib/owner-ai-todo.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {selectSearchVideos} from '../lib/owner-dm-agent.mjs'
import {relevantSearchVideo,selectRelevantSearchVideos,preserveSearchGoal} from '../lib/todo-search-context.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const T=Date.parse('2026-11-02T17:00:00Z'),uid='325467890',bad='BV1abc234567',good='BV1abc234568'
const within=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-goal-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('原话是“听大肥鱼的歌”时，模型缩写主题仍保留歌曲目标与原始证据边界',()=>within(dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>T}),message='你去听听大肥鱼的歌'
 const r=intakeAiReadProposal({row:{incoming:true,senderUid:uid,messageId:'music-one',timestampMs:T-2000,text:message},channel:'dm',todoDisposition:'accept',
   suggestedTodo:{type:'search_videos',topic:'大肥鱼',title:'鱼鱼想找找：大肥鱼',evidence:message},currentMessages:[message],todos,now:()=>T,decide:()=>({decision:'allow'})})
 assert.equal(r.created,true)
 const task=todos.list()[0]
 assert.equal(task.topic,'大肥鱼 歌曲')
 assert.equal(task.searchGoal,'music')
 assert.match(task.title,/音乐/)
 assert.equal(task.ownerAuthorized,false)
 assert.ok(!readFileSync(join(dir,'owner-todos.json'),'utf8').includes(message),'不把私信原文存入普通待办')
}))

test('主人私信与普通社交意愿共用目标保留规则；无效来源不能借音乐语义入队',()=>{
 const accepted=validateOwnerAiTodo({type:'search_videos',topic:'大肥鱼',title:'有空了解大肥鱼',evidence:'你去听听大肥鱼的歌'},'你去听听大肥鱼的歌')
 assert.equal(accepted?.topic,'大肥鱼 歌曲')
 assert.equal(accepted.searchGoal,'music')
 assert.equal(validateOwnerAiTodo({type:'search_videos',topic:'不存在的艺人',evidence:'你去听听大肥鱼的歌'},'你去听听大肥鱼的歌'),null)
 assert.deepEqual(preserveSearchGoal({topic:'大肥鱼',evidence:'你有空研究一下大肥鱼的 QQ 教程'}),{topic:'大肥鱼',searchGoal:'general',changed:false})
 assert.deepEqual(preserveSearchGoal({topic:'大肥鱼',evidence:'推荐你了解大肥鱼的 QQ 教程',searchGoal:'music'}),{topic:'大肥鱼',searchGoal:'general',changed:false})
})

test('音乐搜索候选要有对象锚点和音乐线索；同名 QQ 零基础教程与伪装音乐制作教程不入子待办',()=>{
 const search={topic:'大肥鱼 歌曲',searchGoal:'music'}
 const data={data:{list:[
  {bvid:bad,title:'想给大肥鱼完整的一生？DeepSeek接入QQ零基础教程，让她记住你'},
  {bvid:'BV1abc234569',title:'用AI教你让大肥鱼唱歌，接入QQ的新教程'},
  {bvid:'BV1abc234570',title:'另一首很精彩的歌曲（与大肥鱼无关）'},
  {bvid:good,title:'【大肥鱼】原创主题曲｜今天也要好好生活',tname:'音乐'},
 ]}}
 const all=selectSearchVideos(data)
 assert.equal(all.length,4)
 assert.deepEqual(selectRelevantSearchVideos(all,search).map(v=>v.bvid),[good])
 assert.equal(relevantSearchVideo({title:'大肥鱼 声音测试'},search),false)
 assert.deepEqual(selectRelevantSearchVideos(all,{topic:'大肥鱼',searchGoal:'general'}).map(x=>x.bvid),[bad,'BV1abc234569','BV1abc234570'])
})

test('音乐视频不在搜索结果前五条时仍能被提取，非音乐排序噪声不挤掉它',()=>{
 const a=Array.from({length:6},(_,i)=>({bvid:`BV1abc2345${i}0`,title:`大肥鱼 DeepSeek 零基础教程 第${i+1}集`}))
 a.push({bvid:good,title:'【大肥鱼】主题曲正式版'})
 const videos=selectSearchVideos({data:{list:a}},{limit:20})
 assert.equal(videos.length,7)
 assert.deepEqual(selectRelevantSearchVideos(videos,{topic:'大肥鱼 歌曲',searchGoal:'music'}).map(v=>v.bvid),[good])
})

test('已在待办账本里的音乐子任务，也不能被下一轮模型自主调度误执行',async()=>{
 await within(async dir=>{
  const todos=createOwnerTodoEngine({dataDir:dir,now:()=>T})
  const parent=todos.add({type:'search_videos',topic:'大肥鱼 歌曲',searchGoal:'music',sourceKey:'music-root'},{source:'owner'}).item
  const base={parentTodoId:parent.id,topic:parent.topic,searchGoal:'music',origin:{kind:'owner-dm',uid,messageId:'music-one'}}
  todos.add({type:'watch_video',bvid:bad,title:'考虑了解：想给大肥鱼完整的一生？DeepSeek接入QQ零基础教程，让她记住你',...base},{source:'owner'})
  const wanted=todos.add({type:'watch_video',bvid:good,title:'考虑了解：大肥鱼 原创主题曲',...base},{source:'owner'}).item
  let prompt='',executed=[]
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:4}),
   getTodos:()=>todos.list({limit:500,includeClosed:true}),invokeModel:async s=>{prompt=s;return JSON.stringify({action:'execute_read',id:wanted.id})},
   executeRead:async id=>{executed.push(id);return {ok:true}},updateTodo:(id,action,opts)=>todos.update(id,action,opts),reflect:async()=>({ok:true})})
  const r=await planner.considerChildren(parent.id)
  assert.equal(r.executed,1)
  assert.deepEqual(executed,[wanted.id])
  assert.ok(prompt.includes('大肥鱼 原创主题曲'))
  assert.ok(!prompt.includes('DeepSeek接入QQ'))
 })
})

test('没有合格音乐候选时保持空子任务；不凭空声称听到了音频',()=>{
 assert.deepEqual(selectRelevantSearchVideos([{bvid:bad,title:'DeepSeek接入QQ，大肥鱼零基础教程'}],{topic:'大肥鱼 歌曲',searchGoal:'music'}),[])
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(host,/selectRelevantSearchVideos\(selectSearchVideos\(result,\{limit:20\}\)/)
 assert.match(host,/尚未实际看过画面或听过声音/)
})
