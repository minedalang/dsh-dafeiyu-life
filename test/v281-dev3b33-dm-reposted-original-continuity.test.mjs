import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const SCOPE='0123456789abcdef',SCOPE2='1234567890abcdef',UID='202573574'
const outerId='1234567890123456',originalId='9876543210987654'
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'fish-dm-repost-'))
  let scope=SCOPE
  const store=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>scope})
  const offer=store.offerFromMessage({uid:UID,role:'owner',text:`https://t.bilibili.com/${outerId}`,messageId:'original-share-test'})
  return {store,id:offer.ids[0],setScope:v=>scope=v,close:()=>rmSync(dir,{recursive:true,force:true})}
}
const verifiedOuter=(related=[{relation:'reposted-original',kind:'dynamic',dynamicId:originalId}])=>({ok:true,kind:'dynamic',dynamicId:outerId,title:'转发时附言',summary:'我觉得这个值得看看',authorUid:UID,related})
const reply=(extra={})=>JSON.stringify({items:[{id:'0',action:'reply',reply:'已看完核验的原动态',messages:['已看完核验的原动态'],todoDisposition:'none',...extra}]})
const make=options=>createInteractionBatcher({delayMs:0,getPersona:()=> '鱼鱼',getContextMode:()=> 'compact',logger:{info(){},warn(){}},...options})

test('只有先读到 B站可信转发引用，且同账号同发件人，才提供唯一原动态候选',()=>{
  const f=fixture();try{
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
    assert.equal(f.store.recordRead(f.id,verifiedOuter(),SCOPE).ok,true)
    const child=f.store.repostedOriginalForParent(f.id,SCOPE)
    assert.equal(child?.relation,'reposted-original')
    assert.equal(child?.kind,'dynamic')
    assert.equal(child?.status,'pending')
    assert.notEqual(child?.id,f.id)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE2),null)
    f.setScope(SCOPE2)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
    f.setScope(SCOPE)
    const proof={ok:true,kind:'dynamic',dynamicId:originalId,title:'原帖真正内容',summary:'可核验的原帖正文',authorUid:'99887766'}
    assert.equal(f.store.recordRead(child.id,proof,SCOPE).ok,true)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE)?.status,'inspected')
  }finally{f.close()}
})

test('没有平台原帖引用时不生成阅读目标，绝不能从用户文字猜测',()=>{
  const f=fixture();try{
    f.store.recordRead(f.id,verifiedOuter([]),SCOPE)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
  }finally{f.close()}
})

test('Life 在一次私信中独立两次选择：外层读取后才可自主读取原帖，并形成最终回复',async()=>{
  const prompts=[],loads=[]
  const b=make({invoke:async prompt=>{
      prompts.push(prompt)
      if(prompts.length===1)return reply({action:'skip',reply:'',contextRequests:['shared_link']})
      if(prompts.length===2)return reply({action:'skip',reply:'',contextRequests:['shared_original']})
      return reply()
    },loadRequestedContexts:async(_batch,requests)=>{
      loads.push(requests)
      if(loads.length===1)return [{sharedLinkContext:JSON.stringify({verified:true,title:'转发附言',repostedOriginalAvailable:true,originalRead:false}),availableContexts:['shared_original']}]
      return [{sharedOriginalContext:JSON.stringify({verified:true,source:'reposted-original',title:'原帖真正内容',summary:'原动态内容证据',originalRead:true})}]
    }})
  try{
    const result=await b.generate({kind:'dm',uid:UID,text:'请看看我转发的动态',socialAutonomy:true,availableContexts:['shared_link']})
    assert.equal(result?.action,'reply')
    assert.deepEqual(result?.messages,['已看完核验的原动态'])
    assert.equal(prompts.length,3)
    assert.deepEqual(loads,[[['shared_link']],[['shared_original']]])
    assert.doesNotMatch(prompts[0],/原帖真正内容|原动态内容证据/)
    assert.match(prompts[1],/repostedOriginalAvailable/)
    assert.match(prompts[1],/read_shared_original/)
    assert.match(prompts[2],/原帖真正内容/)
  }finally{b.stop()}
})

test('Life 可选择只阅读外层、直接答复，不得自动触发原动态读取',async()=>{
  let calls=0,reads=0
  const b=make({invoke:async()=>{
      calls++
      return calls===1?reply({action:'skip',reply:'',contextRequests:['shared_link']}):reply({reply:'只知道你的转发附言，原帖还没看'})
    },loadRequestedContexts:async()=>{reads++;return [{sharedLinkContext:'{"repostedOriginalAvailable":true,"originalRead":false}',availableContexts:['shared_original']}]}})
  try{
    assert.equal(await b.generate({kind:'dm',uid:UID,text:'这是动态',availableContexts:['shared_link']}),'只知道你的转发附言，原帖还没看')
    assert.equal(reads,1)
  }finally{b.stop()}
})

test('没有宿主授予原帖菜单，模型直接索要 shared_original 必须拒绝并且不执行读取',async()=>{
  let reads=0
  const b=make({invoke:async()=>reply({action:'skip',reply:'',contextRequests:['shared_original']}),
    loadRequestedContexts:async()=>{reads++;return [{}]}})
  try{
    await assert.rejects(b.generate({kind:'dm',uid:UID,text:'普通对话',availableContexts:['shared_link']}),/模型未形成编号 0 的最终决定/)
    assert.equal(reads,0)
  }finally{b.stop()}
})

test('平台返回两个不同的原动态引用时，拒绝猜测其中一个',()=>{
  const f=fixture();try{
    f.store.recordRead(f.id,verifiedOuter([
      {relation:'reposted-original',kind:'dynamic',dynamicId:originalId},
      {relation:'reposted-original',kind:'dynamic',dynamicId:'8888888888888888'}
    ]),SCOPE)
    assert.equal(f.store.repostedOriginalForParent(f.id,SCOPE),null)
  }finally{f.close()}
})

test('失败或冷却提示不能统计为原动态真实读取命中；只接受经过核验的内容',async()=>{
  const seen=[]
  const b=make({invoke:async prompt=>{
      seen.push(prompt)
      return seen.length===1?reply({action:'skip',reply:'',contextRequests:['shared_original']}):reply({reply:'现在还没拿到原帖正文',messages:['现在还没拿到原帖正文']})
    },loadRequestedContexts:async()=>[{sharedOriginalContext:'请求保护中，原帖未读取'}]})
  try{
    assert.equal(await b.generate({kind:'dm',uid:UID,text:'那个原动态看了吗',availableContexts:['shared_original']}),'现在还没拿到原帖正文')
    assert.equal(seen.length,2)
    assert.match(seen[1],/原帖未读取/)
  }finally{b.stop()}
})

test('宿主实际读取门禁的源码契约：只读原帖且保持账号、安全预算及可选动作',async()=>{
  const {readFileSync}=await import('node:fs')
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=host.indexOf('loadRequestedContexts:async(batch,requestedByIndex)=>')
  assert.ok(start>0)
  const part=host.slice(start,start+11000)
  assert.match(part,/wantsOriginal/)
  assert.match(part,/repostedOriginalForParent/)
  assert.match(part,/executeSharedBiliLinkRead\(original\.id,scope\)/)
  assert.match(part,/if\(original\.status==='inspected'\)/)
  assert.match(part,/root\?\.senderUid===String\(input\.uid\)/)
  assert.match(part,/!accountBinding\.status\(\)\.blocked/)
  assert.match(part,/proof\?\.code!=='read-budget-blocked'/)
  assert.doesNotMatch(part,/executeSharedDynamicWrite|bili_dynamic_like_life|bili_dynamic_comment_life/)
})
