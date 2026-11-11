#!/usr/bin/env node
/** Offline-only review/recovery for the durable Life willingness admission ledger.
 * This tool never contacts Bilibili or a model and never replays an action.
 *
 * Inspect:
 *   node tools/life-willingness-offline-recovery.mjs --data-dir "<account runtime dir>" --inspect
 * Recover (ONLY after closing every DSH instance and checking platform outcomes):
 *   node tools/life-willingness-offline-recovery.mjs --data-dir "<account runtime dir>" --recover --confirm-all-stopped --confirm-platform-reviewed
 */
import {existsSync,lstatSync} from 'node:fs'
import {inspectLifeWillingnessAdmissionOffline,recoverLifeWillingnessOffline} from '../lib/life-willingness-admission.mjs'
const args=process.argv.slice(2)
const value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined
const dataDir=value('--data-dir')
const inspect=args.includes('--inspect'),recover=args.includes('--recover')
const confirmedStopped=args.includes('--confirm-all-stopped')
const reviewed=args.includes('--confirm-platform-reviewed')
if(!dataDir||inspect===recover||recover&&(!confirmedStopped||!reviewed)){
  console.error('用法：--data-dir <账号 runtime 目录> --inspect')
  console.error('恢复：--data-dir <账号 runtime 目录> --recover --confirm-all-stopped --confirm-platform-reviewed')
  process.exitCode=2
}else{
  try{
    const stat=existsSync(dataDir)?lstatSync(dataDir):null
    if(!stat?.isDirectory()||stat.isSymbolicLink())throw Error('unsafe-or-missing-runtime-dir')
    const result=inspect
      ?{mode:'inspect',...inspectLifeWillingnessAdmissionOffline({dataDir})}
      :{mode:'offline-recovery',...recoverLifeWillingnessOffline({dataDir,allScopes:true,
        confirmedAllStopped:true,platformTransactionReviewed:true})}
    console.log(JSON.stringify(result,null,2))
    if(result.ok!==true)process.exitCode=1
  }catch{
    console.error('Life 授权账本无法安全检查；没有确认任何恢复操作。')
    process.exitCode=1
  }
}
