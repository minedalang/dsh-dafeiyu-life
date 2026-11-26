import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,mkdirSync,utimesSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeMemoryBackup,restoreLifeMemoryBackup,collectBackupFiles,createBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {execFile,execFileSync} from 'node:child_process'
import {promisify} from 'node:util'
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

test('oversize, no timestamps and duplicate IDs do not enter deep details',()=>setup(({gateway,memoryId})=>{
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

// New observations use one physical shallow slot, while the individual trusted
// source identities remain valid for independent decay and reverse activation.
test('new verified same-BV observations nest under one durable shallow slot, including after restart',()=>setup(({dir,gateway,memoryId,setTime})=>{
 const proof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:proof}).ok,true)
 const next={...event,key:'video-explore:new-fresh-observation',at:NOW+2000,experience:{...event.experience,visualSceneNotes:['新片段中有朱红雨伞']}}
 const written=gateway.recordEvents([next]);assert.equal(written.shallowAdded,0);assert.equal(written.visualAppended,1)
 const raw=JSON.parse(readFileSync(gateway.file,'utf8'))
 assert.equal(raw.episodes.length,1);assert.equal(raw.episodes[0].id,memoryId);assert.equal(raw.episodes[0].visualObservations.length,1)
 const child=raw.episodes[0].visualObservations[0];assert.notEqual(child.id,memoryId)
 for(const key of ['bvid','kind','accountTag','visibility'])assert.ok(!Object.hasOwn(child,key))
 assert.equal(gateway.attachMemoryDetails({memoryId:child.id,accountTag:A,fragments:[{...fragments[0],fragmentId:'fresh-umbrella',content:'画面中一位行人撑着朱红色雨伞。',sourceRef:'verified:observation:fresh'}],sourceProof:proof}).ok,true)
 assert.equal(gateway.recordEvents([next]).added,0,'same operation is idempotent')
 const fresh=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A,now:()=>NOW+5000})
 try{
  assert.equal(fresh.recall({query:BV}).length,1)
  assert.equal(fresh.recallVideoDetails({bvid:BV,accountTag:A}).fragments.length,2)
  assert.ok(fresh.visualDetailCandidates({accountTag:A}).some(x=>x.id===child.id&&x.text.includes('朱红色雨伞')))
  assert.equal(fresh.status().shallowSlots,1);assert.equal(fresh.status().nestedVisualObservations,1)
 }finally{fresh.close()}
}))

test('historical duplicate roots are not migrated or overwritten; new writes use one existing root and keep account/privacy separate',()=>setup(({gateway,memoryId})=>{
 const legacy={...event,key:'video-explore:legacy-other-root',at:NOW+1000}
 gateway.recordEvents([legacy],{migration:true})
 const before=JSON.parse(readFileSync(gateway.file,'utf8')).episodes
 assert.equal(before.length,2)
 gateway.recordEvents([{...event,key:'video-explore:new-public-source',at:NOW+2000}])
 const after=JSON.parse(readFileSync(gateway.file,'utf8')).episodes
 assert.equal(after.length,2);assert.equal(after[0].id,memoryId)
 assert.equal(after[0].visualObservations.length,1)
 const {visualObservations,...unchanged}=after[0];assert.deepEqual(unchanged,before[0]);assert.deepEqual(after[1],before[1])
 gateway.recordEvents([{...event,key:'video-explore:other-account-source',accountTag:B},{...event,key:'video-explore:private-source-one',experience:{...event.experience,source:'main-session'}},{...event,key:'video-explore:private-source-two',experience:{...event.experience,source:'main-session'}}])
 const rows=JSON.parse(readFileSync(gateway.file,'utf8')).episodes
 assert.equal(rows.length,4)
 assert.equal(rows.find(e=>e.visibility==='private-session').visualObservations.length,1)
 assert.equal(rows.find(e=>e.accountTag===B).visualObservations,undefined)
 assert.equal(gateway.videoEvidenceTrace({accountTag:A,bvid:BV,limit:12}).length,3)
 assert.equal(gateway.recall({query:BV,domain:'bili-life',role:'friend',actorUid:'123'}).length,1)
}))

test('nested evidence survives backup and the fading root is replaced without restoring old details',()=>setup(({dir,gateway,memoryId,setTime})=>{
 const proof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:proof}).ok,true)
 setTime(NOW+10*DAY)
 const next={...event,key:'video-explore:later-independent-source',at:NOW+10*DAY}
 gateway.recordEvents([next])
 const later=JSON.parse(readFileSync(gateway.file,'utf8')).episodes[0].visualObservations[0].id
 assert.equal(gateway.attachMemoryDetails({memoryId:later,accountTag:A,fragments:[{...fragments[0],fragmentId:'fresh-later',sourceRef:'verified:observation:later'}],sourceProof:proof}).ok,true)
 const backup=createLifeMemoryBackup(dir)
 assert.ok(backup.files[`life-memory/details/v1/${A}/${later}.json`])
 const dest=mkdtempSync(join(tmpdir(),'dafeiyu-nested-restore-'))
 try{
  restoreLifeMemoryBackup(dest,backup)
  const gate=createLifeMemoryGateway({dataDir:dest,getAccountTag:()=>A,now:()=>NOW+10*DAY})
  try{assert.equal(gate.recallVideoDetails({bvid:BV,accountTag:A}).fragments.length,2);assert.equal(gate.reconcileMemoryDetails().removed,0)}finally{gate.close()}
 }finally{rmSync(dest,{recursive:true,force:true})}
 setTime(NOW+14*DAY)
 assert.deepEqual(gateway.recallVideoDetails({bvid:BV,accountTag:A}).fragments.map(f=>f.memoryId),[later])
 let persisted=JSON.parse(readFileSync(gateway.file,'utf8')).episodes
 assert.equal(persisted.filter(e=>e.bvid===BV).length,1)
 assert.equal(persisted.find(e=>e.bvid===BV).id,later)
 restoreLifeMemoryBackup(dir,backup)
 assert.deepEqual(gateway.recallVideoDetails({bvid:BV,accountTag:A}).fragments.map(f=>f.memoryId),[later])
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
}))

test('expired group root rehomes fresh child under an existing clear legacy root rather than adding another BV',()=>setup(({gateway,setTime})=>{
 setTime(NOW+5*DAY)
 gateway.recordEvents([{...event,key:'video-explore:legacy-still-clear',at:NOW+5*DAY}],{migration:true})
 setTime(NOW+10*DAY)
 gateway.recordEvents([{...event,key:'video-explore:latest-clear-child',at:NOW+10*DAY}])
 setTime(NOW+14*DAY);gateway.decay()
 const rows=JSON.parse(readFileSync(gateway.file,'utf8')).episodes.filter(e=>e.bvid===BV)
 assert.equal(rows.length,1);assert.equal(rows[0].key,'video-explore:legacy-still-clear');assert.equal(rows[0].visualObservations[0].key,'video-explore:latest-clear-child')
}))


test('production event builder and coordinator do not turn reused cached visuals into another observation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-visual-cache-slot-'))
 const gate=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A,now:()=>NOW+5000})
 try{
  let reflected=0
  const coordinator=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:gate,lifeReflection:{addEvents:()=>{reflected++;return {ok:true}}},getAccountTag:()=>A,now:()=>NOW+5000})
  const build=(id,status)=>buildVideoExplorationEvent({bvid:BV,operationId:id,at:NOW,source:'bili-life',accountTag:A,
   info:{ok:true,bvid:BV,title:'真实视觉采样'},visual:{ok:true,bvid:BV,status,image_source:'B站低清预览',times:[2,8,15],description:'画面中有一个蓝色的盒子。'}})
  const first=build('fresh-observation-one','analyzed'),second=build('fresh-observation-two','analyzed'),cached=build('cached-observation-one','cached')
  assert.equal(first.visualObservationState,'fresh');assert.equal(cached.visualObservationState,'cached')
  assert.equal((await coordinator.recordEvents([first])).ok,true)
  assert.equal((await coordinator.recordEvents([second])).ok,true)
  const before=readFileSync(gate.file,'utf8');assert.equal(JSON.parse(before).episodes[0].visualObservations.length,1)
  assert.equal((await coordinator.recordEvents([cached])).skipped,'cached-visual');assert.equal(reflected,2)
  assert.equal(gate.recordEvents([cached]).added,0);assert.equal(readFileSync(gate.file,'utf8'),before)
 }finally{gate.close();rmSync(dir,{recursive:true,force:true})}
})

test('two independent processes cannot create two fresh same-account BV slots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-visual-slot-race-'))
 const gatewayUrl=new URL('../lib/life-memory-gateway.mjs',import.meta.url).href
 const execute=promisify(execFile)
 const code=`import {createLifeMemoryGateway} from ${JSON.stringify(gatewayUrl)};
 const event=JSON.parse(process.argv[2]);const dir=process.argv[1];
 for(let i=0;i<200;i++){let gate;try{gate=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>event.accountTag,now:()=>${NOW+5000}});gate.recordEvents([event]);break}catch(e){if(e.code!=='LEDGER_BUSY'||i===199)throw e;await new Promise(r=>setTimeout(r,10))}finally{gate?.close()}}`
 try{
  await Promise.all(['process-observation-one','process-observation-two'].map(id=>execute(process.execPath,['--input-type=module','-e',code,dir,JSON.stringify({...event,key:'video-explore:'+id})],{timeout:10000})))
  const gate=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A,now:()=>NOW+5000})
  try{const raw=JSON.parse(readFileSync(gate.file,'utf8'));assert.equal(raw.episodes.length,1);assert.equal(raw.episodes[0].visualObservations.length,1);assert.equal(gate.videoEvidenceTrace({accountTag:A,bvid:BV}).length,2)}finally{gate.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('owner-only visual details use the same store, exclude public recall, survive owner backup and forget independently',()=>setup(({dir,gateway,setAccount,setTime})=>{
 const olderPortable=createBackup({root:dir,config:{}})
 const privateEvent={...event,key:'video-explore:owner-private-detail',experience:{...event.experience,source:'main-session'}}
 gateway.recordEvents([privateEvent]);const opts={accountTag:A,bvid:BV,ownerSession:true}
 const privateRow=gateway.videoEvidenceTrace(opts).find(x=>x.visibility==='private-session')
 assert.ok(privateRow);const id=privateRow.memoryId
 const part={...fragments[0],fragmentId:'private-frame-1',content:'仅主人会话记录的蓝色雨伞画面。'}
 const proof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments:[part],sourceProof:proof}).reason,'memory-unavailable')
 assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments:[part],ownerSession:true,verified:true}).reason,'source-not-admitted')
 assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments:[part],sourceProof:proof,ownerSession:true}).ok,true)
 assert.equal(gateway.recallVideoDetails(opts).fragments[0].content,part.content)
 assert.equal(gateway.recallVideoDetails({...opts,ownerSession:false}).ok,false)
 assert.equal(gateway.expandMemoryDetail({memoryId:id,accountTag:A}).ok,false)
 assert.equal(gateway.videoEvidenceTrace({accountTag:A,memoryId:id}).length,0)
 assert.equal(gateway.visualDetailCandidates({accountTag:A,ids:[id]}).length,0)
 assert.equal(gateway.reconcileMemoryDetails().removed,0)
 setAccount(B);assert.equal(gateway.recallVideoDetails(opts).ok,false);setAccount(A)
 const detailKey=`life-memory/details/v1/${A}/${id}.json`
 assert.equal(collectBackupFiles(dir)[detailKey],undefined)
 restoreBackupFiles(dir,olderPortable)
 assert.equal(gateway.recallVideoDetails(opts).fragments[0].content,part.content,'ordinary restore must not orphan a newer local private detail')
 const pack=createLifeMemoryBackup(dir);assert.ok(pack.files[detailKey])
 const dst=mkdtempSync(join(tmpdir(),'private-detail-restore-'))
 try{restoreLifeMemoryBackup(dst,pack);const gate=createLifeMemoryGateway({dataDir:dst,getAccountTag:()=>A,now:()=>NOW+5000})
  try{assert.equal(gate.recallVideoDetails(opts).ok,true);assert.equal(gate.recallVideoDetails({...opts,ownerSession:false}).ok,false)}finally{gate.close()}
 }finally{rmSync(dst,{recursive:true,force:true})}
 setTime(NOW+14*DAY);assert.equal(gateway.recallVideoDetails(opts).ok,false);assert.equal(existsSync(join(dir,detailKey)),false)
}))


test('deep attachment lock reclaims a proven dead PID but refuses live and legacy locks',()=>setup(({dir,gateway,memoryId})=>{
 const proof={internalToken:'test-only'}
 const args={memoryId,accountTag:A,fragments,sourceProof:proof}
 assert.equal(gateway.attachMemoryDetails(args).ok,true)
 const lock=join(dir,'life-memory','details','v1',A,memoryId+'.json.lock')
 const dead=Number(execFileSync(process.execPath,['-e','console.log(process.pid)'],{encoding:'utf8'}).trim())
 const old=new Date(Date.now()-120000)
 const claim=pid=>{writeFileSync(lock,JSON.stringify({pid,token:'a'.repeat(32),at:+old}));utimesSync(lock,old,old)}
 claim(process.pid);assert.equal(gateway.attachMemoryDetails(args).ok,false);assert.equal(existsSync(lock),true);rmSync(lock)
 claim(dead);assert.equal(gateway.attachMemoryDetails(args).ok,true);assert.equal(existsSync(lock),false)
 mkdirSync(lock);assert.equal(gateway.attachMemoryDetails(args).ok,false);assert.equal(existsSync(lock),true)
}))


test('owner inspection reads complete bounded attachments by source without expanding model recall budget',()=>setup(({gateway,memoryId,setTime,setAccount})=>{
 const second={...event,key:'video-explore:dev6-long-full-detail',at:NOW+1000}
 gateway.recordEvents([second]);const other=gateway.videoEvidenceTrace({accountTag:A,bvid:BV}).find(e=>e.memoryId!==memoryId).memoryId
 const many=Array.from({length:24},(_,i)=>({...fragments[0],fragmentId:'frame-'+String(i).padStart(4,'0'),timeAnchorMs:[1000+i*250,1000+i*250],content:i===23?'独特的朱红色雨伞立在门框旁。':'实际观察片段 '+i+'：'+('人物动作与暖色场景，'.repeat(45))}))
 for(const [id,parts] of [[memoryId,many],[other,fragments]])assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments:parts,sourceProof:{internalToken:'test-only'}}).ok,true)
 const args={bvid:BV,accountTag:A,visibility:'public-event'},index=gateway.inspectVideoDetails(args)
 assert.equal(index.ok,true);assert.equal(index.sources.length,2);assert.equal(index.totalFragments,25)
 const full=gateway.inspectVideoDetails({...args,sourceMemoryId:memoryId})
 assert.equal(full.fragments.length,24);assert.equal(full.truncated,false);assert.equal(full.fragments.at(-1).timeAnchorMs[0],6750)
 assert.match(full.fragments.at(-1).content,/朱红色雨伞/)
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A,maxBytes:8192}).truncated,true)
 assert.ok(gateway.visualDetailCandidates({accountTag:A,ids:[memoryId]})[0].parts.some(p=>p.note.includes('朱红色雨伞')))
 assert.equal(gateway.inspectVideoDetails({...args,visibility:'private-session',sourceMemoryId:memoryId}).ok,false)
 setAccount(B);assert.equal(gateway.inspectVideoDetails(args).ok,false);setAccount(A)
 setTime(NOW+14*DAY);assert.equal(gateway.inspectVideoDetails(args).ok,false)
}))


test('time-targeted deep recall selects earlier evidence BEFORE the model byte cap and never replays forgotten data',()=>setup(({gateway,memoryId,setAccount,setTime})=>{
 const sourceProof={internalToken:'test-only'}
 const early=[{...fragments[0],fragmentId:'early-zero',content:'最初的红色椅子。',timeAnchorMs:[0,0]},
   {...fragments[0],fragmentId:'early-twenty',content:'二十秒的蓝色杯子。',timeAnchorMs:[20000,20000]},
   {...fragments[0],fragmentId:'outside-range',content:'另一个时间的独特内容。',timeAnchorMs:[21000,21000]}]
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:early,sourceProof}).ok,true)
 gateway.recordEvents([{...event,key:'video-explore:latest-long-focus',at:NOW+1000,
  experience:{...event.experience,visualReceipt:{source:'decoded-public-video',frameCount:12,firstAtMs:98000,lastAtMs:112000}}}])
 const other=gateway.videoEvidenceTrace({accountTag:A,bvid:BV}).find(e=>e.memoryId!==memoryId).memoryId
 const late=Array.from({length:12},(_,i)=>({...fragments[0],fragmentId:'late-'+i,sourceRef:'verified:observation:late',content:('后段场景详细描述。'.repeat(139)),timeAnchorMs:[98000+i*1000,98000+i*1000]}))
 assert.equal(gateway.attachMemoryDetails({memoryId:other,accountTag:A,fragments:late,sourceProof}).ok,true)
 const opts={bvid:BV,accountTag:A,maxBytes:4096}
 const untargeted=gateway.recallVideoDetails(opts)
 assert.equal(untargeted.truncated,true);assert.ok(!untargeted.fragments.some(f=>f.fragmentId==='early-zero'))
 const targeted=gateway.recallVideoDetails({...opts,startMs:0,endMs:20000,firstObservation:true})
 assert.equal(targeted.ok,true);assert.deepEqual(targeted.requestedRangeMs,[0,20000]);assert.equal(targeted.firstCurrentObservation,true)
 assert.deepEqual(targeted.fragments.map(f=>f.fragmentId),['early-zero','early-twenty']);assert.ok(targeted.bytes<=4096)
 const all=gateway.recallVideoDetails({...opts,startMs:0,endMs:20000});assert.deepEqual(all.fragments.map(f=>f.fragmentId),['early-zero','early-twenty'])
 assert.equal(gateway.recallVideoDetails({...opts,startMs:30000,endMs:31000}).reason,'no-detail-in-time-range')
 assert.equal(gateway.recallVideoDetails({...opts,startMs:20000,endMs:0}).reason,'invalid-detail-time-range')
 assert.equal(gateway.recallVideoDetails({...opts,startMs:0}).reason,'invalid-detail-time-range')
 setAccount(B);assert.equal(gateway.recallVideoDetails({...opts,startMs:0,endMs:20000}).ok,false);setAccount(A)
 setTime(NOW+14*DAY);assert.equal(gateway.recallVideoDetails({...opts,startMs:0,endMs:20000}).ok,false)
}))

test('time-targeted recall sees a legacy appended focus outside the original parent envelope without inventing a single frame',()=>setup(({gateway,memoryId})=>{
 const review={reviewStatus:'model-observation-not-independent-semantic-proof',startMs:49000,endMs:61000,frameTimesMs:[49500,50500,60500],description:'实际采样的合并分镜描述。'}
 assert.equal(gateway.recordVerifiedFocusRevision({memoryId,accountTag:A,bvid:BV,sourceProof:{internalToken:'test-only'},sourceRef:'focus:'+'c'.repeat(32),review}).ok,true)
 const found=gateway.recallVideoDetails({bvid:BV,accountTag:A,startMs:50000,endMs:50000})
 assert.equal(found.ok,true);assert.deepEqual(found.fragments[0].timeAnchorMs,[49000,61000])
}))


test('paged deep recall returns all currently valid fragments without repeating or confusing unread evidence with forgetting',()=>setup(({gateway,memoryId,setAccount,setTime})=>{
 const proof={internalToken:'test-only'}
 const parts=Array.from({length:24},(_,i)=>({...fragments[0],fragmentId:'page-'+String(i).padStart(2,'0'),content:'片段'+i+'：'+('实际采样的画面描述。'.repeat(30)),timeAnchorMs:[i*1000,i*1000]}))
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:parts,sourceProof:proof}).ok,true)
 const opts={bvid:BV,accountTag:A,ownerSession:true,order:'earliest',maxBytes:4096}
 const first=gateway.recallVideoDetails(opts);assert.equal(first.ok,true);assert.equal(first.totalFragments,24);assert.ok(first.hasMore&&first.nextCursor);assert.ok(first.bytes<=4096)
 assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor.slice(0,-1)+'z'}).reason,'invalid-detail-cursor')
 assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor,ownerSession:false}).reason,'invalid-detail-cursor')
 assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor,startMs:0,endMs:2000}).reason,'invalid-detail-cursor')
 setAccount(B);assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor}).ok,false);setAccount(A)
 let page=first,ids=first.fragments.map(f=>f.fragmentId),calls=1
 while(page.hasMore&&calls++<30){page=gateway.recallVideoDetails({...opts,maxBytes:8192,cursor:page.nextCursor});assert.equal(page.ok,true);assert.equal(page.totalFragments,24);assert.ok(page.bytes<=8192);ids.push(...page.fragments.map(f=>f.fragmentId))}
 assert.deepEqual(ids,parts.map(f=>f.fragmentId));assert.equal(page.remainingFragments,0);assert.equal(page.hasMore,false)
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:[{...parts[0],fragmentId:'new-page-evidence',content:'new verified evidence'}],sourceProof:proof}).ok,true)
 assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor}).reason,'detail-cursor-stale')
 setTime(NOW+14*DAY);assert.equal(gateway.recallVideoDetails({...opts,cursor:first.nextCursor}).ok,false)
}))

test('oversize legacy evidence is paged as Unicode-safe text of the same observation, never skipped or split into fake times',()=>setup(({gateway,memoryId})=>{
 const content='画面𠮷🌧️描述'.repeat(1000)
 const part={...fragments[0],content,fragmentId:'long-board',timeAnchorMs:[1000,9000]}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:[part],sourceProof:{internalToken:'test-only'}}).ok,true)
 const opts={bvid:BV,accountTag:A,ownerSession:true,maxBytes:4096}
 let page=gateway.recallVideoDetails(opts),text='',offset=0,calls=0
 do{assert.equal(page.ok,true);assert.equal(page.totalFragments,1);assert.equal(page.fragments.length,1);assert.ok(page.bytes<=4096);const f=page.fragments[0];assert.equal(f.fragmentId,part.fragmentId);assert.deepEqual(f.timeAnchorMs,part.timeAnchorMs);assert.equal(f.contentCharRange[0],offset);offset=f.contentCharRange[1];text+=f.content;assert.ok(++calls<30);if(!page.hasMore)break;page=gateway.recallVideoDetails({...opts,cursor:page.nextCursor})}while(true)
 assert.equal(text,content);assert.equal(offset,Array.from(content).length);assert.equal(page.remainingFragments,0)
}))


test('paged deep recall continues beyond twelve observation sources and keeps the total accurate',()=>setup(({gateway,memoryId})=>{
 const proof={internalToken:'test-only'}
 const attach=id=>assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments:[{...fragments[0],content:'本次真实观察。'}],sourceProof:proof}).ok,true)
 attach(memoryId)
 for(let i=0;i<13;i++){
  gateway.recordEvents([{...event,key:'video-explore:page-source-'+i,at:NOW+1000+i}])
  attach(gateway.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId)
 }
 const opts={bvid:BV,accountTag:A,ownerSession:true,maxBytes:12288}
 const first=gateway.recallVideoDetails(opts);assert.equal(first.totalFragments,14);assert.equal(first.sources.length,12);assert.equal(first.remainingFragments,2);assert.ok(first.nextCursor)
 const second=gateway.recallVideoDetails({...opts,cursor:first.nextCursor});assert.equal(second.sources.length,2);assert.equal(second.remainingFragments,0);assert.equal(second.hasMore,false)
 assert.equal(new Set([...first.fragments,...second.fragments].map(f=>f.memoryId)).size,14)
 assert.ok(JSON.stringify(first).length<16000)
}))


test('release compatibility: more than 100 verified deep attachments can be exported, restored and reopened without losing grouped observation identities',()=>setup(({dir,gateway,memoryId})=>{
 const events=Array.from({length:100},(_,i)=>({...event,key:'video-explore:release-compat-'+i,at:NOW+i+1}))
 assert.equal(gateway.recordEvents(events).added,100)
 const root=JSON.parse(readFileSync(gateway.file,'utf8')).episodes.find(e=>e.id===memoryId)
 assert.equal(root.visualObservations.length,100)
 const ids=[memoryId,...root.visualObservations.map(e=>e.id)]
 for(const id of ids)assert.equal(gateway.attachMemoryDetails({memoryId:id,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}}).ok,true)
 const bundle=createLifeMemoryBackup(dir)
 assert.equal(Object.keys(bundle.files).filter(name=>name.startsWith('life-memory/details/v1/')).length,101)
 const dest=mkdtempSync(join(tmpdir(),'detail-release-upgrade-'))
 try{
  restoreLifeMemoryBackup(dest,bundle)
  const reopened=createLifeMemoryGateway({dataDir:dest,getAccountTag:()=>A,now:()=>NOW+5000})
  try{
   assert.equal(reopened.status().nestedVisualObservations,100)
   assert.equal(reopened.status().details.attachments,101)
   for(const id of ids)assert.equal(reopened.expandMemoryDetail({memoryId:id,accountTag:A}).ok,true)
   assert.equal(reopened.expandMemoryDetail({memoryId:ids.at(-1),accountTag:B}).ok,false)
  }finally{reopened.close()}
 }finally{rmSync(dest,{recursive:true,force:true})}
}))

// dev.16: verify the durable parent+detail transaction through real files,
// not a fabricated successful return from the storage layer.
test('fresh verified observation and pending detail survive restart, account switch and backup refusal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'detail-transaction-'));let account=A,clock=NOW+5000
 const options={dataDir:dir,getAccountTag:()=>account,now:()=>clock,admitMemoryDetails:({episode,sourceProof})=>sourceProof?.internalToken==='test-only'&&episode.accountTag===account,logger:{warn(){}}}
 let g=createLifeMemoryGateway(options)
 try{
  const {createHash}=await import('node:crypto')
  const fresh={...event,key:'video-explore:dev16-fresh-transaction',visualObservationState:'fresh'}
  const id='e-'+createHash('sha256').update(fresh.key).digest('hex').slice(0,18)
  const folder=join(dir,'life-memory','details','v1',A),lock=join(folder,id+'.json.lock');mkdirSync(folder,{recursive:true})
  writeFileSync(lock,JSON.stringify({pid:process.pid,token:'a'.repeat(32),at:Date.now()}))
  const old=createLifeMemoryBackup(dir)
  const coordinator=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:g,getAccountTag:()=>account,now:()=>clock,lifeReflection:{addEvents:()=>({ok:true})},logger:{warn(){}}})
  const stored=await coordinator.recordEvents([fresh],{detailAdmission:{fragments,sourceProof:{internalToken:'test-only'}}})
  assert.equal(stored.ok,true);assert.equal(stored.detailWrite.pending,true)
  const snapshot=JSON.parse(readFileSync(g.file,'utf8'))
  assert.equal(snapshot.pendingVisualDetails.length,1);assert.equal(snapshot.pendingVisualDetails[0].memoryId,id)
  assert.equal(g.videoEvidenceTrace({accountTag:A,bvid:BV})[0].memoryId,id)
  assert.equal(g.expandMemoryDetail({memoryId:id,accountTag:A}).ok,false)
  assert.equal(g.recallVideoDetails({bvid:BV,accountTag:A,startMs:1000,endMs:9000}).reason,'detail-write-pending')
  assert.equal(g.inspectVideoDetails({bvid:BV,accountTag:A,visibility:'public-event',sourceMemoryId:id}).reason,'detail-write-pending')
  assert.deepEqual(g.visualDetailCandidates({accountTag:A,ids:[id]}),[])
  assert.equal(g.memoryDetailInfo({memoryId:id,accountTag:A}).available,false)
  assert.throws(()=>createLifeMemoryBackup(dir),/待写记录/)
  assert.throws(()=>collectBackupFiles(dir),/待写记录/)
  assert.throws(()=>restoreLifeMemoryBackup(dir,old),/待写记录/)
  assert.doesNotMatch(readFileSync(coordinator.file,'utf8'),/frame-0001|internalToken/,'proof and detailed source must not enter event outbox')
  g.close();account=B;rmSync(lock);g=createLifeMemoryGateway(options)
  assert.equal(g.recoverPendingVisualDetails().pending,1);assert.equal(g.expandMemoryDetail({memoryId:id,accountTag:B}).ok,false)
  account=A;assert.equal(g.recoverPendingVisualDetails().pending,0)
  const deep=g.expandMemoryDetail({memoryId:id,accountTag:A});assert.equal(deep.ok,true);assert.equal(deep.totalFragments,1)
  assert.equal(g.recordEvents([fresh]).added,0);assert.equal(g.recoverPendingVisualDetails().pending,0)
  assert.equal(createLifeMemoryBackup(dir).files[`life-memory/details/v1/${A}/${id}.json`].includes('frame-0001'),true)
 }finally{g.close();rmSync(dir,{recursive:true,force:true})}
})

test('process exit immediately after atomic deep replacement recovers the exact shallow revision once',()=>setup(({dir,gateway,memoryId})=>{
 const {status}=(()=>{try{
  const moduleUrl=new URL('../lib/life-memory-gateway.mjs',import.meta.url).href
  const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {createLifeMemoryGateway} from ${JSON.stringify(moduleUrl)};const [dir,id]=process.argv.slice(1);const g=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>${JSON.stringify(A)},now:()=>${NOW+5000},admitMemoryDetails:()=>true,logger:{warn(){}}});const orig=fs.renameSync;fs.renameSync=(a,b)=>{orig(a,b);if(String(b).endsWith(id+'.json'))process.exit(71)};syncBuiltinESMExports();g.recordVerifiedFocusRevision({memoryId:id,accountTag:${JSON.stringify(A)},bvid:${JSON.stringify(BV)},sourceProof:{},sourceRef:'focus:'+'e'.repeat(32),review:{reviewStatus:'model-observation-not-independent-semantic-proof',startMs:1000,endMs:8000,frameTimesMs:[3000],description:'已核验局部观察'}});process.exit(72);`
  execFileSync(process.execPath,['--input-type=module','-e',code,dir,memoryId]);return {status:0}
 }catch(error){return error}})()
 assert.equal(status,71,'child must exit at actual attachment replacement')
 const folder=join(dir,'life-memory','details','v1',A),detailFile=join(folder,memoryId+'.json')
 assert.equal(JSON.parse(readFileSync(detailFile,'utf8')).fragments.length,1)
 const pending=JSON.parse(readFileSync(gateway.file,'utf8'));assert.equal(pending.pendingVisualDetails.length,1)
 assert.equal(pending.episodes[0].focusRevision,undefined)
 // Age only locks of the known exited child; exercise real dead-owner reclaim.
 for(const lock of [gateway.file+'.lock',detailFile+'.lock']){assert.ok(existsSync(lock));utimesSync(lock,new Date(Date.now()-60_000),new Date(Date.now()-60_000))}
 const reopened=createLifeMemoryGateway({dataDir:dir,now:()=>NOW+5000,getAccountTag:()=>A,logger:{warn(){}}})
 try{
  assert.equal(reopened.recoverPendingVisualDetails().pending,0)
  assert.equal(reopened.expandMemoryDetail({memoryId,accountTag:A}).totalFragments,1)
  assert.equal(JSON.parse(readFileSync(reopened.file,'utf8')).episodes[0].focusRevision.version,1)
  assert.equal(reopened.recoverPendingVisualDetails().pending,0)
  assert.equal(JSON.parse(readFileSync(reopened.file,'utf8')).episodes[0].focusRevision.version,1)
 }finally{reopened.close()}
}))

test('pending deep evidence is revoked on fading, never replayed from an older backup',()=>setup(({dir,gateway,memoryId,setTime})=>{
 const old=createLifeMemoryBackup(dir),folder=join(dir,'life-memory','details','v1',A),lock=join(folder,memoryId+'.json.lock')
 mkdirSync(folder,{recursive:true});writeFileSync(lock,JSON.stringify({pid:process.pid,token:'a'.repeat(32),at:Date.now()}))
 const result=gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:{internalToken:'test-only'}})
 assert.equal(result.pending,true)
 setTime(NOW+14*DAY);assert.equal(gateway.recoverPendingVisualDetails().pending,0)
 rmSync(lock);assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
 restoreLifeMemoryBackup(dir,old);assert.equal(gateway.recoverPendingVisualDetails().pending,0)
 assert.equal(gateway.expandMemoryDetail({memoryId,accountTag:A}).ok,false)
 assert.equal(gateway.status().details.attachments,0)
}))

test('conflicting fragment identities are rejected before staging; a forged fresh admission cannot create pending evidence',()=>setup(({gateway,memoryId})=>{
 const proof={internalToken:'test-only'}
 assert.equal(gateway.attachMemoryDetails({memoryId,accountTag:A,fragments,sourceProof:proof}).ok,true)
 const conflict=gateway.attachMemoryDetails({memoryId,accountTag:A,fragments:[{...fragments[0],content:'不同的证据'}],sourceProof:proof})
 assert.equal(conflict.ok,false);assert.equal(gateway.recoverPendingVisualDetails().pending,0)
 const bad={...event,key:'video-explore:forged-admission',visualObservationState:'fresh'}
 assert.equal(gateway.recordEvents([bad],{detailAdmission:{fragments,sourceProof:{internalToken:'forged'}}}).detailWrite.ok,false)
 assert.equal(gateway.recoverPendingVisualDetails().pending,0);assert.equal(gateway.status().details.attachments,1)
}))
