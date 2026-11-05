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
    const pending=[],recent=[]
    if(existsSync(locks))for(const id of readdirSync(locks).filter(x=>HEX.test(x)).slice(-300)){
      const dir=join(locks,id);safeDir(dir)
      try{const row=safeJSON(join(dir,'entry.json'))
        if(row.version!==1||row.id!==id||row.scopeHash!==scope)continue
        pending.push({id,kind:String(row.kind||'unknown').slice(0,40),at:Number(row.at)||0,
          state:'recorded-no-auto-replay'})
      }catch{/* Broken/partial claims remain physically locked. */}
    }
    if(existsSync(receipts))for(const name of readdirSync(receipts).filter(x=>receiptName.test(x)).sort().slice(-100).reverse()){
      try{const row=safeJSON(join(receipts,name));if(row.version===1&&row.scopeHash===scope)
        recent.push({kind:String(row.kind||'unknown').slice(0,40),at:Number(row.finishedAt)||0,state:'platform-confirmed-receipt'})
      }catch{/* Don't treat unreadable receipts as success. */}
      if(recent.length>=20)break
    }
    return {ok:true,pending:pending.slice(-25),recent,locks:pending.length,
      note:'写入结果未知时绝不自动重试；本页不提供解除或重发按钮。仅展示当前已核验账号的脱敏回执。'}
  }
}
