import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {QUOTA_PRESETS,resolveQuotaPresetPatch} from '../lib/quota-preset.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {messageBurstInstruction,deliverMessageBurst} from '../lib/message-burst.mjs'

const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('额度卡片是持久且可审计的模式，不能仅填写数值却谎报方案',()=>{
  const natural=QUOTA_PRESETS.natural
  assert.deepEqual(resolveQuotaPresetPatch({}, {...natural,quotaPreset:'natural'}),{...natural,quotaPreset:'natural'})
  assert.throws(()=>resolveQuotaPresetPatch({}, {quotaPreset:'active',dmReplyPerDay:200}),/真实数值不一致/)
  assert.equal(resolveQuotaPresetPatch({...natural,quotaPreset:'natural'},{dmReplyPerDay:201}).quotaPreset,'custom')
  assert.equal(resolveQuotaPresetPatch({...natural,quotaPreset:'natural'},{visionDailyLimit:35}).quotaPreset,'custom')
  assert.throws(()=>resolveQuotaPresetPatch({...natural,visionDailyLimit:30},{...natural,quotaPreset:'natural',visionDailyLimit:40}),/自定义方案/)
  assert.equal(resolveQuotaPresetPatch({...natural,quotaPreset:'natural'},{dmWatchMinutes:5}).quotaPreset,undefined)
  assert.throws(()=>resolveQuotaPresetPatch({}, {quotaPreset:'invented'}),/不合法/)
})

test('管理页选中方案、改参数切自定义、读回旧方案并随配置保存',()=>{
  const js=source('lib/management-console.js'),html=source('lib/management-console.html'),server=source('index.js')
  assert.match(js,/setQuotaPresetChoice\(savedQuotaPlan\)/)
  assert.match(js,/for\(const \[id\] of quotaFields\)\$\(id\)\?\.addEventListener\('input',\(\)=>setQuotaPresetChoice\('custom'\)\)/)
  assert.match(js,/payload\.quotaPreset=selectedQuotaPlan/)
  assert.match(js,/Object\.entries\(quotaPresetValues\[c\.quotaPreset\]\)/)
  assert.match(server,/resolveQuotaPresetPatch\(cfg,mergedPatch\)/)
  assert.match(server,/quotaPreset: z\.string\(\)\.default\('custom'\)/)
  assert.match(html,/data-quota-preset="custom" aria-pressed="true"/)
})

test('普通私信回复额度不阻断主人；主人气泡不占其他人的每日预算',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dafeiyu-owner-quota-'))
  let clock=1790000000000
  const inbox=[],sent=[]
  const cfg={enabled:true,strangerEnabled:true,whitelist:[],ownerUid:'200',
    maxPerDay:1,maxPerHour:120,maxPerPoll:10,strangerMaxReplies:10,
    whitelistCooldownSeconds:0,p6Enabled:true,p6MaxBubbles:3}
  const engine=createDmAutoReply({dataDir,selfUid:'999',now:()=>clock,getConfig:()=>cfg,
    fetchIncoming:async()=>inbox,generateReply:async({uid})=>({action:'reply',messages:uid==='200'?['主人第一条','主人第二条']:['普通一条']}),
    send:async data=>{sent.push(data);return {ok:true,receiptId:'r'+sent.length}},logger:{warn(){},error(){}}})
  const m=(uid,id)=>({senderUid:uid,messageId:id,incoming:true,text:'你好',timestampMs:clock})
  try{
    await engine.poll()
    inbox.push(m('301','first'))
    assert.equal((await engine.poll()).sent,1)
    inbox.push(m('200','owner'))
    assert.equal((await engine.poll()).sent,2,'owner uses two bubbles even after ordinary daily cap')
    assert.equal(sent.filter(x=>x.uid==='200').length,2)
    inbox.push(m('302','other'))
    assert.equal((await engine.poll()).sent,0,'ordinary user still faces the cap')
    const db=JSON.parse(await readFile(join(dataDir,'dm-autoreply-state.json'),'utf8'))
    assert.equal(db.sentAt.length,1,'owner bubbles are excluded from ordinary daily quota counter')
  }finally{await rm(dataDir,{recursive:true,force:true})}
})

test('自然多气泡完整草稿→独立语义点→最终 messages，仍允许单条和沉默',async()=>{
  const text=messageBurstInstruction({context:'私信',requireArray:true})
  assert.match(text,/①先理解对方当下的问题/)
  assert.match(text,/②再从草稿找说话节奏/)
  assert.match(text,/③最后按所选条数输出 messages 数组/)
  assert.match(text,/不能|不得|不要/)
  assert.match(text,/简短回答/)
  assert.match(source('lib/interaction-batch.mjs'),/context:'B站私信与评论',requireArray:true/)
  assert.match(source('lib/owner-dm-agent.mjs'),/context:'主人 B站私信',requireArray:true/)
  const delivered=[]
  const receipt=await deliverMessageBurst({messages:['先说一条','再补一句'],
    send:async({text})=>{delivered.push(text);return {ok:true,receiptId:'r'+delivered.length}}})
  assert.equal(receipt.confirmed,2)
  assert.deepEqual(delivered,['先说一条','再补一句'])
})
