import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createOwnerDmAgent,ownerDmTimedHistory} from '../lib/owner-dm-agent.mjs'

test('short owner acknowledgements explicitly anchor to the immediately preceding assistant turn',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'dsh-owner-anchor-'))
  try{
    let now=Date.parse('2026-11-14T04:23:00Z'),calls=0
    const prompts=[]
    const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,
      ownerDmReadCommandsEnabled:false,dmP6Enabled:true,dmP6MaxBubbles:1}
    const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,getAccountTag:()=>'a'.repeat(16),now:()=>now,
      invokeModel:async prompt=>{
        prompts.push(Array.isArray(prompt)?prompt.join('\\n'):String(prompt))
        calls++
        return JSON.stringify({action:'reply',text:calls===1?'我刚刚发了一条有趣的评论。':'哈哈，这句确实挺有意思。'})
      },
      executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
      send:async()=>({ok:true,receiptId:'confirmed-'+calls}),logger:{warn(){}}})
    agent.primeInbox([])
    const first=await agent.processMessage({incoming:true,senderUid:'123',messageId:'123:first',
      timestampMs:now,text:'最近发了什么有趣的评论？'})
    assert.equal(first.ok,true)
    now+=5_000
    const second=await agent.processMessage({incoming:true,senderUid:'123',messageId:'123:second',
      timestampMs:now,text:'还是得是你'})
    assert.equal(second.ok,true)
    assert.equal(prompts.length,2)
    assert.match(prompts[1],/本轮聊天锚点（最高优先级/)
    assert.match(prompts[1],/我刚刚发了一条有趣的评论/)
    assert.match(prompts[1],/主人本条若只是“哈哈”“还是得是你”/)
  }finally{rmSync(dataDir,{recursive:true,force:true})}
})


test('跨日历史附带可信时间戳且不按 90 分钟硬切，当前短反馈优先锚定上一条评论回复',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'dsh-owner-timed-context-'))
  try{
    let now=Date.parse('2026-11-14T04:23:00Z')
    const oldAt=Date.parse('2026-11-13T15:30:00Z')
    const prompts=[]
    const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,
      ownerDmReadCommandsEnabled:false,dmP6Enabled:true,dmP6MaxBubbles:1}
    const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,getAccountTag:()=>'a'.repeat(16),now:()=>now,
      invokeModel:async prompt=>{
        prompts.push(String(prompt))
        return JSON.stringify({action:'reply',text:prompts.length===1?'我刚刚发表了情书视频的评论。':'哈哈，情书这事确实好玩。'})
      },executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
      send:async()=>({ok:true,receiptId:'confirmed-'+prompts.length}),logger:{warn(){}}})
    agent.primeInbox([])
    const stateFile=join(dataDir,'owner-dm-agent.json')
    const state=JSON.parse(readFileSync(stateFile,'utf8'))
    state.historyUid='123'
    state.history=[
      {role:'user',text:'猜猜我今天吃了啥',at:oldAt},
      {role:'assistant',text:'我猜番茄炒蛋！',at:oldAt+5_000},
    ]
    writeFileSync(stateFile,JSON.stringify(state))
    const first=await agent.processMessage({incoming:true,senderUid:'123',messageId:'first',
      timestampMs:now,text:'最近有什么有趣评论？'})
    assert.equal(first.ok,true)
    now+=5_000
    const second=await agent.processMessage({incoming:true,senderUid:'123',messageId:'second',
      timestampMs:now,text:'哈哈，还得是你'})
    assert.equal(second.ok,true)
    assert.equal(prompts.length,2)
    // Old subject is deliberately still available; timestamp and current anchor
    // instead of an arbitrary 90-minute erasure decide the conversational priority.
    assert.match(prompts[1],/猜猜我今天吃了啥/)
    assert.match(prompts[1],new RegExp(new Date(oldAt).toISOString()))
    assert.match(prompts[1],/我刚刚发表了情书视频的评论/)
    assert.match(prompts[1],/"currentOwnerMessageAtUTC":"2026-11-14T04:23:05.000Z"/)
    assert.match(prompts[1],/时间跨度是线索而非硬边界/)
    assert.doesNotMatch(prompts[1],/超过 90 分钟的旧话题不混入/)
  }finally{rmSync(dataDir,{recursive:true,force:true})}
})

test('时间戳历史保留跨日顺序、不把时间丢掉或改写成无日期原文',()=>{
  const a=Date.parse('2026-11-13T12:25:00Z'),b=Date.parse('2026-11-14T12:25:00Z')
  assert.deepEqual(ownerDmTimedHistory([
    {role:'user',text:'昨天的饭菜',at:a},
    {role:'assistant',text:'今天的评论',at:b},
  ]),[
    {role:'user',text:'昨天的饭菜',atUTC:'2026-11-13T12:25:00.000Z'},
    {role:'assistant',text:'今天的评论',atUTC:'2026-11-14T12:25:00.000Z'},
  ])
})
