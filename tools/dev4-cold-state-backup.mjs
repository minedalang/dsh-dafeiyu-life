#!/usr/bin/env node
/** Run only with DSH Desktop stopped. Snapshot includes credentials and secrets. */
import {createColdSnapshot,restoreColdSnapshot,verifyColdSnapshot,inspectSplitColdSnapshot,createSplitColdSnapshot,verifySplitColdSnapshot,restoreSplitColdSnapshot,rollbackSplitColdRestore} from '../lib/cold-state-snapshot.mjs'
const [command,...argv]=process.argv.slice(2)
const get=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:null}
const args={root:get('--root'),destination:get('--to'),snapshot:get('--snapshot'),stoppedConfirmed:argv.includes('--stopped'),confirm:get('--confirm')}
try{
  let result
  if(command==='plan-full')result=inspectSplitColdSnapshot(args.root)
  else if(command==='backup-full')result=createSplitColdSnapshot(args)
  else if(command==='verify-full')result=verifySplitColdSnapshot(args.snapshot)
  else if(command==='restore-full')result=restoreSplitColdSnapshot(args)
  else if(command==='rollback-full')result=rollbackSplitColdRestore(args)
  else if(command==='backup')result=createColdSnapshot(args)
  else if(command==='verify')result=verifyColdSnapshot(args.snapshot)
  else if(command==='restore')result=restoreColdSnapshot(args)
  else throw Error('用法：plan-full --root 生效核心目录 | backup-full --root 生效核心目录 --to 备份目录 --stopped | verify-full --snapshot 目录 | restore-full --snapshot 目录 --root 生效核心目录 --stopped --confirm RESTORE_FULL_DSH_STATE | rollback-full --root 生效核心目录 --stopped --confirm ROLLBACK_FULL_DSH_STATE；原 backup/verify/restore 仅支持旧单根格式')
  console.log(JSON.stringify(result))
}catch(e){console.error('操作未完成：'+String(e?.message||e));process.exitCode=1}
