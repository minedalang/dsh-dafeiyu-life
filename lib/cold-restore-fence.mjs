/** Outside the live directory: survives a partial rename and blocks blank startup. */
import {lstatSync} from 'node:fs'
import {resolve} from 'node:path'
export const OFFLINE_RESCUE_MARKER='offline-rescue-only.json'
export const coldRestoreFencePath=root=>resolve(root)+'.cold-restore-pending-v1.json'
export function assertColdRestoreClear(root){
  try{lstatSync(resolve(root,OFFLINE_RESCUE_MARKER));throw Error('隔离救援资料不是可启动的角色数据；禁止激活')}catch(e){if(e.code!=='ENOENT')throw e}
  try{lstatSync(coldRestoreFencePath(root))}catch(e){if(e.code==='ENOENT')return;throw e}
  throw Error('分盘冷恢复事务尚未结算；禁止启动，请完全停机后按恢复教程回退或核查')
}
