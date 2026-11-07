import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'

const baseMemories=[
  {id:'m-owner',text:'鱼鱼曾和主人讨论过小猫的名字',importance:.8,source:'owner-manual',visibility:'private',createdAt:'2026-10-01T00:00:00.000Z'},
  {id:'m-public',text:'鱼鱼公开表达过对猫咪绘本的兴趣',importance:.7,source:'owner-public-approved',visibility:'public',publicApproved:true,createdAt:'2026-10-02T00:00:00.000Z'},
  {id:'m-private',text:'某位好友私信中的敏感私人内容',importance:.8,source:'owner-manual',visibility:'private',createdAt:'2026-10-03T00:00:00.000Z'},
  {id:'m-interest',text:'对某主题有兴趣',importance:.5,source:'life-interest',memoryKind:'interest',tags:['猫咪绘本'],createdAt:'2026-10-04T00:00:00.000Z'},
]
const episodes=[
  {id:'ep-owner',summary:'鱼鱼曾和主人聊过小猫的名字',kind:'social',stage:'clear',at:'2026-10-05T00:00:00.000Z'},
  {id:'ep-friend',summary:'鱼鱼与 UID 123 的私信共同经历',kind:'private-social',stage:'clear',at:'2026-10-06T00:00:00.000Z'},
  {id:'ep-other',summary:'UID 456 的私人经历不可访问',kind:'private-social',stage:'clear',at:'2026-10-07T00:00:00.000Z'},
  {id:'ep-watch',summary:'鱼鱼记得一条公开视频中的猫咪',kind:'watch',stage:'clear',at:'2026-10-08T00:00:00.000Z'},
]
function createFixture({onSemantic=()=>{},getMemories=()=>baseMemories}={}){
 const calls=[]
 const getEpisodeCandidates=opts=>{
  calls.push({...opts})
  let rows=[]
  if(opts.domain==='main-session')rows=[episodes[0],episodes[3]]
  else if(opts.domain==='bili-life')rows=[episodes[0],episodes[3]]
  else if(opts.domain==='bili-dm'&&opts.actorUid==='123'&&opts.role==='friend')rows=[episodes[1]]
  else if(opts.domain==='bili-dm'&&opts.actorUid==='456'&&opts.role==='friend')rows=[episodes[2]]
  if(Array.isArray(opts.ids))rows=rows.filter(x=>opts.ids.includes(x.id))
  if(Array.isArray(opts.kinds))rows=rows.filter(x=>opts.kinds.includes(x.kind))
  return rows.slice(0,opts.limit||48)
 }
 const semanticSearch=async(query,candidates,options)=>{
  onSemantic(query,candidates,options)
  const selected=candidates.filter(x=>/猫|小猫|绘本|橘子宠物/.test(x.text)).map((x,i)=>({id:x.id,score:.92-i*.03}))
  return {ready:true,items:selected.slice(0,options.limit||12)}
 }
 const retriever=createMemoryRetriever({
  getMemories,
  getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionMemoryEmbeddingEnabled:true,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:1600,mainSessionMemoryCandidates:48,mainSessionMemorySearchDailyLimit:20}),
  getEpisodes:()=>[],getEpisodeCandidates,
  getPrivateInsights:({actorUid,role,domain})=>domain==='bili-dm'&&role==='friend'&&actorUid==='123'?[{id:'insight-123',text:'鱼鱼记得 UID 123 曾表达过喜欢猫咪绘本'}]:[],
  getPrivateInsightCandidates:({actorUid,role,domain})=>domain==='bili-dm'&&role==='friend'&&actorUid==='123'?[{id:'insight-123',text:'鱼鱼记得 UID 123 曾表达过喜欢猫咪绘本'}]:[],
  semanticSearch,getAccount:()=>({activeUid:'999',oldUids:[]}),
 })
 return {retriever,calls}
}

test('主 Session 先用当前授权候选做本地向量召回，并在异步后重新核验记忆',async()=>{
 const {retriever,calls}=createFixture()
 const result=await retriever.retrieve('那只小动物后来怎么样了','chat')
 assert.equal(result.usedEmbedding,true)
 assert.equal(result.reason,'embedding')
 assert.match(result.context,/小猫/)
 assert.ok(calls.some(x=>x.domain==='main-session'&&x.limit===3200))
})

test('主人私信的异步主动回忆使用本地 Embedding，并仍只返回实时账本中的 ID',async()=>{
 const {retriever}=createFixture()
 const result=await retriever.ownerSearchAsync('那个小动物的名字',{limit:6})
 assert.equal(result.usedEmbedding,true)
 assert.ok(result.items.some(x=>x.id==='m-owner'||x.id==='memory:m-owner'))
})

test('普通社交语义候选不包含私有记忆，只检索公开记忆和当前 UID 可见经历',async()=>{
 let observed=[]
 const {retriever}=createFixture({onSemantic:(q,candidates)=>{observed=candidates.map(x=>x.id)}})
 const result=await retriever.socialContextAsync('猫咪绘本',{actorUid:'123',role:'friend',maxItems:6})
 assert.match(result,/猫咪绘本/)
 assert.ok(observed.includes('memory:m-public'))
 assert.ok(observed.includes('episode:ep-owner'))
 assert.equal(observed.includes('memory:m-private'),false)
 assert.equal(observed.includes('episode:ep-friend'),false)
})

test('好友私信私有回忆按当前 UID 隔离，不能召回另一 UID 的私信',async()=>{
 const {retriever,calls}=createFixture()
 const result=await retriever.privateContextAsync({uid:'123',role:'friend',query:'猫咪绘本'})
 assert.match(result,/UID 123/)
 assert.equal(result.includes('UID 456'),false)
 assert.ok(calls.some(x=>x.domain==='bili-dm'&&x.role==='friend'&&x.actorUid==='123'&&x.kinds?.includes('private-social')))
})

test('语义检索候选被删除后，异步返回不会复活旧记忆',async()=>{
 let rows=[{...baseMemories[0],text:'鱼鱼曾和主人聊过名为橘子宠物的事情'}]
 const {retriever}=createFixture({getMemories:()=>rows,onSemantic:()=>{rows=[]}})
 const result=await retriever.retrieve('橘子宠物是什么','chat')
 assert.equal(result.context.includes('橘子宠物'),false)
 assert.equal(result.memories.some(x=>x.id==='m-owner'),false)
})
