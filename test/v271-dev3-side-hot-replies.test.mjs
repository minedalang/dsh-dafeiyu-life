import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createCommentInteract} from '../lib/comment-interact.mjs'
const BV='BV1abcdEFG12'
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'legacy-side-hot-retired-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
async function scenario(dir){
 const now=Date.now(),sent=[],incoming=[],cfg={watchReplies:true,watchTop:false,watchAt:false,allowGeneralReplies:true,
   sideHotEnabled:true,replyPerPoll:1,replyPerDay:5,globalDailyLimit:20,topCount:12}
 let readHot=0
 const event=id=>({user:{mid:123,uname:'观众'},item:{business_id:1,subject_id:987,source_id:id,root_id:777,
   uri:`https://www.bilibili.com/video/${BV}`,source_content:'大肥鱼你怎么看？',source_time:Math.floor(now/1000)}})
 const create=()=>createCommentInteract({dataDir:dir,selfUid:async()=>'900',getConfig:()=>cfg,now:()=>now,
   getNotifications:async()=>({data:{items:incoming}}),getOwnComments:async()=>({top:['777'],nested:[]}),
   getVideos:async()=>[],getComments:async()=>{readHot++;return {comments:[{rpid:'800',mid:333,content:'感觉音乐很舒服',time:Math.floor(now/1000)}]}},
   getVideoContext:async()=>({text:'真实视频信息；评论区',usable:true,verifiedVideo:{bvid:BV,title:'真实作品'}}),
   generateReply:async()=> '哈哈，确实有意思',send:async args=>(sent.push(args),{ok:true,rpid:String(9000+sent.length)}),
   logger:{warn(){},error(){}}})
 return {cfg,incoming,sent,event,create,readHot:()=>readHot}
}
test('old side-hot toggle is ignored: a confirmed ordinary reply does not auto-read or auto-reply unrelated threads',()=>home(async dir=>{
 const x=await scenario(dir)
 await x.create().poll();x.incoming.push(x.event('700'))
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.readHot(),0)
 assert.equal((await x.create().poll()).sent,0)
 assert.equal(x.sent.length,1)
 const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(state.sideHotQueue,undefined)
 assert.equal(state.lifeSelectedQueue.length,0)
}))
test('old toggle cannot authorize side replies; only Life-selected same-BV comments can be queued',()=>home(async dir=>{
 const x=await scenario(dir)
 await x.create().poll()
 x.cfg.sideHotEnabled=false
 const result=await x.create().offerLifeSelectedDiscussion({bvid:BV,accountUid:'900',sourceId:'intention:'+'a'.repeat(24)+':discussion',
   comments:[{rpid:'800',mid:'333',content:'感觉音乐很舒服',time:Math.floor(Date.now()/1000)}]})
 assert.equal(result.ok,true)
 assert.equal(result.queued,1)
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.sent[0].rpid,'800')
}))
test('a failed ordinary reply cannot register an optional Life continuation or fetch extra hot comments',()=>home(async dir=>{
 const x=await scenario(dir)
 await x.create().poll();x.incoming.push(x.event('702'))
 const writes=[],reads=[]
 const engine=createCommentInteract({dataDir:dir,selfUid:async()=>'900',getConfig:()=>x.cfg,now:Date.now,
   getNotifications:async()=>({data:{items:x.incoming}}),getOwnComments:async()=>({top:['777'],nested:[]}),
   getVideoContext:async()=>({text:'真实信息',usable:true,verifiedVideo:{bvid:BV,title:'真实作品'}}),
   onConfirmedVideoReply:async data=>writes.push(data),generateReply:async()=> '哈哈',
   send:async()=>({ok:false,error:'平台失败'}),getComments:async()=>reads.push(1),
   logger:{warn(){},error(){}}})
 assert.equal((await engine.poll()).sent,0)
 assert.equal(writes.length,0)
 assert.equal(reads.length,0)
 const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(state.lifeSelectedQueue.length,0)
}))
