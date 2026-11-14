import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {subagentActionMenu,dmContactFollowCandidates,validateSubagentNextAction} from '../lib/life-subagent-continuity.mjs'

const file=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('README top announces verified DSHMarket listing and exact DSH search name',()=>{
 const readme=file('README.md')
 assert.match(readme.slice(0,450),/已被收录进 \[DSHMarket 插件市场\]\(https:\/\/dshmarket\.com\/zh\/\)/)
 assert.match(readme.slice(0,450),/dsh-dafeiyu-life/)
})
test('DM next-action menu offers autonomous follow and unfollow without relationship-scope whitelist',()=>{
 const candidates=dmContactFollowCandidates({enabled:true,uid:'12345678',role:'stranger',history:[],
  incomingText:'今天的新聊天',verifiedIncoming:true})
 assert.deepEqual(candidates.map(x=>x.action),['follow_dm_contact','unfollow_dm_contact'])
 const menu=subagentActionMenu({agent:'dm',nextActions:candidates})
 assert.ok(menu.some(x=>x.action==='follow_dm_contact'))
 assert.ok(menu.some(x=>x.action==='unfollow_dm_contact'))
 assert.deepEqual(validateSubagentNextAction({action:'unfollow_dm_contact',reason:'最近双方兴趣确实有变化，考虑取关'},candidates)?.action,'unfollow_dm_contact')
 assert.deepEqual(dmContactFollowCandidates({enabled:true,uid:'12345678',role:'owner',history:[],
  incomingText:'不应关注主人',verifiedIncoming:true}),[])
 assert.deepEqual(dmContactFollowCandidates({enabled:true,uid:'12345678',role:'stranger',history:[],
  incomingText:'未经平台核验',verifiedIncoming:false}),[])
})
test('DM unfollow uses host-only tool, never accidentally routes through video Life bridge',()=>{
 const main=file('index.js'),py=file('vendor/bilibili-mcp/mcp_server.py')
 assert.match(main,/call\(wantUnfollow\?'bili_unfollow_dm_contact':'bili_follow_dm_contact'/)
 assert.match(py,/async def bili_unfollow_dm_contact\(uid: int, reason: str\)/)
 assert.match(py,/os\.environ\.get\('BILI_JS_MCP_ADAPTER'\) != '1'/)
 assert.match(py,/os\.environ\.get\('BILI_DM_FOLLOW_ENABLED'\) != '1'/)
 assert.match(py,/return await _unfollow_creator_provenance_checked\(uid, reason\)/)
 assert.match(py,/datetime\.now\(\)-datetime\.fromisoformat\(row\['followed_at'\]\)/)
})
test('settings no longer tell users that DM follow is friends-only',()=>{
 const html=file('lib/management-console.html')
 assert.doesNotMatch(html,/实际关注范围默认只覆盖好友/)
 assert.match(html,/关注对象不再按好友／陌生人划授权范围/)
 assert.match(html,/首次发现来信仍取决于普通监听间隔/)
})


test('new verified permitted incoming DM opens 10-second lane even when Life chooses silence',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'dafeiyu-final-fast-'))
 try{
  let clock=1790000000000,account='999';const inbox=[]
  const engine=createDmAutoReply({dataDir,selfUid:()=>account,now:()=>clock,
   getConfig:()=>({enabled:true,strangerEnabled:true,whitelist:[],whitelistCooldownSeconds:0,
    dmActivePollEnabled:true,dmActivePollSeconds:10,dmActiveWindowSeconds:180}),
   fetchIncoming:async()=>inbox,send:async()=>{throw Error('silence must not send')},
   generateReply:async()=>({action:'skip',messages:[]}),logger:{warn(){},error(){}}})
  await engine.poll() // first read only baselines; never retrospectively sends
  inbox.push({senderUid:'222',messageId:'incoming-1',timestampMs:clock,incoming:true,text:'一条新的真实私信'})
  await engine.poll()
  assert.equal(engine.nextFastUid(),'')
  clock+=10_000
  assert.equal(engine.nextFastUid(),'222')
  account='998' // switching account must never reuse the old fast lane
  assert.equal(engine.nextFastUid(),'')
 }finally{await rm(dataDir,{recursive:true,force:true})}
})

test('DM compact model context distinguishes real fresh message time from stale chat history',()=>{
 const batch=file('lib/interaction-batch.mjs')
 assert.match(batch,/currentMessageAtUTC/)
 assert.match(batch,/atUTC/)
 assert.match(batch,/跨天旧话题不得自动当作当前主题/)
})
