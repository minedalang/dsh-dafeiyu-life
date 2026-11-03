import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAccountBinding,verifyBiliCredential} from '../lib/account-binding.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createBackup,allowedPath} from '../lib/data-backup.mjs'
const cred=(uid)=>({dedeuserid:String(uid),sessdata:'SESSION-for-'+uid,bili_jct:'csrf-token',buvid3:'test'})
const withDir=async fn=>{const d=mkdtempSync(join(tmpdir(),'fish-account-test-'));try{return await fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
const make=(d,opt={})=>createAccountBinding({dataDir:d,verifier:async c=>({uid:c.dedeuserid,username:'已核验'}),...opt})
const initial=d=>{writeFileSync(join(d,'bili_credential.json'),JSON.stringify(cred('10001')));return make(d)}
const switchTo=async(a,uid='20002')=>{a.stage(cred(uid));return a.activate({expectedUid:uid})}
test('升级已有账号产生稳定的角色身份，旧生命记忆不被搬走；账号收发状态隔离',()=>withDir(d=>{
 mkdirSync(join(d,'life-memory'));writeFileSync(join(d,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 writeFileSync(join(d,'dm-autoreply-state.json'),'old-dm');writeFileSync(join(d,'owner-todo-followups.json'),'old-followup')
 const a=initial(d),fish=a.characterId(),runtime=a.runtimeDir()
 assert.equal(a.status().reason,'ready')
 assert.equal(readFileSync(join(runtime,'dm-autoreply-state.json'),'utf8'),'old-dm')
 assert.equal(readFileSync(join(runtime,'owner-todo-followups.json'),'utf8'),'old-followup')
 assert.equal(readFileSync(join(d,'life-memory','episodic.json'),'utf8'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 assert.equal(make(d).characterId(),fish)
 assert.equal(readFileSync(join(d,'character-identity.json'),'utf8').includes(fish),true)
 assert.equal(allowedPath('character-identity.json'),true)
 assert.equal(allowedPath('account-login-pending.json'),false)
 assert.equal(allowedPath('accounts/10001/credential.json'),false)
 assert.equal(allowedPath('accounts/10001/runtime/dm-autoreply-state.json'),false)
 const backup=createBackup({root:d,config:{},sqlite:{}})
 assert.equal(JSON.parse(backup.files['character-identity.json']).id,fish)
 assert.equal(backup.files['dm-autoreply-state.json'],undefined)
}))
test('暂存新账号不会覆盖当前凭证，取消后恢复原账号',()=>withDir(d=>{
 const a=initial(d)
 a.stage(cred('20002'));assert.equal(a.status().reason,'login-staged')
 assert.throws(()=>a.assertReady(),/冻结/)
 assert.equal(JSON.parse(readFileSync(join(d,'bili_credential.json'),'utf8')).dedeuserid,'10001')
 a.cancel();assert.equal(a.status().reason,'ready')
}))
test('在线认证失败与 UID 伪造不得切换或丢失旧身份',()=>withDir(async d=>{
 const a=initial(d),fish=a.characterId()
 const broken=make(d,{verifier:async()=>({uid:'88888'})})
 broken.stage(cred('20002'))
 await assert.rejects(()=>broken.activate({expectedUid:'20002'}),/在线登录身份/)
 assert.equal(JSON.parse(readFileSync(join(d,'bili_credential.json'),'utf8')).dedeuserid,'10001')
 assert.equal(a.characterId(),fish)
 assert.equal(a.status().reason,'login-staged')
 a.cancel()
}))
test('新账号核验后必须重启并人工复核；旧账号状态不得复用',()=>withDir(async d=>{
 const a=initial(d),fish=a.characterId()
 a.runtimeDir();const old=join(d,'accounts','10001','runtime');writeFileSync(join(old,'owner-dm-agent.json'),'private-old')
 const todo=createOwnerTodoEngine({dataDir:d,getAccountUid:()=>a.accountUid()})
 const original=todo.add({type:'search_videos',topic:'旧号的学习',sourceKey:'shared-source'},{source:'owner'}).item
 assert.equal(original.accountUid,'10001')
 await switchTo(a);assert.equal(a.status().reason,'restart-required')
 assert.equal(a.characterId(),fish)
 assert.equal(existsSync(join(d,'accounts','10001','credential.json')),true)
 assert.throws(()=>a.resume({expectedUid:'20002'}),/先重启/)
 const b=make(d);assert.equal(b.characterId(),fish)
 assert.equal(b.runtimeDir().includes(join('20002','runtime')),true)
 assert.equal(existsSync(join(b.runtimeDir(),'owner-dm-agent.json')),false)
 assert.equal(readFileSync(join(old,'owner-dm-agent.json'),'utf8'),'private-old')
 b.acknowledgeRestart();assert.equal(b.status().reason,'review-required')
 assert.equal(b.taskAllowed(original),false)
 assert.throws(()=>b.assertReady(),/冻结/)
 b.resume({expectedUid:'20002'});assert.equal(b.status().reason,'ready')
 assert.equal(b.taskAllowed(original),false)
 const updated=createOwnerTodoEngine({dataDir:d,getAccountUid:()=>b.accountUid()})
 const next=updated.add({type:'search_videos',topic:'新号的学习',sourceKey:'shared-source'},{source:'owner'})
 assert.equal(next.created,true)
 assert.equal(next.item.accountUid,'20002');assert.equal(b.taskAllowed(next.item),true)
 assert.equal(JSON.parse(readFileSync(join(d,'owner-todos.json'),'utf8')).items.length,2)
}))
test('人为替换 Cookie 不会改变绑定 UID，恢复正确 Cookie 后才可运行',()=>withDir(d=>{
 const a=initial(d)
 writeFileSync(join(d,'bili_credential.json'),JSON.stringify(cred('30003')))
 assert.equal(a.status().reason,'uid-mismatch')
 assert.throws(()=>a.assertReady(),/冻结/)
 writeFileSync(join(d,'bili_credential.json'),JSON.stringify(cred('10001')))
 assert.equal(a.status().reason,'ready')
}))
test('通过真实 B站导航接口核对登录 UID，不信任客户端提交的 UID',async()=>{
 const out=await verifyBiliCredential(cred('10001'),{fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:{isLogin:true,mid:10001,uname:'鱼鱼'}})})})
 assert.deepEqual(out,{uid:'10001',username:'鱼鱼'})
 await assert.rejects(()=>verifyBiliCredential(cred('10001'),{fetchImpl:async()=>({ok:true,json:async()=>({code:0,data:{isLogin:true,mid:22222}})})}),/UID 与扫码凭证不一致/)
})
test('身份归档损坏或与绑定账本冲突时不能默默创建新鱼鱼',()=>withDir(d=>{
 const a=initial(d),fish=a.characterId()
 writeFileSync(join(d,'character-identity.json'),JSON.stringify({version:1,id:'00000000-0000-4000-8000-000000000000'}))
 assert.notEqual(fish,'00000000-0000-4000-8000-000000000000')
 assert.throws(()=>make(d),/角色身份与账号绑定账本不一致/)
}))
test('首次设置尚未解锁 B站视频探索导航时，仍可显式确认扫码、取消和重启复核',()=>{
 const root=new URL('../',import.meta.url)
 const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
 const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
 for(const id of ['fs-account-confirm','fs-account-cancel','fs-account-resume']){
   assert.match(html,new RegExp('id="'+id+'"'))
   assert.match(js,new RegExp("\\$\\('"+id+"'\\)\\?\\.addEventListener"))
 }
 assert.match(js,/const confirmPendingAccount=async\(\)=>/)
 assert.match(js,/const resumeAccount=async\(\)=>/)
 assert.match(js,/const cancelPendingAccount=async\(\)=>/)
 assert.doesNotMatch(js,/扫码凭证已暂存[^\n]*\n\s*switchTab\('bili'\)/)
})
