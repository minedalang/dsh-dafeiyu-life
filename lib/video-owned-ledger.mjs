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
export function selectedInExactRound(snapshot,bvid,roundId){
  return snapshot?.ok===true&&/^[a-f0-9]{24}$/.test(String(roundId||''))&&
    snapshot.rows.some(x=>x.bvid===bvid&&x.picked===true&&x.roundId===roundId)
}
