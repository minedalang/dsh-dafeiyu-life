#!/usr/bin/env node
/** Offline per-domain migration, no HTTP side effects. */
import {inspectDomainMigration,migrateDomainOffline,rollbackDomainOffline,inspectDomainReturnHome,returnDomainHomeOffline,STORAGE_DOMAINS,STORAGE_MIGRATION_GROUPS} from '../lib/storage-layout.mjs'
import {inspectRetainedModelCopies,cleanupRetainedModelCopies} from '../lib/storage-maintenance.mjs'
const argv=process.argv.slice(2),arg=name=>argv.includes(name)?argv[argv.indexOf(name)+1]:''
try{
 const root=arg('--root'),domain=arg('--domain'),target=arg('--to'),mode=arg('--mode')
 if(domain==='python'&&mode&&mode!=='cache')throw Error('Python 分区仅可迁移 uv/pip 包管理缓存；不提供运行环境重建')
 if(!root||!(argv.includes('--inspect-retained-model')||argv.includes('--cleanup-retained-model'))&&(!(STORAGE_MIGRATION_GROUPS[domain]||STORAGE_DOMAINS[domain])||!target&&!argv.includes('--rollback')&&!argv.includes('--return-home')))throw Error('用法：node scripts/migrate-bili-duty-domain.mjs --root <当前bili-duty> --domain <model|python|memory>（旧布局兼容 whisper|embedding|media） --to <新空目录> [--mode cache（仅 Python）] [--confirm-stopped]')
 const result=argv.includes('--inspect-retained-model')
   ?inspectRetainedModelCopies({root,verify:true})
   :argv.includes('--cleanup-retained-model')
   ?cleanupRetainedModelCopies({root,confirmedStopped:argv.includes('--confirm-stopped'),
     confirmedRuntimeVerified:argv.includes('--confirm-runtime-verified'),
     confirmedDeleteOldCopy:argv.includes('--confirm-delete-old-copy')})
   :argv.includes('--return-home')
   ?argv.includes('--confirm-stopped')?returnDomainHomeOffline({root,domain,confirmedStopped:true}):inspectDomainReturnHome({root,domain})
   :argv.includes('--rollback')
   ?rollbackDomainOffline({root,domain,confirmedStopped:argv.includes('--confirm-stopped')})
   :argv.includes('--confirm-stopped')
     ?migrateDomainOffline({root,domain,target,mode,confirmedStopped:true})
     :inspectDomainMigration({root,domain,target,mode})
 console.log(JSON.stringify(result,null,2))
 console.log(argv.includes('--inspect-retained-model')?'只读旧副本校验完成；未修改任何数据。':
  argv.includes('--cleanup-retained-model')?'仅旧模型副本已清理；当前目标模型和 Python、Life 数据未被移动。':
  result.changesNow===false?'只读检查成功；未修改任何路径和数据。':'原有数据及外置副本均保留；请重新启动 DSH 并验证生效目录。')
 if(result.domain==='python'&&result.mode==='cache')console.log(result.changesNow===false
  ?'预检通过：将只迁移 uv/pip 下载缓存；主/ASR/视觉虚拟环境、uv-python 与 uv-tools 保持原位置。'
  :'Python 缓存路径已切换；主/ASR/视觉虚拟环境、uv-python 与 uv-tools 仍使用原目录，不需要重装。')
}catch(e){console.error('迁移被安全拒绝：'+String(e?.message||e));process.exitCode=1}
