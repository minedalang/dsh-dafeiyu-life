/**
 * One-way, no-send migration from the retired video round report-DM channel.
 * This module does not interpret dmUid as owner identity and does not touch the
 * independent Life/social DM permissions or their recipient ledgers.
 */
import {existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync} from 'node:fs'
import {join} from 'node:path'
export function planVideoReportRetirement(saved={},host={},legacyInstall=false){
  const raw=saved && typeof saved==='object' && !Array.isArray(saved)?saved:{}
  if(raw._videoReportRetired===1)return {changed:false,config:raw}
  const hasOld=Object.hasOwn(raw,'dmMode')||Object.hasOwn(raw,'dmUid')||
    Object.hasOwn(host||{},'dmMode')||Object.hasOwn(host||{},'dmUid')
  if(!hasOld)return {changed:false,config:raw}
  // The historical delivery route is unrelated to original-comment permission.
  // Preserve autoComment exactly as saved (and leave host defaults untouched).
  const next={...raw};delete next.dmMode;delete next.dmUid
  if(Array.isArray(next._set))next._set=next._set.filter(k=>k!=='dmMode'&&k!=='dmUid')
  next._videoReportRetired=1
  return {changed:true,config:next}
}
export function retireVideoReportConfig(stateDir,{host={},legacyInstall=false}={}){
  const file=join(stateDir,'config.json')
  let saved={}
  if(existsSync(file)){
    const st=lstatSync(file)
    if(!st.isFile()||st.isSymbolicLink()||st.size>5_000_000)throw Error('配置迁移：config.json 不是安全的普通文件')
    saved=JSON.parse(readFileSync(file,'utf8'))
    if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('配置迁移：config.json 格式异常')
  }
  const result=planVideoReportRetirement(saved,host,legacyInstall)
  if(!result.changed)return result
  const temp=file+'.'+process.pid+'.tmp'
  try{
    writeFileSync(temp,JSON.stringify(result.config,null,2)+'\n',{mode:0o600,flag:'wx'})
    renameSync(temp,file)
  }catch(e){try{unlinkSync(temp)}catch{};throw e}
  return result
}
