/** Authoritative local receipts for this plugin's own published dynamics. */
import {existsSync,lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {validDynamicId} from './bili-content-ref.mjs'
export function ownPublishedDynamics(dataDir){
 const path=join(dataDir,'daily-dynamic','drafts.json')
 try{
  if(!existsSync(path))return []
  const st=lstatSync(path)
  if(!st.isFile()||st.isSymbolicLink()||st.size>400000)return []
  const data=JSON.parse(readFileSync(path,'utf8'))
  if(!Array.isArray(data?.drafts))return []
  return [...new Set(data.drafts.filter(d=>d?.status==='published'&&validDynamicId(d.dynamicId))
    .map(d=>String(d.dynamicId)))].slice(-60).reverse()
 }catch{return []}
}
