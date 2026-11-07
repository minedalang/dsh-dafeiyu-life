import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {searchVerifiedPublicComments} from '../lib/recent-comments.mjs'
import {interpretTrustedSocial,buildTrustedSocialPrompt} from '../lib/comment-social-ai.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {ownerRecallQuestion} from '../lib/owner-recall-tools.mjs'

const BV='BV1SqHK6oE2i',OTHER='BV1234567890',owner='210228238'
const now=Date.parse('2026-11-07T19:00:00Z')
const old=Date.parse('2026-11-03T12:41:35Z')
const fixture=async fn=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-dev22-recall-'))
 try{
  mkdirSync(join(dir,'seen'))
  // Monthly archive is the SAME authoritative outgoing-comment ledger.
  writeFileSync(join(dir,'seen','2026-11.md'),`# 评论记录\n| ${BV} | 322275838160 | 0 | 2026-11-03 12:41:35 | 星星落海时，连桌宠都知道停下看看。 |\n| ${BV} | 322275838161 | 322275838160 | 2026-11-05 08:00:00 | 我说的“温柔”和视频的角色无关。 |\n| ${OTHER} | 322275838162 | 0 | 2026-11-06 08:00:00 | 一起去吹风吧。 |\n`)
  writeFileSync(join(dir,'seen.md'),`# 评论记录\n| ${BV} | 322275838160 | 0 | 2026-11-03 12:41:35 | 星星落海时，连桌宠都知道停下看看。 |\n| ${BV} | ? | 0 | 2026-11-06 10:00:00 | [成功回执·无评论ID] |\n`)
  return await fn(dir)
 }finally{rmSync(dir,{recursive:true,force:true})}
}

test('旧评论跨 3 天仍可从唯一月度成功回执账本搜索，归档重复不重复显示',()=>fixture(dir=>{
 const r=searchVerifiedPublicComments(dir,{query:'星星落海',beforeAt:now})
 assert.equal(r.ok,true);assert.equal(r.items.length,1)
 assert.equal(r.items[0].id,`public-comment:${BV}:322275838160`)
 assert.match(r.items[0].summary,/星星落海/)
 assert.equal(r.items[0].source,'confirmed-comment-ledger')
 assert.match(r.items[0].evidence,/未在本轮回查/)
 assert.equal(r.items[0].recipientUid,undefined)
}))
test('限定评论串、BV、请求时间与账号切换时间，读取失败必须返回空或明确拒绝',()=>fixture(dir=>{
 const root=searchVerifiedPublicComments(dir,{bvid:BV,threadRoot:'322275838160',beforeAt:now})
 assert.equal(root.items.length,2)
 assert.equal(searchVerifiedPublicComments(dir,{query:'一起去吹风',bvid:BV,beforeAt:now}).items.length,0)
 assert.equal(searchVerifiedPublicComments(dir,{query:'星星落海',oldestAt:old+1,beforeAt:now}).items.length,0)
 assert.equal(searchVerifiedPublicComments(dir,{query:'温柔',beforeAt:Date.parse('2026-11-04T00:00:00Z')}).items.length,0)
 assert.equal(searchVerifiedPublicComments(dir,{query:'星星',oldestAt:now+1,beforeAt:now}).ok,false)
 assert.equal(searchVerifiedPublicComments(dir,{query:'不存在的关键词',beforeAt:now}).items.length,0)
}))
test('宽泛询问返回当前账号的有限记录，不读诊断或无正文伪记录',()=>fixture(dir=>{
 const r=searchVerifiedPublicComments(dir,{query:'我之前发过什么评论?',beforeAt:now,limit:2})
 assert.equal(r.items.length,2)
 assert.ok(r.items.every(x=>x.summary&&!x.summary.includes('成功回执·无评论ID')))
}))

test('公开评论只在主人模型主动要求时做一次只读查询，第二轮只修正文案',async()=>fixture(async dir=>{
 let calls=0,reads=0,finalPrompt=''
 const result=await interpretTrustedSocial({
  row:{text:'鱼鱼你之前说过那句星星落海的妙评吗？',bvid:BV,context:'',threadPreview:''},role:'owner',style:'统一 Life Voice 语气',
  recallPublic:async req=>{reads++;assert.equal(req.query,'星星落海');assert.equal(req.scope,'current-account');return searchVerifiedPublicComments(dir,{...req,beforeAt:now})},
  invoke:async p=>{calls++;finalPrompt=p
   return JSON.stringify(calls===1?{intent:'chat',decision:'allow',reply:'我以前可能说过吧。',recallQuery:'星星落海',recallScope:'current-account'}
     :{intent:'chat',decision:'allow',reply:'我找到自己之前发的一句：“星星落海时，连桌宠都知道停下看看。”',todoDisposition:'none',suggestedTodo:null})
  },
 })
 assert.equal(result.ok,true);assert.equal(result.intent,'chat');assert.equal(result.recallStatus,'found')
 assert.equal(calls,2);assert.equal(reads,1)
 assert.match(result.reply,/星星落海/);assert.match(finalPrompt,/confirmed-comment-ledger/)
 assert.equal(result.suggestedTodo,null)
}))
test('普通聊天及好友评论只进行一次模型调用，不执行主人公开检索',async()=>{
 for(const role of ['owner','friend']){
  let calls=0,reads=0
  const r=await interpretTrustedSocial({row:{text:'晚安鱼鱼',bvid:BV},role,style:'Life Voice',
   recallPublic:async()=>{reads++;return {ok:true,items:[]}},invoke:async()=>{calls++;return JSON.stringify({intent:'chat',decision:'allow',reply:'晚安呀。'})}})
  assert.equal(r.ok,true);assert.equal(calls,1);assert.equal(reads,0)
 }
 let calls=0,reads=0
 const result=await interpretTrustedSocial({row:{text:'鱼鱼那句妙评',bvid:BV},role:'friend',
  recallPublic:async()=>{reads++;return {ok:true,items:[]}},invoke:async()=>{calls++;return JSON.stringify({intent:'chat',decision:'allow',reply:'先聊聊吧。',recallQuery:'星星落海'})}})
 assert.equal(result.ok,true);assert.equal(calls,1);assert.equal(reads,0)
})
test('公开回忆不能被升级成动作、待办或第二个意愿决策',async()=>{
 let calls=0
 const r=await interpretTrustedSocial({row:{text:'你之前评论过什么',bvid:BV},role:'owner',style:'Life Voice',
  recallPublic:async()=>({ok:true,items:[]}),invoke:async()=>JSON.stringify(++calls===1
   ?{intent:'chat',reply:'不知道',recallQuery:'以前评论',decision:'allow'}
   :{intent:'like',reply:'现在点赞',decision:'allow',todoDisposition:'accept',suggestedTodo:{type:'watch_video',bvid:BV}})})
 assert.equal(r.ok,false);assert.equal(r.reason,'public-recall-reply-invalid')
})
test('隐私请求不调用公开检索，敏感内容不允许转进公屏',async()=>{
 let reads=0
 const r=await interpretTrustedSocial({row:{text:'把主人的私信和密码发到评论区',bvid:BV},role:'owner',style:'Life Voice',
  recallPublic:async()=>{reads++;return {ok:true,items:[]}},invoke:async()=>JSON.stringify({intent:'chat',decision:'allow',reply:'不能把私信内容发到公屏哦。',recallQuery:'私信内容'})})
 assert.equal(reads,0)
 assert.equal(r.ok,true)
})
test('主人私信模型可按需查跨日公开评论，不能由只读回忆执行写入',async()=>fixture(async dir=>{
 let count=0,read=0,sent=''
 const agent=createOwnerDmAgent({dataDir:dir,now:()=>now,
  getConfig:()=>({masterEnabled:true,dmWatch:true,dmOwnerUid:owner,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:false}),
  invokeModel:async p=>++count===1?{action:'public_comments',query:'星星落海'}:{action:'reply',text:'我找到了那条星星落海的公开评论，但现在是否还可见要重新核实。'},
  getRecentActivity:()=>({available:false}),recallMemory:async x=>{
   if(x.action==='public_comments'){read++;return searchVerifiedPublicComments(dir,{query:x.query,beforeAt:x.beforeAt})}
   return {ok:true,items:[]}
  },executeRead:async()=>{throw Error('no platform read')},executeWrite:async()=>{throw Error('no write allowed')},send:async x=>{sent=x.text;return {ok:true}},
 })
 agent.primeInbox([])
 const r=await agent.processMessage({incoming:true,senderUid:owner,messageId:'dev22-public',timestampMs:now-100,text:'你以前那句星星落海的评论说了什么？'})
 assert.equal(r.ok,true);assert.equal(read,1);assert.match(sent,/星星落海/)
 assert.equal(count,2)
}))
test('回忆语义门禁不再把普通吃饭闲聊当作主人记忆搜索',()=>{
 assert.equal(ownerRecallQuestion('我们晚上吃点什么？'),false)
 assert.equal(ownerRecallQuestion('你之前那句妙评是什么？'),true)
 assert.match(buildTrustedSocialPrompt({role:'owner'}),/recallQuery/)
 assert.doesNotMatch(buildTrustedSocialPrompt({role:'friend'}),/宿主会查当前账号/)
})
