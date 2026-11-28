import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOwnerDmActionLedger, OWNER_DM_ACTION_FLAGS } from '../lib/owner-dm-actions.mjs'

const B='BV1Q541167Qg',T=Date.parse('2026-10-28T18:00:00Z')
test('历史自然语言命令解析器已退役，现行操作类型及独立权限仍保留',async()=>{
 const module=await import('../lib/owner-dm-actions.mjs')
 assert.equal(Object.hasOwn(module,'parseOwnerDmAction'),false)
 for(const type of ['like','collect','follow','unfollow','comment_draft','comment_publish','comment_publish_draft','dynamic_draft','dynamic_publish','message'])assert.ok(OWNER_DM_ACTION_FLAGS[type])
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.doesNotMatch(host,/parseOwnerDmAction|parseOwnerDmTodo|queueOwnerDmReadTodo/)
 assert.match(host,/const generated=await interactionBatcher.generate\(\{kind:'dm'/)
})
test('认证消息持久去重、15分钟过期限制、写操作在真正调用前先记录',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-action-'))
 try{
  const args={uid:'12345',messageId:'msg:1',timestampMs:T,action:{type:'like',bvid:B},enabled:true}
  const a=createOwnerDmActionLedger({dataDir:dir,now:()=>T+5000})
  const first=a.claim(args);assert.equal(first.ok,true)
  const b=createOwnerDmActionLedger({dataDir:dir,now:()=>T+7000})
  assert.equal(b.claim(args).reason,'duplicate')
  assert.equal(b.claim({...args,messageId:'msg:2',timestampMs:T-16*60*1000}).reason,'stale-message')
  assert.equal(b.claim({...args,messageId:'msg:3',enabled:false}).reason,'not-allowed')
  b.finish(first.key,{ok:false,uncertain:true,error:'B站返回不确定'})
  assert.equal(b.stats().recent[0].status,'uncertain')
  const draft=b.addDraft({bvid:B,text:'已审阅、仅本地草拟的评论'})
  assert.equal(b.getDraft(draft.id)?.bvid,B)
  assert.equal(b.lockDraft(draft.id)?.status,'attempted')
  assert.equal(b.lockDraft(draft.id),null,'发送不确定不能重新发布草稿')
  assert.ok(!readFileSync(join(dir,'owner-dm-actions.json'),'utf8').includes('验证码'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('配置入口、独立权限及按钮都要同步存在',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 for(const flag of [...new Set(Object.values(OWNER_DM_ACTION_FLAGS))]){
  assert.match(host,new RegExp(flag+': z\\.boolean\\(\\)\\.default\\(true\\)'))
  assert.ok(host.includes(`'${flag}'`),flag+' route must save config')
  assert.ok(js.includes(flag),flag+' must have UI save')
 }
 for(const id of ['owner-dm-agent-save','owner-dm-like','owner-dm-collect','owner-dm-follow','owner-dm-comment-draft','owner-dm-comment-publish','owner-dm-dynamic-draft','owner-dm-dynamic-publish','owner-dm-friend-message'])assert.ok(ui.includes(`id="${id}"`))
 const ownerAgent=readFileSync(new URL('../lib/owner-dm-agent.mjs',import.meta.url),'utf8')
 assert.match(ownerAgent,/status:'claimed'/,'现行主人 Agent 仍须在执行前持久占位')
 assert.match(ownerAgent,/writeFile\(file,d,now\(\)\)/,'现行消息领取及结果必须持久化')
 assert.match(host,/createOwnerDmAgent/)
})
