#!/usr/bin/env node
/** Offline per-domain migration, no HTTP side effects. */
import {inspectDomainMigration,migrateDomainOffline,rollbackDomainOffline,STORAGE_DOMAINS} from '../lib/storage-layout.mjs'
const argv=process.argv.slice(2),arg=name=>argv.includes(name)?argv[argv.indexOf(name)+1]:''
try{
 const root=arg('--root'),domain=arg('--domain'),target=arg('--to')
 if(!root||!STORAGE_DOMAINS[domain]||!target&&!argv.includes('--rollback'))throw Error('用法：node scripts/migrate-bili-duty-domain.mjs --root <当前bili-duty> --domain <whisper|embedding|python|media|memory> --to <新空目录> [--confirm-stopped]')
 const result=argv.includes('--rollback')
   ?rollbackDomainOffline({root,domain,confirmedStopped:argv.includes('--confirm-stopped')})
   :argv.includes('--confirm-stopped')
     ?migrateDomainOffline({root,domain,target,confirmedStopped:true})
     :inspectDomainMigration({root,domain,target})
 console.log(JSON.stringify(result,null,2))
 console.log(result.changesNow===false?'只读检查成功；未修改任何路径和数据。':'旧目录仍完整保留；请重新启动 DSH 并逐项验证，严禁直接清除旧数据。')
}catch(e){console.error('迁移被安全拒绝：'+String(e?.message||e));process.exitCode=1}
