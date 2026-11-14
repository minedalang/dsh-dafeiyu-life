/** Private, low-detail activity snapshots for the desktop/mobile management UI
 * and future desktop pets. Polling is intentionally transport-neutral: no
 * websocket, extra listener, external access token, or raw user content.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'

const KINDS=new Set(['life','reflection','personality','video','social','dynamic','system'])
const RETENTION=48*3600*1000
const LABELS={life:'记录了一段真实生活经历',reflection:'完成一次人生反思',personality:'更新了人格成长证据',video:'处理了一轮视频探索',social:'完成一次社交互动',dynamic:'处理了生活动态草稿',system:'大肥鱼的生活系统正在运行'}
const cleanText=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,90)
export function createActivityFeed({dataDir,now=Date.now,onChange=()=>{}}={}){
  if(!dataDir)throw TypeError('activity feed requires dataDir')
  const file=join(dataDir,'activity','feed.json')
  const read=()=>{
    try{
      if(!existsSync(file))return {version:1,seq:0,rows:[]}
      const s=lstatSync(file)
      if(!s.isFile()||s.isSymbolicLink()||s.size>128*1024)throw Error('activity feed path unsafe')
      const data=JSON.parse(readFileSync(file,'utf8'))
      if(data?.version!==1||!Number.isSafeInteger(data.seq)||!Array.isArray(data.rows))throw Error('activity feed format invalid')
      return data
    }catch{return {version:1,seq:0,rows:[]}}
  }
  const publish=(kind,{count=0}={})=>{
    if(!KINDS.has(kind))return null
    const data=read(),timestamp=now(),seq=data.seq+1
    // Use fixed, local labels only. Never persist raw comments, prompts, IDs,
    // paths, user names, private memories, or model output in this feed.
    const row={seq,at:new Date(timestamp).toISOString(),kind,text:LABELS[kind],count:Math.max(0,Math.min(9999,Math.floor(Number(count)||0)))}
    data.seq=seq;data.rows=[...data.rows.filter(x=>Date.parse(x.at)>=timestamp-RETENTION),row].slice(-80)
    mkdirSync(dirname(file),{recursive:true})
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('activity feed path unsafe')
    const tmp=file+'.'+process.pid+'.tmp'
    writeFileSync(tmp,JSON.stringify(data)+'\n',{mode:0o600});renameSync(tmp,file)
    try{onChange()}catch{}
    return row
  }
  const list=({since=0,limit=15}={})=>{
    const data=read(),timestamp=now(),n=Math.max(1,Math.min(50,Math.floor(Number(limit)||15))),min=Math.max(0,Math.floor(Number(since)||0))
    return {ok:true,schema:1,transport:'poll',intervalMs:12000,cursor:data.seq,items:data.rows.filter(x=>x.seq>min&&Date.parse(x.at)>=timestamp-RETENTION).slice(-n).map(x=>({seq:x.seq,at:x.at,kind:x.kind,text:cleanText(x.text),count:x.count}))}
  }
  return {publish,list}
}
export const __test={KINDS,LABELS,RETENTION}
