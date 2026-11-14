import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {normalizeRecallQueries} from '../lib/active-recall-contract.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {searchVerifiedPublicComments} from '../lib/recent-comments.mjs'
import {interpretTrustedSocial} from '../lib/comment-social-ai.mjs'

const OWNER='210228238',FRIEND='90001',BV='BV1SqHK6oE2i',NOW=Date.parse('2026-11-07T16:30:00Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev23-recall-'));try{return await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const output=(fields={})=>JSON.stringify({items:[{id:'0',action:'reply',reply:'已经核对',mood:'neutral',intensity:0,...fields}]})
const baseCfg={masterEnabled:true,dmWatch:true,dmOwnerUid:OWNER,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:false}
const makeOwner=(dir,opts={})=>{
 const agent=createOwnerDmAgent({dataDir:dir,now:()=>NOW,getConfig:()=>baseCfg,
  getRecentActivity:()=>({available:false}),executeRead:async()=>{throw Error('platform tool must not run')},
  executeWrite:async()=>{throw Error('no write')},send:async()=>({ok:true}),...opts})
 agent.primeInbox([])
 return agent
}
const ownerMsg=(text,id='m1')=>({incoming:true,senderUid:OWNER,messageId:id,timestampMs:NOW-100,text})

test('查询词由模型提供，最多三组去重；拒绝 URL、凭据、空检索词',()=>{
 assert.deepEqual(normalizeRecallQueries(['  星星落海  ','星星落海','星辰掉进海里','公开留言','多余第四个']),['星星落海','星辰掉进海里','公开留言'])
 assert.deepEqual(normalizeRecallQueries(['a','https://evil.test','SESSDATA abc',{},null]),[])
})
test('主人消息含“以前”也不会因为固定词自动预检索',()=>withDir(async dir=>{
 let reads=0,modelCalls=0
 const agent=makeOwner(dir,{recallMemory:async()=>{reads++;return {ok:true,items:[]}},
  invokeModel:async p=>{modelCalls++;assert.doesNotMatch(p,/主动回忆预检索/);return {action:'reply',text:'嗯，我们接着聊现在的事。'}}})
 assert.equal((await agent.processMessage(ownerMsg('以前那个话题先不提了'))).ok,true)
 assert.equal(modelCalls,1);assert.equal(reads,0)
}))
test('主人搜索多个模型查询词，不再使用本轮原话，并只允许展开检索到的 id',()=>withDir(async dir=>{
 let calls=0,reads=[],reply=''
 const plan=[{action:'memory_search',queries:['海边散步','傍晚海风']},
  {action:'memory_detail',id:'memory:known'},
  {action:'reply',text:'我查到傍晚海边散步的那次回忆了。'}]
 const agent=makeOwner(dir,{recallMemory:async args=>{reads.push(args);return args.action==='memory_search'
    ?{ok:true,items:[{id:'memory:known',kind:'long-term',summary:'我们那晚在海边散步'}]}
    :{ok:true,items:[{id:'memory:known',summary:'我们那晚在海边散步',kind:'long-term'}]}},
  invokeModel:async()=>plan[calls++],send:async({text})=>(reply=text,{ok:true})})
 const result=await agent.processMessage(ownerMsg('那次是怎么回事？','m2'))
 assert.equal(result.ok,true);assert.equal(calls,3);assert.equal(reads.length,2)
 assert.deepEqual(reads[0].query,['海边散步','傍晚海风'])
 assert.equal(reads[1].id,'memory:known');assert.match(reply,/海边散步/)
}))
test('主人缺少检索词与伪造 detail id 不能触发回忆源或外部写操作',()=>withDir(async dir=>{
 let reads=0,writes=0,steps=0
 const agent=makeOwner(dir,{recallMemory:async()=>{reads++;return {ok:true,items:[]}},
  invokeModel:async()=>++steps===1?{action:'memory_search',queries:[]}:{action:'memory_detail',id:'memory:forged'},
  executeWrite:async()=>{writes++;throw Error('bad')}})
 assert.equal((await agent.processMessage(ownerMsg('那条呢?','m3'))).ok,true)
 assert.equal(reads,0);assert.equal(writes,0)
}))
test('长期记忆与已衰减经历使用相同模型查询组，旧关键词不匹配也可召回',()=>{
 const calls=[]
 const r=createMemoryRetriever({getConfig:()=>({mainSessionMemoryEnabled:false}),
  getMemories:()=>[{id:'one',text:'音乐会上听见合成器的低音旋律',tags:['合成器'],importance:.8}],
  getEpisodes:(query,opts)=>{calls.push({query,opts});return query.includes('合成器')?[{id:'ep1',summary:'周六的合成器演出',kind:'watch',at:'2026-11-02T00:00:00Z'}]:[]}})
 assert.equal(r.ownerSearch(['旧日合成器演出','合成器低音'],{limit:6}).ok,true)
 const found=r.ownerSearch(['旧日合成器演出','合成器低音'])
 assert.ok(found.items.some(x=>x.id==='memory:one'))
 assert.ok(found.items.some(x=>x.id==='episode:ep1'))
 assert.equal(found.searched,2)
 assert.ok(calls.every(c=>c.opts.domain==='main-session'))
})
test('普通用户对话的查询词直接进入统一检索，公开记忆不会读 owner-private',async()=>{
 const queries=[],privateReads=[]
 const policy={actor:uid=>({role:uid===OWNER?'owner':uid===FRIEND?'friend':'unverified'}),memoryScope:({kind,uid})=>kind==='dm'&&uid===OWNER?'owner-private':'public',
  canViewIdentity:()=>false,canViewRelationship:()=>false}
 const assembler=createSocialContextAssembler({policy,
  memoryRetriever:{localContext:query=>(privateReads.push(query),'OWNER SECRET'),socialContext:(q,opts)=>(queries.push({q,opts}),'公开的合成器经历')},
  getPrivateLifeContext:()=>'',logger:{warn(){}}})
 const first=await assembler.message({uid:FRIEND,kind:'comment',text:'你还记得吗'},{mode:'compact'})
 assert.equal(first.memoryContext,'');assert.equal(queries.length,0)
 const found=await assembler.message({uid:FRIEND,kind:'comment',text:'你还记得吗',recallQueries:['合成器演出','那次音乐会']},{mode:'compact',requested:['memory']})
 assert.match(found.memoryContext,/合成器/);assert.deepEqual(queries[0].q,['合成器演出','那次音乐会'])
 assert.equal(queries[0].opts.actorUid,FRIEND);assert.equal(queries[0].opts.role,'friend')
 assert.equal(privateReads.length,0)
 const ownerRead=await assembler.message({uid:OWNER,kind:'dm',text:'那次',recallQueries:['私人约定']},{mode:'compact',requested:['memory']})
 assert.match(ownerRead.memoryContext,/OWNER SECRET/);assert.deepEqual(privateReads,['私人约定'])
 const unverified=await assembler.message({uid:'not-uid',kind:'dm',text:'那次',recallQueries:['私人约定']},{mode:'compact',requested:['memory']})
 assert.equal(unverified.ok,false)
})
test('普通批处理第一轮自主生成记忆查询词，缺查询词时失败而非回退原文',async()=>{
 let reads=0,calls=0,queries=[]
 const b=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'统一 Life Voice',
  prepareContexts:async rows=>rows.map(()=>({availableContexts:['memory'],memoryContext:''})),
  loadRequestedContexts:async rows=>{reads++;queries=rows.map(r=>r.recallQueries);return rows.map(()=>({memoryContext:'已衰减但仍记得的合成器演出'}))},
  invoke:async()=>++calls===1?output({action:'skip',reply:'',contextRequests:['memory'],recallQueries:['合成器演出','电子音乐会']}):output({reply:'想起来了，聊过合成器。'})})
 assert.equal(await b.generate({uid:FRIEND,kind:'dm',text:'那个呢'}),'想起来了，聊过合成器。');b.stop()
 assert.equal(reads,1);assert.deepEqual(queries,[['合成器演出','电子音乐会']])
 let rejectReads=0
 const strict=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:async rows=>rows.map(()=>({availableContexts:['memory']})),
  loadRequestedContexts:async()=>{rejectReads++;return []},
  invoke:async()=>output({action:'skip',reply:'',contextRequests:['memory']}) ,logger:{warn(){}}})
 await assert.rejects(strict.generate({uid:FRIEND,kind:'dm',text:'你记得吗'}),/未形成编号/);strict.stop()
 assert.equal(rejectReads,0)
})
test('跨日评论多查询词共享一次成功回执扫描，严格遵守 BV/时间/账号截断',()=>withDir(dir=>{
 mkdirSync(join(dir,'seen'))
 writeFileSync(join(dir,'seen','2026-11.md'),`# 评论记录\n| ${BV} | 322275838160 | 0 | 2026-11-03 12:41:35 | 星星落海时是很温柔的一幕。 |\n| BV1234567890 | 322275838161 | 0 | 2026-11-06 08:00:00 | 世界真大。 |\n`)
 const r=searchVerifiedPublicComments(dir,{query:['星星落海','世界真大'],beforeAt:NOW})
 assert.equal(r.items.length,2);assert.equal(new Set(r.items.map(x=>x.id)).size,2)
 assert.equal(searchVerifiedPublicComments(dir,{query:['世界真大'],bvid:BV,beforeAt:NOW}).items.length,0)
 assert.equal(searchVerifiedPublicComments(dir,{query:['星星落海'],oldestAt:Date.parse('2026-11-04T00:00:00Z'),beforeAt:NOW}).items.length,0)
 assert.equal(searchVerifiedPublicComments(dir,{query:[],beforeAt:NOW}).ok,false)
}))
test('受信好友公开评论仅能回忆公开安全证据，第二轮不能改变行动',async()=>{
 let calls=0,readArgs=[]
 const result=await interpretTrustedSocial({row:{text:'之前我们聊过那场音乐会吗',bvid:BV},role:'friend',style:'Life Voice',
  recallMemory:async args=>(readArgs.push(args),{ok:true,items:[{id:'safe',kind:'public-safe',summary:'那天公开评论谈到电子音乐会',source:'live-memory-only'}]}),
  invoke:async()=>JSON.stringify(++calls===1?{intent:'chat',reply:'让我想想',recallQueries:['电子音乐会','那天公开聊的音乐'],decision:'allow'}
   :{intent:'chat',reply:'我记得我们在公开评论里提过电子音乐会。',decision:'allow'})})
 assert.equal(result.ok,true);assert.equal(calls,2);assert.deepEqual(readArgs[0].queries,['电子音乐会','那天公开聊的音乐'])
 let actions=0
 const refused=await interpretTrustedSocial({row:{text:'还记得那次吗',bvid:BV},role:'friend',style:'Life Voice',
  recallMemory:async()=>({ok:true,items:[]}),invoke:async()=>JSON.stringify(++actions===1?{intent:'chat',reply:'稍等',recallQueries:['那次聊天']}:{intent:'like',decision:'allow',reply:'点赞啦'})})
 assert.equal(refused.ok,false);assert.equal(refused.reason,'public-recall-reply-invalid')
})
