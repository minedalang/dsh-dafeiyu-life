/** Outside the live directory: survives a partial rename and blocks blank startup. */
import {lstatSync,readFileSync} from 'node:fs'
import {resolve,isAbsolute,dirname,parse,basename} from 'node:path'
export const OFFLINE_RESCUE_MARKER='offline-rescue-only.json'
// A marked backup tree, its nested payloads and reserved transaction siblings
// are maintenance artifacts, never alternative live role directories.
export function assertOfflineImageClear(root){
  for(let p=resolve(root);p!==parse(p).root;p=dirname(p)){
    if(/\.(?:cold-stage|pre-restore|sealed-stage|snapshot)-[0-9a-f-]{36}$/i.test(basename(p)))throw Error('冷快照或恢复事务保留目录不是可启动的角色数据；禁止激活')
    try{lstatSync(resolve(p,OFFLINE_RESCUE_MARKER));throw Error('隔离救援资料或冷快照不是可启动的角色数据；禁止激活')}catch(e){if(e.code!=='ENOENT')throw e}
  }
}
export const coldRestoreFencePath=root=>resolve(root)+'.cold-restore-pending-v1.json'
export const coldCheckpointPath=root=>resolve(root)+'.cold-checkpoint-v1.json'
export function assertCheckpointClear(root){
  const check=base=>{
    try{lstatSync(coldCheckpointPath(base))}catch(e){if(e.code==='ENOENT')return;throw e}
    throw Error('停机封存检查点仍生效；禁止启动或写入。请先执行 plan-sealed-recovery / recover-sealed / release-seal')
  }
  const base=resolve(root);assertOfflineImageClear(base);check(base)
  // Direct offline maintenance on an already relocated core must honour the
  // same boot-parent seal as stateDirOf, not just the new data root.
  const marker=resolve(base,'.bili-duty-migration-v1.json')
  let st;try{st=lstatSync(marker)}catch(e){if(e.code==='ENOENT')return;throw e}
  if(!st.isFile()||st.isSymbolicLink()||st.size>16384)throw Error('核心迁移身份不安全')
  const m=JSON.parse(readFileSync(marker,'utf8'))
  if(m?.version===1&&m.ok===true&&m.target===base&&typeof m.source==='string'&&isAbsolute(m.source))check(m.source)
}
// For the few explicit offline account-runtime repair CLIs that accept a
// nested runtime directory instead of the plugin root. Normal online callers
// still use the original stateDirOf startup guard.
export function assertCheckpointAncestorsClear(root){
  for(let p=resolve(root);p!==parse(p).root;p=dirname(p))assertCheckpointClear(p)
}
export function assertColdRestoreClear(root){
  assertCheckpointClear(root)
  try{lstatSync(coldRestoreFencePath(root))}catch(e){if(e.code==='ENOENT')return;throw e}
  throw Error('分盘冷恢复事务尚未结算；禁止启动，请完全停机后按恢复教程回退或核查')
}
