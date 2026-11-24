import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeMemoryBackup,restoreLifeMemoryBackup} from '../lib/data-backup.mjs'
const A='aaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbb',BV='BV1234567890'
const NOW=Date.parse('2026-11-18T12:00:00Z'),DAY=86_400_000
const event={kind:'watch',key:'video-explore:dev2-integration',bvid:BV,title:'已观察片段',at:NOW,accountTag:A,
 experience:{source:'bili-life',metadata:true,preview:true,vision:true,evidenceSchema:'life-video-evidence/v1',
  visualReceipt:{source:'low-resolution-preview',frameCount:2,firstAtMs:1000,lastAtMs:9000},
  visualSceneNotes:['画面里出现两个角色'],purpose:'自主探索'}}
const fragments=[{fragmentId:'frame-0001',type:'observed-scene',content:'在 1–9 秒内实际采样时出现两个人物。',certainty:'model-observation',sourceRef:'verified:observation:sample1',timeAnchorMs:[1000,9000],uncertainties:['角色身份不确定']}]
const setup=fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-detail-'));let at=NOW+5000,account=A;const gateway=createLifeMemoryGateway({dataDir:dir,now:()=>at,getAccountTag:()=>account,getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),
 admitMemoryDetails:({episode,sourceProof})=>sourceProof?.internalToken==='test-only'&&episode.bvid===BV,logger:{warn(){}}});
 try{gateway.recordEvents([event]);const memoryId=gateway.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId;fn({dir,gateway,memoryId,setTime:t=>at=t,setAccount:t=>account=t})}
 finally{gateway.close();rmSync(dir,{recursive:true,force:true})}}

test('dev.2 default production Gateway never accepts forged details, even with verified=true',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-detail-closed-'))
 try{const gate=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A,now:()=>NOW+5000});gate.recordEvents([event]);const id=gate.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId
  assert.equal(gate.attachMemoryDetails({memoryId:id,accountTag:A,fragments,verified:true}).reason,'source-not-admitted')
  assert.equal(gate.memoryDetailInfo({memoryId:id,accountTag:A}).available,false);gate.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('detail attachment stores actual bounded fragments, honors read budget and never changes summary',()=>setup(({gateway,memoryId})=>{
 const sourceProof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof}).ok,true)
 assert.equal(gateway.memoryDetailInfo({memoryId,accountTag:A}).available,true)
 const result=gateway.expandMemoryDetail({memoryId,accountTag:A,maxBytes:4096})
 assert.equal(result.ok,true);assert.equal(result.totalFragments,1);assert.match(result.fragments[0].content,/两个人物/)
 assert.equal(gateway.videoEvidenceTrace({accountTag:A,bvid:BV})[0].detailStorage,'available')
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:B}).reason,'memory-unavailable')
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:B,fragments,sourceProof}).reason,'memory-unavailable')
 assert.equal(gateway.expandMemoryDetail({memoryId:'../../../archive',accountTag:A}).reason,'memory-unavailable')
 assert.equal(gateway.status().details.attachments,1)
}))

test('oversize, no timestamps, duplicate IDs and private source do not enter deep details',()=>setup(({gateway,memoryId})=>{
 const sourceProof={internalToken:'test-only'}
 for(const invalid of [[{...fragments[0],content:'x'.repeat(34*1024)}], [{...fragments[0],timeAnchorMs:undefined}], [...fragments,...fragments]]){
  assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:invalid,sourceProof}).ok,false)
 }
 assert.equal(gateway.memoryDetailInfo({memoryId,accountTag:A}).available,false)
}))

test('clear to fuzzy revokes detail before any future read, persists irreversible tombstone outside life-memory backup',()=>setup(({dir,gateway,memoryId,setTime})=>{
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,true)
 setTime(NOW+14*DAY)
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).reason,'memory-unavailable')
 const doc=JSON.parse(readFileSync(join(dir,'detail-protection','revocations-v1.json'),'utf8'))
 assert.ok(doc.ids.includes(memoryId))
 assert.equal(gateway.status().details.attachments,0)
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,false)
}))

test('reconciliation purges orphan details after parent replacement and does not use archives',()=>setup(({dir,gateway,memoryId})=>{
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,true)
 const path=join(dir,'life-memory','episodic.json')
 const data=JSON.parse(readFileSync(path,'utf8'));data.episodes=[]
 writeFileSync(path,JSON.stringify(data),'utf8')
 const result=gateway.reconcileMemoryDetails()
 assert.equal(result.ok,true)
 assert.equal(gateway.status().details.attachments,0)
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).reason,'memory-unavailable')
}))

test('standalone memory backup includes detail attachments and does not resurrect a detail after fuzzy restore',()=>setup(({dir,gateway,memoryId,setTime})=>{
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,true)
 const pack=createLifeMemoryBackup(dir)
 const detailKey=`life-memory/details/v1/${A}/${memoryId}.json`
 assert.ok(pack.files[detailKey])
 const destination=mkdtempSync(join(tmpdir(),'detail-backup-dest-'))
 try{
  assert.ok(restoreLifeMemoryBackup(destination,pack)>0)
  const restored=createLifeMemoryGateway({dataDir:destination,getAccountTag:()=>A,now:()=>NOW+5000})
  assert.equal(restored.expandMemoryDetail({memoryId,accountTag:A}).ok,true)
  restored.close()
  // The current source forgets after the backup was created.
  setTime(NOW+14*DAY)
  assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
  // An older snapshot must not revive details on the same device.
  restoreLifeMemoryBackup(dir,pack)
  assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
  assert.equal(gateway.status().details.attachments,0)
 }finally{rmSync(destination,{recursive:true,force:true})}
}))

test('dev.6 verified owner focus appends deep fragments and publishes bounded shallow revisions',()=>setup(({gateway,memoryId})=>{
 const sourceProof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof}).ok,true)
 const verified={reviewStatus:'model-observation-not-independent-semantic-proof',
  startMs:2000,endMs:8000,frameTimesMs:[2300,5500],description:'这段原视频画面出现一张写着菜单的桌面。'}
 const result=gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,
  sourceProof,sourceRef:'focus:'+'c'.repeat(32),review:verified})
 assert.equal(result.ok,true)
 assert.equal(result.shallowVersion,1)
 assert.equal(result.deepFragments,2,'已有深层片段必须保留')
 const memo=gateway.recall({query:BV,maxItems:4,maxChars:3000}).find(x=>x.id===memoryId)
 assert.match(memo?.summary||'',/后来在/)
 assert.match(memo?.summary||'',/未独立核实/)
 const deep=gateway.expandMemoryDetail({memoryId,accountTag:A,maxBytes:8192})
 assert.equal(deep.totalFragments,2)
 assert.ok(deep.fragments.some(x=>x.type==='focused-observation'&&x.timeAnchorMs[0]===2000))
 assert.ok(deep.fragments.some(x=>x.fragmentId==='frame-0001'))
 const updated=gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,
  sourceProof,sourceRef:'focus:'+'d'.repeat(32),review:{...verified,description:'画面中出现了绿色的广告牌'}})
 assert.equal(updated.shallowVersion,2)
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).totalFragments,3)
}))

test('dev.6 focus rejects unverified evidence, wrong account and forgotten parents',()=>setup(({gateway,memoryId,setTime})=>{
 const proof={internalToken:'test-only'},review={reviewStatus:'model-observation-not-independent-semantic-proof',
  startMs:1000,endMs:8000,frameTimesMs:[3000],description:'有树木的街角'}
 assert.equal(gateway.recordVerifiedFocusRevision({memoryId,accountTag:B,bvid:BV,review,sourceProof:proof,
  sourceRef:'focus:'+'c'.repeat(32)}).reason,'memory-unavailable')
 assert.equal(gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,review:{...review,reviewStatus:'unknown'},
  sourceProof:proof,sourceRef:'focus:'+'c'.repeat(32)}).reason,'invalid-verified-window')
 assert.equal(gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,review,
  sourceProof:{internalToken:'untrusted'},sourceRef:'focus:'+'c'.repeat(32)}).reason,'source-not-admitted')
 assert.equal(gateway.memoryDetailInfo({memoryId,accountTag:A}).available,false)
 setTime(NOW+14*DAY)
 assert.equal(gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,review,
  sourceProof:proof,sourceRef:'focus:'+'c'.repeat(32)}).reason,'memory-unavailable')
}))


test('dev.6 one-hour video focus updates both shallow and deep at a real minute-50 anchor',()=>setup(({gateway,memoryId})=>{
 const sourceProof={internalToken:'test-only'}
 const review={reviewStatus:'model-observation-not-independent-semantic-proof',
  startMs:3000000,endMs:3012000,frameTimesMs:[3000500,3006000],
  description:'50分钟附近真实解码的局部画面中看见一块蓝色标牌。'}
 const result=gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,
  sourceProof,sourceRef:'focus:'+'b'.repeat(32),review})
 assert.equal(result.ok,true,JSON.stringify(result))
 assert.equal(result.shallowVersion,1)
 const deep=gateway.expandMemoryDetail({memoryId,accountTag:A,maxBytes:8192})
 assert.equal(deep.totalFragments,1)
 assert.deepEqual(deep.fragments[0].timeAnchorMs,[3000000,3012000])
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:B}).ok,false)
}))

test('progressive recall groups exact current-account BV and preserves exact episode identity',()=>setup(({gateway,memoryId,setAccount,setTime})=>{
 const sourceProof={internalToken:'test-only'}
 assert.equal(gateway.recallVideoDetails({bvid:BV,accountTag:A}).reason,'no-detail')
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof}).ok,true)
 assert.equal(gateway.recallVideoDetails({bvid:BV,accountTag:A}).fragments[0].fragmentId,'frame-0001')
 gateway.recordEvents([{...event,key:'video-explore:second-observation',at:NOW+1000}])
 const group=gateway.recallVideoDetails({bvid:BV,accountTag:A})
 assert.equal(group.ok,true);assert.equal(group.fragments.length,1);assert.equal(group.fragments[0].memoryId,memoryId)
 const second=gateway.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId
 assert.notEqual(second,memoryId)
 assert.equal(gateway.attachMemoryDetails({memoryId:second,accountTag:A,fragments:[{...fragments[0],fragmentId:'frame-0002',sourceRef:'verified:observation:sample2'}],sourceProof}).ok,true)
 const both=gateway.recallVideoDetails({bvid:BV,accountTag:A})
 assert.equal(both.fragments.length,2);assert.equal(both.sources.length,2)
 const rows=gateway.semanticCandidates({query:BV,limit:3200})
 assert.equal(gateway.videoRecallGroups(rows).filter(e=>e.bvid===BV).length,1)
 assert.equal(gateway.videoEvidenceTrace({accountTag:A,bvid:BV}).length,2)
 assert.equal(gateway.recallVideoDetails({bvid:BV,accountTag:A,memoryId}).ok,true)
 assert.equal(gateway.recallVideoDetails({bvid:'BV0987654321',accountTag:A,memoryId}).ok,false)
 setAccount(B);assert.equal(gateway.recallVideoDetails({bvid:BV,accountTag:A,memoryId}).ok,false)
 setAccount(A);setTime(NOW+14*DAY);assert.equal(gateway.recallVideoDetails({bvid:BV,accountTag:A,memoryId}).ok,false)
}))

 test('group recall preserves each observation lifetime; new observation cannot revive an old attachment',()=>setup(({gateway,memoryId,setTime})=>{
  const sourceProof={internalToken:'test-only'}
  assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof}).ok,true)
  setTime(NOW+10*DAY)
  gateway.recordEvents([{...event,key:'video-explore:later-observation',at:NOW+10*DAY}])
  const later=gateway.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId
  assert.equal(gateway.attachMemoryDetails({memoryId:later,accountTag:A,fragments:[{...fragments[0],fragmentId:'frame-later',sourceRef:'verified:observation:later'}],sourceProof}).ok,true)
  setTime(NOW+14*DAY)
  const grouped=gateway.recallVideoDetails({bvid:BV,accountTag:A})
  assert.equal(grouped.ok,true);assert.deepEqual(grouped.fragments.map(x=>x.memoryId),[later]);assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
 }))
 test('group recall searches past twelve new shallow-only episodes without inventing attachments',()=>setup(({gateway,memoryId})=>{
  assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,true)
  gateway.recordEvents(Array.from({length:13},(_,i)=>({...event,key:'video-explore:no-detail-'+i,at:NOW+1000+i})))
  const result=gateway.recallVideoDetails({bvid:BV,accountTag:A})
  assert.equal(result.ok,true);assert.equal(result.fragments.length,1);assert.equal(result.fragments[0].memoryId,memoryId)
 }))
