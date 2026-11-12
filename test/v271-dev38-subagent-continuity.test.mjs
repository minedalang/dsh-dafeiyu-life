import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {lifeSubagentHandoff,dmContactFollowCandidates,validateSubagentNextAction} from '../lib/life-subagent-continuity.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
const A='b'.repeat(16),B='c'.repeat(16),t=1_790_000_000_000
const dirFor=(ctx)=>{const d=mkdtempSync(join(tmpdir(),'life-subagent-'));ctx.after(()=>rmSync(d,{recursive:true,force:true}));return d}
const longHistory=(time=t)=>[...Array(3)].flatMap((_,i)=>[
  {role:'user',text:'我们聊天',at:time-3*86_400_000+i*3600_000},
  {role:'assistant',text:'聊得很开心',at:time-3*86_400_000+i*3600_000+20_000}
])
const candidate=()=>dmContactFollowCandidates({enabled:true,uid:'12345',role:'friend',history:longHistory() ,now:t})

test('dev38 同人 Episode 可读、跨 UID 不可读、切号自动隔离',ctx=>{
  const d=dirFor(ctx);let account=A
  const episodes=createUniversalLifeEpisodes({stateDir:d,getAccountTag:()=>account,now:()=>t})
  assert.equal(episodes.record({accountTag:A,sourceRef:'dm-conversation:12345',receiptId:'bili-dm:abc',action:'dm_reply',kind:'social',channel:'dm',owner:'life'}).ok,true)
  const own=lifeSubagentHandoff({agent:'dm',episodes,sourceRef:'dm-conversation:12345'})
  assert.equal(own.source.history[0].action,'dm_reply')
  assert.equal(lifeSubagentHandoff({agent:'dm',episodes,sourceRef:'dm-conversation:45678'}).source,null)
  assert.equal(lifeSubagentHandoff({agent:'comment',episodes,sourceRef:'dm-conversation:12345'}).source,null)
  assert.equal(JSON.stringify(own).includes('12345'),false)
  account=B
  assert.equal(lifeSubagentHandoff({agent:'dm',episodes,sourceRef:'dm-conversation:12345'}).source,null)
})

test('dev38 视频 Episode 只获得公开视频相关匿名步骤，不泄露私信/评论',ctx=>{
  const d=dirFor(ctx),episodes=createUniversalLifeEpisodes({stateDir:d,getAccountTag:()=>A,now:()=>t})
  episodes.record({accountTag:A,sourceRef:'dm-conversation:12345',receiptId:'bili-dm:1',action:'dm_reply',kind:'social',channel:'dm',owner:'life'})
  episodes.record({accountTag:A,sourceRef:'life-video:home',receiptId:'bili-read:2',action:'browse_home',kind:'video',channel:'video-agent',owner:'life'})
  const handoff=lifeSubagentHandoff({agent:'video',episodes})
  assert.equal(handoff.recent.length,1)
  assert.equal(handoff.recent[0].history[0].action,'browse_home')
  assert.equal(JSON.stringify(handoff).includes('dm_reply'),false)
})

test('dev38 私信关注候选必须开启独立授权、真实双向长期交流和可信联系人',()=>{
  assert.equal(candidate().length,1)
  for(const diff of [
    {enabled:false},{role:'stranger'},{role:'known'},{uid:'12345<script>'},{uid:'9007199254740993'},{optedOut:true},
    {history:longHistory().slice(0,3)},{history:longHistory(t).map(x=>({...x,at:t-3600_000}))}
  ])assert.deepEqual(dmContactFollowCandidates({enabled:true,uid:'12345',role:'friend',history:longHistory(),now:t,...diff}),[])
  assert.deepEqual(validateSubagentNextAction({action:'follow_dm_contact',reason:'因为我们已经连续聊了很久'},candidate()),
    {action:'follow_dm_contact',reason:'因为我们已经连续聊了很久'})
  assert.equal(validateSubagentNextAction({action:'follow_dm_contact',reason:'因为我们已经连续聊了很久'},[]),null)
  assert.equal(validateSubagentNextAction({action:'follow_dm_contact',reason:'好'},candidate()),null)
  assert.equal(validateSubagentNextAction({action:'follow_dm_contact',reason:'因为我们已经连续聊了很久',uid:'999'},candidate()),null)
})

test('dev38 私信模型自己决定要不要提出关注；不存在候选时提议无效',async()=>{
  let prompt=''
  const model=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> '统一 Life Voice',invoke:async p=>{
    prompt=p
    return JSON.stringify({items:[{id:'0',action:'reply',messages:['最近聊得挺开心'],
      nextAction:{action:'follow_dm_contact',reason:'这位朋友长期和我分享日常，我愿意关注对方'}}]})
  }})
  try{
    const base={kind:'dm',role:'friend',uid:'12345',text:'今天怎么样',socialAutonomy:true,trigger:'incoming',history:longHistory(),
      lifeEpisodeContext:{source:{history:[{action:'dm_reply',outcome:'verified'}]}},availableLifeActions:candidate()}
    const r=await model.generate(base)
    assert.equal(r.nextAction.action,'follow_dm_contact')
    assert.match(prompt,/lifeEpisodeContext/)
    assert.match(prompt,/follow_dm_contact/)
    const denied=await model.generate({...base,availableLifeActions:[]})
    assert.equal(denied.nextAction,null)
  }finally{model.stop()}
})

test('dev38 私信回复有真实回执后只预约关注，冷却到期跨轮重启才执行且只执行一次',async ctx=>{
  const d=dirFor(ctx),inbox=[],out=[],follows=[];let clock=t
  const opt=()=>({enabled:true,whitelist:['12345'],whitelistCooldownSeconds:0,historyLimit:80,p6Enabled:false})
  const make=()=>createDmAutoReply({dataDir:d,selfUid:'90000',now:()=>clock,
    getConfig:opt,fetchIncoming:async()=>inbox,
    generateReply:async()=>({action:'reply',messages:['我还想继续聊'],nextAction:{action:'follow_dm_contact',reason:'我们已经交流过很多次，我希望关注对方的作品'}}),
    send:async()=>{out.push('sent');return {ok:true,receiptId:'confirmed'}} ,
    onVerifiedReply:async proposal=>{follows.push(proposal);return {ok:true}},logger:{warn(){},error(){}}})
  await make().poll() // baseline
  // Existing verified turns in same person's private DM ledger; never fabricate a new sender.
  const path=join(d,'dm-autoreply-state.json'),data=JSON.parse(readFileSync(path,'utf8'))
  data.people['12345']={seen:[],history:longHistory(),olderContext:[],lastRepliedAt:0,stranger:null}
  const {writeFileSync}=await import('node:fs');writeFileSync(path,JSON.stringify(data))
  inbox.push({incoming:true,senderUid:'12345',messageId:'new-msg',timestampMs:clock,text:'最近还想听歌吗'})
  assert.equal((await make().poll()).sent,1)
  assert.equal(out.length,1);assert.equal(follows.length,0)
  let state=JSON.parse(readFileSync(path,'utf8'))
  assert.equal(state.people['12345'].pendingLifeAction.status,'pending')
  assert.equal(state.people['12345'].pendingLifeAction.intentProtocol,2)
  clock+=76_000;await make().poll()
  assert.equal(follows.length,1);assert.equal(follows[0].uid,'12345');assert.equal(follows[0].singleIntentVerified,true)
  assert.equal(JSON.parse(readFileSync(path,'utf8')).people['12345'].pendingLifeAction.status,'verified')
  clock+=120_000;await make().poll()
  assert.equal(follows.length,1)
})

test('dev38 冷却后的关注执行结果不确定，跨轮不重试；联系人撤回授权则终止',async ctx=>{
  const d=dirFor(ctx),inbox=[];let clock=t,followCount=0
  const make=()=>createDmAutoReply({dataDir:d,selfUid:'90000',now:()=>clock,
    getConfig:()=>({enabled:true,whitelist:['12345'],whitelistCooldownSeconds:0,p6Enabled:false}),
    fetchIncoming:async()=>inbox,generateReply:async()=>({action:'reply',messages:['好'],nextAction:{action:'follow_dm_contact',reason:'我们相互交流了很长一段时间'}}),
    send:async()=>({ok:true,receiptId:'confirmed'}),
    onVerifiedReply:async()=>{followCount++;return {ok:false,reason:'platform-uncertain'}},logger:{warn(){},error(){}}})
  await make().poll()
  inbox.push({incoming:true,senderUid:'12345',messageId:'new-msg',timestampMs:clock,text:'你好'})
  await make().poll()
  let db=JSON.parse(readFileSync(join(d,'dm-autoreply-state.json'),'utf8'))
  // This case is testing the terminal treatment of a *previously* valid proposal.
  db.people['12345'].pendingLifeAction={action:'follow_dm_contact',reason:'我们相互交流了很长一段时间',sourceMessageId:'new-msg',dueAt:clock+75_000,expiresAt:clock+3600_000,attempts:0,status:'pending'}
  const {writeFileSync}=await import('node:fs');writeFileSync(join(d,'dm-autoreply-state.json'),JSON.stringify(db))
  clock+=76_000;await make().poll()
  assert.equal(followCount,0,'legacy proposal cannot acquire a new action permission')
  assert.equal(JSON.parse(readFileSync(join(d,'dm-autoreply-state.json'),'utf8')).people['12345'].pendingLifeAction.status,'cancelled')
  clock+=76_000;await make().poll();assert.equal(followCount,0)
})
