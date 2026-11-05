/**
 * A real, isolated LOCAL acceptance runner. It never imports an MCP client,
 * AI model, network library, or a user's actual account/data directory.
 * Intended as a deterministic first checkpoint before real Windows/B站 tests.
 */
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createReadActionExecutionGate,readToolAction,ReadActionHeldError} from './read-action-execution-gate.mjs'
import {createOwnerTodoEngine} from './owner-todos.mjs'

const BV='BV1abcde1234'

export async function runDev3OfflineAcceptance(){
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-dev3-check-'))
  const checks=[]
  const run=async(id,label,fn)=>{
    try{const ok=await fn();checks.push({id,label,ok:ok===true})}
    catch{checks.push({id,label,ok:false})}
  }
  try{
    await run('identities','评论列表、楼中楼和视频元数据属于不同只读动作',()=>{
      const list=readToolAction('bili_comments',{bvid:BV})
      const thread=readToolAction('bili_comment_thread',{bvid:BV,root:123})
      const video=readToolAction('bili_video_info',{bvid:BV})
      return list.operation==='bili_comments'&&thread.operation==='bili_comment_thread'&&
        list.target!==thread.target&&video.target!==list.target&&
        readToolAction('bili_follow_creator',{bvid:BV})===null
    })
    await run('single-flight','相同账号同一次读取仅有一个入口执行',async()=>{
      const scope=()=> 'fictional-account-1:fake-credentials'
      const first=createReadActionExecutionGate({dataDir:home,getAccountScope:scope})
      const second=createReadActionExecutionGate({dataDir:home,getAccountScope:scope})
      const action=readToolAction('bili_comments',{bvid:BV,num:5})
      let unblock,entered=0
      const wait=new Promise(resolve=>{unblock=resolve})
      const running=first.run(action,async()=>{entered++;await wait;return {ok:true}})
      try{
        let rejected=false
        try{await second.run(action,async()=>{entered++;return {ok:true}})}
        catch(e){rejected=e instanceof ReadActionHeldError}
        return rejected&&entered===1
      }finally{unblock();await running}
    })
    await run('receipt','只读执行真实返回后释放预约，并生成技术回执',()=>{
      const gate=createReadActionExecutionGate({dataDir:home,getAccountScope:()=> 'fictional-account-1:fake-credentials'})
      const state=gate.status()
      return state.active===0&&state.recent.some(x=>x.operation==='bili_comments'&&x.state==='tool-returned')
    })
    await run('scope','同一 BV 的不同账号读取互不占用',async()=>{
      const first=createReadActionExecutionGate({dataDir:home,getAccountScope:()=> 'fictional-account-1:fake-credentials'})
      const second=createReadActionExecutionGate({dataDir:home,getAccountScope:()=> 'fictional-account-2:fake-credentials'})
      const action=readToolAction('bili_comments',{bvid:BV,num:6})
      let unblock
      const hold=new Promise(resolve=>{unblock=resolve})
      const inFlight=first.run(action,()=>hold)
      try{return (await second.run(action,async()=>({ok:true}))).ok===true}
      finally{unblock({ok:true});await inFlight}
    })
    await run('todo-stale','旧待办执行回执不能覆盖当前执行尝试',()=>{
      const todos=createOwnerTodoEngine({dataDir:home,getAccountUid:()=> '999'})
      const created=todos.add({type:'search_videos',topic:'fictional-test-topic'})
      if(!created.ok)return false
      const started=todos.begin(created.item.id)
      if(!started.ok||!started.item.attemptId)return false
      const stale=todos.finish(created.item.id,{ok:true},'invalid-attempt-id')
      const current=todos.list({includeClosed:true}).find(x=>x.id===created.item.id)
      if(!stale.stale||current?.status!=='running')return false
      const final=todos.finish(created.item.id,{ok:true,summary:'simulated receipt'},started.item.attemptId)
      return final.status==='done'
    })
    return {ok:checks.every(x=>x.ok),passed:checks.filter(x=>x.ok).length,total:checks.length,checks,
      scope:'offline-simulation',platformCalls:0,aiCalls:0,
      note:'只使用隔离的虚拟账号与本地临时数据；不证明真实 Python/Node 跨进程或 B站端到端成功。'}
  }finally{rmSync(home,{recursive:true,force:true})}
}
