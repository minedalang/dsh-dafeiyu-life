/**
 * Read-only 2.7.1-dev.1 public discussion acceptance evidence.
 * The video Agent writes bounded metadata to daily JSONL files. The management
 * page must not turn that into an AI decision, task, memory or API retry.
 * Filter on the active Bilibili credential so switching accounts never reveals
 * a previous account's diagnostic history in the new account's management UI.
 */
import {createHmac} from 'node:crypto'
import {openSync, readSync, closeSync, lstatSync} from 'node:fs'
import {join} from 'node:path'

const BV=/^BV[0-9A-Za-z]{10}$/
const DAY_MS=24*60*60*1000
const MAX_FILE_BYTES=256*1024
const STATUSES=new Set(['read','failed','partial_failure'])
const KINDS=new Set(['comment_list_read','comment_thread_read','provisional_fish_reaction'])
const REACTIONS=new Set(['curious','amused','skeptical','neutral','none'])

export const discussionAccountTag=credential=>{
  const uid=String(credential?.dedeuserid||'')
  const secret=String(credential?.sessdata||'')
  if(!/^[1-9]\d{0,18}$/.test(uid)||!secret)return ''
  return createHmac('sha256',secret).update(uid).digest('hex').slice(0,16)
}

function tailJsonl(file){
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink())throw Error('diagnostics-not-regular-file')
  const count=Math.min(st.size,MAX_FILE_BYTES)
  const buf=Buffer.alloc(count)
  const fd=openSync(file,'r')
  try{readSync(fd,buf,0,count,st.size-count)}finally{closeSync(fd)}
  let raw=buf.toString('utf8')
  // The first line can be partial when a large file is read from its tail.
  if(st.size>count)raw=raw.slice(raw.indexOf('\n')+1)
  return {truncated:st.size>count,lines:raw.split('\n').filter(Boolean).slice(-1000)}
}

const localDay=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
function asRow(e,account){
  if(!e||e.v!==1||e.account!==account||!BV.test(String(e.bvid||''))||!KINDS.has(e.kind))return null
  const at=String(e.at||'')
  const ms=Date.parse(at)
  if(!Number.isFinite(ms)||!/^\d{4}-\d\d-\d\dT/.test(at))return null
  if(e.kind==='provisional_fish_reaction'){
    return {at,bvid:e.bvid,kind:e.kind,reaction:REACTIONS.has(e.reaction)?e.reaction:'neutral',
      question:String(e.question||'').slice(0,100),count:Math.max(0,Math.min(60,Number(e.count)||0)),
      verified:false,subjective:true}
  }
  if(!STATUSES.has(e.status))return null
  const row={at,bvid:e.bvid,kind:e.kind,status:e.status,
    count:Math.max(0,Math.min(60,Number(e.count)||0)),verified:e.status==='read'}
  if(e.kind==='comment_thread_read'&&/^[1-9]\d{0,19}$/.test(String(e.root||'')))row.root=String(e.root)
  return row
}

/** Recent 7 local calendar dates; no arbitrary file path, UID or token in HTTP output. */
export function readVideoDiscussionDiagnostics({stateDir,credential,now=new Date(),days=7,limit=60}={}){
  const account=discussionAccountTag(credential)
  if(!account)return {ok:true,accountReady:false,days,events:[],summary:null,
    hint:'当前账号未登录，无法安全区分不同 B站账号的阅读记录。'}
  const events=[];let truncated=false;let unreadable=false
  const anchor=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12)
  for(let i=0;i<Math.max(1,Math.min(7,days));i++){
    const date=new Date(anchor.getTime()-i*DAY_MS)
    const file=join(stateDir,'video-discussion-reads',localDay(date)+'.jsonl')
    let lines=[]
    try{const r=tailJsonl(file);lines=r.lines;truncated ||= r.truncated}
    catch(e){if(e?.code==='ENOENT')continue;unreadable=true;continue}
    for(const line of lines){
      let row=null
      try{row=asRow(JSON.parse(line),account)}catch{}
      if(row)events.push(row)
    }
  }
  events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
  const reads=events.filter(e=>e.kind==='comment_list_read')
  const threads=events.filter(e=>e.kind==='comment_thread_read')
  const notes=events.filter(e=>e.kind==='provisional_fish_reaction')
  return {ok:true,accountReady:true,days:Math.max(1,Math.min(7,days)),
    truncated,unreadable,events:events.slice(0,Math.max(1,Math.min(100,limit))),
    summary:{readLists:reads.filter(e=>e.status==='read').length,
      emptyLists:reads.filter(e=>e.status==='read'&&e.count===0).length,
      failedLists:reads.filter(e=>e.status!=='read').length,
      readThreads:threads.filter(e=>e.status==='read').length,
      failedThreads:threads.filter(e=>e.status!=='read').length,
      provisionalNotes:notes.length},
    hint:'只显示已经实际触发的工具阅读。没有记录不能证明鱼鱼选择了不看；当前版本未保存未阅读决策和原因。'}
}
