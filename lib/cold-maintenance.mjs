/** Explicit local maintenance only. Not a Life tool or an HTTP endpoint. */
import {assertMaintenanceRole,assertMaintenanceSnapshot,createSplitColdSnapshot,verifySplitColdSnapshot,
  inspectSplitColdSnapshot,sealSplitColdSnapshot,inspectSealedRecovery,recoverSealedSnapshot,releaseSealedSnapshot,
  restoreSplitColdSnapshot,rollbackSplitColdRestore,planColdRecovery,inspectDisasterRescue,createDisasterRescue,
  verifyDisasterRescue,planDisasterReconciliation,inspectModelRecovery,recoverSnapshotModels} from './cold-state-snapshot.mjs'
import {assertColdRestoreClear} from './cold-restore-fence.mjs'

// Test-only dependency injection is not reachable from the CLI arguments.
export function runColdMaintenance(command,args={}, {checkStopped}={}){
  const options={root:args.root,destination:args.destination,snapshot:args.snapshot,
    stoppedConfirmed:args.stoppedConfirmed===true,confirm:args.confirm,...(checkStopped?{checkStopped}:{})}
  const requireStop=confirm=>{
    if(!options.stoppedConfirmed||options.confirm!==confirm)throw Error('必须完全停机并输入对应的明确确认口令')
  }
  const live=()=>{assertColdRestoreClear(options.root);assertMaintenanceRole(options.root)}
  const image=()=>assertMaintenanceSnapshot(options.snapshot)
  switch(command){
    case 'plan-full': live();return inspectSplitColdSnapshot(options.root)
    case 'backup-full':
    case 'backup-sealed': {
      requireStop(command==='backup-sealed'?'CREATE_AND_SEAL_DSH_STATE':'CREATE_LOCAL_DSH_SNAPSHOT')
      live()
      const captured=createSplitColdSnapshot(options)
      assertMaintenanceSnapshot(options.destination)
      if(command==='backup-full')return {...captured,activationAllowed:false,sealed:false}
      // The old seal engine independently proves that every captured file is
      // still identical; it refuses retroactive or partially completed seals.
      return sealSplitColdSnapshot({...options,snapshot:options.destination,confirm:'SEAL_DSH_COLD_CHECKPOINT'})
    }
    case 'verify-full': image();return {...verifySplitColdSnapshot(options.snapshot),activationAllowed:false}
    case 'seal-full': image();live();return sealSplitColdSnapshot(options)
    case 'plan-sealed-recovery': image();return inspectSealedRecovery(options)
    case 'recover-sealed': image();return recoverSealedSnapshot(options)
    case 'release-seal': image();return releaseSealedSnapshot(options)
    case 'restore-full': image();live();return restoreSplitColdSnapshot(options)
    case 'rollback-full': return rollbackSplitColdRestore(options)
    case 'plan-recovery': image();return planColdRecovery(options)
    case 'plan-model-recovery': image();live();return inspectModelRecovery(options)
    case 'recover-models': image();live();return recoverSnapshotModels(options)
    case 'plan-disaster-rescue': image();return inspectDisasterRescue(options)
    case 'rescue-disaster': image();return createDisasterRescue(options)
    case 'verify-rescue': return verifyDisasterRescue(options.destination)
    case 'plan-rescue-merge': return planDisasterReconciliation(options.destination)
    default: throw Error('未知维护命令；请查看 docs/architecture/cold-maintenance.md')
  }
}
