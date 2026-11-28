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
       !['analyzed','vision_incomplete','vision_unavailable','timeout','subagent_error','no_vision_result','empty_result','no_images_confirmed'].includes(x.status)||!['independent_local','independent_dsh'].includes(x.mode))return null
    if(x.ok&&x.status!=='analyzed')return null
    const model=typeof x.model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,89}$/.test(x.model)?x.model:''
    const allowedFailures=new Set(['ollama_service_offline','ollama_model_missing','ollama_http_error',
      'ollama_request_timeout','ollama_connection_failed','vision_board_deadline','vision_board_time_mismatch',
      'vision_board_grid_mismatch','vision_board_truncated','vision_board_empty_answer','vision_board_unsegmented',
      'vision_board_unclassified'])
    return {at:x.at,ok:x.ok,mode:x.mode,model,status:x.status,
      ...(x.mode==='independent_local'&&x.provider==='llama.cpp'?{provider:'llama.cpp'}:{}),
      errorCode:allowedFailures.has(x.errorCode)?x.errorCode:null}
  }catch{return null}
}
