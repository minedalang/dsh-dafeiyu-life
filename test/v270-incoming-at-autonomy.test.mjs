import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createCommentInteract } from '../lib/comment-interact.mjs'
import { validateSocialReplyText } from '../lib/social-autonomy-contract.mjs'

const self='999', visitor='485221842', bv='BV1ignA6REjB'
const payload=(id,{uid=visitor, timestamp=Date.now(),content='@大肥鱼 蓝色的'}={})=>({
  id,at_time:Math.floor(timestamp/1000),user:{mid:uid,nickname:'新朋友'},
  item:{business_id:1,subject_id:'777',source_id:String(id+500),root_id:'888',target_id:'888',
    source_content:content,uri:`https://www.bilibili.com/video/${bv}`,at_details:[{mid:self}]},
})
const raw=rows=>({at:{code:0,data:{items:rows}}})
async function withEngine(behavior,fn){
  const dir=await mkdtemp(join(tmpdir(),'v270-open-incoming-at-'))
  let notices=[payload(1)], replies=[], seenPrompts=[]
  const cfg={watchAt:true,replyAt:true,atMode:'whitelist',atWhitelist:'123123',replyPerPoll:3,replyPerDay:20,globalDailyLimit:100}
  const engine=createCommentInteract({dataDir:dir,getConfig:()=>cfg,selfUid:async()=>self,now:()=>Date.now(),
    getAtNotifications:async()=>raw(notices),getOwnComments:async()=>({top:[],nested:[]}),
    getVideoContext:async()=>({usable:true,text:'真实的视频与评论上下文'}),
    generateReply:async req=>{seenPrompts.push(req);return behavior(req)},
    send:async req=>{replies.push(req);return {ok:true,rpid:'555555'}},
    logger:{warn(){},error(){}},
  })
  try{
    await engine.poll({mentions:true,notifications:false,top:false})
    await fn({engine,cfg,add:row=>notices.push(row),replies,seenPrompts,
      state:async()=>JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'))})
  }finally{await rm(dir,{recursive:true,force:true})}
}

test('入站 @ 旧白名单即使为空或不包含 UID，也由 AI 决定接话',async()=>{
  await withEngine(()=>'听起来蓝色的身体很不错！',async({engine,cfg,add,replies,seenPrompts,state})=>{
    cfg.atWhitelist='';add(payload(2))
    const result=await engine.poll({mentions:true,notifications:false,top:false})
    assert.equal(result.sent,1);assert.equal(replies.length,1)
    assert.equal(replies[0].uid,visitor);assert.equal(seenPrompts.length,1)
    assert.match(seenPrompts[0].context,/真实的视频与评论上下文/)
    assert.equal((await state()).seen['at:2'],'sent')
    assert.equal(engine.status().atEligibility,'all-verified-incoming')
    await engine.poll({mentions:true,notifications:false,top:false})
    assert.equal(replies.length,1,'重复通知不会重发')
  })
})
test('@ 自动回复开关关闭时仍不得向任何人发送',async()=>{
  await withEngine(()=>'回一句吧',async({engine,cfg,add,replies,seenPrompts})=>{
    cfg.replyAt=false;add(payload(3))
    await engine.poll({mentions:true,notifications:false,top:false})
    assert.equal(replies.length,0);assert.equal(seenPrompts.length,0)
  })
})
test('模型选择 SKIP 是自主沉默而不是再次检查白名单',async()=>{
  await withEngine(()=>'SKIP',async({engine,add,replies,state})=>{
    add(payload(4));await engine.poll({mentions:true,notifications:false,top:false})
    assert.equal(replies.length,0);assert.equal((await state()).seen['at:4'],'skipped')
  })
})
test('未经单独许可主动 @ 昵称被发送前阻断，不占用已发送/不确定回执',async()=>{
  await withEngine(()=>'@某用户 你也来看看！',async({engine,add,replies,state})=>{
    add(payload(5));await engine.poll({mentions:true,notifications:false,top:false})
    const db=await state()
    assert.equal(replies.length,0)
    assert.equal(db.seen['at:5'],'proactive-at-blocked')
    assert.equal(db.sent.length,0)
    assert.equal(db.sendAttempts.length,0)
  })
})
test('被核实但过期的 @，升级后也不能批量回复',async()=>{
  await withEngine(()=>'欢迎来聊天',async({engine,add,replies,seenPrompts,state})=>{
    add(payload(6,{timestamp:Date.now()-48*3600*1000}))
    await engine.poll({mentions:true,notifications:false,top:false})
    assert.equal(replies.length,0);assert.equal(seenPrompts.length,0)
    assert.equal((await state()).seen['at:6'],'at-out-of-window')
  })
})
test('内容安全契约禁止主动 @，但允许普通回复和无害 email',()=>{
  assert.equal(validateSocialReplyText('@小猫 来看看').reason,'proactive-at-forbidden')
  assert.equal(validateSocialReplyText('听说你喜欢蓝色的。').ok,true)
  assert.equal(validateSocialReplyText('公开邮箱 alice@example.com 只是地址').ok,true)
  assert.equal(validateSocialReplyText(' ').reason,'empty-reply')
})
test('管理页移除旧白名单开关，配置兼容仍保留原字段读取',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.doesNotMatch(html,/id="comment-at-mode"|id="comment-at-whitelist"/)
  assert.doesNotMatch(js,/\$\('comment-at-mode'\)|\$\('comment-at-whitelist'\)/)
  assert.match(html,/入站 @|接收别人 @/)
  assert.match(index,/commentAtMode: z\.string\(\)/)
  assert.doesNotMatch(index,/atMode:cfg\.commentAtMode/)
})
