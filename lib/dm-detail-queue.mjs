/** Account-scoped FIFO of conversation IDs awaiting a normal detail fetch.
 * No message text, message IDs, cookies, or platform content is stored.
 * Queue changes are written atomically before making any detail requests.
 */
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
const clean=v=>/^[1-9]\d{0,18}$/.test(String(v??''))?String(v):''
export function createDmDetailQueue({dataDir,now=Date.now}={}){
  if(!dataDir)throw TypeError('DM queue needs an account-scoped data directory')
  const file=join(dataDir,'dm-detail-queue.json')
  let db={version:1,rows:[]}
  try{
    const v=JSON.parse(readFileSync(file,'utf8'))
    if(v?.version!==1||!Array.isArray(v.rows)||v.rows.length>4000||
      v.rows.some(x=>!clean(x?.uid)||!Number.isSafeInteger(x.enqueuedAt)||x.enqueuedAt<0)||
      new Set(v.rows.map(x=>x.uid)).size!==v.rows.length)throw Error('invalid')
    db=v
  }catch(e){
    if(e.code!=='ENOENT')throw Error('私信待扫描队列损坏，停止扫描以防漏处理')
  }
  const store=()=>{
    mkdirSync(dataDir,{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(db)+'\n',{mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
  }
  const select=(candidates,limit)=>{
    const available=new Map(candidates.map(s=>[clean(s?.uid),s]).filter(([id])=>id))
    let changed=false
    const existing=new Set(db.rows.map(r=>r.uid))
    for(const id of available.keys()){
      if(existing.has(id))continue
      if(db.rows.length>=4000)throw Error('私信待扫描队列过长，停止读取以防丢失未处理会话')
      db.rows.push({uid:id,enqueuedAt:Math.max(0,Math.trunc(now()))})
      existing.add(id);changed=true
    }
    // Keep original arrival order across restarts, not the fluctuating unread score.
    if(changed)store()
    return db.rows.filter(r=>available.has(r.uid)).slice(0,limit).map(r=>available.get(r.uid))
  }
  const complete=id=>{
    id=clean(id);if(!id)return
    const idx=db.rows.findIndex(r=>r.uid===id)
    if(idx<0)return
    db.rows.splice(idx,1);store()
  }
  const defer=id=>{
    id=clean(id);const idx=db.rows.findIndex(r=>r.uid===id)
    if(idx<0)return
    // A single broken conversation must not starve later correspondents.
    const [row]=db.rows.splice(idx,1);db.rows.push(row);store()
  }
  return {select,complete,defer,status:()=>({pending:db.rows.length})}
}
