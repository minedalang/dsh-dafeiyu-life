import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {addLifeVideoGallery,listLifeVideoGallery,readLifeVideoGalleryImage,pruneLifeVideoGallery,pruneAllLifeVideoGalleries} from '../lib/life-video-gallery.mjs'
const tag='a'.repeat(16),bvid='BV1pXHK6mE6z',now=1771750800000
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9])
test('相册仅保存真实 JPG、账号隔离、过24小时失效',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-gallery-'))
 try{
  const captureId='b'.repeat(32),captureDir=join(root,'vision-perception-captures',captureId)
  mkdirSync(captureDir,{recursive:true});writeFileSync(join(captureDir,'storyboard-01.jpg'),jpeg)
  const captures=[{id:captureId,kind:'storyboard',images:[{file:'storyboard-01.jpg',times:[1,2],resolution:'官方低清拼图',gridCols:2,gridRows:1}]}]
  assert.equal(addLifeVideoGallery(root,{account:tag,bvid,captures,verified:false,at:now}).ok,false)
  const saved=addLifeVideoGallery(root,{account:tag,bvid,captures,verified:true,at:now})
  assert.equal(saved.ok,true)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000}).length,1)
  assert.equal(listLifeVideoGallery(root,tag,{now:now+1000})[0].images[0].gridCols,2)
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
  assert.equal(readLifeVideoGalleryImage(root,tag,saved.id,file,{now:now+86400_000}),null)
  pruneAllLifeVideoGalleries(root,{now:now+86400_000})
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
 assert.equal(planOwnerGalleryRevisit({...args,now:now+86400_000}).reason,'gallery-unavailable')
 assert.equal(planOwnerGalleryRevisit({...args,mode:'time',atSeconds:149,imageFile:''}).ok,true)
 assert.equal(planOwnerGalleryRevisit({...args,mode:'time',atSeconds:151}).reason,'time-out-of-range')
 const hourLong={...args,durationSeconds:3600,mode:'time',atSeconds:3000,imageFile:''}
 assert.equal(planOwnerGalleryRevisit(hourLong).ok,true,'45 minutes must not block 60-minute video')
 assert.equal(planOwnerGalleryRevisit({...hourLong,atSeconds:3601}).reason,'time-out-of-range')
 assert.equal(planOwnerGalleryRevisit({...hourLong,durationSeconds:14401}).reason,'unverified-video-target')
 assert.equal(planOwnerGalleryRevisit({...hourLong,mode:'frame'}).reason,'frame-not-in-gallery',
   'arbitrary time cannot impersonate a previously verified frame')

 const selected=matchOwnerGalleryMemory([{memoryId:'e-'+'a'.repeat(18),bvid,at:now+1500}],{bvid,at:now})
 assert.equal(selected,'e-'+'a'.repeat(18))
 assert.equal(matchOwnerGalleryMemory([{memoryId:'e-'+'a'.repeat(18),bvid,at:now},
  {memoryId:'e-'+'b'.repeat(18),bvid,at:now+20}],{bvid,at:now}),null)
})
