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
    tools:{register(spec){registered.push(spec);return spec}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(spec){return {dispose(){}}}},effect(callback){return callback()},settings:{describe(){return []}},slots:{inject(){},register(){}}}
  apply(ctx,{})
  return {home,duty,registered}
}

test('v2.4.94 主 Session 注册完整的只读视频工具与受限手动互动工具',async()=>{
  const x=setup()
  try{
    const names=new Set(x.registered.map(t=>t.name))
    for(const name of ['bili_watch_video','bili_video_info','bili_comment_thread','bili_danmaku','bili_hot_videos','bili_rank','bili_user_info','bili_user_videos','bili_favorite_lists','bili_favorite_content','bili_unread_messages','bili_read_dm','bili_received_replies','bili_received_at_and_likes','bili_video_like','bili_video_collect_manual','bili_follow_creator_manual','bili_unfollow_creator_manual','bili_comment_manual','bili_send_message_manual']) assert.ok(names.has(name),`缺少工具 ${name}`)
    const privateRead=x.registered.find(t=>t.name==='bili_read_dm')
    const denied=await privateRead.execute({talker_uid:'42',confirm:true});assert.equal(denied.ok,false);assert.equal(denied.messages,undefined)
    // Actual global registrations must not expose private account data to an unbound caller.
    for(const name of ['bili_dm_contact_lookup','bili_experience_recall','bili_home_recommendations','bili_creator_relation_status','bili_favorite_lists','bili_favorite_content','bili_unread_messages','bili_received_replies','bili_received_at_and_likes']){
      const spec=x.registered.find(t=>t.name===name);assert.ok(spec,name)
      const result=await spec.execute({}, {agent:{id:'other'}});assert.equal(result.ok,false,name);assert.equal(result.choice,'unavailable',name);assert.equal(result.reason,undefined,name)
    }
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
  for(const name of ['bili_video_collect_manual','bili_follow_creator_manual','bili_unfollow_creator_manual','bili_reply_manual','bili_send_message_manual','bili_read_dm']) assert.doesNotMatch(body,new RegExp(name))
  assert.match(js,/BILI_SESSION_DM_ALLOWED_UIDS/)
  assert.match(js,/BILI_SESSION_MANUAL_ACTIONS_ENABLED: '1'/)
  assert.match(js,/bili_session_watch_mark/)
  assert.match(readFileSync(new URL('../lib/data-backup.mjs',import.meta.url),'utf8'),/session-watch-history\.json/) // historical manual receipts remain archived, never grant current-account selection
})


test('dev80 production DM registration passes work authority only from claimed turn and resolved owner',()=>{
 const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const body=js.slice(js.indexOf("tool({name:'bili_read_dm'"),js.indexOf("readTool({name:'bili_received_replies'"))
 assert.match(body,/longTermMemory\?\.capturePrivateRead\(exec\?\.agent\)/)
 assert.match(body,/args\.confirm!==true/)
 assert.match(body,/ownerTurn,boundOwnerUid:target\.basis==='bound-owner'\?target\.uid:''/)
 assert.match(body,/resolve\(\)\.uid===target\.uid/)
 assert.match(body,/dmFetch\(cred,uid,limit,\{readBudget:biliReadBudget\}\)/)
})


test('dev99 real registrations refuse unbound manual sends and cancelled registered reads without I/O',async()=>{
 const x=setup();try{const by=Object.fromEntries(x.registered.map(t=>[t.name,t]));const exec={agent:{id:'not-bound'}}
 for(const [name,args] of [['bili_video_collect_manual',{bvid:BV,folder_title:'旅行'}],['bili_follow_creator_manual',{bvid:BV}],['bili_unfollow_creator_manual',{uid:123}]]){const r=await by[name].execute({...args,confirm:true},exec);assert.equal(r.ok,false,name);assert.equal(r.needsConfirmation,true,name);assert.match(r.error,/真实主人会话/)}
 const ac=new AbortController();ac.abort();const r=await by.bili_search.execute({keyword:'test'},{...exec,signal:ac.signal});assert.equal(r.ok,false);assert.equal(r.reason,'life-read-scope-changed')
 }finally{rmSync(x.home,{recursive:true,force:true})}
})


test('dev100 MCP proof is consumed after startup, immediately before the actual request',async()=>{
 const {McpClient}=await import('../lib/mcp.mjs');const client=new McpClient({});let writes=0,current=true,seen=[]
 const stdin={writable:true,write(line){writes++;const msg=JSON.parse(line);seen.push(msg);client.pending.get(msg.id).resolve({content:[{text:'{"ok":true}'}]});client.pending.delete(msg.id)}}
 client.start=async()=>{await Promise.resolve();current=false;client.proc={stdin}}
 await assert.rejects(client.call('bili_reply_manual',{text:'exact'},{beforeRequest:()=>current}),/凭据失效/);assert.equal(writes,0)
 client.start=async()=>{};current=true
 const result=await client.call('bili_reply_manual',{text:'exact'},{beforeRequest:(name,args)=>{assert.equal(name,'bili_reply_manual');assert.equal(args.text,'exact');current=false;return true}})
 assert.equal(result.ok,true);assert.equal(writes,1);assert.deepEqual(seen[0].params,{name:'bili_reply_manual',arguments:{text:'exact'}})
})
