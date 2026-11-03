import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAccountBinding} from '../lib/account-binding.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {currentAccountSnapshot,historicalAccountMemoryRows,isSelfBiliAccountFact} from '../lib/account-memory-boundary.mjs'
const cred=uid=>({dedeuserid:uid,sessdata:'fake-'+uid,bili_jct:'csrf',buvid3:'test'})
const withDir=async fn=>{const d=mkdtempSync(join(tmpdir(),'fish-memory-switch-'));try{return await fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
const make=d=>createAccountBinding({dataDir:d,verifier:async c=>({uid:c.dedeuserid})})
const change=async(d,a,to)=>{a.stage(cred(to));await a.activate({expectedUid:to});const next=make(d);next.acknowledgeRestart();next.resume({expectedUid:to});return next}
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:false,mainSessionMemoryMaxItems:8,mainSessionMemoryFactsMax:4,mainSessionMemoryMaxChars:1500,mainSessionMemoryThreshold:0.1})
const oldUid={id:'own-uid',category:'stable_profile',source:'owner-manual',事实键:'身份.B站UID',importance:1,text:'我的B站UID是10001'}

test('旧账号 UID 仍能在记忆中检索，但只能标为历史；好友 UID 不误判为本人',()=>{
 const a={activeUid:'20002',oldUids:['10001']}
 const friend={id:'friend',text:'我曾在评论中认识了UID 10001这位观众',事实键:'关系.朋友'}
 const view=historicalAccountMemoryRows([oldUid,friend],a)
 assert.equal(view[0].accountHistorical,true)
 assert.match(view[0].text,/历史B站账号资料；不是当前登录账号UID/)
 assert.equal(view[1].text,friend.text)
 assert.equal(isSelfBiliAccountFact(friend,['10001']),false)
})

test('模拟 A→B→A：完整人生数据不迁移、不丢失，当前 UID 永远来自绑定账本',()=>withDir(async d=>{
 writeFileSync(join(d,'bili_credential.json'),JSON.stringify(cred('10001')))
 let account=make(d)
 const fish=account.characterId()
 mkdirSync(join(d,'long-term-memory'),{recursive:true})
 const originals=[oldUid,{id:'interest',text:'我以前研究过用 FFmpeg 制作短片',importance:.85,source:'life-reflection'},
  {id:'other-uid',text:'我曾收到UID 30003的公开视频建议',importance:.7,source:'life-reflection'},
  {...oldUid,id:'published-old',category:'event',source:'owner-public-approved',visibility:'public',publicApproved:true,事实键:'',text:'我的B站UID是10001，可在B站找我'}]
 const archive=JSON.stringify({version:3,scope:'dafeiyu-identity',memories:originals,traces:[],deleted:[],policy:{}})
 const longFile=join(d,'long-term-memory','dafeiyu.json');writeFileSync(longFile,archive)
 const clock=Date.parse('2026-10-30T12:00:00Z')
 const gateway=createLifeMemoryGateway({dataDir:d,now:()=>clock,getConfig:config})
 try{
  gateway.recordEvents([{kind:'watch',key:'watched-public-video',bvid:'BV1234567890',title:'鱼鱼研究的视频制作教程',at:clock}])
  const lifeBefore=readFileSync(join(d,'life-memory','episodic.json'),'utf8')
  const r=createMemoryRetriever({getMemories:()=>JSON.parse(readFileSync(longFile,'utf8')).memories,getConfig:config,
    getAccount:()=>account.status(),getEpisodes:(q,o)=>gateway.recall({query:q,...o})})
  const before=r.localContext('我的B站UID是多少','chat')
  assert.match(before,/当前绑定UID：10001/)
  assert.doesNotMatch(before,/【历史B站账号资料；不是当前登录账号UID】/)
  account=await change(d,account,'20002')
  assert.equal(account.characterId(),fish)
  const casual=r.localContext('今天过得怎么样','chat')
  assert.doesNotMatch(casual,/我的B站UID是10001/)
  const after=r.localContext('我的B站UID是多少','chat')
  assert.match(after,/当前绑定UID：20002/)
  assert.match(after,/【历史B站账号资料；不是当前登录账号UID】我的B站UID是10001/)
  const explicit=await r.retrieve('我的旧B站账号UID是多少','chat')
  assert.match(explicit.context,/当前绑定UID：20002/)
  assert.match(explicit.context,/历史B站账号资料/)
  const video=await r.retrieve('鱼鱼研究的视频制作教程','chat')
  assert.match(video.context,/视频制作教程/)
  assert.doesNotMatch(r.socialContext('我的B站UID是多少',{actorUid:'88888',role:'stranger'}),/10001|20002/)
  const friend=r.localContext('UID 30003','chat');assert.match(friend,/UID 30003/)
  assert.equal(readFileSync(longFile,'utf8'),archive)
  assert.equal(readFileSync(join(d,'life-memory','episodic.json'),'utf8'),lifeBefore)
  account=await change(d,account,'10001')
  const restored=r.localContext('我的B站UID是多少','chat')
  assert.match(restored,/当前绑定UID：10001/)
  assert.doesNotMatch(restored,/【历史B站账号资料；不是当前登录账号UID】我的B站UID是10001/)
 }finally{gateway.close()}
}))

test('没有有效绑定时不能相信记忆中的旧 UID 是可用的当前账号',()=>{
 const a=currentAccountSnapshot(()=>({activeUid:'',boundAccounts:[],blocked:true,reason:'unbound'}))
 const r=createMemoryRetriever({getMemories:()=>[oldUid],getConfig:config,getAccount:()=>a})
 const content=r.localContext('我的B站UID是多少','chat')
 assert.match(content,/当前没有已绑定的B站账号/)
 assert.match(content,/不能当作当前登录账号/)
})


test('记忆文件损坏时不能默默变成空记忆，更不能被下一次写入覆盖',async()=>withDir(async d=>{
  mkdirSync(join(d,'long-term-memory'),{recursive:true})
  const file=join(d,'long-term-memory','dafeiyu.json')
  const {createLongTermMemory}=await import('../lib/long-term-memory.mjs')
  const store=createLongTermMemory({dataDir:d,getConfig:config,defineTool:x=>x})
  for(const content of ['{truncated','{"version":3,"memories":null,"deleted":[],"traces":[]}']){
    writeFileSync(file,content)
    assert.throws(()=>store.activeMemories(),/SyntaxError|JSON|身份记忆文件格式损坏|Expected property/)
    assert.throws(()=>store.addManual('我记得和朋友一起看了电影'),/SyntaxError|JSON|身份记忆文件格式损坏|Expected property/)
    assert.equal(readFileSync(file,'utf8'),content)
  }
}))
