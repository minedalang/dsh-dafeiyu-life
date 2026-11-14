/** Read-only, account-scoped outbound audit. NEVER removes write reservations.
 * No recipient UID, body, token, or platform message is returned to management.
 */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
const HEX=/^[a-f0-9]{64}$/
const receiptName=/^\d{15}-[0-9a-f-]{36}\.json$/
const hash=s=>createHash('sha256').update(s).digest('hex')
const safeDir=path=>{if(existsSync(path)){const st=lstatSync(path);if(st.isSymbolicLink()||!st.isDirectory())throw Error('外发诊断目录不安全')}}
const safeJSON=path=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('外发诊断回执不安全');return JSON.parse(readFileSync(path,'utf8'))}
export function createOutboundActionStatus({dataDir,getAccountScope}={}){
  if(!dataDir||typeof getAccountScope!=='function')throw TypeError('缺少外发状态依赖')
  const base=join(dataDir,'outbound-action-executions')
  return ()=>{
    const scope=hash(getAccountScope()).slice(0,20)
    const locks=join(base,'locks'),receipts=join(base,'receipts'),unresolved=join(base,'unresolved')
    for(const path of [dataDir,base,locks,receipts,unresolved])safeDir(path)
    const pending=[],recent=[],confirmedIds=new Set()
    // A successful send intentionally leaves its same-day dedupe lock in
    // place. Do not mislabel that lock as an unresolved delivery.
    // Index all trusted receipts; only the newest 20 are displayed.
    if(existsSync(receipts))for(const name of readdirSync(receipts).filter(x=>receiptName.test(x)).sort().reverse()){
      try{const row=safeJSON(join(receipts,name));if(row.version===1&&row.scopeHash===scope&&HEX.test(String(row.id||''))){
        confirmedIds.add(row.id)
        if(recent.length<20)recent.push({kind:String(row.kind||'unknown').slice(0,40),at:Number(row.finishedAt)||0,state:'platform-confirmed-receipt'})
      }}catch{/* Unreadable receipts are never counted as confirmed. */}
    }
    if(existsSync(locks))for(const id of readdirSync(locks).filter(x=>HEX.test(x)).sort().slice(-300)){
      const dir=join(locks,id);safeDir(dir)
      try{const row=safeJSON(join(dir,'entry.json'))
        if(row.version!==1||row.id!==id||row.scopeHash!==scope)continue
        const confirmed=confirmedIds.has(id)
        // New records carry a hashed cross-day marker identity. A crash
        // after writing a receipt but before clearing that marker is still
        // reviewable (and still blocked), not silently treated as clean.
        const marker=HEX.test(String(row.stableHash||''))?join(unresolved,row.stableHash):null
        const markerHeld=marker?existsSync(marker):false
        if(markerHeld)safeDir(marker)
        if(confirmed&&!markerHeld)continue
        pending.push({id,kind:String(row.kind||'unknown').slice(0,40),at:Number(row.at)||0,
          state:confirmed?'receipt-recorded-marker-review':'outcome-unverified'})
      }catch{/* Broken/partial claims remain physically locked; never unlock. */}
    }
    return {ok:true,pending:pending.slice(-25),recent,locks:pending.length,
      note:'已确认成功的同日防重锁不会计作待核查；缺失回执或已记录回执但仍存在冻结标记的动作需人工核实。不自动重发，不提供解除按钮。'}
  }
}
