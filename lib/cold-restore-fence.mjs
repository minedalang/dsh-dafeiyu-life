/** Outside the live directory: survives a partial rename and blocks blank startup. */
import {lstatSync} from 'node:fs'
import {resolve} from 'node:path'
export const coldRestoreFencePath=root=>resolve(root)+'.cold-restore-pending-v1.json'
export function assertColdRestoreClear(root){
  try{lstatSync(coldRestoreFencePath(root))}catch(e){if(e.code==='ENOENT')return;throw e}
  throw Error('分盘冷恢复事务尚未结算；禁止启动，请完全停机后按恢复教程回退或核查')
}
