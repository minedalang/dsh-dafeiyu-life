import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {seedCompletedFirstStart} from './helpers/ready-host.mjs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {bilibiliPerson,relationshipPortraitDepth,socialPersonRef} from '../lib/social-person-identity.mjs'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'
import {createSocialPortraitGateway} from '../lib/social-portrait-gateway.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
const dir=()=>mkdtempSync(join(tmpdir(),'dsh-dev5-people-'))
const DAY=86400000
const now=Date.parse('2026-11-04T12:00:00Z')
const root=fileURLToPath(new URL('../',import.meta.url))
const file=n=>readFileSync(join(root,n),'utf8')

test('平台身份键永不凭 UID 或昵称跨平台合并，B站 UID 兼容既有数字索引',()=>{
 const bilibili=bilibiliPerson('12345'),discord=socialPersonRef('discord','12345')
 assert.equal(bilibili.personKey,'bilibili:12345')
 assert.equal(discord.personKey,'discord:12345')
 assert.notEqual(bilibili.personKey,discord.personKey)
 assert.deepEqual(bilibili.linkedAccounts,[])
 assert.equal(discord.linkStatus,'unverified-unlinked')
 assert.equal(bilibili.platformLabel,'哔哩哔哩')
 assert.throws(()=>bilibiliPerson('00123'))
 assert.throws(()=>socialPersonRef('bilibili','http://example.invalid'))
 assert.throws(()=>socialPersonRef('../tokens','12345'))
 assert.equal(relationshipPortraitDepth('new').cap,0)
 assert.equal(relationshipPortraitDepth('known').cap,2)
 assert.equal(relationshipPortraitDepth('familiar').cap,5)
 assert.equal(relationshipPortraitDepth('friend').cap,8)
})

test('自然交往从相遇摘要到有证据画像；无白名单权限仍不自动外发',async()=>{
 const home=dir(), uid='12345';let index
 try{
  index=createSocialRelationshipIndex({dataDir:home,now:()=>now})
  const opts={friendDirectory:'[]',ownerUid:'',at:now}
  const gateway=createSocialPortraitGateway({dataDir:join(home,'account-A'),getFriendDirectory:()=> '[]',
   getRelationship:id=>index.get(id,opts),now:()=>now})
  const make=(eventId,at,direction='incoming')=>index.observe({uid,source:'comment',direction,eventId,at})
  make('new',now-3*DAY)
  assert.equal(index.get(uid,opts).stage,'new')
  assert.equal(gateway.observe({uid,source:'dm',eventId:'early',text:'我希望你回复短一点',at:now}).added,0)
  make('known1',now-2*DAY,'outgoing')
  make('known2',now-DAY)
  assert.equal(index.get(uid,opts).stage,'known')
  assert.equal(gateway.observe({uid,source:'dm',eventId:'dm-1',text:'我希望你回复短一点',at:now}).added,1)
  assert.equal(gateway.observe({uid,source:'comment',eventId:'c-1',text:'请你不要剧透',at:now}).added,1)
  assert.match(gateway.context(uid,{channel:'dm',at:now}),/简短/)
  assert.match(gateway.context(uid,{channel:'comment',at:now}),/剧透/)
  assert.doesNotMatch(gateway.context(uid,{channel:'comment',at:now}),/简短/)
  assert.equal(gateway.profile(uid).depth.cap,2)
  make('familiar1',now-4*DAY)
  make('familiar2',now-5*DAY,'outgoing')
  assert.equal(index.get(uid,opts).stage,'familiar')
  assert.equal(gateway.profile(uid).depth.cap,5)
  // Real relationship index, not a mocked score, enters the social-friend stage
  // only after enough distinct dates, bidirectional encounters, and a >=14d span.
  for(let i=0;i<12;i++)make('friend-'+i,now-(18-Math.floor(i/2)*3)*DAY,i%2?'outgoing':'incoming')
  assert.equal(index.get(uid,opts).stage,'friend')
  assert.equal(gateway.profile(uid).depth.cap,8)
  const policy=createSocialPolicyGate({getConfig:()=>({masterEnabled:true,dmWatch:true,friendDirectory:'[]'})})
  assert.equal(policy.actor(uid).role,'stranger')
  assert.equal(policy.canSendDm({uid}).allowed,false)
  const assembler=createSocialContextAssembler({policy,memoryRetriever:{socialContext:()=>''},
   getPortrait:(id,kind)=>gateway.context(id,{channel:kind,at:now})})
  const ctx=await assembler.message({uid,kind:'comment',text:'hi'})
  assert.match(ctx.portraitContext,/剧透/)
  assert.doesNotMatch(ctx.portraitContext,/简短/)
  assert.equal(gateway.observe({uid:'23456',source:'dm',eventId:'other',text:'请你回复短一点',at:now}).added,0)
 }finally{if(index)try{index.close()}catch{};rmSync(home,{recursive:true,force:true})}
})

test('同 UID 多账号画像隔离、边界衰退后仍阻断待续聊、清关系则遗忘画像',()=>{
 const home=dir()
 try{
  let stage='known'
  const opts={getFriendDirectory:()=> '[]',getRelationship:()=>({stage}),now:()=>now}
  const a=createSocialPortraitGateway({dataDir:join(home,'A'),...opts})
  const b=createSocialPortraitGateway({dataDir:join(home,'B'),...opts})
  a.observe({uid:'12345',source:'dm',eventId:'no-followup',text:'请你不要再主动追问我',at:now})
  // Forward migration: a different platform with the same local ID must not
  // be exposed or erased through the Bilibili person card.
  const record=JSON.parse(readFileSync(a.file,'utf8'))
  record.entries.push({...record.entries[0],id:'f'.repeat(24),platform:'discord',platformUserId:'12345'})
  writeFileSync(a.file,JSON.stringify(record))
  assert.equal(a.profile('12345').items.length,1)
  assert.equal(b.profile('12345').items.length,0)
  assert.equal(a.continuationAllowed('12345',{channel:'dm',at:now}),false)
  assert.equal(a.continuationAllowed('12345',{channel:'comment',at:now}),true)
  stage='new'
  assert.equal(a.context('12345',{channel:'dm',at:now}),'')
  assert.equal(a.continuationAllowed('12345',{channel:'dm',at:now}),false,
   '降温不能使未撤销的拒绝联系边界失效')
  assert.equal(a.forget('12345').removed,1)
  assert.equal(JSON.parse(readFileSync(a.file,'utf8')).entries[0].platform,'discord')
  assert.equal(a.continuationAllowed('12345',{channel:'dm',at:now}),true)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('人物详情按 UID 懒加载，社交互动不再有第二份画像表或权限开关',()=>{
 const html=file('lib/management-console.html'),js=file('lib/management-console.js'),idx=file('index.js')
 assert.match(html,/id="panel-relationships"/)
 assert.doesNotMatch(html,/id="friend-portrait-list"/)
 assert.match(js,/details\.addEventListener\('toggle'/)
 assert.match(js,/loadPersonPortrait\(row,portrait\)/)
 assert.match(js,/new URLSearchParams\(\{platform:'bilibili',uid\}\)/)
 assert.match(js,/撤回错误线索/)
 assert.match(idx,/person:bilibiliPerson\(uid\)/)
 assert.match(idx,/portraitDepth:relationshipPortraitDepth/)
 assert.match(idx,/socialPortrait\.forget\(person\.platformUserId\)/)
 assert.match(file('lib/social-person-identity.mjs'),/linkStatus:'unverified-unlinked'/)
})


test('真实管理 HTTP：B站人物有平台标识；陌生平台/未知 UID/跨站访问全部拒绝',async()=>{
 const home=dir(),dataDir=join(home,'bili-duty');const closed=[];let handler
 try{
  seedCompletedFirstStart(home)
  const idx=createSocialRelationshipIndex({dataDir})
  idx.observe({uid:'12345',source:'comment',direction:'incoming',eventId:'real-comment',at:Date.now()})
  idx.close()
  const ctx={get:key=>key==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
   logger:{info(){},warn(){}},tools:{register(){}},settings:{describe(){return[]}},
   webServer:{register(route){handler=route.handler;return{dispose(){}}}},
   effect(fn){const clean=fn();if(typeof clean==='function')closed.push(clean)}}
  apply(ctx,{})
  async function get(path,headers={}){
   const req=Readable.from([]);req.method='GET';req.url=path;req.headers={host:'127.0.0.1:3080',...headers}
   let status=200,body='';await handler(req,{writeHead(code){status=code},end(chunk){body=String(chunk||'')},setHeader(){}})
   return {status,data:JSON.parse(body)}
  }
  const list=await get('/api/bili-duty/relationships?query=12345')
  assert.equal(list.status,200)
  assert.equal(list.data.rows[0].personKey,'bilibili:12345')
  assert.equal(list.data.rows[0].platform,'bilibili')
  const profile=await get('/api/bili-duty/friend-portrait?platform=bilibili&uid=12345')
  assert.equal(profile.status,200)
  assert.equal(profile.data.person.personKey,'bilibili:12345')
  assert.equal(profile.data.profile.depth.level,0)
  assert.equal((await get('/api/bili-duty/friend-portrait?platform=discord&uid=12345')).status,400)
  assert.equal((await get('/api/bili-duty/friend-portrait?platform=bilibili&uid=98765')).status,404)
  assert.equal((await get('/api/bili-duty/friend-portrait?uid=12345',{
   origin:'https://evil.example'})).status,403)
 }finally{for(const cleanup of closed.reverse())try{cleanup()}catch{};rmSync(home,{recursive:true,force:true})}
})
