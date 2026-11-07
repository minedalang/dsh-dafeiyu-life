import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const BV='BV19SJi6VEj1'
const epoch=Date.parse('2026-11-03T10:00:00Z')
const temp=async cb=>{const dir=mkdtempSync(join(tmpdir(),'dsh-v262-outreach-'));try{return await cb(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const cfg=()=>({masterEnabled:true,dmOwnerUid:11111,socialOutreachEnabled:true,socialLifeIntentEnabled:true,
  socialVideoRecommendationsAuthorizedV2:true,socialAutoSend:true,socialOutreachDailyLimit:1,
  friendDirectory:JSON.stringify([{uid:'11111',dm:true,recommend:'dm'},{uid:'22222',dm:true,recommend:'dm'}]),mentionProfiles:'{}'})
const video=[{picked:true,bvid:BV,title:'一个没被任何好友画像提及的公开视频'}]
const engine=(dir,config,callbacks={})=>createSocialIntentEngine({dataDir:dir,videoRecommendationsOnly:true,getConfig:()=>config,now:()=>epoch,
  invokeModel:async()=>JSON.stringify({action:'draft',message:'今天刚遇到一条蛮有趣的公开视频，想分享给你看～',reason:'有自己的分享理由'}),
  sendMessage:async()=>({ok:true}),authorizeDraft:async()=>({ok:true,reason:'tested-life-choice'}),...callbacks})

test('主人无需人工画像关键词，真实入选视频经自主判断可以自动私信，重复运行不重发',()=>temp(async dir=>{
  const c=cfg();let called=0,sent=0
  const e=engine(dir,c,{invokeModel:async prompt=>{called++;assert.match(prompt,/对方是已明确允许私信推荐的主人/);assert.match(prompt,/没有对方兴趣匹配证据/);return JSON.stringify({action:'draft',message:'这条公开新视频很有意思，想跟你分享一下～'})},sendMessage:async({uid,text})=>{sent++;assert.equal(uid,'11111');assert.match(text,/公开新视频/);return {ok:true}}})
  assert.equal((await e.reflectOnWatched([{...video[0],picked:false}])).created,0)
  assert.equal((await e.reflectOnWatched(video)).created,1)
  assert.equal(called,1);assert.equal(sent,1)
  assert.equal(e.status().sentToday,1)
  assert.equal(e.status().lastScan.delivery,'已向平台提交私信')
  await e.reflectOnWatched(video)
  assert.equal(sent,1)
}))

test('鱼鱼可选择沉默，缺少好友兴趣证据不会向非主人群发',()=>temp(async dir=>{
  let count=0,sent=0
  const e=engine(dir,cfg(),{invokeModel:async()=>{count++;return '{"action":"skip","reason":"今天没有值得分享的具体内容"}'},sendMessage:async()=>{sent++;return {ok:true}}})
  assert.equal((await e.reflectOnWatched(video)).created,0)
  assert.equal(count,1);assert.equal(sent,0)
  assert.equal(e.status().lastScan.reason,'model-skipped')
}))

test('主人未授权接收私信推荐时不尝试发送或调用模型',()=>temp(async dir=>{
  const c=cfg();c.friendDirectory=JSON.stringify([{uid:'11111',dm:true,recommend:'off'}]);let invoked=0
  const e=engine(dir,c,{invokeModel:async()=>{invoked++;throw Error('不应调用')}})
  assert.equal(e.status().ownerEligible,false)
  assert.equal((await e.reflectOnWatched(video)).skipped,'no-trusted-friends')
  assert.equal(invoked,0)
}))

test('自动私信关闭时只生成可审阅草稿，旧版其他回访权限仍不恢复',()=>temp(async dir=>{
  const c=cfg();c.socialAutoSend=false;let sent=0
  const e=engine(dir,c,{sendMessage:async()=>{sent++;return {ok:true}}})
  assert.equal((await e.reflectOnWatched(video)).created,1)
  assert.equal(e.status().items[0].status,'draft');assert.equal(sent,0)
}))

test('新安装的推荐默认开启，但老用户已保存权限不被安装升级覆写',()=>{
  const src=read('index.js')
  for(const key of ['socialOutreachEnabled','socialLifeIntentEnabled','socialVideoRecommendationsAuthorizedV2','socialAutoSend']){
    assert.match(src,new RegExp(key+': z\\.boolean\\(\\)\\.default\\(true\\)'))
    assert.match(src,new RegExp(key+':false'))
  }
  assert.match(src,/legacySocialRecommendationDefaults/)
  assert.match(src,/\.\.\.legacySocialRecommendationDefaults/)
})

test('记忆花园分类控制真正的顶部生活记忆列表，而非仅长期认识附属区',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js')
  assert.match(html,/data-tab="life"[^>]*>🧠 经历与记忆/)
  assert.match(html,/data-memory-kind="relationship"/)
  assert.match(html,/id="main-session-history"/)
  assert.match(js,/const paintMemoryGarden=\(\)=>/)
  assert.match(js,/const episodes=\(!view\|\|view==='experience'\)\?gardenEpisodes:\[\]/)
  assert.match(js,/const memories=gardenMemories\.filter\(m=>!view\|\|gardenKindOf\(m\)===view\)/)
  assert.match(js,/const target=\$\('main-session-history'\);target\.replaceChildren\(\)/)
  assert.match(js,/b\.dataset\.memoryKind;document\.querySelectorAll/)
  assert.doesNotMatch(html,/id="social-enabled"/)
  assert.doesNotMatch(html,/允许鱼鱼根据真实选片自主形成推荐草稿/)
})
