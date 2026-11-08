import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'

const BV='BV19SJi6VEj1'
const now=Date.parse('2026-11-02T13:00:00Z')
const home=()=>mkdtempSync(join(tmpdir(),'dafeiyu-video-push-hotfix-'))
const config=()=>({masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:false,
  socialVideoRecommendationsAuthorizedV2:false,socialOutreachDailyLimit:1,
  friendDirectory:JSON.stringify([{uid:'11111',dm:true,recommend:'dm'},{uid:'22222',dm:true,recommend:'off'}]),
  mentionProfiles:JSON.stringify({'11111':{personalityInterests:'猫咪'},'22222':{personalityInterests:'猫咪'}})})
const videos=[{picked:true,bvid:BV,title:'猫咪日常合集'}]
const engine=(dir,cfg,callbacks={})=>createSocialIntentEngine({dataDir:dir,getConfig:()=>cfg,now:()=>now,videoRecommendationsOnly:true,
  getSelectedVideos:()=>[{...videos[0],day:'2026-11-02'}],
  invokeModel:async()=>JSON.stringify({action:'draft',message:'今天遇到一条猫咪的公开新视频，想跟你分享这份发现～',reason:'觉得猫咪题材有趣'}),
  sendMessage:async()=>({ok:true}),authorizeDraft:async()=>({ok:true,reason:'tested-life-choice',proof:{id:'verified-life-candidate'}}),...callbacks})

test('旧暂停版配置没有新授权时，不进行模型调用或私信投递',async()=>{
 const dir=home(),cfg=config();cfg.socialAutoSend=true;let models=0,sends=0
 try{const e=engine(dir,cfg,{invokeModel:async()=>{models++;return '{}'},sendMessage:async()=>{sends++;return {ok:true}}})
  assert.equal(e.status().consentRequired,true)
  assert.equal(e.status().autoSend,false)
  assert.equal((await e.reflectOnWatched(videos)).skipped,'consent-required')
  assert.equal((await e.send('fake',{automatic:true})).ok,false)
  assert.equal(models,0);assert.equal(sends,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('白名单主人画像匹配真实入选视频，只生成本人私信草稿而不默认发送',async()=>{
 const dir=home(),cfg=config();cfg.socialVideoRecommendationsAuthorizedV2=true;let sends=0
 try{const e=engine(dir,cfg,{sendMessage:async()=>{sends++;return {ok:true}}})
  assert.equal((await e.reflectOnWatched([{picked:false,bvid:BV,title:'猫咪日常合集'}])).created,0)
  const r=await e.reflectOnWatched(videos);assert.equal(r.created,1)
  assert.equal(e.status().items.length,1)
  assert.equal(e.status().items[0].uid,'11111')
  assert.equal(e.status().items[0].type,'interest-share')
  assert.equal(e.status().items[0].status,'draft')
  assert.equal(e.status().lastScan.reason,'draft-created')
  assert.equal(sends,0)
  const manual=await e.send(e.status().items[0].id,{confirm:true})
  assert.equal(manual.ok,false);assert.match(manual.error,/不允许人工代发/)
  assert.equal(sends,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('重新授权并明确开启自动发送后才能实际投递，重复视频不重发',async()=>{
 const dir=home(),cfg=config();Object.assign(cfg,{socialVideoRecommendationsAuthorizedV2:true,socialAutoSend:true});let sends=0
 try{const e=engine(dir,cfg,{sendMessage:async()=>{sends++;return {ok:true}}})
  assert.equal((await e.reflectOnWatched(videos)).created,1)
  assert.equal(sends,1);assert.equal(e.status().items[0].status,'sent')
  assert.equal((await e.reflectOnWatched(videos)).created,0)
  assert.equal(sends,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('旧版回访草稿即使已有记录、也不能被兴趣私信专用模式发送',async()=>{
 const dir=home(),cfg=config();cfg.socialVideoRecommendationsAuthorizedV2=true;let sends=0
 try{writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,items:[{id:'recommend:11111:'+BV,uid:'11111',bvid:BV,title:'猫咪',status:'draft',type:'recommendation',text:'旧回访文字'}],sent:[],lastGenerationAt:0}))
  const e=engine(dir,cfg,{sendMessage:async()=>{sends++;return {ok:true}}})
  const r=await e.send('recommend:11111:'+BV,{confirm:true})
  assert.equal(r.ok,false);assert.match(r.error,/不允许人工代发/);assert.equal(sends,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理中心与服务端只解除视频兴趣推荐锁，不恢复旧待办回访和情绪主动联系',()=>{
 const root=new URL('../',import.meta.url)
 const index=readFileSync(new URL('index.js',root),'utf8'),html=readFileSync(new URL('lib/management-console.html',root),'utf8')
 const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
 assert.match(index,/videoRecommendationsOnly:true/)
 assert.match(index,/body\?\.confirm!=='ENABLE_VIDEO_RECOMMENDATIONS'/)
 assert.match(index,/paused:true, \/\/ 2\.6\.0: outgoing emotion/)
 assert.match(html,/id="social-outreach-section" class="card"/)
 assert.doesNotMatch(html,/<fieldset disabled class="outreach-disabled">/)
 assert.match(js,/socialVideoRecommendationsAuthorizedV2:enabled,confirm:enabled/)
 assert.match(js,/row\.type==='interest-share'/)
})

test('旧授权仍开启，但统一 Life 意愿拒绝时不得自动发送',async()=>{
 const dir=home(),cfg=config();Object.assign(cfg,{socialVideoRecommendationsAuthorizedV2:true,socialAutoSend:true});let sends=0
 try{
  const e=engine(dir,cfg,{authorizeDraft:async()=>({ok:false,reason:'life-chose-rest'}),sendMessage:async()=>{sends++;return {ok:true}}})
  assert.equal((await e.reflectOnWatched(videos)).created,1)
  assert.equal(sends,0);assert.equal(e.status().items[0].status,'draft')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
