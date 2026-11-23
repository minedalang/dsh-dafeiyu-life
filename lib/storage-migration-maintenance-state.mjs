/** Small, read-only maintenance lease: a restarted DSH may host ONLY the
 * migration waiting page. The worker exempts this exact fresh PID, never a
 * full DSH runtime or arbitrary Python process. */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateLocalDataPath} from './storage-location.mjs'
const FILE='.dafeiyu-migration-maintenance-v1.json'
export const maintenanceFile=root=>join(validateLocalDataPath(root),FILE)
export function writeMaintenanceLease(root,{jobId,pid,token}){
 if(typeof jobId!=='string'||!Number.isSafeInteger(pid)||pid<=0||!token)throw Error('维护模式身份不完整')
 const dest=maintenanceFile(root),tmp=dest+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify({schema:1,jobId,pid,token,heartbeatAt:Date.now()})+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,dest)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
}
export function readMaintenanceExemptPid(root,jobId,{now=Date.now()}={}){
 const dest=maintenanceFile(root)
 if(!existsSync(dest))return null
 const stat=lstatSync(dest)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)throw Error('迁移维护模式身份文件不可信')
 const row=JSON.parse(readFileSync(dest,'utf8'))
 if(row?.schema!==1||row.jobId!==jobId||!Number.isSafeInteger(row.pid)||row.pid<=0||
    typeof row.token!=='string'||row.token.length<16||!Number.isFinite(row.heartbeatAt))return null
 if(row.heartbeatAt>now+2000||now-row.heartbeatAt>10000)return null
 return row.pid
}
export function removeMaintenanceLease(root,token){
 const dest=maintenanceFile(root)
 if(!existsSync(dest))return
 try{if(JSON.parse(readFileSync(dest,'utf8')).token===token)rmSync(dest,{force:true})}catch{/* do not alter unknown marker */}
}
