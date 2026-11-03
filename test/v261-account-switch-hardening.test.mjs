import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAccountBinding, verifyBiliCredential } from '../lib/account-binding.mjs'
import { createOwnerTodoEngine } from '../lib/owner-todos.mjs'
import { createBackup, restoreBackupFiles, validateRestoreIdentity } from '../lib/data-backup.mjs'

const credential=uid=>({dedeuserid:String(uid),sessdata:'mock-session-'+uid,bili_jct:'mock-jct',buvid3:'mock-buvid'})
const fixture=async fn=>{
  const dir=mkdtempSync(join(tmpdir(),'fish-switch-audit-'))
  try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
const binding=(dir,options={})=>createAccountBinding({dataDir:dir,verifier:async c=>({uid:c.dedeuserid}),...options})
const load=(dir,name)=>JSON.parse(readFileSync(join(dir,name),'utf8'))
const open=dir=>{writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credential('10001')));return binding(dir)}
const switchTo=async(dir,from,uid)=>{
  from.stage(credential(uid))
  await from.activate({expectedUid:uid})
  const restarted=binding(dir)
  assert.equal(restarted.status().reason,'restart-required')
  restarted.acknowledgeRestart()
  assert.equal(restarted.status().reason,'review-required')
  restarted.resume({expectedUid:uid})
  assert.equal(restarted.status().reason,'ready')
  return restarted
}

test('无 B站账号时一律冻结：恢复进来的旧待办不能被重新归属',()=>fixture(dir=>{
  const a=binding(dir)
  assert.equal(a.status().reason,'unbound')
  assert.equal(a.status().blocked,true)
  assert.throws(()=>a.assertReady(),/冻结/)
  const todos=createOwnerTodoEngine({dataDir:dir})
  const legacy=todos.add({type:'search_videos',topic:'旧号任务'},{source:'owner'}).item
  assert.equal(a.taskAllowed(legacy),false)
}))

test('已存在的损坏账本/角色/扫码暂存，必须阻断而非默默重建',()=>fixture(dir=>{
  const a=open(dir),fish=a.characterId(),ledger=readFileSync(join(dir,'account-binding.json'),'utf8')
  writeFileSync(join(dir,'account-binding.json'),'{truncated')
  assert.throws(()=>binding(dir),/文件损坏/)
  assert.equal(readFileSync(join(dir,'character-identity.json'),'utf8').includes(fish),true)
  assert.equal(readFileSync(join(dir,'account-binding.json'),'utf8'),'{truncated')
  writeFileSync(join(dir,'account-binding.json'),ledger)
  writeFileSync(join(dir,'character-identity.json'),'garbage')
  assert.throws(()=>binding(dir),/文件损坏/)
  writeFileSync(join(dir,'character-identity.json'),JSON.stringify({version:1,id:fish}))
  writeFileSync(join(dir,'account-login-pending.json'),'BROKEN')
  assert.throws(()=>binding(dir).status(),/文件损坏/)
  a.cancel()
  assert.equal(binding(dir).status().reason,'ready')
}))

test('账号账本丢失但运行目录还在，不能把历史社交状态重新绑定给当前 Cookie',()=>fixture(dir=>{
  const a=open(dir)
  a.runtimeDir()
  rmSync(join(dir,'account-binding.json'))
  writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credential('20002')))
  assert.throws(()=>binding(dir),/绑定账本缺失/)
}))

test('平台异步调用仍在运行，禁止确认换号；结束后才能提交，期间不发生串号',()=>fixture(async dir=>{
  const a=open(dir)
  const release=a.enterPlatformOperation()
  a.stage(credential('20002'))
  await assert.rejects(()=>a.activate({expectedUid:'20002'}),/平台操作尚未结束/)
  assert.equal(load(dir,'bili_credential.json').dedeuserid,'10001')
  release();release()
  assert.equal(a.status().activeOperations,0)
  const b=await switchTo(dir,a,'20002')
  assert.equal(b.accountUid(),'20002')
}))

test('核验期间启动旧账号操作应阻止真正切换，不提交新凭证',()=>fixture(async dir=>{
  let finishVerify
  open(dir)
  const slow=binding(dir,{verifier:()=>new Promise(resolve=>{finishVerify=resolve})})
  slow.stage(credential('20002'))
  const switching=slow.activate({expectedUid:'20002'})
  // A task begun BEFORE staging is represented by the old binding in practice;
  // here the pending state is deliberately cleared only after verifying that
  // activation's second idle check handles a race.
  slow.cancel()
  const release=slow.enterPlatformOperation()
  slow.stage(credential('20002'))
  finishVerify({uid:'20002'})
  await assert.rejects(switching,/平台操作尚未结束/)
  assert.equal(load(dir,'bili_credential.json').dedeuserid,'10001')
  release()
}))

test('模拟 A→B→A 保留鱼鱼身份/真实记忆，且只处理当前账号的待办',()=>fixture(async dir=>{
  const a=open(dir),fish=a.characterId()
  mkdirSync(join(dir,'life-memory'))
  const memory=JSON.stringify({version:1,episodes:[],archiveKeys:['forgotten-event']})
  writeFileSync(join(dir,'life-memory','episodic.json'),memory)
  const todos=createOwnerTodoEngine({dataDir:dir,getAccountUid:()=>a.accountUid()})
  const ta=todos.add({type:'search_videos',topic:'A 的公开视频',sourceKey:'same'},{source:'owner'}).item
  a.runtimeDir();writeFileSync(join(a.runtimeDir(),'owner-todo-followups.json'),'A-unique')
  const b=await switchTo(dir,a,'20002')
  assert.equal(b.taskAllowed(ta),false)
  const tb=createOwnerTodoEngine({dataDir:dir,getAccountUid:()=>b.accountUid()}).add({type:'search_videos',topic:'B 的公开视频',sourceKey:'same'},{source:'owner'}).item
  assert.equal(b.taskAllowed(tb),true)
  assert.equal(existsSync(join(b.runtimeDir(),'owner-todo-followups.json')),false)
  const aAgain=await switchTo(dir,b,'10001')
  assert.equal(aAgain.characterId(),fish)
  assert.equal(aAgain.taskAllowed(tb),false)
  assert.equal(aAgain.taskAllowed(ta),true)
  assert.equal(readFileSync(join(aAgain.runtimeDir(),'owner-todo-followups.json'),'utf8'),'A-unique')
  assert.equal(readFileSync(join(dir,'life-memory','episodic.json'),'utf8'),memory)
  assert.equal(load(dir,'owner-todos.json').items.length,2)
}))

test('切换中断：凭证已变但绑定账本未提交，重启后冻结，重新核验才能修复',()=>fixture(async dir=>{
  const a=open(dir),fish=a.characterId()
  a.stage(credential('20002'))
  writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(credential('20002')))
  const crashed=binding(dir)
  assert.equal(crashed.status().reason,'uid-mismatch')
  assert.throws(()=>crashed.assertReady(),/冻结/)
  await crashed.activate({expectedUid:'20002'})
  assert.equal(crashed.characterId(),fish)
  const restarted=binding(dir)
  restarted.acknowledgeRestart()
  assert.equal(restarted.status().reason,'review-required')
  restarted.resume({expectedUid:'20002'})
  assert.equal(restarted.status().reason,'ready')
}))

test('普通备份不得恢复别的鱼鱼 UUID：恢复前拒绝，原有文件零改动',()=>fixture(async dir=>{
  const a=open(dir),fish=a.characterId()
  writeFileSync(join(dir,'seen.md'),'ORIGINAL')
  const other=await fixture(otherDir=>{
    open(otherDir)
    writeFileSync(join(otherDir,'seen.md'),'OTHER DATA')
    return createBackup({root:otherDir,config:{},sqlite:{}})
  })
  assert.notEqual(JSON.parse(other.files['character-identity.json']).id,fish)
  assert.throws(()=>validateRestoreIdentity(dir,other),/不同的鱼鱼角色/)
  assert.throws(()=>restoreBackupFiles(dir,other),/不同的鱼鱼角色/)
  assert.equal(readFileSync(join(dir,'seen.md'),'utf8'),'ORIGINAL')
  assert.equal(binding(dir).characterId(),fish)
}))

test('核验失败、错误 UID、HTTP 异常不得切换；不需要真实账号',()=>fixture(async dir=>{
  const a=open(dir)
  a.stage(credential('20002'))
  await assert.rejects(()=>a.activate({expectedUid:'30003'}),/核对待切换 UID/)
  const refused=binding(dir,{verifier:async()=>({uid:'30003'})})
  await assert.rejects(()=>refused.activate({expectedUid:'20002'}),/身份未通过核验/)
  assert.equal(load(dir,'bili_credential.json').dedeuserid,'10001')
  await assert.rejects(()=>verifyBiliCredential(credential('20002'),{fetchImpl:async()=>({ok:false,status:429})}),/HTTP 429/)
  assert.equal(a.status().reason,'login-staged')
  a.cancel()
  assert.equal(a.status().reason,'ready')
}))
