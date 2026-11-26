#!/usr/bin/env node
/** Run only with DSH Desktop stopped. Snapshot includes credentials and secrets. */
import {createColdSnapshot,restoreColdSnapshot,verifyColdSnapshot,inspectSplitColdSnapshot,createSplitColdSnapshot,verifySplitColdSnapshot,restoreSplitColdSnapshot,rollbackSplitColdRestore,inspectModelRecovery,recoverSnapshotModels,inspectDisasterRescue,createDisasterRescue,verifyDisasterRescue,planDisasterReconciliation,sealSplitColdSnapshot,inspectSealedRecovery,recoverSealedSnapshot,releaseSealedSnapshot,planColdRecovery} from '../lib/cold-state-snapshot.mjs'
const [command,...argv]=process.argv.slice(2)
const get=flag=>{const i=argv.indexOf(flag);return i>=0?argv[i+1]:null}
const args={root:get('--root'),destination:get('--to'),snapshot:get('--snapshot'),stoppedConfirmed:argv.includes('--stopped'),confirm:get('--confirm')}
try{
  let result
  if(command==='plan-recovery')result=planColdRecovery(args)
  else if(command==='plan-full')result=inspectSplitColdSnapshot(args.root)
  else if(command==='backup-full')result=createSplitColdSnapshot(args)
  else if(command==='verify-full')result=verifySplitColdSnapshot(args.snapshot)
  else if(command==='restore-full')result=restoreSplitColdSnapshot(args)
  else if(command==='plan-model-recovery')result=inspectModelRecovery(args)
  else if(command==='recover-models')result=recoverSnapshotModels(args)
  else if(command==='plan-disaster-rescue')result=inspectDisasterRescue(args)
  else if(command==='rescue-disaster')result=createDisasterRescue(args)
  else if(command==='verify-rescue')result=verifyDisasterRescue(args.destination)
  else if(command==='plan-rescue-merge')result=planDisasterReconciliation(args.destination)
  else if(command==='seal-full')result=sealSplitColdSnapshot(args)
  else if(command==='plan-sealed-recovery')result=inspectSealedRecovery(args)
  else if(command==='recover-sealed')result=recoverSealedSnapshot(args)
  else if(command==='release-seal')result=releaseSealedSnapshot(args)
  else if(command==='rollback-full')result=rollbackSplitColdRestore(args)
  else if(command==='backup')result=createColdSnapshot(args)
  else if(command==='verify')result=verifyColdSnapshot(args.snapshot)
  else if(command==='restore')result=restoreColdSnapshot(args)
  else throw Error('用法：plan-recovery --root 原核心目录 --snapshot 快照 [--to 新目录] | plan-full --root 生效核心目录 | backup-full --root 生效核心目录 --to 备份目录 --stopped | verify-full --snapshot 目录 | restore-full --snapshot 目录 --root 生效核心目录 --stopped --confirm RESTORE_FULL_DSH_STATE | rollback-full --root 生效核心目录 --stopped --confirm ROLLBACK_FULL_DSH_STATE | plan-model-recovery --root 生效核心目录 --snapshot 快照 --to 新模型目录 | recover-models --root 生效核心目录 --snapshot 快照 --to 新模型目录 --stopped --confirm RECOVER_DSH_MODELS_ONLY | plan-disaster-rescue --snapshot 快照 --to 新隔离目录 | rescue-disaster --snapshot 快照 --to 新隔离目录 --stopped --confirm RESCUE_DSH_OFFLINE_ONLY | verify-rescue --to 隔离目录 | plan-rescue-merge --to 隔离目录 | seal-full --root 生效核心目录 --snapshot 快照 --stopped --confirm SEAL_DSH_COLD_CHECKPOINT | plan-sealed-recovery --root 原核心目录 --snapshot 快照 | recover-sealed --root 原核心目录 --snapshot 快照 --stopped --confirm RECOVER_SEALED_DSH_STATE | release-seal --root 原核心目录 --snapshot 快照 --stopped --confirm RELEASE_DSH_COLD_CHECKPOINT；原 backup/verify/restore 仅支持旧单根格式')
  console.log(JSON.stringify(result))
}catch(e){console.error('操作未完成：'+String(e?.message||e));process.exitCode=1}
