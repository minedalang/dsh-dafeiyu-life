import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createCommentInteract} from '../lib/comment-interact.mjs'
const BV='BV1abcdEFG12'
const home=fn=>{const dir=mkdtempSync(join(tmpdir(),'dev3-side-hot-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
async function scenario(dir){
 const now=Date.now(),sent=[],incoming=[],cfg={watchReplies:true,watchTop:false,watchAt:false,allowGeneralReplies:true,sideHotEnabled:true,replyPerPoll:1,replyPerDay:5,globalDailyLimit:20,topCount:12}
 let readHot=0
 const event=id=>({user:{mid:123,uname:'观众'},item:{business_id:1,subject_id:987,source_id:id,root_id:777,uri:`https://www.bilibili.com/video/${BV}`,source_content:'大肥鱼你怎么看？',source_time:Math.floor(now/1000)}})
 const create=()=>createCommentInteract({dataDir:dir,selfUid:async()=>'900',getConfig:()=>cfg,now:()=>now,
   getNotifications:async()=>({data:{items:incoming}}),getOwnComments:async()=>({top:['777'],nested:[]}),
   getVideos:async()=>[],getComments:async()=>{readHot++;return {comments:[{rpid:'800',mid:333,content:'感觉音乐很舒服',ctime:Math.floor(now/1000)}]}},
   getVideoContext:async()=>({text:'真实视频信息；评论区',usable:true,counts:{hotProvided:0}}),
   generateReply:async()=> '哈哈，确实有意思',send:async args=>(sent.push(args),{ok:true,rpid:String(9000+sent.length)}),
   logger:{warn(){},error(){}}})
 return {cfg,incoming,sent,event,create,readHot:()=>readHot}
}
test('after a confirmed reply, a distinct real hot comment is available next round without all-video patrol',()=>home(async dir=>{
 const x=await scenario(dir)
 assert.equal((await x.create().poll()).sent,0)
 x.incoming.push(x.event('700'))
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.sent[0].rpid,'700')
 const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(state.sideHotQueue.length,1)
 assert.equal(state.sideHotQueue[0].bvid,BV)
 assert.equal(state.sideHotQueue[0].rpid,'800')
 assert.equal((await x.create().poll()).sent,1)
 assert.equal(x.sent[1].rpid,'800')
 assert.equal(x.sent[1].bvid,BV)
 assert.equal((await x.create().poll()).sent,0)
}))
test('disabling side-hot never sends queued incidental replies',()=>home(async dir=>{
 const x=await scenario(dir)
 await x.create().poll();x.incoming.push(x.event('701'))
 assert.equal((await x.create().poll()).sent,1)
 x.cfg.sideHotEnabled=false
 assert.equal((await x.create().poll()).sent,0)
 assert.equal(x.sent.length,1)
}))
test('a failed original notification send does not create a hot-reply opportunity',()=>home(async dir=>{
 const x=await scenario(dir)
 await x.create().poll();x.incoming.push(x.event('702'))
 const engine=createCommentInteract({dataDir:dir,selfUid:async()=>'900',getConfig:()=>x.cfg,now:Date.now,
   getNotifications:async()=>({data:{items:x.incoming}}),getOwnComments:async()=>({top:['777'],nested:[]}),
   getVideoContext:async()=>({text:'真实信息',usable:true}),generateReply:async()=> '哈哈',
   send:async()=>({ok:false,error:'平台失败'}),getComments:async()=>{throw Error('must not browse hot')},
   logger:{warn(){},error(){}}})
 assert.equal((await engine.poll()).sent,0)
 const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
 assert.equal(state.sideHotQueue.length,0)
}))
