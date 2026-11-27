import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,utimesSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {addLifeVideoGallery,listLifeVideoGallery,recentLifeObservations,readLifeVideoGalleryImage,pruneLifeVideoGallery,pruneAllLifeVideoGalleries} from '../lib/life-video-gallery.mjs'
const tag='a'.repeat(16),bvid='BV1pXHK6mE6z',now=1771750800000
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9])
test('相册仅保存真实 JPG、账号隔离、精确在12小时失效',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-gallery-'))
 try{
  const captureId='b'.repeat(32),captureDir=join(root,'vision-perception-captures',captureId)
  mkdirSync(captureDir,{recursive:true});writeFileSync(join(captureDir,'storyboard-01.jpg'),jpeg)
  const captures=[{id:captureId,kind:'storyboard',images:[{file:'storyboard-01.jpg',times:[1,2],resolution:'官方低清拼图',gridCols:2,gridRows:1}]}]
  assert.equal(addLifeVideoGallery(root,{account:tag,bvid,captures,verified:false,at:now}).ok,false)
  const saved=addLifeVideoGallery(root,{account:tag,bvid,captures,verified:true,at:now,analysis:'R1C1 [00:01]：真实模型描述。',memoryWrite:{status:'recorded',detailStatus:'recorded',privateField:'never expose'}})
  assert.equal(saved.ok,true)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000}).length,1)
  const projection=recentLifeObservations(root,tag,{bvid,now:now+1000});assert.equal(projection.rows.length,1);assert.equal(projection.imagesIncluded,false);assert.equal(projection.rows[0].images[0].times[0],1);assert.doesNotMatch(JSON.stringify(projection),/真实模型描述|never expose/);assert.equal(recentLifeObservations(root,'c'.repeat(16),{now:now+1000}).rows.length,0);assert.equal(recentLifeObservations(root,tag,{now:now+12*3600_000}).rows.length,0)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000})[0].images[0].gridCols,2)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000})[0].analysis,'R1C1 [00:01]：真实模型描述。')
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000})[0].memoryWrite.detailStatus,'recorded')
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000})[0].memoryWrite.privateField,undefined)
  const file=listLifeVideoGallery(root,tag,{now:now+1000})[0].images[0].file
  assert.deepEqual(readLifeVideoGalleryImage(root,tag,saved.id,file,{now:now+1000}),jpeg)
  const focusId='d'.repeat(32),groupId='e'.repeat(32)
  mkdirSync(join(root,'vision-perception-captures',focusId),{recursive:true})
  writeFileSync(join(root,'vision-perception-captures',focusId,'focus-00.jpg'),jpeg)
  const related=addLifeVideoGallery(root,{account:tag,bvid,verified:true,groupId,phase:'focus',at:now+2000,
    captures:[{id:focusId,kind:'focus',images:[{file:'focus-00.jpg',times:[18],resolution:'原视频实际局部'}]}]})
  assert.equal(related.ok,true)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+3000}).find(x=>x.id===related.id)?.groupId,groupId)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+3000}).find(x=>x.id===related.id)?.phase,'focus')
  assert.equal(listLifeVideoGallery(root,'c'.repeat(16),{now:now+1000}).length,0)
  assert.deepEqual(readLifeVideoGalleryImage(root,tag,saved.id,file,{now:now+12*3600_000-1}),jpeg)
  assert.equal(readLifeVideoGalleryImage(root,tag,saved.id,file,{now:now+12*3600_000}),null)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+12*3600_000}).some(x=>x.id===saved.id),false)
  pruneAllLifeVideoGalleries(root,{now:now+12*3600_000})
  assert.equal(existsSync(join(root,'life-video-gallery',tag,saved.id)),false)
 }finally{rmSync(root,{recursive:true,force:true})}
})

import {planOwnerGalleryRevisit,matchOwnerGalleryMemory} from '../lib/owner-video-revisit.mjs'
test('dev.6 owner focus requires matching account gallery and exact captured frame time',()=>{
 const row={id:'c'.repeat(32),bvid,verified:true,at:now,images:[{file:'storyboard-00.jpg',times:[4,12.5]}]}
 const args={row,account:tag,bvid,mode:'frame',atSeconds:12.5,imageFile:'storyboard-00.jpg',durationSeconds:150,now:now+1000}
 assert.equal(planOwnerGalleryRevisit(args).ok,true)
 assert.equal(planOwnerGalleryRevisit({...args,atSeconds:13}).reason,'frame-not-in-gallery')
 assert.equal(planOwnerGalleryRevisit({...args,imageFile:'../../bad.jpg'}).reason,'frame-not-in-gallery')
 assert.equal(planOwnerGalleryRevisit({...args,account:'invalid'}).reason,'gallery-unavailable')
 assert.equal(planOwnerGalleryRevisit({...args,now:now+12*3600_000-1}).ok,true)
 assert.equal(planOwnerGalleryRevisit({...args,now:now+12*3600_000}).reason,'gallery-unavailable')
 assert.equal(planOwnerGalleryRevisit({...args,mode:'time',atSeconds:149,imageFile:''}).ok,true)
 assert.equal(planOwnerGalleryRevisit({...args,mode:'time',atSeconds:151}).reason,'time-out-of-range')
 const hourLong={...args,durationSeconds:3600,mode:'time',atSeconds:3000,imageFile:''}
 assert.equal(planOwnerGalleryRevisit(hourLong).ok,true,'45 minutes must not block 60-minute video')
 assert.equal(planOwnerGalleryRevisit({...hourLong,atSeconds:3601}).reason,'time-out-of-range')
 assert.equal(planOwnerGalleryRevisit({...hourLong,durationSeconds:14401}).reason,'unverified-video-target')
 assert.equal(planOwnerGalleryRevisit({...hourLong,mode:'frame'}).reason,'frame-not-in-gallery',
   'arbitrary time cannot impersonate a previously verified frame')

 const chosenId='e-'+'a'.repeat(18)
 const selected=matchOwnerGalleryMemory([{memoryId:chosenId,bvid,at:now+1500},{memoryId:'e-'+'b'.repeat(18),bvid,at:now}],{bvid,memoryId:chosenId})
 assert.equal(selected,chosenId)
 assert.equal(matchOwnerGalleryMemory([{memoryId:chosenId,bvid,at:now}],{bvid,at:now}),null)
 assert.equal(matchOwnerGalleryMemory([{memoryId:'e-'+'a'.repeat(18),bvid,at:now},
  {memoryId:'e-'+'b'.repeat(18),bvid,at:now+20}],{bvid,at:now}),null)
})

import {pruneVideoCaches,VIDEO_CACHE_RETENTION} from '../lib/video-cache-retention.mjs'
test('expired cache sweep physically deletes only recognized artifacts and uses active media root',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-cache-retention-'))
 const media=join(root,'runtime-media-v2'),H=3600_000
 const put=(path,age,body='test')=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,body);utimesSync(path,(now-age)/1000,(now-age)/1000);return path}
 try{
  const staleASR=put(join(media,'asr-transcript-cache',bvid+'-small-auto-v1.json'),0,JSON.stringify({createdAt:(now-7*24*H)/1000}))
  const freshASR=put(join(media,'asr-transcript-cache',bvid+'-base-auto-v1.json'),6*24*H)
  const staleVision=put(join(media,'vision-cache',bvid+'-adaptive-v9-focus.json'),24*H)
  const freshVision=put(join(media,'vision-cache',bvid+'.json'),23*H)
  const stage=put(join(media,'vision-cache','.'+bvid+'-'+ 'a'.repeat(32)+'.tmp'),25*H)
  const asrStage=put(join(media,'asr-transcript-cache',bvid+'-small-auto-v1.json.123.tmp'),25*H)
  const audio=put(join(media,'tmp','asr',bvid+'-deadbeef.sample1.wav'),24*H)
  const active=put(join(media,'tmp','asr',bvid+'-cafebabe.m4a.part'),H)
  const retained=put(join(root,'vision-cache',bvid+'.json'),48*H)
  const unknown=put(join(media,'vision-cache','user.json'),48*H)
  const memory=put(join(root,'life-memory','memory.json'),100*H)
  const model=put(join(root,'.hf-cache','model.bin'),100*H)
  const capture=join(root,'vision-perception-captures','a'.repeat(32));put(join(capture,'focus-00.jpg'),H);utimesSync(capture,(now-H)/1000,(now-H)/1000)
  const scene=join(root,'tmp','vision','dafeiyu-scene-123');put(join(scene,'part.mp4'),25*H);utimesSync(scene,(now-25*H)/1000,(now-25*H)/1000)
  const activeScene=join(root,'tmp','vision','dafeiyu-scene-active');put(join(activeScene,'part.mp4'),H);utimesSync(activeScene,(now-25*H)/1000,(now-25*H)/1000)
  const proof=put(join(root,'vision-proof','c'.repeat(32)+'.yml'),25*H)
  const result=pruneVideoCaches(root,{now,resolveMedia:()=>media})
  assert.deepEqual(result,{removed:8,failed:0,skipped:0})
  for(const file of [staleASR,staleVision,stage,asrStage,audio,capture,scene,proof])assert.equal(existsSync(file),false,file)
  for(const file of [freshASR,freshVision,active,retained,unknown,memory,model,activeScene])assert.equal(existsSync(file),true,file)
  assert.equal(pruneVideoCaches(root,{now,resolveMedia:()=>media}).removed,0)
  assert.equal(VIDEO_CACHE_RETENTION.interval,15*60_000)
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('unsafe cache directory is skipped independently and retried after repair',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-cache-link-'))
 try{
  const media=join(root,'media'),outside=join(root,'outside');mkdirSync(media);mkdirSync(outside)
  const target=join(outside,bvid+'.json');writeFileSync(target,'private');utimesSync(target,0,0)
  try{symlinkSync(outside,join(media,'vision-cache'),'junction')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  const asr=join(media,'asr-transcript-cache');mkdirSync(asr);const old=join(asr,bvid+'-small-auto-v1.json');writeFileSync(old,'{}');utimesSync(old,0,0)
  const result=pruneVideoCaches(root,{now,resolveMedia:()=>media})
  assert.equal(result.failed,1);assert.equal(result.removed,1);assert.equal(existsSync(target),true)
  assert.equal(pruneVideoCaches(root,{now,resolveMedia:()=>{throw Error('offline disk')}}).failed,1)
  rmSync(join(media,'vision-cache'));mkdirSync(join(media,'vision-cache'));const expired=join(media,'vision-cache',bvid+'.json');writeFileSync(expired,'{}');utimesSync(expired,0,0)
  assert.equal(pruneVideoCaches(root,{now,resolveMedia:()=>media}).removed,1)
  assert.equal(existsSync(target),true)
 }finally{rmSync(root,{recursive:true,force:true})}
})


test('gallery binds frame captions only to one exact verified storyboard receipt in the same observation',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-frame-result-'))
 try{
  const id='c'.repeat(32),dir=join(root,'vision-perception-captures',id);mkdirSync(dir,{recursive:true})
  writeFileSync(join(dir,'storyboard-01.jpg'),jpeg);writeFileSync(join(dir,'storyboard-02.jpg'),jpeg)
  const images=[{file:'storyboard-01.jpg',times:[0,5.5],gridCols:2,gridRows:1},{file:'storyboard-02.jpg',times:[10,15.5],gridCols:2,gridRows:1}]
  const captures=[{id,kind:'storyboard',images}]
  const first={index:1,status:'analyzed',times:[0,5.5],gridCols:2,gridRows:1,description:'R1C1 [00:00]：真实第一格。\nR1C2 [00:05]：真实第二格。'}
  const second={index:2,status:'analyzed',times:[10,15.5],gridCols:2,gridRows:1,description:'R1C1 [00:10]：第二板第一格。\nR1C2 [00:15]：第二板第二格。'}
  const put=receipts=>{const result=addLifeVideoGallery(root,{account:tag,bvid,captures,verified:true,at:now,boardReceipts:receipts});assert.ok(result.ok);return listLifeVideoGallery(root,tag,{now}).find(r=>r.id===result.id)}
  const verified=put([second,first]);assert.deepEqual(verified.images[0].frameDescriptions.map(x=>x.text),['真实第一格。','真实第二格。']);assert.equal(verified.images[1].frameDescriptions[1].text,'第二板第二格。')
  for(const receipts of [[{...first,times:[0,5]}],[{...first,description:'R1C1 [00:00]：不完整'}],[first,first],[{...first,gridRows:2}],[]])assert.equal(put(receipts).images[0].frameDescriptions,undefined)
  assert.equal(listLifeVideoGallery(root,'a'.repeat(15)+'b',{now}).length,0)
 }finally{rmSync(root,{recursive:true,force:true})}
})

import {readLifeObservationFrame,prepareLifeObservationAttachment,lifeObservationShareSelection} from '../lib/life-video-gallery.mjs'
test('dev40 cached bytes and explicit host attachment are distinct; expiry, account and stale owner guarded',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-frame40-'))
 try{const cid='b'.repeat(32),folder=join(root,'vision-perception-captures',cid);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'storyboard-01.jpg'),jpeg)
 const saved=addLifeVideoGallery(root,{account:tag,bvid,verified:true,at:now,captures:[{id:cid,kind:'storyboard',images:[{file:'storyboard-01.jpg',times:[1,2],resolution:'fixture'}]}]});assert.equal(saved.ok,true)
 const file=recentLifeObservations(root,tag,{now}).rows[0].images[0].file,choice={id:saved.id,file,now}
 const frame=readLifeObservationFrame(root,tag,choice);assert.deepEqual(frame.bytes,jpeg);assert.equal(frame.receipt.newVisualInference,false);assert.equal(readLifeObservationFrame(root,'c'.repeat(16),choice).ok,false);assert.equal(readLifeObservationFrame(root,tag,{...choice,now:now+43200000}).ok,false);assert.equal(readLifeObservationFrame(root,tag,{...choice,file:'../a.jpg'}).ok,false)
 assert.match(lifeObservationShareSelection(frame).marker,/^\[observation-image:[a-f0-9]{64}\]$/)
 let live=true,saves=0,vision=true;const agent={session:{requestHeader:()=>({config:{provider:'fixture',model:'vision'}})}};const ref={attachmentId:'fixture',mediaType:'image/jpeg',bytes:4,width:1,height:1};const opts={frame,agent,exec:{agent},isCurrent:()=>live,getService:n=>n==='llm'?{resolveModelInfo:async()=>({inputModalities:vision?['image']:['text']})}:{saveImages:async images=>{saves++;assert.deepEqual(images[0].data,jpeg);return [ref]}}}
 assert.equal((await prepareLifeObservationAttachment({...opts,exec:{agent:{}}})).ok,false);vision=false;assert.equal((await prepareLifeObservationAttachment(opts)).ok,false);assert.equal(saves,0);vision=true;const r=await prepareLifeObservationAttachment(opts);assert.equal(r.ok,true);assert.equal(r.deliveryConfirmed,false);assert.deepEqual(r.attachment,ref);live=false;assert.equal((await prepareLifeObservationAttachment(opts)).ok,false);assert.equal(saves,1)
 }finally{rmSync(root,{recursive:true,force:true})}
})
