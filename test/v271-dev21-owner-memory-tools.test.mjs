import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {ownerRecallQuestion,expandOwnerRecallQueries,groundedOwnerAnswer} from '../lib/owner-recall-tools.mjs'
import {isOwnerActivityQuestion} from '../lib/owner-recent-life.mjs'
const owner='12345',now=Date.parse('2026-11-07T16:30:00Z')
const run=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev21-owner-memory-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const msg=(text,id='one')=>({incoming:true,senderUid:owner,messageId:id,timestampMs:now-100,text})
const config=()=>({masterEnabled:true,dmWatch:true,dmOwnerUid:owner,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:false})
const activity={available:true,comments:[{kind:'回复别人',text:'嫌完还是乖乖待在屏幕上，这种才算有脾气的桌宠吧',time:'2026-11-07T16:12:43'}],videos:[]}
const factory=(dir,overrides={})=>{
 const a=createOwnerDmAgent({dataDir:dir,getConfig:config,now:()=>now,
  invokeModel:async()=>({action:'reply',text:'我记得自己说过一句妙评。'}),
  executeRead:async()=>{throw Error('should not access B站')},executeWrite:async()=>{throw Error('should not write B站')},
  send:async()=>({ok:true}),...overrides})
 a.primeInbox([]);return a
}
test('主人提问包含夸过、妙评与指代，能主动检索个人记忆而不是平台热搜',()=>{
 for(const q of ['你之前夸过谁？','你今天发的妙评呢','刚才说的那句是什么','你记得我们聊过什么吗'])assert.equal(ownerRecallQuestion(q),true,q)
 assert.equal(ownerRecallQuestion('请搜索全站热门视频'),false)
 assert.equal(ownerRecallQuestion('妙评',[{role:'user',text:'你今天回复了谁'}]),true)
 assert.equal(expandOwnerRecallQueries('你之前夸过谁？').length,2)
 assert.equal(isOwnerActivityQuestion('你之前夸过谁？'),true)
 assert.equal(isOwnerActivityQuestion('那句',[{role:'user',text:'你之前夸过谁？'}]),true)
})
test('主 Session 记忆开关关闭也可进行经主人私信权限核验的私有只读检索',()=>{
 const retriever=createMemoryRetriever({getConfig:()=>({mainSessionMemoryEnabled:false}),
  getMemories:()=>[{id:'legacy-1',text:'鱼鱼之前回复评论时夸奖过桌宠非常有脾气',importance:.8,tags:['评论']}],
  getEpisodes:()=>[{id:'episode-1',summary:'鱼鱼回复过一条有关桌宠的评论',kind:'social',stage:'clear',at:new Date(now).toISOString()}]})
 assert.equal(retriever.localContext('评论'),'')
 const found=retriever.ownerSearch('我之前有什么妙评',{limit:6})
 assert.equal(found.ok,true)
 assert.ok(found.items.some(x=>x.id==='memory:legacy-1'))
 assert.ok(found.items.some(x=>x.id==='episode:episode-1'))
 assert.match(retriever.ownerDetail('memory:legacy-1').summary,/桌宠/)
 assert.equal(retriever.ownerDetail('memory:unknown'),null)
})
test('记忆工具分步查询，详情只能来自本轮检索到的 ID，无需平台只读工具权限',()=>run(async dir=>{
 let n=0,queryCalls=0,detailCalls=0,prompt='',sent=''
 const results=[{action:'memory_search',query:'我之前夸过谁'},
  {action:'memory_detail',id:'memory:one'},
  {action:'reply',text:'我想起来了！之前我回了一句“这桌宠有脾气”，还挺喜欢那个说法。'}]
 const agent=factory(dir,{getRecentActivity:()=>({available:false}),
  recallMemory:async({action,id})=>{if(action==='memory_search'){queryCalls++;return {ok:true,items:[{id:'memory:one',summary:'鱼鱼曾说过这桌宠有脾气',kind:'long-term'}]}}
    if(action==='memory_detail'){detailCalls++;assert.equal(id,'memory:one');return {ok:true,items:[{id,summary:'鱼鱼曾说过这桌宠有脾气',kind:'long-term'}]}}
    return {ok:false,items:[]}},
  invokeModel:async p=>{prompt=p;return results[n++]},send:async x=>{sent=x.text;return {ok:true}}})
 const r=await agent.processMessage(msg('你之前夸过谁？'))
 assert.equal(r.ok,true);assert.equal(n,3);assert.equal(queryCalls,1);assert.equal(detailCalls,1)
 assert.match(prompt,/鱼鱼曾说过这桌宠有脾气/)
 assert.match(sent,/我想起来了/)
 assert.ok(!prompt.includes('判断本条主人消息是否提出了未来想让你'))
}))
test('不允许未经搜索直接使用模型伪造的记忆 ID 读取详情',()=>run(async dir=>{
 let calls=0
 const agent=factory(dir,{recallMemory:async x=>{calls++;if(x.action==='memory_detail')throw Error('unexpected unsafe detail read');return {ok:true,items:[]}},
  invokeModel:async()=>({action:'memory_detail',id:'memory:forged'}),send:async()=>({ok:true})})
 const r=await agent.processMessage(msg('你以前说过什么','x1'))
 assert.equal(r.ok,true);assert.equal(calls,0)
 assert.match(r.reply,/没找到|线索/)
}))
test('没有证据时自然回答，不会反复自责或索要 BV 号',()=>run(async dir=>{
 let sent=''
 const agent=factory(dir,{getRecentActivity:()=>({available:false}),recallMemory:async()=>({ok:true,items:[]}),
  invokeModel:async()=>({action:'reply',text:'我刚才完整看完了一首视频，它的旋律好听极了。'}),
  send:async x=>{sent=x.text;return {ok:true}}})
 const result=await agent.processMessage(msg('你刚才说的那句妙评？','claim1'))
 assert.equal(result.ok,true)
 assert.doesNotMatch(sent,/刚才说得太满|缺少可靠依据|先承认|看完了|BV号/)
 assert.match(sent,/没找到|线索/)
}))
test('局部事实错误允许同一模型纠正，保留正常表达而非替换成程序模板',()=>run(async dir=>{
 let calls=0,sent=''
 const agent=factory(dir,{getRecentActivity:()=>activity,
  invokeModel:async()=>++calls===1?{action:'reply',text:'我完整看完了那条视频，夸的是桌宠。'}:{action:'reply',text:'哈哈，我倒是回过一句“嫌完还是乖乖待在屏幕上”，这句我自己还挺喜欢。'},
  send:async x=>{sent=x.text;return {ok:true}}})
 const result=await agent.processMessage(msg('你发过什么妙评？','fix1'))
 assert.equal(result.ok,true);assert.equal(calls,2)
 assert.match(sent,/哈哈/);assert.doesNotMatch(sent,/看完|没有依据|抱歉/)
}))
test('旧 owner DM 状态仍可读取，未新增不兼容持久字段',()=>run(async dir=>{
 const agent=factory(dir)
 assert.equal((await agent.processMessage(msg('晚安鱼鱼','default'))).ok,true)
 const disk=JSON.parse(readFileSync(join(dir,'owner-dm-agent.json'),'utf8'))
 assert.equal(disk.version,1);assert.ok(Array.isArray(disk.history))
}))
test('开发文档、服务端 owner 认证和版本一致',()=>{
 const base=new URL('../',import.meta.url)
 const index=readFileSync(new URL('index.js',base),'utf8')
 assert.match(index,/recallMemory:async/)
 assert.match(index,/trustedLifeAccountTag\(\)/)
 assert.match(readFileSync(new URL('package.json',base),'utf8'),/"version": "2\.8\.0(?:-dev\.\d+)?"/)
})
