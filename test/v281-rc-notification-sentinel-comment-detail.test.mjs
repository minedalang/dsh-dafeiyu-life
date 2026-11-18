import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCommentInteract} from '../lib/comment-interact.mjs'

test('@/点赞计数单独增加时不读取评论回复列表或无关的本人评论归属数据',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-comment-sentinel-'));let ownCommentLookups=0,replyListLookups=0,atLookups=0
  const comments=createCommentInteract({dataDir:dir,now:()=>1_800_000_000_000,logger:{warn(){},error(){}},
    getConfig:()=>({masterEnabled:true,watchReplies:false,watchAt:true,watchTop:false,commentWatchReplies:false,commentAtEnabled:true}),
    selfUid:async()=>'12345',getNotifications:async()=>{replyListLookups++;return {items:[]}},
    getAtNotifications:async()=>{atLookups++;return {at:{data:{items:[]}},likes:{data:{items:[]}}}},
    getOwnComments:async()=>{ownCommentLookups++;return {top:[],nested:[]}},
    generateReply:async()=>'',send:async()=>({ok:true}),
  })
  try{
    const result=await comments.poll({notifications:false,mentions:true,top:false})
    assert.equal(result.error,undefined)
    assert.equal(atLookups,1)
    assert.equal(replyListLookups,0)
    assert.equal(ownCommentLookups,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
