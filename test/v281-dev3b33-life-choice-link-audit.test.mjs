import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {canReadSharedLinkFromSender} from '../lib/life-shared-link-policy.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createBiliReadBudget} from '../lib/bili-read-budget.mjs'
import {resolveBiliShareLink} from '../lib/bili-share-link.mjs'

const scope='0123456789abcdef',uid='123456789'
function fresh(){const dir=mkdtempSync(join(tmpdir(),'life-link-audit-'));return {dir,close:()=>rmSync(dir,{recursive:true,force:true})}}


test('real shared Bilibili read budget counts each short-link redirect and persists HTTP 429 cooldown',async()=>{
  const x=fresh();try{
    let now=1_800_000_000_000
    const budget=createBiliReadBudget({dataDir:x.dir,now:()=>now})
    const ok=await resolveBiliShareLink({kind:'short',code:'pjKd41b'}, {
      fetchImpl:async()=>({status:302,headers:{get:()=> 'https://t.bilibili.com/1234567890123456'},body:{cancel:async()=>{}}}),
      requestGuard:(kind,task)=>budget.guard(kind,task)
    })
    assert.equal(ok.ok,true)
    assert.equal(budget.status().byKind.find(x=>x.kind==='shared-link-resolve')?.hour,1)
    const limited=await resolveBiliShareLink({kind:'short',code:'nextCode'}, {
      fetchImpl:async()=>({status:429,headers:{get:()=>null},body:{cancel:async()=>{}}}),
      requestGuard:(kind,task)=>budget.guard(kind,task)
    })
    assert.equal(limited.code,'read-budget-blocked')
    assert.equal(budget.status().blocked,true)
    assert.equal(budget.status().backoffCount,1)
  }finally{x.close()}
})

test('typed direct share references cannot be recorded as another resource kind',()=>{
  const x=fresh();try{
    const store=createLifeSharedBiliLinks({stateDir:x.dir,getAccountTag:()=>scope})
    const dynamic=store.offerFromMessage({uid,role:'friend',messageId:'kind-dynamic',text:'https://t.bilibili.com/1234567890123456'})
    assert.equal(store.recordRead(dynamic.ids[0],{ok:true,kind:'video',bvid:'BV1xx411c7mD',title:'错配'},scope).ok,false)
    const video=store.offerFromMessage({uid,role:'friend',messageId:'kind-video',text:'https://www.bilibili.com/video/av12345678'})
    assert.equal(store.recordRead(video.ids[0],{ok:true,kind:'video',aid:'87654321',bvid:'BV1xx411c7mD',title:'错 AID'},scope).ok,false)
    const valid=store.recordRead(video.ids[0],{ok:true,kind:'video',aid:'12345678',bvid:'BV1xx411c7mD',title:'已核验元数据'},scope)
    assert.equal(valid.ok,true)
    assert.equal(valid.evidenceLevel,'video-metadata-only')
    assert.equal(store.list()[0].evidenceLevel,'video-metadata-only')
  }finally{x.close()}
})

test('read-budget deferral preserves a pending link without recording a content failure',()=>{
  const x=fresh();try{
    const store=createLifeSharedBiliLinks({stateDir:x.dir,getAccountTag:()=>scope})
    const offered=store.offerFromMessage({uid,role:'friend',messageId:'budget-defer',text:'https://t.bilibili.com/1234567890123456'})
    const nextAt=Date.now()+4*60_000
    const deferred=store.recordDeferral(offered.ids[0],{nextAt,reason:'read-budget-blocked'},scope)
    assert.equal(deferred.ok,true)
    assert.equal(deferred.status,'deferred')
    const row=store.get(offered.ids[0],scope)
    assert.equal(row.failureCode,'')
    assert.ok(row.nextAt>Date.now())
    assert.equal(row.status,'deferred')
  }finally{x.close()}
})

test('dynamic text evidence is not mislabeled as image observation',()=>{
  const x=fresh();try{
    const store=createLifeSharedBiliLinks({stateDir:x.dir,getAccountTag:()=>scope})
    const offered=store.offerFromMessage({uid,role:'friend',messageId:'dynamic-text-only',text:'https://t.bilibili.com/1234567890123456'})
    const receipt=store.recordRead(offered.ids[0],{ok:true,kind:'dynamic',dynamicId:'1234567890123456',title:'文字动态',summary:'只有文字，没有图片观察'},scope)
    assert.equal(receipt.ok,true)
    assert.equal(receipt.evidenceLevel,'dynamic-text')
    assert.equal(store.list()[0].evidenceLevel,'dynamic-text')
  }finally{x.close()}
})

test('private shared-link reads revalidate the sender permission at execution time',()=>{
  assert.equal(canReadSharedLinkFromSender({senderRole:'owner',senderUid:uid,ownerUid:uid,dmEnabled:true}),true)
  assert.equal(canReadSharedLinkFromSender({senderRole:'owner',senderUid:uid,ownerUid:'998877',dmEnabled:true}),false)
  assert.equal(canReadSharedLinkFromSender({senderRole:'friend',senderUid:uid,ownerUid:'998877',currentRole:'friend',dmEnabled:true,friendCanLearn:true}),true)
  assert.equal(canReadSharedLinkFromSender({senderRole:'friend',senderUid:uid,ownerUid:'998877',currentRole:'stranger',dmEnabled:true,friendCanLearn:false,strangerEnabled:true}),false)
  assert.equal(canReadSharedLinkFromSender({senderRole:'stranger',senderUid:uid,ownerUid:'998877',currentRole:'stranger',dmEnabled:true,strangerEnabled:false}),false)
  assert.equal(canReadSharedLinkFromSender({senderRole:'stranger',senderUid:uid,ownerUid:'998877',currentRole:'stranger',dmEnabled:true,strangerEnabled:true}),true)
  assert.equal(canReadSharedLinkFromSender({senderRole:'stranger',senderUid:uid,ownerUid:'998877',currentRole:'friend',dmEnabled:true,strangerEnabled:false,friendCanLearn:true}),true)
  assert.equal(canReadSharedLinkFromSender({senderRole:'public',senderUid:uid,ownerUid:'',dmEnabled:false}),true)
})

test('Life can select one exact safe link among multiple DM candidates; it cannot invent a URL target',async()=>{
  const calls=[],loads=[],chosen='b'.repeat(24),unselected='a'.repeat(24)
  const batch=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=> '鱼鱼',
    prepareContexts:async()=>[{availableContexts:['shared_link','memory','history']}],
    invoke:async prompt=>{
      calls.push(prompt)
      return calls.length===1
        ?JSON.stringify({items:[{id:'0',action:'skip',reply:'',contextRequests:['shared_link'],sharedLinkChoiceId:chosen}]})
        :JSON.stringify({items:[{id:'0',action:'reply',messages:['我看了你选的那条动态。'],topicState:'settled'}]})
    },
    loadRequestedContexts:async(rows,requested)=>{
      loads.push({id:rows[0].sharedLinkId,requested})
      return [{sharedLinkContext:'{"verified":true,"kind":"dynamic","title":"真实动态"}'}]
    }})
  const result=await batch.generate({kind:'dm',uid,text:'这两个链接你看看 https://t.bilibili.com/1234567890123456 https://b23.tv/pjKd41b',
    messages:['这两个链接你看看'],history:[],socialAutonomy:true,sharedLinkScope:scope,
    sharedLinkCandidates:[{id:unselected,label:'第1个动态链接'},{id:chosen,label:'第2个 B站短链'}],
    availableContexts:['shared_link']})
  assert.equal(loads.length,1)
  assert.equal(loads[0].id,chosen)
  assert.deepEqual(loads[0].requested,[['shared_link']])
  assert.match(calls[0],new RegExp(unselected))
  assert.match(calls[0],new RegExp(chosen))
  assert.doesNotMatch(calls[0],/evil\\.example/)
  assert.equal(result.action,'reply')
})

test('multiple DM links without an exact model choice fail closed before any read',async()=>{
  let reads=0
  const batch=createInteractionBatcher({delayMs:0,getContextMode:()=> 'compact',getPersona:()=> '鱼鱼',
    prepareContexts:async()=>[{availableContexts:['shared_link']}],
    invoke:async()=>JSON.stringify({items:[{id:'0',action:'reply',reply:'我看看',contextRequests:['shared_link']}]}) ,
    loadRequestedContexts:async()=>{reads++;return [{sharedLinkContext:'{"verified":true}'}]}})
  await assert.rejects(batch.generate({kind:'dm',uid,text:'两个链接',history:[],socialAutonomy:true,
    sharedLinkScope:scope,sharedLinkCandidates:[{id:'a'.repeat(24)},{id:'b'.repeat(24)}],availableContexts:['shared_link']}))
  assert.equal(reads,0)
})

test('decision autonomy audit preserves one Life choice, read-only link tools and independent write gates',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const interaction=readFileSync(new URL('../lib/interaction-batch.mjs',import.meta.url),'utf8')
  const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  assert.match(host,/resolveBiliShareLink\(row\.ref,\{requestGuard:\(kind,task\)=>biliReadBudget\.guard\(kind,task\)\}\)/)
  assert.match(host,/sharedLinkPermissionCurrent\(shared,scope\)/)
  assert.match(host,/sharedLinkPermissionCurrent\(root,scope\)/)
  assert.match(host,/sharedLinkReadDeferral/)
  assert.match(host,/const sharedLinkCandidates=permittedLinkRows/)
  assert.match(host,/for\(const id of offered\.ids\|\|\[\]\)/)
  assert.match(interaction,/sharedLinkChoiceId/)
  assert.match(readFileSync(new URL('../lib/bili-share-link.mjs',import.meta.url),'utf8'),/resource-deferred/)
  assert.match(host,/watched:false/)
  assert.match(planner,/video-metadata-only|metadata-only|视频标题不等于看过画面/)
  assert.match(planner,/lifePublicInteractionEnabled/)
  assert.match(planner,/validateOfferedLifeAction/)
  assert.match(planner,/contact-shared-bili-link/)
  assert.match(planner,/shared-link-read-deferred/)
})
