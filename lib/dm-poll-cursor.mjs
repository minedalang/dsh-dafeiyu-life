/** Account-scoped DM session hints only. We never persist message text here.
 * A read cursor commits only after the reply engine has persisted its dedupe state.
 * Periodic rescans remain possible even when Bilibili omits unread markers.
 */
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
const uid=v=>/^[1-9]\d{0,18}$/.test(String(v||''))?String(v):''
const timestamp=v=>Number.isFinite(Number(v))?Number(v):0
export function createDmPollCursor({dataDir,now=Date.now,quietRescanMinutes=30,unreadRescanMinutes=3}={}){
  if(!dataDir)throw TypeError('cursor dataDir required')
  const file=join(dataDir,'dm-poll-cursor.json')
  let db={version:1,people:{}}
  try{const found=JSON.parse(readFileSync(file,'utf8'));if(found?.version!==1||!found.people||Array.isArray(found.people)||typeof found.people!=='object'||Object.entries(found.people).some(([key,row])=>!uid(key)||!row||!Number.isFinite(row.lastTs)||!Number.isSafeInteger(row.unread)||row.unread<0||!Number.isSafeInteger(row.at)))throw Error('invalid');db=found}
  catch(e){if(e.code!=='ENOENT')throw Error('私信会话游标损坏，已暂停私信读取，防止旧消息被误认为新消息')}
  let pending=new Map()
  const shouldRead=s=>{
    const id=uid(s?.uid);if(!id)return false
    const last=db.people[id];if(!last)return true
    const ts=timestamp(s?.lastTs),unread=Math.max(0,Number(s?.unread)||0),elapsed=now()-Number(last.at||0)
    if(ts!==last.lastTs||unread!==last.unread)return true
    return elapsed>=(unread?unreadRescanMinutes:quietRescanMinutes)*60_000
  }
  const observed=s=>{const id=uid(s?.uid);if(id)pending.set(id,{lastTs:timestamp(s.lastTs),unread:Math.max(0,Number(s.unread)||0),at:now()})}
  const commit=()=>{
    if(!pending.size)return
    // Commit to disk before publishing the new cursor in memory. A full disk or
    // interrupted rename must not hide newly fetched conversations for this run.
    const people={...db.people}
    for(const [id,row] of pending)people[id]=row
    const entries=Object.entries(people).sort((a,b)=>b[1].at-a[1].at).slice(0,2500)
    const next={version:1,people:Object.fromEntries(entries)}
    mkdirSync(dataDir,{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(next)+'\n',{mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
    db=next
    pending=new Map()
  }
  const discard=()=>{pending=new Map()}
  return {shouldRead,observed,commit,discard,status:()=>({tracked:Object.keys(db.people).length,pending:pending.size})}
}
