/** Last REAL production vision model attempt, no BV, account, frames or prompt. */
import {existsSync,lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
export function readProductionVisionStatus(home){
  try{
    const file=join(home,'vision-production-last.json')
    if(!existsSync(file))return null
    const st=lstatSync(file)
    if(!st.isFile()||st.isSymbolicLink()||st.size>2048)return null
    const x=JSON.parse(readFileSync(file,'utf8'))
    if(x.version!==1||!Number.isSafeInteger(x.at)||x.at<=0||x.at>Date.now()+120000||typeof x.ok!=='boolean'||
       !['analyzed','vision_unavailable','timeout','subagent_error','no_vision_result','empty_result','no_images_confirmed'].includes(x.status)||!['independent_local','independent_dsh'].includes(x.mode))return null
    return {at:x.at,ok:x.ok,model:String(x.model||'').slice(0,90),status:x.status}
  }catch{return null}
}
