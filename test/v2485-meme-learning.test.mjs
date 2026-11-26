import test from 'node:test'
import assert from 'node:assert/strict'
import {createAutomaticSessionScope} from '../lib/session-integration-policy.mjs'
import {createMemeLearning} from '../lib/meme-learning.mjs'
const row=(id,bvid,name='奶蛙')=>({id,bvid,name,evidence:'真实评论文字',evidence_type:'评论'})
test('跨视频反思至少两个真实 BV，使用已有 observation ID 才能提交',async()=>{
  let captured=[],calls=0
  const engine=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>({ok:true,rows:[row(1,'BV1ab2345678'),row(2,'BV1cd2345678'),row(3,'BV1ef2345678','无关名称')]}),invokeModel:async()=>{calls++;return JSON.stringify({entries:[{name:'奶蛙',kind:'角色',meaning:'来自不同视频的角色形象线索，出处仍待核实',observation_ids:[1,2]},{name:'奶蛙',kind:'梗',meaning:'伪造的不可验证引用内容',observation_ids:[2,999]}]})},commit:async p=>{captured=p.entries;return {ok:true,created:p.entries.length}}})
  const x=await engine.reflect({force:true})
  assert.equal(x.created,1)
  assert.equal(calls,1)
  assert.equal(captured[0].kind,'角色')
  assert.deepEqual(captured[0].observation_ids,[1,2])
})
test('不足两个不同 BV 的线索不会调用语义模型，关闭时不调用',async()=>{
  let calls=0,active=true
  const engine=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:active}),read:async()=>({ok:true,rows:[row(1,'BV1ab2345678'),row(2,'BV1ab2345678')]}),invokeModel:async()=>{calls++;return '{}'},commit:async()=>({ok:true})})
  assert.equal((await engine.reflect()).skipped,'insufficient-cross-video-evidence')
  active=false
  assert.equal((await engine.reflect()).skipped,'disabled')
  assert.equal(calls,0)
})

test('通用 Day 和栏目标题不能进入梗学习模型，但仍供主人查看线索',async()=>{
 const rows=[{id:1,bvid:'BV19SJi6VEj1',name:'Day 1',evidence_type:'标题',evidence:'【Day 1】...'},
  {id:2,bvid:'BV1ab2345678',name:'Day 1',evidence_type:'标题',evidence:'【Day 1】...'}]
 let calls=0
 const engine=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>({ok:true,rows,pending:2}),invokeModel:async()=>{calls++;return '{}'},commit:async()=>({ok:true})})
 const status=await engine.status();assert.equal(status.pendingTitleHints.length,1)
 assert.equal(status.pendingTitleHints[0].sources.length,2)
 assert.equal((await engine.reflect({force:true})).skipped,'insufficient-cross-video-evidence')
 assert.equal(calls,0)
})


test('dev.24 memory foundation preserves read-only meme status but blocks autonomous reflection including force',async()=>{
 let reads=0,models=0,commits=0
 const engine=createMemeLearning({automaticSession:createAutomaticSessionScope(()=>({mode:'memory-foundation',revision:1})),getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>{reads++;return {ok:true,rows:[]}},invokeModel:async()=>{models++;return '{}'},commit:async()=>{commits++;return {ok:true}}})
 assert.equal((await engine.reflect({force:true})).skipped,'session-integration-paused');assert.equal(reads,0)
 assert.equal((await engine.status()).ok,true);assert.equal(reads,1);assert.equal(models+commits,0)
})
test('dev.24 stale meme reads and models do not commit or consume interval; admitted commits settle',async()=>{
 let policy={mode:'autonomous-life',revision:0},phase='read',models=0,commits=0
 const change=()=>{policy={mode:'memory-foundation',revision:policy.revision+1};policy={mode:'autonomous-life',revision:policy.revision+1}}
 const engine=createMemeLearning({automaticSession:createAutomaticSessionScope(()=>policy),getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>{if(phase==='read')change();return {ok:true,rows:[row(1,'BV1ab2345678'),row(2,'BV1cd2345678')]}},invokeModel:async()=>{models++;if(phase==='model')change();return JSON.stringify({entries:[{name:'奶蛙',kind:'角色',meaning:'来自不同视频的真实线索，含义仍待核实',observation_ids:[1,2]}]})},commit:async()=>{commits++;change();return {ok:true,created:1}}})
 assert.equal((await engine.reflect()).skipped,'session-integration-paused');assert.equal(models,0)
 phase='model';assert.equal((await engine.reflect()).skipped,'session-integration-paused');assert.equal(commits,0);assert.equal((await engine.status()).lastRunAt,0)
 phase='commit';assert.equal((await engine.reflect()).created,1);assert.equal(commits,1);assert.ok((await engine.status()).lastRunAt>0)
})
