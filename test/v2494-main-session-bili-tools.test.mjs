import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {apply} from './helpers/ready-host.mjs'
import {watchedEvent} from '../lib/main-session-bridge.mjs'

const BV='BV1pXHK6mE6z'
function setup(){
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-v2494-session-tools-'))
  const duty=join(home,'bili-duty');mkdirSync(duty,{recursive:true})
  writeFileSync(join(duty,'bili_credential.json'),JSON.stringify({dedeuserid:'12345'}))
  const registered=[]
  const ctx={get(key){return key==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
    tools:{register(spec){registered.push(spec);return spec}},webServer:{register(spec){return {dispose(){}}}},effect(callback){return callback()},settings:{describe(){return []}},slots:{inject(){},register(){}}}
  apply(ctx,{})
  return {home,duty,registered}
}

test('v2.4.94 主 Session 注册完整的只读视频工具与受限手动互动工具',async()=>{
  const x=setup()
  try{
    const names=new Set(x.registered.map(t=>t.name))
    for(const name of ['bili_watch_video','bili_video_info','bili_comment_thread','bili_danmaku','bili_hot_videos','bili_rank','bili_user_info','bili_user_videos','bili_favorite_lists','bili_favorite_content','bili_unread_messages','bili_received_replies','bili_received_at_and_likes','bili_video_like','bili_video_collect_manual','bili_follow_creator_manual','bili_unfollow_creator_manual','bili_comment_manual','bili_send_message_manual']) assert.ok(names.has(name),`缺少工具 ${name}`)
    const watch=x.registered.find(t=>t.name==='bili_watch_video')
    assert.equal((await watch.execute({bvid:'bad'})).ok,false)
    assert.ok(x.registered.some(t=>t.name==='bili_video_like'))
  }finally{rmSync(x.home,{recursive:true,force:true})}
})

test('主 Session 写操作需要主人确认；私信额外要求白名单 dm 权限',async()=>{
  const x=setup()
  try{
    const byName=Object.fromEntries(x.registered.map(t=>[t.name,t]))
    const noConfirm=await byName.bili_video_collect_manual.execute({bvid:BV,folder_title:'旅行',create_folder:true})
    assert.equal(noConfirm.ok,false);assert.equal(noConfirm.needsConfirmation,true)
    const noDm=await byName.bili_send_message_manual.execute({receiver_uid:98765,text:'你好',confirm:true})
    assert.equal(noDm.ok,false);assert.match(noDm.error,/白名单/)
    const noFollowConfirm=await byName.bili_follow_creator_manual.execute({bvid:BV})
    assert.equal(noFollowConfirm.ok,false);assert.equal(noFollowConfirm.needsConfirmation,true)
  }finally{rmSync(x.home,{recursive:true,force:true})}
})

test('主 Session 指定观看会进入经历候选，但普通跳过记录仍不会伪装成观看经历',()=>{
  const watched=watchedEvent({day:'2026-10-28',bvid:BV,title:'测试视频',status:'主 Session 指定观看',picked:false})
  assert.equal(watched?.kind,'watch');assert.equal(watched?.tier,'主人指定观看')
  assert.equal(watchedEvent({day:'2026-10-28',bvid:BV,status:'跳过',picked:false}),null)
})

test('主 Session 手动动作不会被加入 headless Agent 的 MCP 白名单',()=>{
  const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const body=js.slice(js.indexOf('const mcpWhitelist = () =>'),js.indexOf('// 不依赖模型自觉'))
  for(const name of ['bili_video_collect_manual','bili_follow_creator_manual','bili_unfollow_creator_manual','bili_reply_manual','bili_send_message_manual']) assert.doesNotMatch(body,new RegExp(name))
  assert.match(js,/BILI_SESSION_DM_ALLOWED_UIDS/)
  assert.match(js,/BILI_SESSION_MANUAL_ACTIONS_ENABLED: '1'/)
  assert.match(js,/bili_session_watch_mark/)
  assert.match(readFileSync(new URL('../lib/data-backup.mjs',import.meta.url),'utf8'),/session-watch-history\.json/) // historical manual receipts remain archived, never grant current-account selection
})
