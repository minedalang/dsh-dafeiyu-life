#!/usr/bin/env node
/** Offline review of anonymous Life event outcomes. No platform/model access.
 * The only mutating operation closes a reviewed event WITHOUT re-execution.
 */
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {existsSync,lstatSync} from 'node:fs'
const argv=process.argv.slice(2)
const get=flag=>argv.indexOf(flag)>=0?argv[argv.indexOf(flag)+1]:undefined
const stateDir=get('--data-dir'),tag=get('--account-tag'),id=get('--close')
const inspect=argv.includes('--inspect'),close=argv.includes('--close')
const confirmed=argv.includes('--confirm-all-stopped')
if(!stateDir||!/^[a-f0-9]{16}$/.test(String(tag||''))||inspect===close||close&&(!confirmed||!/^[a-f0-9]{24}$/.test(String(id||'')))){
  console.error('Usage: --data-dir <local bili-duty> --account-tag <16-hex> (--inspect | --close <24-hex-id> --confirm-all-stopped)')
  process.exitCode=2
}else{
  try{
    const st=existsSync(stateDir)?lstatSync(stateDir):null
    if(!st?.isDirectory()||st.isSymbolicLink())throw Error('unsafe-or-missing-data-directory')
    const store=createLifeAgentEvents({stateDir,getAccountTag:()=>tag})
    const result=inspect?{ok:true,mode:'inspect',review:store.inspectReviewOffline()}:
      {mode:'close-without-replay',...store.closeReviewOffline(id,{confirmedAllStopped:true})}
    console.log(JSON.stringify(result,null,2))
    if(result.ok!==true)process.exitCode=1
  }catch{
    // Never print filesystem internals, model output, account contents or UID.
    console.error('Life Agent event ledger could not be safely reviewed; no changes confirmed.')
    process.exitCode=1
  }
}
