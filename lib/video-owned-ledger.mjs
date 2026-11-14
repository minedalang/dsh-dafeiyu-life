/** Single, account-bound selection source for host and Python video Agent.
 * A read failure is NOT an empty successful selection; writes always fail closed.
 */
import {execFileSync,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const SCRIPT=fileURLToPath(new URL('./video-owned-ledger-read.py',import.meta.url))
const UID=/^[1-9]\d{0,18}$/
const execAsync=promisify(execFile)
const INPUT_OK=({home,uid,python})=>UID.test(String(uid||''))&&typeof home==='string'&&!!home&&typeof python==='string'&&!!python
function decode(raw){
  const data=JSON.parse(raw)
  if(data?.ok!==true||!Array.isArray(data.rows))return {ok:false,code:data?.code||'selection-ledger-unavailable',rows:[]}
  return {ok:true,rows:data.rows.filter(r=>/^BV[0-9A-Za-z]{10}$/.test(r.bvid))}
}
function failureCode(error){
  return error?.killed===true||error?.signal==='SIGTERM'||error?.code==='ETIMEDOUT'?'selection-reader-timeout':'selection-ledger-unavailable'
}
const readOpts=timeout=>({encoding:'utf8',timeout,maxBuffer:1_500_000,windowsHide:true,
  env:{...process.env,PYTHONIOENCODING:'utf-8'}})
export function readOwnedVideoLedger({home,uid,python='python',timeout=3000}={}){
  if(!INPUT_OK({home,uid,python}))
    return {ok:false,code:'account-not-ready',rows:[]}
  try{
    return decode(execFileSync(python,[SCRIPT,home,String(uid)],{...readOpts(timeout),stdio:['ignore','pipe','ignore']}))
  }catch(error){return {ok:false,code:failureCode(error),rows:[]}}
}
/** Async, fail-closed comment eligibility read. Retry only transient reader faults.
 * The DSH event loop stays responsive while Python starts or SQLite is busy.
 * This is a local-only retry: no new AI request, platform read, or send.
 */
export async function readOwnedVideoLedgerForComment({home,uid,python='python',timeout=5500,runner=execAsync}={}){
  if(!INPUT_OK({home,uid,python}))return {ok:false,code:'account-not-ready',rows:[],attempts:0}
  let last={ok:false,code:'selection-ledger-unavailable',rows:[]}
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const result=await runner(python,[SCRIPT,home,String(uid)],readOpts(timeout))
      last=decode(typeof result==='string'?result:result.stdout)
    }catch(error){last={ok:false,code:failureCode(error),rows:[]}}
    if(last.ok===true||!['selection-reader-timeout','selection-ledger-busy'].includes(last.code))
      return {...last,attempts:attempt}
  }
  return {...last,attempts:2}
}
// Diagnose exact account+round evidence without changing the fail-closed rule.
// The host must never treat a read error as "not selected" or a historic pick.
export function explainCommentSelection(snapshot,bvid,roundId,{previouslyPicked=false}={}){
  if(snapshot?.ok!==true)return {ok:false,reason:'comment-selection-ledger-unavailable'}
  // A previous pick is only eligible while its separate Life decision is
  // durably pending; an earlier approval, skip or uncertain send is terminal.
  const row=snapshot.rows.find(x=>x.bvid===bvid&&x.picked===true)
  const recovering=previouslyPicked&&row?.reviewState==='pending'&&
    !row.delivered&&!row.commented&&Number.isFinite(row.selectedAt)&&row.selectedAt>0&&
    Date.now()-row.selectedAt>=0&&Date.now()-row.selectedAt<=86_400_000
  if(previouslyPicked&&!recovering)return {ok:false,reason:'comment-selection-preexisting'}
  if(!/^[a-f0-9]{24}$/.test(String(roundId||'')))return {ok:false,reason:'comment-review-not-current'}
  if(!row)return {ok:false,reason:'comment-selection-not-confirmed'}
  if(row.roundId!==roundId&&!recovering)return {ok:false,reason:'comment-selection-round-mismatch'}
  return {ok:true,recovered:recovering}
}
export function recoverableCommentCandidates(snapshot,{now=Date.now(),limit=2}={}){
  if(snapshot?.ok!==true)return []
  return snapshot.rows.filter(row=>row.picked===true&&row.reviewState==='pending'&&
    !row.delivered&&!row.commented&&Number.isFinite(row.selectedAt)&&row.selectedAt>0&&
    now-row.selectedAt>=0&&now-row.selectedAt<=86_400_000)
    .sort((a,b)=>b.selectedAt-a.selectedAt).slice(0,Math.max(0,Math.min(4,limit)))
}
export function selectedInExactRound(snapshot,bvid,roundId){
  return snapshot?.ok===true&&/^[a-f0-9]{24}$/.test(String(roundId||''))&&
    snapshot.rows.some(x=>x.bvid===bvid&&x.picked===true&&x.roundId===roundId)
}
