#!/usr/bin/env node
// Run only after shutting down all DSH/Headless/plugin/Python processes.
import {inspectStorageTarget,migrateStorageOffline} from '../lib/storage-location.mjs'
const args=process.argv.slice(2)
const flag=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:''}
try{
 const source=flag('--from'),target=flag('--to')
 if(!source||!target)throw Error('用法: node scripts/migrate-bili-duty-storage.mjs --from <旧bili-duty目录> --to <新bili-duty目录> [--confirm-stopped]')
 if(args.includes('--confirm-stopped')){
  const result=migrateStorageOffline({source,target,confirmedStopped:true})
  console.log('冷迁移成功：'+JSON.stringify(result))
  console.log('旧目录已保留。重启 DSH 并确认账号和记忆正确后再决定是否手动归档旧目录。')
 }else{
  console.log('只读预检：'+JSON.stringify(inspectStorageTarget({source,target})))
  console.log('确认退出所有 DSH 进程后，再加 --confirm-stopped 执行。')
 }
}catch(e){console.error('拒绝迁移：'+String(e?.message||e));process.exitCode=1}
