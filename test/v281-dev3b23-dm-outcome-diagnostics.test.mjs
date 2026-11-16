import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'

const t0=1794739000000
const contact='202573574'
const incoming=(id)=>({senderUid:contact,messageId:contact+':'+id,timestampMs:t0+Number(id)*1000,text:'这是私人消息，请勿写入新诊断字段',incoming:true})
const scenario=async(action,deliver)=>{
 const dir=await mkdtemp(join(tmpdir(),'dm-outcome-'))
 try{
  let now=t0,rows=[],sent=0
  const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>now,
   getConfig:()=>({enabled:true,strangerEnabled:false,whitelist:[contact],whitelistCooldownSeconds:0,p6Enabled:true}),
   fetchIncoming:async()=>rows,generateReply:async()=>({action,messages:['测试发送'],reason:'私人解释不得记录'}),
   send:async()=>{sent++;return deliver?.()??{ok:true,receiptId:'verified-receipt'}},logger:{warn(){},error(){}}})
  await engine.poll()
  rows.push(incoming('1'))
  const result=await engine.poll()
  const data=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'))
  return {sent,result,person:data.people[contact]}
 }finally{await rm(dir,{recursive:true,force:true})}
}

test('持久化每位联系人最近自主沉默/延期，不误判为平台未读已清零',async()=>{
 for(const [action,status,reason] of [['skip','model-skip','model-chose-skip'],['close','model-close','model-chose-close'],['defer','model-defer','model-chose-defer']]){
  const r=await scenario(action)
  assert.equal(r.sent,0)
  assert.equal(r.person.lastInboundOutcome.status,status)
  assert.equal(r.person.lastInboundOutcome.reason,reason)
  assert.equal(r.person.lastInboundOutcome.inboundAt,t0+1000)
  assert.equal(r.person.lastInboundOutcome.at,t0)
  assert.equal(r.person.seen.length,1)
  const saved=JSON.stringify(r.person.lastInboundOutcome)
  assert.doesNotMatch(saved,/私人|测试发送|202573574|UID|提示词/)
 }
})

test('确认发送/未知发送分别记录状态，不把未知状态改成成功',async()=>{
 const success=await scenario('reply')
 assert.equal(success.person.lastInboundOutcome.status,'delivered')
 assert.equal(success.sent,1)
 const failure=await scenario('reply',()=>{throw Error('simulated delivery lost')})
 assert.equal(failure.person.lastInboundOutcome.status,'send-unknown')
 assert.equal(failure.person.lastInboundOutcome.reason,'remote-outcome-unknown')
 assert.equal(failure.sent,1)
})

test('用户指定云端增量测试约束与日志导出脚本已经接线',async()=>{
 const {readFileSync}=await import('node:fs')
 const agents=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8')
 const exporter=readFileSync(new URL('../tools/导出B站日志.bat',import.meta.url),'utf8')
 const bat=readFileSync(new URL('../tools/抓取窗口与私信视觉诊断.bat',import.meta.url),'utf8')
 const ps=readFileSync(new URL('../tools/抓取窗口与私信视觉诊断.ps1',import.meta.url),'utf8')
 assert.match(agents,/禁止云端 Agent 执行全量 Node 测试/)
 assert.match(agents,/增量 Node\/Python 测试/)
 assert.match(exporter,/dm-inbound-outcomes\.json/)
 assert.match(bat,/capture-window-dm-vision\.bat/)
 assert.match(ps,/ParentProcessId/)
 assert.doesNotMatch(ps,/\.CommandLine/)
})
