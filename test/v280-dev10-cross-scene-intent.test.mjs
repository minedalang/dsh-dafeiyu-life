import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {parseTrustedSocialDecision} from '../lib/comment-social-ai.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {createLifeContinuationWriteExecutor} from '../lib/life-continuation-write.mjs'
const BV='BV1abcde1234',SCOPE='a'.repeat(16),UID='123456789',ID='b'.repeat(24)
const now=Date.now()
const temp=fn=>{
  const path=mkdtempSync(join(tmpdir(),'life280-dev10-'))
  return Promise.resolve().then(()=>fn(path)).finally(()=>rmSync(path,{recursive:true,force:true}))
}
const create=(dir,settings={})=>createLifeWillingness({dataDir:dir,
  getAccountTag:settings.getAccountTag||(()=>SCOPE),getContext:async()=>({voice:'有自主选择权的鱼鱼',world:{}}),
  invokeModel:settings.invokeModel||(()=>{throw Error('should not invoke another model')}),
  beginTrace:()=>({step(){},finish(){}}),
  opportunityWindowMs:settings.window||0})
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))

test('chat refuse/defer is never coerced to allow and permits a truly empty reply',()=>{
  for(const decision of ['refuse','defer']){
    const out=parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision,reply:''}))
    assert.equal(out.ok,true)
    assert.equal(out.decision,decision)
    assert.equal(out.replyDecision,decision)
    assert.equal(out.reply,'')
    const supplied=parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision,reply:'我不想回复'}))
    assert.equal(supplied.ok,true)
    assert.equal(supplied.replyDecision,decision)
    assert.equal(supplied.reply,'','silence must not send a model-supplied nonempty phrase')
  }
  const act=parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision:'allow',reply:'我想聊一聊'}))
  assert.equal(act.replyDecision,'allow')
  assert.equal(act.reply,'我想聊一聊')
  const expressSilence=parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision:'allow',replyDecision:'refuse',reply:''}))
  assert.equal(expressSilence.ok,true);assert.equal(expressSilence.replyDecision,'refuse')
  assert.equal(parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision:'allow',reply:''})).ok,false)
})

test('separate action and expression choices allow refuse-and-reply or refuse-and-silence',()=>{
  const base={intent:'social_invite',decision:'refuse'}
  const answer=parseTrustedSocialDecision(JSON.stringify({...base,replyDecision:'allow',reply:'暂时不想去看'}))
  assert.equal(answer.ok,true);assert.equal(answer.decision,'refuse');assert.equal(answer.replyDecision,'allow')
  const silent=parseTrustedSocialDecision(JSON.stringify({...base,replyDecision:'refuse',reply:''}))
  assert.equal(silent.ok,true);assert.equal(silent.reply,'')
})

test('owner comment AI refusal to chat records voluntary silence; no public reply is sent',()=>temp(async dir=>{
  const sent=[]
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>now,
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      dmOwnerUid:UID,commentDailyLimit:5,commentReplyPerDay:5}),
    interpretSocial:async()=>parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision:'refuse',reply:''})),
    getRole:()=> 'owner',perform:async()=>({ok:true}),sendReply:async x=>{sent.push(x);return {ok:true,rpid:'123456789'}}})
  const output=await agent.accept({kind:'at',id:'at:comment1',uid:UID,bvid:BV,rpid:'1234567',
    text:'你在吗',timestampMs:now})
  assert.equal(output.status,'skipped')
  assert.equal(sent.length,0)
  const ledger=JSON.parse(readFileSync(join(dir,'owner-comment-agent.json'),'utf8')).items[0]
  assert.equal(ledger.replyStatus,'not-requested');assert.equal(ledger.reason,'chose-silence')
}))

test('refused social invitation only sends a reply when expression willingness explicitly allows',()=>temp(async dir=>{
  let serial=0;const sent=[]
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>now,
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      dmOwnerUid:UID,commentDailyLimit:5,commentReplyPerDay:5}),
    interpretSocial:async()=>parseTrustedSocialDecision(JSON.stringify({intent:'social_invite',decision:'refuse',
      replyDecision:serial++===0?'refuse':'allow',reply:'这次我不想去看'})),
    recordAgency:async()=>({decision:'refuse'}),getRole:()=> 'owner',perform:async()=>{throw Error('must not explore')},
    sendReply:async x=>{sent.push(x);return {ok:true,rpid:'123456789'}}})
  const row=id=>({kind:'at',id,uid:UID,bvid:BV,rpid:id.slice(3),text:'来看看视频吧',timestampMs:now})
  const a=await agent.accept(row('at:1111111'))
  assert.equal(a.status,'skipped');assert.equal(sent.length,0)
  const b=await agent.accept(row('at:2222222'))
  assert.equal(b.status,'skipped');assert.equal(sent.length,1)
  assert.equal(sent[0].sourceMessageId,'at:2222222')
}))

test('simultaneous PUBLIC video and comment candidates preserve per-candidate evidence with one model call',()=>temp(async dir=>{
  let calls=0,prompt=''
  const w=create(dir,{window:45,invokeModel:async p=>{calls++;prompt=p;return JSON.stringify({action:'act',candidateId:'q0_vid',reason:'确实想点赞这条视频'})}})
  const video=w.decide({sourceKey:'video:verified-001',scene:'main',trigger:'video-action',
    candidates:[{id:'vid',kind:'video_like',label:'考虑点赞公开视频'}],
    evidence:{publicVideoAction:{summary:'公开视频介绍了城市骑行路线',bvid:BV}}})
  const social=w.decide({sourceKey:'public-comment:verified-002',scene:'comment',trigger:'comment-message',
    candidates:[{id:'talk',kind:'comment_reply',label:'考虑回复当前公开留言'}],
    evidence:{socialReply:{incoming:'公开留言问鱼鱼骑车要带什么',draftMessages:['记得带水哦']}}})
  const [a,b]=await Promise.all([video,social]);assert.equal(calls,1)
  assert.equal(a.ok,true);assert.equal(b.action,'defer')
  assert.match(prompt,/城市骑行路线/);assert.match(prompt,/公开留言问鱼鱼骑车要带什么/)
  assert.match(prompt,/记得带水哦/)
  assert.equal(w.receipt(a.proof,{status:'not-sent'}).ok,true)
}))

test('mixed private and public candidates do not leak incoming DM text into common arbitration',()=>temp(async dir=>{
  let prompt=''
  const w=create(dir,{window:40,invokeModel:async p=>{prompt=p;return JSON.stringify({action:'skip',reason:'这轮选择保持安静'})}})
  const [a,b]=await Promise.all([
    w.decide({sourceKey:'private-dm-verified-001',scene:'dm',uid:UID,
      candidates:[{id:'dm',kind:'dm_reply',label:'考虑私信回复'}],
      evidence:{socialReply:{incoming:'绝对不能进公开场景的私人句子Q9'}}}),
    w.decide({sourceKey:'public-video-verified-002',scene:'main',
      candidates:[{id:'vid',kind:'video_like',label:'公开视频点赞'}],
      evidence:{publicVideoAction:{summary:'公开骑行视频'}}})
  ])
  assert.equal(a.action,'skip');assert.equal(b.action,'skip')
  assert.doesNotMatch(prompt,/私人句子Q9/)
  assert.match(prompt,/公开骑行视频/)
}))

test('video intent follows same FIFO as social; never votes again while another proof is active',()=>temp(async dir=>{
  const w=create(dir)
  const social=w.adoptSocialDecision({kind:'dm_reply',uid:UID,sourceKey:'dm-original',messages:['想回答']})
  assert.equal(social.ok,true)
  const waiting=w.adoptVideoDecisionQueued({sourceKey:'episode-original',kind:'video_like',target:BV})
  await delay(15)
  assert.equal(w.status().queued,1)
  assert.equal(w.receipt(social.proof,{status:'not-sent'}).ok,true)
  const video=await waiting
  assert.equal(video.ok,true,video.reason)
  assert.equal(w.verify(video.proof,'video_like',{target:BV,commentText:''}).ok,true)
  assert.equal(w.verify(video.proof,'video_like',{target:BV,commentText:''}).ok,false,'no replay')
  assert.equal(w.receipt(video.proof,{status:'uncertain'}).ok,true)
}))

test('account change while queued closes the unissued video proof',()=>temp(async dir=>{
  let scope=SCOPE;const w=create(dir,{getAccountTag:()=>scope})
  const first=w.adoptSocialDecision({kind:'dm_reply',uid:UID,sourceKey:'dm-queued-account',messages:['打招呼']})
  assert.equal(first.ok,true)
  const pending=w.adoptVideoDecisionQueued({sourceKey:'episode-account-change',kind:'video_like',target:BV})
  scope='c'.repeat(16)
  const result=await pending
  assert.equal(result.ok,false);assert.equal(result.reason,'life-account-changed')
}))

test('video queued admission does not override authorization revoked while waiting',()=>temp(async dir=>{
  let allow=true,cancelled=''
  const intention={id:ID,status:'inspected',selectedBvid:BV,metadataAt:Date.now()-500,
    expiresAt:Date.now()+3_600_000,nextAt:0}
  const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
    autoVideoLike:allow,autoVideoLikeDailyLimit:5})
  const send=createLifeContinuationWriteExecutor({getConfig:config,getAccountTag:()=>SCOPE,
    getAccountUid:()=>UID,getIntention:()=>intention,
    getPublicEvidence:async()=>({ok:true,bvid:BV,title:'真实视频'}),markSelected:async()=>({ok:true}),
    bridgeReady:()=>true,
    prepareIntent:async()=>{allow=false;return {ok:true,ticket:'ticket-queued'}},
    cancelIntent:ticket=>{cancelled=ticket},runWriter:async()=>{throw Error('revoked consent should not reach writer')}})
  const result=await send({action:'like_video',id:ID,bvid:BV,reason:'我想点赞这个确实读过公开视频的作品'},SCOPE)
  assert.equal(result.status,'blocked')
  assert.equal(result.code,'authorization-changed-after-queue')
  assert.equal(cancelled,'ticket-queued')
}))

test('trusted owner comment sender uses shared sealed-proof and receipt, not only a bare platform transaction',()=>{
  const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=code.indexOf('sendReply:async({bvid,rpid,root,text,actorUid,kind,channel})=>{',code.indexOf('const ownerCommentAgent=createOwnerCommentAgent'))
  const end=code.indexOf('},logger:{warn:m=>',start)
  const send=code.slice(start,end)
  assert.ok(start>0&&end>start)
  assert.match(send,/adoptSocialDecisionQueued\(/)
  assert.match(send,/lifeWillingness\?\.verify\(/)
  assert.match(send,/socialSendTransaction\.execute\(/)
  assert.match(send,/settle\(confirmed\?'verified'/)
})

test('trusted chat denied before platform attempt is blocked, not falsely reported as unknown delivery',()=>temp(async dir=>{
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>now,
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      dmOwnerUid:UID,commentDailyLimit:5,commentReplyPerDay:5}),
    interpretSocial:async()=>parseTrustedSocialDecision(JSON.stringify({intent:'chat',decision:'allow',reply:'想回答这个公开问题'})),
    getRole:()=> 'owner',perform:async()=>({ok:true}),
    sendReply:async()=>({ok:false,notAttempted:true,reason:'authorization-revoked-while-queued'})})
  const out=await agent.accept({kind:'at',id:'at:blocked-reply',uid:UID,bvid:BV,rpid:'1234567',
    text:'聊聊吧',timestampMs:now})
  assert.equal(out.status,'failed');assert.equal(out.replyStatus,'blocked')
  const ledger=JSON.parse(readFileSync(join(dir,'owner-comment-agent.json'),'utf8')).items[0]
  assert.equal(ledger.replyStatus,'blocked')
}))

test('a trusted social model permits speech with its exact chosen text, not a generated success template',()=>temp(async dir=>{
  const sent=[]
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>now,
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      dmOwnerUid:UID,commentDailyLimit:5,commentReplyPerDay:5}),
    interpretSocial:async()=>parseTrustedSocialDecision(JSON.stringify({intent:'social_invite',decision:'allow',
      replyDecision:'allow',reply:'我只看了公开资料，之后自己决定是否评论。'})),
    recordAgency:async()=>({decision:'allow'}),getRole:()=> 'owner',
    perform:async()=>({ok:true,inspected:true,inspection:'title-only',commentDecision:'life-offered'}),
    sendReply:async x=>{sent.push(x);return {ok:true,rpid:'123456789'}}})
  const result=await agent.accept({kind:'at',id:'at:social-exact',uid:UID,bvid:BV,rpid:'1234567',
    text:'去看这个视频',timestampMs:now})
  assert.equal(result.status,'done')
  assert.equal(sent.length,1)
  assert.equal(sent[0].text,'我只看了公开资料，之后自己决定是否评论。')
}))


test('post-action verified outcome may revise reply wording without a second expression-willingness vote',()=>temp(async dir=>{
  let calls=0;const sent=[]
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>now,
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      dmOwnerUid:UID,commentDailyLimit:5,commentReplyPerDay:5}),
    interpretSocial:async()=>{calls++;return parseTrustedSocialDecision(JSON.stringify({intent:'social_invite',
      decision:'allow',replyDecision:'allow',reply:'我去看看公开资料。'}))},
    recordAgency:async()=>({decision:'allow'}),getRole:()=> 'owner',
    perform:async()=>({ok:true,ownerReplySuccess:'已经核实公开视频信息，但尚未决定要不要评论。'}),
    sendReply:async x=>{sent.push(x);return {ok:true,rpid:'123456789'}}})
  const out=await agent.accept({kind:'at',id:'at:outcome-model',uid:UID,bvid:BV,rpid:'1234567',
    text:'去核实一下视频内容',timestampMs:now})
  assert.equal(out.status,'done');assert.equal(calls,1)
  assert.equal(sent.length,1)
  assert.equal(sent[0].text,'已经核实公开视频信息，但尚未决定要不要评论。')
}))
