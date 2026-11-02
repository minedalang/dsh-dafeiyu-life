import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createActivityFeed} from '../lib/activity-feed.mjs'
import {favoriteStyleFromPersona,publicFavoriteTopics} from '../lib/favorite-style.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'

const ROOT=resolve(fileURLToPath(import.meta.url),'../..')
const read=path=>readFileSync(join(ROOT,path),'utf8')
const date=Date.parse('2026-10-21T12:00:00Z')
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev7-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('活动 API 固定类型与文案，绝不保存私信、评论或令牌内容',()=>temp(dir=>{
  const feed=createActivityFeed({dataDir:dir,now:()=>date})
  assert.equal(feed.publish('unknown',{text:'私信秘密'}),null)
  assert.equal(feed.publish('reflection',{count:3,token:'SECRET',text:'私信秘密'}).count,3)
  const result=feed.list({since:0,limit:1000})
  assert.equal(result.transport,'poll')
  assert.equal(result.items.length,1)
  assert.match(result.items[0].text,/人生反思/)
  assert.doesNotMatch(JSON.stringify(result),/SECRET|私信秘密|token/)
  assert.equal(feed.list({since:1}).items.length,0)
}))

test('活动 API 48 小时失效，且每次读取上限安全',()=>temp(dir=>{
  let time=date;const feed=createActivityFeed({dataDir:dir,now:()=>time})
  feed.publish('video',{count:4})
  time+=49*3600*1000
  assert.equal(feed.list().items.length,0)
  feed.publish('system')
  assert.deepEqual(feed.list().items.map(x=>x.kind),['system'])
}))

test('自建收藏夹仅依据当前人设风格与公开兴趣，不使用隐私材料',()=>{
  assert.equal(favoriteStyleFromPersona('嘴硬傲娇'), 'tsundere')
  assert.equal(favoriteStyleFromPersona('温柔体贴'), 'gentle')
  assert.equal(favoriteStyleFromPersona('元气可爱'), 'playful')
  assert.equal(favoriteStyleFromPersona('冷静理性'), 'calm')
  assert.equal(favoriteStyleFromPersona('没有关键词'), '')
  assert.equal(publicFavoriteTopics('["游戏","AI" ]',[{topic:'美食',secret:'秘密'}]),'游戏、AI、美食')
  assert.doesNotMatch(publicFavoriteTopics('["游戏"]',[{topic:'美食',actorUid:'1234',text:'private'}]),/private|1234/)
})

test('反思无产出可诊断，不虚构长期认识、不会强制生成人格证据',()=>temp(async dir=>{
  const cfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionMemoryHalfLifeDays:30})
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:cfg,now:()=>date})
  const events=[{kind:'watch',key:'watch:dev7:one',bvid:'BV1111111111',day:'2026-10-21',title:'普通公开视频',tier:'可以看'}]
  gate.recordEvents(events)
  let called=0;const seen=[]
  const life=createLifeReflection({dataDir:dir,getConfig:cfg,memoryGateway:gate,now:()=>date,
    getPersonalityEnabled:()=>true,onResult:x=>seen.push(x),
    invokeModel:async()=>JSON.stringify({memories:[],note:'证据不足',trait_proposals:[]}),
    commitMemories:()=>{called++;return {added:0,rows:[]}}})
  life.addEvents(events)
  const r=await life.reflect({force:true})
  assert.equal(r.ok,true)
  assert.equal(r.processed,1)
  assert.equal(r.diagnosis,'model-no-insight')
  assert.equal(r.created,0)
  assert.equal(r.personalityAccepted,0)
  assert.equal(called,1)
  assert.equal(life.status().recentPublicRun.diagnosis,'model-no-insight')
  assert.equal((await life.reflect({force:true})).processed,0)
  assert.equal(seen.length,1)
  gate.close()
}))

test('dev.7 管理页面与工具入口保留沙盒隔离、安全权限和第三方卡片仅引用',()=>{
  const html=read('lib/management-console.html'),ui=read('lib/management-console.js'),server=read('index.js'),py=read('vendor/bilibili-mcp/mcp_server.py')
  assert.match(html,/2\.6\.0 实验版/)
  assert.match(ui,/尚无真实人格变化/)
  assert.match(ui,/模拟尚无变化/)
  assert.doesNotMatch(html,/aigengtu\.com\/persona/)
  assert.match(ui,/外部平台\/工具指令/)
  assert.match(html,/activity-ticker-text/)
  assert.match(server,/activity-feed/)
  assert.match(server,/BILI_FISH_FAVORITE_STYLE/)
  assert.match(py,/automatic=True/)
  assert.match(py,/if automatic:/)
  assert.match(server,/socialPolicyGate/)
})


test('2.6.0 正式源码保留历史发行归档，但发布包只带当前 Release Notes',()=>{
  const pkg=JSON.parse(read('package.json'));assert.equal(pkg.version,'2.6.1-dev.3');
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.1-dev.3.md'));
  assert.ok(!pkg.files.includes('docs/release'));
  assert.ok(!pkg.files.includes('RELEASE_NOTES_v2.6.0-dev.7.md'));
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.0-dev.7.md'),/2\.6\.0-dev\.7/);
  assert.match(read('README.md'),/aigengtu.com\/persona/);
  assert.match(read('docs/release/2.6.0-readiness.md'),/正式发布/);
  assert.match(read('docs/release/2.6.0-bilibili-pinned-post.md'),/【2.6.0 新增/);
})
