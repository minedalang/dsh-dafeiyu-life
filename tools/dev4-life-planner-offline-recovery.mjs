#!/usr/bin/env node
/** Offline-only inspector for crashed Life Planner claims. Never contacts B站.
 * Usage: node tools/dev4-life-planner-offline-recovery.mjs --data-dir ".../bili-duty" --inspect
 * Recovery: ... --recover --confirm-all-stopped
 * Stop ALL DSH instances, back up local state, and review unknown actions first.
 */
import {createPlannerRunLease,recoverPlannerLockOffline} from '../lib/life-planner-atomic.mjs'
import {existsSync} from 'node:fs'
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1]
const dataDir=args.includes('--data-dir')?value('--data-dir'):''
const recover=args.includes('--recover'),inspect=args.includes('--inspect')
const confirmed=args.includes('--confirm-all-stopped')
if(typeof dataDir!=='string'||!dataDir||!(inspect!==recover)||recover&&!confirmed){
  console.error('Usage: --data-dir <local bili-duty directory> --inspect | --recover --confirm-all-stopped')
  process.exitCode=2
}else if(!existsSync(dataDir)){
  console.error('No such local data directory. No changes made.')
  process.exitCode=2
}else{
  const names=['autonomous-planner-run.lock','autonomous-planner-run-recovery.lock','autonomous-planner-ledger.lock','life-agent-events-ledger.lock','life-opportunities-ledger.lock']
  if(inspect){
    console.log(JSON.stringify({mode:'inspect',run:createPlannerRunLease({dataDir}).inspect(),
      recoveryGuard:{present:existsSync(dataDir+'/autonomous-planner-run-recovery.lock')},
      ledger:{present:existsSync(dataDir+'/autonomous-planner-ledger.lock')},
      events:{writeLockPresent:existsSync(dataDir+'/life-agent-events-ledger.lock')},
      opportunities:{writeLockPresent:existsSync(dataDir+'/life-opportunities-ledger.lock')}},null,2))
  }else{
    const result=names.map(name=>({name,...recoverPlannerLockOffline(dataDir,name,{confirmedAllStopped:true})}))
    console.log(JSON.stringify({mode:'offline-recovery',result},null,2))
    if(result.some(r=>!r.ok))process.exitCode=1
  }
}
