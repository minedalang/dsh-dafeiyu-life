import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {attachVerifiedBiliVideoUrl,confirmedRecentVideoShare,confirmedSharePromptContext,confirmedShareReplyMatches} from '../lib/confirmed-video-share.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {verifyOutboundVideoLinks} from '../lib/outbound-video-link-evidence.mjs'
const BV='BV1abc234567',OTHER='BV1abc234568',UID='22334455',OTHER_UID='33445566'
const TAG='0123456789abcdef',OTHER_TAG='fedcba9876543210'
const NOW=Date.parse('2026-11-07T15:00:00Z')
const VIDEO_URL='https://www.bilibili.com/video/'+BV
const data=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const withDir=fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev29-'));const finish=()=>rmSync(dir,{recursive:true,force:true});return Promise.resolve().then(()=>fn(dir)).finally(finish)}
const recorded=(bvid=BV,uid=UID,tag=TAG,at=NOW)=>({id:'life-share:'+uid+':'+bvid,uid,bvid,accountTag:tag,
  title:bvid===BV?'Deepseek V4 Flash正式版实测':'另一条视频',type:'interest-share',status:'sent',sentAt:at,
  text:'我觉得很有趣！\nhttps://www.bilibili.com/video/'+bvid})
function record(dir,items){writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,items,
 sent:items.filter(x=>x.status==='sent').map(x=>({id:x.id,uid:x.uid,at:x.sentAt,accountTag:x.accountTag}))}))}
test('首次配置有明确推荐和跳过按钮，共用原安装 API，老用户配置不自动修改',()=>{
 const html=data('lib/management-console.html'),js=data('lib/management-console.js'),index=data('index.js')
 for(const id of ['quick-embedding-section','quick-embedding-install','quick-embedding-later','quick-embedding-status','quick-embedding-progress'])assert.match(html,new RegExp('id="'+id+'"'))
 assert.match(html,/推荐安装 · 可选/);assert.match(html,/不需另外安装 Ollama 或 Python/)
 assert.match(js,/\$\('quick-embedding-install'\)\.addEventListener\('click',\(\)=>run\(confirmEmbeddingInstall\)\)/)
 assert.match(js,/\$\('quick-embedding-later'\)/)
 assert.match(js,/request\('\/embedding\/install',\{\}\)/)
 assert.match(index,/path === '\/api\/bili-duty\/embedding\/status'/)
 assert.doesNotMatch(js.slice(js.indexOf("$('quick-embedding-later')"),js.indexOf("$('embedding-cancel')")),/request\('\/embedding\/install'/)
})
test('已核实 BV 发送时附标准链接，错误目标链接必须拒绝',()=>{
 assert.equal(attachVerifiedBiliVideoUrl('分享一条好玩的视频',BV),'分享一条好玩的视频\n'+VIDEO_URL)
 assert.equal(attachVerifiedBiliVideoUrl('这是链接 '+VIDEO_URL,BV),'这是链接 '+VIDEO_URL)
 assert.throws(()=>attachVerifiedBiliVideoUrl('https://www.bilibili.com/video/'+OTHER,BV),/不一致/)
 assert.ok(attachVerifiedBiliVideoUrl('视频标题很长'.repeat(70),BV).length<=230)
 assert.throws(()=>attachVerifiedBiliVideoUrl('x','not-a-bv'))
})
test('只有同账号同 UID 已确认发送的真实推荐能够支撑后续链接',()=>withDir(async dir=>{
 record(dir,[recorded()])
 const found=confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'好 给我链接我看看',now:NOW+30000})
 assert.equal(found.bvid,BV);assert.equal(found.url,VIDEO_URL)
 assert.match(confirmedSharePromptContext(found),/Deepseek V4 Flash/)
 assert.equal(confirmedRecentVideoShare(dir,{uid:OTHER_UID,accountTag:TAG,text:'链接',now:NOW+30000}),null)
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:OTHER_TAG,text:'链接',now:NOW+30000}),null)
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'晚饭吃啥',now:NOW+30000}),null)
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'给我链接',now:NOW+4*86400_000}),null)
 assert.equal(confirmedShareReplyMatches('可以呀，'+VIDEO_URL,found),true)
 assert.equal(confirmedShareReplyMatches('去搜奶蛙入侵大学吧',found),false)
}))
test('未确认回执、无账号标签的旧账本、无发送索引，不得成为回复证据',()=>withDir(async dir=>{
 const old=recorded();delete old.accountTag;record(dir,[old])
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'链接',now:NOW+1000}),null)
 const pending=recorded();pending.status='uncertain';record(dir,[pending])
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'链接',now:NOW+1000}),null)
 record(dir,[recorded()]);const doc=JSON.parse(readFileSync(join(dir,'social-intentions.json'),'utf8'));doc.sent=[]
 writeFileSync(join(dir,'social-intentions.json'),JSON.stringify(doc))
 assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'链接',now:NOW+1000}),null)
}))
test('同一收件人近期有多个候选时，不猜某一条；明确 BV 可定位',()=>withDir(async dir=>{
 record(dir,[recorded(),recorded(OTHER,UID,TAG,NOW-2000)])
 const vague=confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'刚才视频链接',now:NOW+1000})
 assert.equal(vague.ambiguous,true);assert.equal(vague.items.length,2)
 const exact=confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'BV1abc234568 的链接',now:NOW+1000})
 assert.equal(exact.bvid,OTHER)
}))
test('Life 实际确认发送后，原账本保存 BV 链接与帐号作用域；不另造存储',()=>withDir(async dir=>{
 const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,
 socialVideoRecommendationsAuthorizedV2:true,dmOwnerUid:UID,friendDirectory:JSON.stringify([{uid:UID,dm:true,recommend:'both'}])}
 let sentText='',scope=TAG
 record(dir,[{...recorded(),status:'draft',sentAt:undefined,text:'刚发现这条视频挺有趣'}])
 const engine=createSocialIntentEngine({dataDir:dir,getConfig:()=>cfg,getAccountScope:()=>scope,
  getSelectedVideos:()=>[{picked:true,bvid:BV,day:'2026-11-07'}],now:()=>NOW,invokeModel:async()=>'',
  authorizeDraft:async()=>({ok:true,proof:{id:'test-life'}}),
  sendMessage:async a=>{sentText=a.text;assert.equal(a.accountTag,TAG);return {ok:true}} ,videoRecommendationsOnly:true})
 const result=await engine.send('life-share:'+UID+':'+BV,{automatic:true})
 assert.equal(result.ok,true);assert.match(sentText,new RegExp(BV))
 assert.equal(engine.recentSharedVideo({uid:UID,text:'好，给我链接'}).url,VIDEO_URL)
 scope=OTHER_TAG
 assert.equal(engine.recentSharedVideo({uid:UID,text:'好，给我链接'}),null)
}))
test('发送结果未知不能形成分享已发送记录或自动重复发送',()=>withDir(async dir=>{
 const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,
 socialVideoRecommendationsAuthorizedV2:true,dmOwnerUid:UID,friendDirectory:JSON.stringify([{uid:UID,dm:true,recommend:'both'}])}
 record(dir,[{...recorded(),status:'draft',sentAt:undefined,text:'这个视频不错'}])
 let attempts=0
 const engine=createSocialIntentEngine({dataDir:dir,getConfig:()=>cfg,getAccountScope:()=>TAG,
  getSelectedVideos:()=>[{picked:true,bvid:BV,day:'2026-11-07'}],now:()=>NOW,invokeModel:async()=>'',
  authorizeDraft:async()=>({ok:true,proof:{id:'test-life'}}),sendMessage:async()=>{attempts++;return {ok:false}},videoRecommendationsOnly:true})
 assert.equal((await engine.send('life-share:'+UID+':'+BV,{automatic:true})).status,'uncertain')
 assert.equal((await engine.send('life-share:'+UID+':'+BV,{automatic:true})).ok,false)
 assert.equal(attempts,1)
 assert.equal(engine.recentSharedVideo({uid:UID,text:'给我链接'}),null)
}))
test('普通私信：第一轮答成无关视频时，带当前收件人证据修正为真实链接',async()=>{
 let calls=0,prompts=[]
 const helper=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=>'',invoke:async prompt=>{
  prompts.push(prompt);calls++
  return JSON.stringify({items:[{id:'0',action:'reply',reply:calls===1?'奶蛙入侵大学，你去搜搜看':`好呀，就是这条：${VIDEO_URL}`,messages:[]} ]})
 }})
 try{
  const shared={...recorded(),url:VIDEO_URL,sourceId:'life-share:'+UID+':'+BV,ambiguous:false}
  const reply=await helper.generate({kind:'dm',uid:UID,text:'好 给我链接我看看',
   verifiedSharedVideoContext:confirmedSharePromptContext(shared),sharedVideoEvidence:shared,canSkip:true})
  assert.equal(calls,2);assert.match(prompts[0],new RegExp(BV));assert.match(String(reply),new RegExp(BV))
 }finally{helper.stop()}
})
test('主人私信：不用重新搜索，也能答出自己刚发的 BV 链接',()=>withDir(async dir=>{
 let sent='',searchCalls=0
 const shared={...recorded(),url:VIDEO_URL,sourceId:'life-share:'+UID+':'+BV,ambiguous:false}
 const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>({masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,dmOwnerUid:UID}),
  getSharedVideo:({uid,text})=>uid===UID&&text.includes('链接')?shared:null,
  invokeModel:async()=>JSON.stringify({action:'reply',text:'好呀，刚刚那条 Deepseek 视频是 '+VIDEO_URL}),
  executeRead:async()=>{searchCalls++;return {ok:true}},executeWrite:async()=>({ok:true}),send:async({text})=>(sent=text,{ok:true})})
 agent.primeInbox([])
 const result=await agent.processMessage({incoming:true,senderUid:UID,messageId:'msg-01',timestampMs:Date.now(),text:'好 给我链接我看看'})
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(searchCalls,0);assert.match(sent,new RegExp(BV))
 assert.equal(verifyOutboundVideoLinks(sent,{readRecords:[{action:'shared_video',ok:true,bvid:BV,title:'Deepseek'}]}).ok,true)
 assert.equal(verifyOutboundVideoLinks('https://www.bilibili.com/video/'+OTHER,{readRecords:[{action:'shared_video',ok:true,bvid:BV}]}).ok,false)
}))
