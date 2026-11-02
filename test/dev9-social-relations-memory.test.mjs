import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'
import {createSocialInteractionCoordinator} from '../lib/social-interaction-coordinator.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
const DAY=86400000,AT=Date.parse('2026-11-01T09:00:00Z'),BV='BV1234567890'
const tmp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev9-social-'))
const using=async fn=>{const dir=tmp(),clock={at:AT};let index
 try{index=createSocialRelationshipIndex({dataDir:dir,now:()=>clock.at});await fn({index,dir,clock})}
 finally{index?.close();rmSync(dir,{recursive:true,force:true})}}
const observe=(index,uid,day,n=2)=>{for(let i=0;i<n;i++){
 const t=AT-(18-day)*DAY;const r=index.observe({uid,source:'comment',direction:i%2?'outgoing':'incoming',eventId:`${uid}-${day}-${i}`,at:t})
 assert.equal(r.ok,true)
}}
test('真实公开互动的陌生人能跨日自然成为社交好友，不获得白名单权限',()=>using(async({index})=>{
 for(const day of [0,3,6,9,12,15,18])observe(index,'987654321',day)
 const row=index.get('987654321');assert.equal(row.stage,'friend');assert.equal(row.socialFriend,true)
 assert.equal(row.whitelisted,false);assert.equal(row.permissionRole,'stranger')
 const gate=createSocialPolicyGate({getConfig:()=>({dmOwnerUid:'100',friendDirectory:'[]'})})
 assert.equal(gate.actor('987654321').role,'stranger')
 assert.equal(gate.canTrustComment({uid:'987654321',kind:'at'}),false)
 assert.equal(index.preferenceHint('987654321').stage,'friend')
}))
test('白名单仅提供较高关系起点，不会伪造已互动的次数或成长事实',()=>using(async({index})=>{
 const friendDirectory=JSON.stringify([{uid:'200',name:'小甲',dm:true,atInvite:true}]);
 const row=index.get('200',{friendDirectory});assert.equal(row.whitelisted,true);assert.equal(row.count,0);assert.equal(row.stage,'new');assert.equal(row.score>=64,true)
 assert.equal(index.get('300'),null)
 const fromList=index.list({friendDirectory,query:'200'});assert.equal(fromList.rows[0].uid,'200')
 assert.equal(index.get('200',{friendDirectory}).firstAt,0)
 const observed=index.observe({uid:'200',source:'comment',direction:'incoming',eventId:'first-live',at:AT});assert.equal(observed.ok,true)
 assert.equal(index.get('200',{friendDirectory}).firstAt,AT)
}))
test('重复事件幂等、每人每天最多 8 条、不会保存原始聊天文本',()=>using(async({index,dir})=>{
 for(let i=0;i<12;i++)index.observe({uid:'333',source:'comment',direction:'incoming',eventId:'same-day-'+i,at:AT})
 assert.equal(index.get('333').count,8)
 assert.equal(index.observe({uid:'333',source:'comment',direction:'incoming',eventId:'same-day-1',at:AT}).duplicate,true)
 const text=readFileSync(index.file);assert.doesNotMatch(text.toString('latin1'),/个人性格|私信内容|具体评论文本/)
 assert.equal(index.observe({uid:'invalid',source:'comment',direction:'incoming',eventId:'x',at:AT}).ok,false)
 assert.equal(index.observe({uid:'999',source:'raw',direction:'incoming',eventId:'x',at:AT}).ok,false)
}))
test('已遇到的人使用有界稳定游标分页与精确 UID 搜索',()=>using(async({index})=>{
 for(let i=1;i<=85;i++)index.observe({uid:String(10000+i),source:'comment',direction:'incoming',eventId:'encounter-'+i,at:AT-i*1000})
 const ids=[];let cursor=''
 do{const p=index.list({cursor,limit:30});assert.ok(p.rows.length<=30);ids.push(...p.rows.map(x=>x.uid));cursor=p.nextCursor}while(cursor)
 assert.equal(ids.length,85);assert.equal(new Set(ids).size,85)
 assert.deepEqual(index.list({query:'10001'}).rows.map(x=>x.uid),['10001'])
 assert.deepEqual(index.list({query:'10001 OR 1=1'}).rows,[])
}))
test('长时间没有互动时熟悉度和关系阶段逐步冷却',()=>using(async({index,clock})=>{
 for(const day of [0,3,6,9,12,15,18])observe(index,'222',day)
 assert.equal(index.get('222').stage,'friend');const warm=index.get('222').score
 clock.at+=70*DAY;assert.equal(index.get('222').stage,'known');assert.ok(index.get('222').score<warm)
}))
test('统一社交协调层记录陌生人 UID 元数据，不将陌生人 UID 写进可携带 outbox',()=>using(async({index,dir})=>{
 const social=createSocialInteractionCoordinator({dataDir:dir,recordPerson:x=>index.observe(x)})
 const evt={type:'incoming',source:'comment',role:'stranger',actorUid:'3456',eventKey:'real-rpid-10',at:AT}
 assert.equal((await social.record(evt)).ok,true)
 assert.equal(index.get('3456').count,1)
 assert.equal((await social.record(evt)).duplicate,true)
 assert.equal(index.get('3456').count,1)
 assert.doesNotMatch(readFileSync(social.file,'utf8'),/3456|real-rpid-10/)
}))
test('陌生人的新公开经历衰减更快，社交好友较慢，已模糊及遗忘内容无法复活',()=>using(async({index,dir,clock})=>{
 for(const day of [0,3,6,9,12,15,18])observe(index,'2222',day)
 const gate=createLifeMemoryGateway({dataDir:dir,now:()=>clock.at,getConfig:()=>({mainSessionMemoryHalfLifeDays:30}),getRelationship:uid=>index.get(uid)})
 const events=[{kind:'social',key:`social:2222:${BV}:123`,actorUid:'2222',bvid:BV,text:'聊起星空和旅行',at:AT},
 {kind:'social',key:`social:3333:${BV}:321`,actorUid:'3333',bvid:BV,text:'我是第一次路过的观众',at:AT}]
 try{
  assert.equal(gate.recordEvents(events).added,2)
  clock.at+=2*DAY
  const initial=JSON.parse(readFileSync(gate.file,'utf8')).episodes
  gate.status()
  const current=JSON.parse(readFileSync(gate.file,'utf8')).episodes
  assert.equal(current.find(x=>x.kind==='social'&&x.actorUid==='3333'),undefined,'短期陌生人已模糊后移除 UID')
  assert.ok(current.some(x=>x.actorUid==='2222'&&x.stage==='clear'),'熟悉的人仍清晰')
  clock.at+=5*DAY;gate.status()
  const later=JSON.parse(readFileSync(gate.file,'utf8')).episodes
  assert.ok(later.some(x=>x.stage==='forgotten'),'陌生人的新经历最终忘记')
  assert.equal(gate.recall({query:'第一次路过',domain:'bili-life',role:'stranger',actorUid:'3333'}).length,0)
  assert.ok(gate.recall({query:'星空',domain:'bili-life',role:'stranger',actorUid:'2222'}).length>0)
  assert.equal(initial.length,2)
 }finally{gate.close()}
}))
test('dev.9 README 使用自由成长叙事，而非主人选择名单叙事',()=>{
 const s=readFileSync(new URL('../README.md',import.meta.url),'utf8')
 assert.match(s,/自由结识世界里的每个人/)
 assert.doesNotMatch(s,/不是只有主人提前加入名单的人|不必先被主人加入白名单/)
 assert.match(s,/未来 2\.6\.1/)
})

test('关系昵称仅为短期展示缓存：旧库兼容、不能凭昵称新增用户或授予权限',()=>using(async({index,dir,clock})=>{
 const uid='522504190'
 assert.equal(index.cacheNickname(uid,'公开昵称').ok,false,'没有真实交互的 UID 不能凭名字成为熟人')
 assert.equal(index.observe({uid,source:'comment',direction:'incoming',eventId:'real-encounter-5225',at:AT}).added,1)
 const saved=index.cacheNickname(uid,'测试公开昵称 <script>',{at:AT})
 assert.equal(saved.ok,true)
 assert.equal(saved.nickname,'测试公开昵称  script ' .trim())
 const a=index.list({query:uid}).rows[0]
 assert.equal(a.nickname,'测试公开昵称  script')
 assert.equal(a.stage,'new');assert.equal(a.whitelisted,false);assert.equal(a.permissionRole,'stranger')
 assert.equal(a.count,1,'资料读取不会增加互动次数')
 clock.at+=8*DAY
 const expired=index.get(uid)
 assert.equal(expired.nickname,'','昵称七天后不得当作实时资料展示')
 assert.equal(expired.count,1,'昵称过期不删除关系记录')
 index.close()
 const reopened=createSocialRelationshipIndex({dataDir:dir,now:()=>clock.at})
 try{assert.equal(reopened.get(uid).count,1,'旧关系数据可以重开'); assert.equal(reopened.get(uid).nickname,'')}
 finally{reopened.close()}
}))

test('关系记忆参考半衰期与真实遗忘算法共享参数，不由昵称改动',async()=>{
 const {relationshipMemoryHalfLifeDays}=await import('../lib/life-memory-gateway.mjs')
 assert.equal(relationshipMemoryHalfLifeDays({stage:'new',permissionRole:'stranger'},30),1.3)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'known',permissionRole:'stranger'},30),3)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'familiar',permissionRole:'stranger'},30),10)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'friend',permissionRole:'stranger'},30),24)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'friend',permissionRole:'friend',whitelisted:true},30),30)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'new',permissionRole:'owner'},30),50)
 assert.equal(relationshipMemoryHalfLifeDays({stage:'new',permissionRole:'stranger'},60),2.6)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(html,/公开社交经历/)
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(js,/关系熟悉度/)
 assert.match(js,/publicMemoryHalfLifeDays/)
 assert.match(js,/relationships\/nicknames/)
})
