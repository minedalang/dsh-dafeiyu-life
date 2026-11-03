import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeFactFromReceipt,lifeFactsFromCompletedTodos,currentLifeFactView,verifyLifeOutbound,lifeFactsFromOwnerReads} from '../lib/verified-life-facts.mjs'
const at=Date.parse('2026-11-03T15:00:00Z'),uid='210228238',other='485221842',bv='BV1abc234567'
const task={id:'task-abc',type:'watch_video',bvid:bv,status:'done',completedAt:at,origin:{uid,kind:'bilibili-dm',messageId:'m1'},history:[{to:'done',reason:'收到成功回执'}]}
test('统一事实类型必须由适配器认证的操作回执构造，模型声明不能变成投稿证据',()=>{
 assert.equal(lifeFactFromReceipt({type:'video_uploaded_verified',ok:true,sourceId:'fake',bvid:bv,at}),null)
 assert.equal(lifeFactFromReceipt({type:'video_uploaded_verified',operation:'platform-upload-receipt',ok:false,sourceId:'fake',bvid:bv,at}),null)
 const f=lifeFactFromReceipt({type:'video_metadata_read',operation:'public-video-metadata',ok:true,sourceId:'read:1',bvid:bv,at})
 assert.equal(f.type,'video_metadata_read')
 assert.equal(verifyLifeOutbound('我自己做的那期视频最近入选推荐了',{channel:'dm',uid,events:[f],at}).code,'unverified-upload')
 assert.equal(verifyLifeOutbound('我听完了这首歌',{channel:'dm',uid,events:[f],at}).ok,false)
 assert.equal(verifyLifeOutbound('我查过这段公开视频的资料，还没亲耳听过。',{channel:'dm',uid,events:[f],at}).ok,true)
})
test('诚实的否定经历允许表达，混合的肯定造假仍会拒发',()=>{
 for(const line of ['我还没听过这首歌','我没有发布过视频','我还没看完这个视频'])
  assert.equal(verifyLifeOutbound(line,{channel:'dm',uid,events:[],at}).ok,true,line)
 assert.equal(verifyLifeOutbound('我没有发布过视频，但我自己做的那期入选了',{channel:'dm',uid,events:[],at}).ok,false)
})
test('成功待办只证明公开资料查询，人工标记完成不能冒充回执；事实按原始UID/渠道/时间隔离',()=>{
 const facts=lifeFactsFromCompletedTodos([task,{...task,id:'manual',history:[{to:'done',reason:'已人工标记完成'}]}],{uid,at})
 assert.deepEqual(facts.map(e=>e.type).sort(),['todo_read_completed','video_metadata_read'])
 assert.equal(currentLifeFactView(facts,{uid,channel:'dm',at}).length,2)
 assert.equal(currentLifeFactView(facts,{uid:other,channel:'dm',at}).length,0)
 assert.equal(currentLifeFactView(facts,{uid,channel:'comment',at}).length,0)
 assert.equal(currentLifeFactView(facts,{uid,channel:'dm',at:at+26*3600_000}).length,0)
 assert.equal(lifeFactsFromCompletedTodos([task],{uid:other,at}).length,0)
})
test('视频链接须对应本轮检索、当前可见的任务回执或本条来信确切BV；历史缓存不提供证据',()=>{
 const facts=lifeFactsFromCompletedTodos([task],{uid,at})
 assert.equal(verifyLifeOutbound('这条 https://www.bilibili.com/video/'+bv,{uid,channel:'dm',events:facts,at}).ok,true)
 assert.equal(verifyLifeOutbound('这条 https://www.bilibili.com/video/BV1abc234568',{uid,channel:'dm',events:facts,at}).ok,false)
 assert.equal(verifyLifeOutbound('这条 https://www.bilibili.com/video/'+bv,{uid:other,channel:'dm',events:facts,at}).ok,false)
 assert.equal(verifyLifeOutbound('就是你发来的 https://www.bilibili.com/video/'+bv,{uid:other,channel:'dm',ownerText:'你觉得 '+bv+' 如何？',at}).ok,true)
 const reads=[{action:'search',ok:true,videos:[{bvid:bv}]}]
 assert.equal(lifeFactsFromOwnerReads(reads,{uid,at})[0].type,'video_metadata_read')
})
test('普通DM、主人私信、评论、社交分享、动态及回访统一经过事实外发接口',()=>{
 const root=new URL('../',import.meta.url)
 const files=['index.js','lib/dm-autoreply.mjs','lib/owner-dm-agent.mjs','lib/comment-interact.mjs',
   'lib/social-intentions.mjs','lib/daily-dynamic.mjs','lib/owner-todo-followup.mjs']
 for(const file of files){const src=readFileSync(new URL(file,root),'utf8');
   assert.match(src,/verifyLifeOutbound|outboundFactCheck|getVerifiedFacts/,file)}
})
