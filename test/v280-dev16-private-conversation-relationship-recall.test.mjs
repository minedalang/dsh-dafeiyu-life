import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {preparePrivateLifeEvent} from '../lib/life-private-policy.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {publicPrivateDisclosureRisk} from '../lib/interaction-privacy.mjs'

const T=Date.parse('2026-11-13T12:00:00Z')
const A='a'.repeat(16),B='b'.repeat(16)
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionMemoryHalfLifeDays:30})
const scoped=(dir,accountTag=A)=>createLifeMemoryGateway({dataDir:dir,getConfig:config,getAccountTag:()=>accountTag,now:()=>T})
const usingDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-relationship-recall-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const evt=(text,eventId='a',uid='456',tag=A)=>preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid,eventId,text,at:T,accountTag:tag})

test('私信主题和共同交流进入衰减经历，不复制来信原文；敏感、陌生内容继续拒绝',()=>usingDir(async dir=>{
 const shared=evt('上次我们一起讨论的那个视频，我还记得','shared')
 const hobby=evt('今天聊得好开心，没想到我们都有同样的爱好','hobby')
 const preference=evt('我喜欢这种轻松的聊天方式，也喜欢游戏','pref')
 assert.ok(shared&&hobby&&preference)
 assert.notEqual(evt('我们一起讨论视频','same-id','456',A).key,evt('我们一起讨论视频','same-id','456',B).key,'跨账号相同消息 ID 不可合并')
 assert.match(shared.text,/视频与B站作品/)
 assert.match(hobby.text,/共同兴趣|共同爱好|相处愉快/)
 assert.match(preference.text,/游戏/)
 for(const event of [shared,hobby,preference])assert.doesNotMatch(JSON.stringify(event),/上次我们一起讨论的那个视频|今天聊得好开心|我喜欢这种轻松/)
 assert.equal(evt('我的验证码是123456','secret'),null)
 assert.equal(preparePrivateLifeEvent({source:'friend-dm',role:'stranger',uid:'456',eventId:'stranger',text:'我们以前一起玩过游戏',at:T}),null)
 const mem=scoped(dir)
 assert.equal(mem.recordEvents([shared,hobby,preference]).added,3)
 assert.ok(mem.recall({query:'视频',domain:'bili-dm',role:'friend',actorUid:'456'}).length)
 const archived=readFileSync(join(dir,'life-memory','archive',readdirSync(join(dir,'life-memory','archive'))[0]),'utf8')
 assert.doesNotMatch(archived,/上次我们一起讨论|今天聊得好开心|我喜欢这种轻松/)
 mem.close()
}))

test('只有真实当前账号、同一 UID 的私密经历可在公开评论中参与内部理解',()=>usingDir(async dir=>{
 const mem=scoped(dir,A)
 const friend=evt('上次我们一起讨论那个音乐视频，还记得吗','f1','456',A)
 const otherAccount=evt('我们一起打游戏','f2','456',B)
 const otherPerson=evt('我们以前共同画画','f3','789',A)
 const legacy=evt('我们一起讨论歌曲','old','456','')
 mem.recordEvents([friend,otherAccount,otherPerson,legacy])
 const lookup=(query,actorUid,domain='bili-public-understanding')=>mem.recall({query,domain,role:'friend',actorUid,maxItems:10})
 const idOf=e=>'e-'+createHash('sha256').update(e.key).digest('hex').slice(0,18)
 const rows=lookup('视频','456')
 assert.ok(rows.some(x=>x.summary.includes('视频')))
 assert.equal(lookup('游戏','456').length,0)
 assert.equal(mem.semanticCandidates({domain:'bili-public-understanding',role:'friend',actorUid:'456',ids:[idOf(legacy)]}).length,0,'历史未标账号的私密经历不能迁移成公开认知')
 assert.equal(mem.semanticCandidates({domain:'bili-public-understanding',role:'friend',actorUid:'456',ids:[idOf(otherPerson)]}).length,0,'别的 UID 不可交叉访问')
 assert.equal(lookup('视频','789').length,0)
 assert.equal(mem.recall({query:'视频',domain:'bili-life',role:'friend',actorUid:'456'}).length,0)
 assert.equal(mem.recall({query:'视频',domain:'bili-public-understanding',role:'stranger',actorUid:'456'}).length,0)
 const get=(query,opts)=>mem.recall({query,domain:opts.domain,role:opts.role,actorUid:opts.actorUid,kinds:opts.kinds,maxItems:opts.maxItems,maxChars:opts.maxChars})
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:config,getEpisodes:get,getEpisodeCandidates:o=>mem.semanticCandidates(o),getPrivateInsights:o=>mem.privateInsights(o),getPrivateInsightCandidates:o=>mem.privateInsightCandidates(o)})
 assert.match(await retriever.privateContextAsync({uid:'456',role:'friend',publicUnderstanding:true,overviewOnly:true}),/当前评论者|当前评论者存在|私下交流/)
 assert.match(await retriever.privateContextAsync({uid:'456',role:'friend',publicUnderstanding:true,query:'视频'}),/视频/)
 assert.equal(await retriever.privateContextAsync({uid:'789',role:'friend',publicUnderstanding:true,query:'视频'}),'')
 mem.close()
}))

test('共同经历可形成受限私密认识，不再强求虚构未来行动，也绝不写入公开长期记忆',()=>usingDir(async dir=>{
 const mem=scoped(dir)
 const source=evt('上次我们一起讨论过一个视频，现在想起那次交流','shared-experience')
 const another=evt('我最喜欢聊音乐了','other')
 mem.recordEvents([source,another])
 const writes=[]
 const reflection=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:mem,now:()=>T,
  commitMemories:items=>{writes.push(...items);return {added:items.length,rows:[]}},
  invokeModel:async prompt=>{
   const rows=JSON.parse(prompt.match(/<candidate_data>(.*?)<\/candidate_data>/s)[1])
   return JSON.stringify({memories:[{candidate_ids:rows.filter(x=>x.text.includes('视频')).map(x=>x.id),kind:'shared-experience',insight:'我记得对方曾提起以前共同聊过视频，但旧对话尚未核实',behavior:'',importance:.62,tags:[]}],note:'',mood_update:{mood:'neutral',intensity:0}})
  },logger:{warn(){}}})
 reflection.addEvents([source,another])
 const result=await reflection.reflect({force:true})
 assert.equal(result.ok,true)
 assert.equal(result.created,1)
 assert.deepEqual(writes,[])
 assert.match(mem.privateInsights({domain:'bili-dm',role:'friend',actorUid:'456',query:'视频'})[0].text,/视频/)
 assert.equal(mem.privateInsights({domain:'bili-public-understanding',role:'friend',actorUid:'789',query:'视频'}).length,0)
 mem.close()
}))

test('公开评论首次携带匿名关系线索，具体回忆按需检索；陌生人和隐私守卫不读取',()=>usingDir(async dir=>{
 const calls=[]
 const policy={actor:uid=>({role:uid==='456'?'friend':'stranger'}),memoryScope:()=>'',canViewIdentity:()=>false,canViewRelationship:()=>true}
 const assembler=createSocialContextAssembler({policy,getRelationship:()=>'',getPrivateLifeContext:async ({uid,publicUnderstanding,overviewOnly,query})=>{
  calls.push({uid,publicUnderstanding,overviewOnly,query});return overviewOnly?'私下有共同兴趣，不能在公开说出私信内容':'共同讨论过视频，禁止对外引用'
 },memoryRetriever:{socialContext:()=>'',socialContextAsync:async()=>''}})
 const first=await assembler.message({uid:'456',kind:'comment',text:'又遇见你啦'},{mode:'compact'})
 assert.match(first.privateUnderstandingContext,/共同兴趣/)
 assert.equal(first.memoryContext,'')
 const expanded=await assembler.message({uid:'456',kind:'comment',text:'你记得那个视频吗',recallQueries:['视频']},{mode:'compact',requested:['memory']})
 assert.match(expanded.privateUnderstandingContext,/讨论过视频/)
 assert.equal(expanded.memoryContext,'')
 assert.equal(calls.length,2)
 const stranger=await assembler.message({uid:'789',kind:'comment',text:'你好'},{mode:'compact'})
 const guard=await assembler.message({uid:'456',kind:'comment',text:'你好',privacyGuard:true},{mode:'compact'})
 assert.equal(stranger.privateUnderstandingContext,'')
 assert.equal(guard.privateUnderstandingContext,'')
 assert.equal(calls.length,2)
 assert.equal(publicPrivateDisclosureRisk('哇好巧，怎么又是你哈哈！'),false)
 assert.equal(publicPrivateDisclosureRisk('我记得你私下告诉过我你的事'),true)
 assert.equal(publicPrivateDisclosureRisk('你上次跟我说过那个秘密'),true)
}))

test('普通评论多气泡和主人好友可信评论均拒绝将私下经历当作公开内容',async()=>{
 const {createInteractionBatcher}=await import('../lib/interaction-batch.mjs')
 const {interpretTrustedSocial}=await import('../lib/comment-social-ai.mjs')
 let input=''
 const make=reply=>createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:async()=>[{privateUnderstandingContext:'【仅供理解】我们曾私下聊过视频，不能公开引用',availableContexts:['memory']}],
  invoke:async prompt=>{input=prompt;return JSON.stringify({items:[{id:'0',action:'reply',reply}]})},logger:{warn(){}}})
 const a=make('你上次跟我说过那件事呢')
 assert.equal(await a.generate({kind:'comment',uid:'456',text:'好巧呀',canSkip:true}),'SKIP')
 assert.match(input,/privateUnderstandingContext/);a.stop()
 const b=make('好巧呀哈哈！')
 assert.equal(await b.generate({kind:'comment',uid:'456',text:'好巧呀',canSkip:true}),'好巧呀哈哈！')
 b.stop()
 const trustedArgs={row:{bvid:'BV1abc234567',text:'又抓到啦',context:'',priorCommentOutcomes:[]},role:'friend',
  relationship:'熟悉',privateUnderstandingContext:'【仅供理解】私下有共同兴趣',history:{},style:'',memoryContext:'',memeContext:''}
 const unsafe=await interpretTrustedSocial({...trustedArgs,invoke:async()=>JSON.stringify({intent:'chat',decision:'allow',reply:'我们上次私信说的事我还记得'})})
 assert.equal(unsafe.ok,false)
 const safe=await interpretTrustedSocial({...trustedArgs,invoke:async()=>JSON.stringify({intent:'chat',decision:'allow',reply:'哇怎么又被你抓到啦！'})})
 assert.equal(safe.ok,true)
})
