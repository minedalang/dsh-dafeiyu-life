/**
 * Agent-scoped Life continuity handoff. The canonical Episode/relationship/
 * platform ledgers remain the only sources of facts. Handoffs are read-only,
 * deliberately omit contact identifiers and message text, and never grant a
 * tool permission or create a fresh action from a stale receipt.
 */
const AGENTS=new Set(['video','dm','comment','todo','social','reflection'])
const UID=/^[1-9]\d{0,18}$/
const ACTION=/^[a-z][a-z0-9_-]{1,45}$/
const clean=(x,n=140)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
const channels={video:new Set(['video-agent','planner']),dm:new Set(['dm']),comment:new Set(['comment']),todo:new Set(['owner-todo','todo-followup']),social:new Set(['social-agent','dm','comment']),reflection:new Set(['reflection'])}
/** Current account and original source are checked by the supplied Episode ledger. */
export function lifeSubagentHandoff({agent,episodes,sourceRef='',limit=3}={}){
  if(!AGENTS.has(agent)||!episodes)return {agent:'unknown',recent:[],source:null}
  const safeView=row=>{
    if(!row||typeof row!=='object')return null
    return {status:row.status==='review'?'review':row.status==='paused'?'paused':row.status==='completed'?'completed':'active',
      steps:Math.max(0,Math.min(5,Number(row.steps)||0)),
      history:(Array.isArray(row.history)?row.history:[]).slice(-5).filter(x=>x&&ACTION.test(String(x.action||''))&&channels[agent].has(x.channel))
        .map(x=>({action:x.action,outcome:clean(x.outcome,24),channel:x.channel})),
      nextAt:Number.isSafeInteger(row.nextAt)?row.nextAt:0}
  }
  try{
    const source=sourceRef&&typeof episodes.sourceState==='function'?safeView(episodes.sourceState(sourceRef)):null
    // Never show another DM/comment subject's activity to this person's
    // model. Only video can see its own public, anonymous global episodes.
    const recent=agent==='video'&&typeof episodes.list==='function'
      ?episodes.list({limit:Math.max(1,Math.min(5,limit))}).filter(x=>['video','exploration'].includes(x.kind)).map(safeView).filter(Boolean)
      :[]
    return {agent,source:source?.history.length?source:null,recent}
  }catch{return {agent,source:null,recent:[]}}
}
/** This is a *candidate*, not follow permission. All evidence comes from the
 * same already authenticated inbox sender. Age and turn count prevent an
 * isolated request/prompt injection from creating a new social capability. */
export function dmContactFollowCandidates({enabled=false,uid='',role='',history=[],optedOut=false,now=Date.now()}={}){
  if(enabled!==true||!UID.test(String(uid))||!Number.isSafeInteger(Number(uid))||String(Number(uid))!==String(uid)||role!=='friend'||optedOut||!Array.isArray(history))return []
  const rows=history.filter(x=>x&&['user','assistant'].includes(x.role)&&Number.isSafeInteger(Number(x.at))&&
    Number(x.at)>0&&now-Number(x.at)<=90*86400_000&&now>=Number(x.at))
  const inbound=rows.filter(x=>x.role==='user'),outbound=rows.filter(x=>x.role==='assistant')
  if(inbound.length<3||outbound.length<3||rows.length<6)return []
  const first=Math.min(...rows.map(x=>Number(x.at)))
  if(now-first<86400_000)return []
  return [{id:'follow_dm_contact',action:'follow_dm_contact',label:'自主考虑关注这位长期交流的私信联系人（需独立授权及平台复核）',risk:'outbound-write'}]
}
export function validateSubagentNextAction(proposed,candidates=[]){
  if(!proposed||typeof proposed!=='object'||Array.isArray(proposed))return null
  const id=clean(proposed.action,50),reason=clean(proposed.reason,160)
  if(Object.keys(proposed).some(key=>!['action','reason'].includes(key))||!ACTION.test(id)||!candidates.some(c=>c.action===id)||reason.length<8)return null
  return {action:id,reason}
}
