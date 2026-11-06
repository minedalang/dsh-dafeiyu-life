import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'

const T=Date.parse('2026-11-03T13:00:00Z'),UID='210228238',BV='BV1abc234567'
const defaults=()=>({masterEnabled:true,ownerTodoCompletionFollowupEnabled:true,dmOwnerUid:UID,
  ownerTodoFollowupQuietEnabled:false,ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupMinIntervalMinutes:0})
const task=(id,mid)=>({id,type:'watch_video',bvid:BV,title:'大肥鱼翻唱的视频资料',sourceKey:`manual:${id}`,
  origin:{kind:'owner-dm',uid:UID,messageId:mid}})
const space=async(fn)=>{const dir=mkdtempSync(join(tmpdir(),'dsh-followup-debug-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const ledger=dir=>JSON.parse(readFileSync(join(dir,'owner-todo-followups.json'),'utf8'))

test('正常检查遵守延期，DEBUG 单条直接重新询问：选择联系后真实发送一次，重复调试不会重发',()=>space(async dir=>{
 let calls=0,sent=[]
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:defaults,now:()=>T,hourOf:()=>13,
   chooseReply:()=>{calls++;return calls===1?{decision:'defer'}:{decision:'reply',text:'我找到了一些和你提到的歌曲有关的公开资料。'}},
   send:async row=>{sent.push(row);return {ok:true}}})
 assert.equal(f.queue(task('one','msg1'),{ok:true}).queued,true)
 assert.equal((await f.tick()).skipped,'鱼鱼选择延期');assert.equal(calls,1)
 assert.ok(f.status().recent[0].nextEligibleAt>T)
 assert.equal((await f.tick()).skipped,'鱼鱼选择延期，等待下次考虑');assert.equal(calls,1)
 const key=f.status().recent[0].key
 const res=await f.debugReconsider(key)
 assert.equal(res.status,'sent');assert.equal(res.debug,true);assert.equal(res.targetKey,key)
 assert.equal(res.decision,'reply');assert.equal(calls,2);assert.equal(sent.length,1)
 assert.equal(f.status().recent[0].lastDecisionMode,'debug')
 assert.match((await f.debugReconsider(key)).skipped,/不是可处理的 pending/)
 assert.equal(sent.length,1)
}))

test('DEBUG 连续延期不增加普通轮次的 attempts，也不永久跳过 pending',()=>space(async dir=>{
 let calls=0
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:defaults,now:()=>T,hourOf:()=>13,
   chooseReply:()=>{calls++;return {decision:'defer',modelInvoked:true}},send:()=>{throw Error('no send expected')}})
 f.queue(task('a','m1'),{ok:true})
 assert.equal((await f.tick()).skipped,'鱼鱼选择延期')
 const before=ledger(dir).items[0].attempts
 for(let i=0;i<4;i++){
   const r=await f.debugReconsider(f.status().recent[0].key)
   assert.equal(r.decision,'defer');assert.equal(r.modelInvoked,true)
   assert.equal(f.status().recent[0].status,'pending')
 }
 assert.equal(calls,5);assert.equal(ledger(dir).items[0].attempts,before)
 assert.ok(f.status().recent[0].nextEligibleAt>=T+6*3600_000)
}))

test('DEBUG 只考虑指定原请求；目标不存在/不是 pending 不会转而触发另一条',()=>space(async dir=>{
 const tried=[],sent=[]
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:defaults,now:()=>T,hourOf:()=>13,
  chooseReply:row=>{tried.push(row.taskId);return {decision:'reply',text:'我已经查阅了公开视频的公开资料。'}},
  send:async row=>{sent.push(row);return {ok:true}}})
 f.queue(task('a','m1'),{ok:true});f.queue(task('b','m2'),{ok:true})
 assert.match((await f.debugReconsider('')).skipped,/多条待回访/)
 assert.match((await f.debugReconsider('missing-key')).skipped,/不是可处理的 pending/)
 assert.equal(sent.length,0)
 const rowB=f.status().recent.find(x=>x.taskId==='b')
 assert.equal((await f.debugReconsider(rowB.key)).status,'sent')
 assert.deepEqual(tried,['b']);assert.equal(sent.length,1)
 assert.equal(f.status().recent.find(x=>x.taskId==='a').status,'pending')
}))

test('DEBUG 不绕过全局发送频率、授权开关、静默期和回执不确定的冻结',()=>space(async dir=>{
 let at=T,quiet=false,enabled=true,sends=0
 const f=createOwnerTodoFollowup({dataDir:dir,now:()=>at,hourOf:()=>quiet?23:13,
  getConfig:()=>({...defaults(),ownerTodoCompletionFollowupEnabled:enabled,ownerTodoFollowupQuietEnabled:quiet,
    ownerTodoFollowupDailyLimit:1}),
  chooseReply:()=>({decision:'reply',text:'我找到了一点公开视频资料。'}),
  send:async()=>{sends++;return {ok:sends!==1}}})
 f.queue(task('a','m1'),{ok:true})
 enabled=false;assert.equal((await f.debugReconsider('')).skipped,'disabled');assert.equal(sends,0)
 enabled=true;quiet=true;assert.equal((await f.debugReconsider('')).skipped,'quiet-hours');assert.equal(sends,0)
 quiet=false;assert.equal((await f.debugReconsider('')).status,'uncertain');assert.equal(sends,1)
 assert.equal((await f.debugReconsider('')).skipped,'empty');assert.equal(sends,1)
 // An independently completed request can still be checked. A separate confirmed
 // send fills the global quota, which DEBUG must preserve.
 f.queue(task('b','m2'),{ok:true})
 assert.equal((await f.debugReconsider('')).status,'sent');assert.equal(sends,2)
 f.queue(task('c','m3'),{ok:true})
 assert.equal((await f.debugReconsider('')).skipped,'全局24小时回访额度已用完');assert.equal(sends,2)
}))

test('DEBUG 没有可核验事实时不能被催成发送，同时应显示模型未实际运行',()=>space(async dir=>{
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:defaults,now:()=>T,hourOf:()=>13,
  chooseReply:()=>({decision:'defer',modelInvoked:false,diagnosticReason:'缺少可核实的完成回执与可读经历；未调用模型'}),
  send:()=>{throw Error('cannot send without evidence')}})
 f.queue(task('a','m1'),{ok:true})
 const r=await f.debugReconsider(f.status().recent[0].key)
 assert.equal(r.decision,'defer');assert.equal(r.modelInvoked,false)
 assert.match(r.diagnosticReason,/未调用模型/)
 assert.equal(f.status().recent[0].lastModelInvoked,false)
 assert.match(f.status().recent[0].lastCheckReason,/缺少可核实/)
}))

test('管理中心有显式 DEBUG 路由、一次一条的按钮和反悔确认，不改原到期检查',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(host,/body\?\.action==='debug-reconsider'/)
 assert.match(host,/ownerTodoFollowup\.debugReconsider/)
 assert.match(ui,/id="owner-todo-followup-debug"/)
 assert.match(ui,/检查到期回访（不跳过延期）/)
 assert.match(js,/action:'debug-reconsider',key:row\.key/)
 assert.match(js,/action:'debug-reconsider'\}/)
 assert.match(js,/if\(!await confirmAction\(\{title:'请确认操作',description:'DEBUG/)
})
