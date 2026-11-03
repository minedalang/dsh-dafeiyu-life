import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {memoryGardenSnapshot,memoryGardenKind} from '../lib/memory-garden-view.mjs'
import {recordInterestEvents,interestMemoryRows} from '../lib/life-interests.mjs'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'

const BV=['BV1abC2defGH','BV1abC2defGI','BV1abC2defGJ']
const now=Date.parse('2026-11-03T15:00:00Z')
const sandbox=fn=>{const dir=mkdtempSync(join(tmpdir(),'v262-memory-garden-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('花园区分经历、人物、兴趣、事实；不能把任意聊天或已删除记录伪装成事实',()=>{
 const snapshot=memoryGardenSnapshot({memories:[
  {id:'reflection',text:'我发现合适的交流需要尊重对方',source:'life-reflection',memoryKind:'experience',createdAt:new Date(now).toISOString()},
  {id:'fact',text:'主人明确说好下次一起查看某个项目',category:'stable_profile',事实键:'约定.项目',createdAt:new Date(now-10).toISOString()},
  {id:'chat',text:'今天聊到一个问题',source:'main-session-ai',createdAt:new Date(now-20).toISOString()},
  {id:'replaced',text:'已经取代的旧事实',category:'stable_profile',已被取代:{by:'fact'}},
  {id:'deleted',text:'删除的私人事实',deletedAt:new Date(now).toISOString(),category:'stable_profile'}
 ]})
 assert.deepEqual(snapshot.counts,{experience:2,relationship:0,interest:0,fact:1})
 assert.equal(snapshot.rows.length,3)
 assert.equal(memoryGardenKind({source:'main-session-ai',text:'聊天话语'}),'experience')
 assert.equal(memoryGardenSnapshot({memories:snapshot.rows,kind:'fact'}).rows.length,1)
 assert.equal(memoryGardenSnapshot({memories:snapshot.rows,query:'不存在'}).total,0)
})

test('后天兴趣与真实互动只能来自已核实线索；白名单、单次视频不会自动制造记忆',()=>sandbox(dir=>{
 const emptyFile=join(dir,'social-relationships','relationships.sqlite3')
 const index=createSocialRelationshipIndex({dataDir:dir,now:()=>now})
 try{
  const options={friendDirectory:JSON.stringify([{uid:'88888',name:'白名单，但没有对话'}]),ownerUid:'99999',at:now}
  const before=index.list({...options,limit:50}).rows
  assert.equal(before.some(x=>x.uid==='88888'),true)
  assert.equal(memoryGardenSnapshot({people:before}).counts.relationship,0)
  const item=(bvid,day)=>({kind:'watch',bvid,title:'今天做白饭料理',tier:'selected',time:day+'T08:00:00Z'})
  recordInterestEvents(dir,[item(BV[0],'2026-10-30')],now)
  assert.equal(interestMemoryRows(dir,now).length,0)
  recordInterestEvents(dir,[item(BV[1],'2026-10-31'),item(BV[2],'2026-11-01')],now)
  const interests=interestMemoryRows(dir,now)
  assert.equal(interests.length,1)
  assert.equal(interests[0].source,'life-interest')
  const observed=index.observe({uid:'77777',source:'comment',direction:'incoming',eventId:'rpid-real-123',at:now-2000})
  assert.equal(observed.added,1)
  const s=memoryGardenSnapshot({people:index.list({...options,limit:50}).rows,interests})
  assert.equal(s.counts.relationship,1)
  assert.equal(s.counts.interest,1)
  const p=s.rows.find(r=>r.source==='relationship-observation')
  assert.match(p.text,/1 次已记录/)
  assert.doesNotMatch(p.text,/对方喜欢|亲密无间|私信正文/)
  assert.equal(memoryGardenSnapshot({people:index.list({...options,limit:50}).rows,interests,kind:'interest'}).rows.length,1)
  assert.equal(memoryGardenSnapshot({people:index.list({...options,limit:50}).rows,interests,kind:'relationship',query:'77777'}).rows.length,1)
 }finally{index.close()}
 assert.equal(existsSync(emptyFile),true)
}))

test('花园新增管理入口不写入记忆，只在同源读取已有真实事实与关系索引',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(host,/path === '\/api\/bili-duty\/main-session\/memory\/garden'/)
 assert.match(host,/仅允许同源管理中心查看记忆花园/)
 assert.match(host,/const index=existingRelationshipIndex\(\)/)
 assert.match(host,/memories:longTermMemory\.list\('',300\)/)
 assert.match(host,/interests:interestMemoryRows\(stateDir\)/)
 assert.match(ui,/gardenCounts=garden\.counts/)
 assert.match(ui,/source==='relationship-observation'/)
 assert.match(ui,/source==='life-interest'/)
 assert.match(ui,/后天兴趣要求多个不同真实入选 BV/)
 assert.match(ui,/没有互动的人不会因为在白名单就自动成为朋友/)
})

test('跨私信引用旧搜索 BV 不能作为新回复证据；本轮已核验结果和主人原链接可展示',async()=>{
 const {verifyOutboundVideoLinks}=await import('../lib/outbound-video-link-evidence.mjs')
 const bv='BV1abc234568',tutorial='BV1abc234567'
 const music='给我找一个大肥鱼翻唱的歌曲视频'
 const found={action:'search',ok:true,query:'大肥鱼 翻唱 歌曲',videos:[
  {bvid:tutorial,title:'大肥鱼QQ唱歌教程'},{bvid:bv,title:'大肥鱼翻唱 音乐现场'}]}
 const link=v=>'https://www.bilibili.com/video/'+v
 assert.equal(verifyOutboundVideoLinks(link(tutorial),{ownerText:music,readRecords:[found],musicRequest:true}).ok,false)
 assert.equal(verifyOutboundVideoLinks(link(bv),{ownerText:music,readRecords:[found],musicRequest:true}).ok,true)
 assert.equal(verifyOutboundVideoLinks(link(bv),{ownerText:'你是不是偷偷发视频了',readRecords:[]}).ok,false)
 assert.equal(verifyOutboundVideoLinks(link(bv),{ownerText:'这条 '+link(bv)+' 是什么',readRecords:[]}).ok,true)
 assert.equal(verifyOutboundVideoLinks('没有附链接',{}).ok,true)
})
