import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
const uid='210228238',bv='BV1abc234567',now=Date.parse('2026-11-03T15:00:00Z')
const cfg=()=>({masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,
 socialOutreachDailyLimit:5,dmOwnerUid:uid,friendDirectory:JSON.stringify([{uid,dm:true,recommend:'both'}])})
const run=async(selected)=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-fact-share-'));let sends=0
 try{
   writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,sent:[],items:[{
     id:'life-share:'+uid+':'+bv,uid,bvid:bv,title:'他人的公开视频',type:'interest-share',
     text:'我想分享这条公开的视频：https://www.bilibili.com/video/'+bv,status:'draft',sourceAt:now}]}))
   const engine=createSocialIntentEngine({dataDir:dir,getConfig:cfg,now:()=>now,
     getSelectedVideos:()=>selected?[{picked:true,bvid:bv,day:'2026-11-03'}]:[],
     invokeModel:async()=>'',sendMessage:async()=>{sends++;return {ok:true}}})
   const result=await engine.send('life-share:'+uid+':'+bv,{confirm:true})
   return {result,sends}
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('真实近期选片允许自然分享本人选中过的BV，不把选择说成投稿',async()=>{
 const {result,sends}=await run(true);assert.equal(result.status,'sent');assert.equal(sends,1)
})
test('没有当前选片证据的旧草稿链接不自动发送，也不会占用远端发送回执',async()=>{
 const {result,sends}=await run(false);assert.equal(result.ok,false);assert.equal(sends,0);assert.match(result.error,/来源|核验/)
})
