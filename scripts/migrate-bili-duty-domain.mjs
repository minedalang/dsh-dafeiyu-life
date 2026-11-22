#!/usr/bin/env node
/** Offline per-domain migration, no HTTP side effects. */
import {inspectDomainMigration,migrateDomainOffline,rollbackDomainOffline,STORAGE_DOMAINS,STORAGE_MIGRATION_GROUPS} from '../lib/storage-layout.mjs'
import {inspectRetainedModelCopies,cleanupRetainedModelCopies} from '../lib/storage-maintenance.mjs'
const argv=process.argv.slice(2),arg=name=>argv.includes(name)?argv[argv.indexOf(name)+1]:''
try{
 const root=arg('--root'),domain=arg('--domain'),target=arg('--to'),mode=arg('--mode')
 if(domain==='python'&&mode==='rebuild'&&process.platform!=='win32')throw Error('当前平台尚未完成 Python 视觉环境自动重建验收；仅可迁移 uv/pip 包缓存')
 if(!root||!(argv.includes('--inspect-retained-model')||argv.includes('--cleanup-retained-model'))&&(!(STORAGE_MIGRATION_GROUPS[domain]||STORAGE_DOMAINS[domain])||!target&&!argv.includes('--rollback')))throw Error('用法：node scripts/migrate-bili-duty-domain.mjs --root <当前bili-duty> --domain <model|python|memory>（旧布局兼容 whisper|embedding|media） --to <新空目录> [--mode cache|rebuild（仅 Python）] [--confirm-stopped]')
 const result=argv.includes('--inspect-retained-model')
   ?inspectRetainedModelCopies({root,verify:true})
   :argv.includes('--cleanup-retained-model')
   ?cleanupRetainedModelCopies({root,confirmedStopped:argv.includes('--confirm-stopped'),
     confirmedRuntimeVerified:argv.includes('--confirm-runtime-verified'),
     confirmedDeleteOldCopy:argv.includes('--confirm-delete-old-copy')})
   :argv.includes('--rollback')
   ?rollbackDomainOffline({root,domain,confirmedStopped:argv.includes('--confirm-stopped')})
   :argv.includes('--confirm-stopped')
     ?migrateDomainOffline({root,domain,target,mode,confirmedStopped:true})
     :inspectDomainMigration({root,domain,target,mode})
 console.log(JSON.stringify(result,null,2))
 console.log(argv.includes('--inspect-retained-model')?'只读旧副本校验完成；未修改任何数据。':
  argv.includes('--cleanup-retained-model')?'仅旧模型副本已清理；当前目标模型和 Python、Life 数据未被移动。':
  result.changesNow===false?'只读检查成功；未修改任何路径和数据。':'旧目录仍完整保留；请重新启动 DSH 并逐项验证，严禁直接清除旧数据。')
 if(result.domain==='python'&&result.mode==='cache')console.log(result.changesNow===false
  ?'预检通过：将只迁移 uv/pip 下载缓存；主/ASR/视觉虚拟环境、uv-python 与 uv-tools 保持原位置。'
  :'Python 缓存路径已切换；主/ASR/视觉虚拟环境、uv-python 与 uv-tools 仍使用原目录，不需要重装。')
 if(result.domain==='python'&&result.mode==='rebuild')console.log(result.changesNow===false
  ?'预检通过：将切换未来 Python 环境创建路径；旧环境不会复制或删除，执行后需重装主依赖、ASR 并修复视觉环境。'
  :'Python 环境路径已切换但未复制旧环境；重启后请安装主依赖、安装 ASR 依赖，并修复视觉环境。旧环境保留，可停机回退。')
}catch(e){console.error('迁移被安全拒绝：'+String(e?.message||e));process.exitCode=1}
