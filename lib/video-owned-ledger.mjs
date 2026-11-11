/** Single, account-bound selection source for host and Python video Agent.
 * A read failure is NOT an empty successful selection; writes always fail closed.
 */
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const SCRIPT=fileURLToPath(new URL('./video-owned-ledger-read.py',import.meta.url))
const UID=/^[1-9]\d{0,18}$/
export function readOwnedVideoLedger({home,uid,python='python',timeout=3000}={}){
  if(!UID.test(String(uid||''))||typeof home!=='string'||!home||typeof python!=='string'||!python)
    return {ok:false,code:'account-not-ready',rows:[]}
  try{
    const raw=execFileSync(python,[SCRIPT,home,String(uid)],{encoding:'utf8',timeout,maxBuffer:1_500_000,windowsHide:true,stdio:['ignore','pipe','ignore'],
      env:{...process.env,PYTHONIOENCODING:'utf-8'}})
    const result=JSON.parse(raw)
    if(result?.ok!==true||!Array.isArray(result.rows))return {ok:false,code:'selection-ledger-unavailable',rows:[]}
    return {ok:true,rows:result.rows.filter(r=>/^BV[0-9A-Za-z]{10}$/.test(r.bvid))}
  }catch{return {ok:false,code:'selection-ledger-unavailable',rows:[]}}
}
// Diagnose exact account+round evidence without changing the fail-closed rule.
// The host must never treat a read error as "not selected" or a historic pick.
export function explainCommentSelection(snapshot,bvid,roundId,{previouslyPicked=false}={}){
  if(snapshot?.ok!==true)return {ok:false,reason:'comment-selection-ledger-unavailable'}
  if(previouslyPicked)return {ok:false,reason:'comment-selection-preexisting'}
  if(!/^[a-f0-9]{24}$/.test(String(roundId||'')))return {ok:false,reason:'comment-review-not-current'}
  const row=snapshot.rows.find(x=>x.bvid===bvid&&x.picked===true)
  if(!row)return {ok:false,reason:'comment-selection-not-confirmed'}
  if(row.roundId!==roundId)return {ok:false,reason:'comment-selection-round-mismatch'}
  return {ok:true}
}
export function selectedInExactRound(snapshot,bvid,roundId){
  return snapshot?.ok===true&&/^[a-f0-9]{24}$/.test(String(roundId||''))&&
    snapshot.rows.some(x=>x.bvid===bvid&&x.picked===true&&x.roundId===roundId)
}
