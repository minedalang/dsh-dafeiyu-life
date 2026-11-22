/** Read-only storage archive inventory: NEVER deletes, restores or opens memory text. */
import {existsSync,lstatSync,readdirSync} from 'node:fs'
import {join,dirname,basename} from 'node:path'
import {validateLocalDataPath} from './storage-location.mjs'
import {storageLayoutStatus} from './storage-layout.mjs'
const RETURN_OLD=/^\.dafeiyu-return-old-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RETIRED_LIFE=/^\.dafeiyu-retired-life-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function measure(path){
 let files=0,bytes=0,visited=0,incomplete=false
 const stack=[path]
 while(stack.length){
  const item=stack.pop(),s=lstatSync(item)
  if(s.isSymbolicLink()||!s.isDirectory()&&!s.isFile()){incomplete=true;continue}
  if(s.isFile()){files++;bytes+=s.size}
  else for(const name of readdirSync(item)){stack.push(join(item,name))}
  if(++visited>40000||bytes>120*1024**3){incomplete=true;break}
 }
 return {files,bytes,incomplete}
}
export function storageArchiveInventory({root,migrationJob={},lifeReturnEvidence}={}){
 const base=validateLocalDataPath(root),status=storageLayoutStatus(base)
 const entries=[],seen=new Set(),parent=dirname(base)
 const add=(path,kind)=>{
  if(typeof path!=='string'||seen.has(path)||!existsSync(path))return
  try{
   validateLocalDataPath(path)
   const st=lstatSync(path)
   if(!st.isDirectory()||st.isSymbolicLink())return
   if(Object.values(status.domains).some(row=>row.configured&&row.root===path))return
   seen.add(path)
   entries.push({path,kind,...measure(path),current:false,eligibleForDeletion:false})
  }catch{/* Unknown or unsafe archive is never deletion-eligible. */}
 }
 for(const name of readdirSync(parent).sort()){
  if(entries.length>=32)break
  if(RETURN_OLD.test(name))add(join(parent,name),'回迁时隔离的旧默认目录副本')
 }
 const archived=migrationJob?.oldExternalCopyArchive
 if(typeof archived==='string'&&RETIRED_LIFE.test(basename(archived)))add(archived,'上次复用 D 盘时保留的历史 Life 快照')
 const retained=lifeReturnEvidence||migrationJob
 if(retained?.status==='completed'&&retained.operation==='return-home'&&retained.domain==='memory'){
  for(const path of Array.isArray(retained.externalSources)?retained.externalSources.slice(0,4):[]){
   if(typeof path!=='string'||path.length>420)continue
   // This source was retained after return-home; do not show it as active.
   add(path,'回迁后保留的原外置 Life 分区')
  }
 }
 return {items:entries,totalBytes:entries.reduce((n,x)=>n+x.bytes,0),truncated:entries.length>=32,
  note:'仅统计可识别的历史副本，不含未知用户目录。外置 Life 旧分区可在当前回迁记录有效时单独验证并预约停机删除；其他隔离档案仍受保护。'}
}
