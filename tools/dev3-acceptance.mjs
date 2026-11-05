#!/usr/bin/env node
/** No B站 network, no DSH credential access. A CLI companion to the console selftest. */
import {runDev3OfflineAcceptance} from '../lib/dev3-offline-acceptance.mjs'
import {spawnSync} from 'node:child_process'
const result=await runDev3OfflineAcceptance()
console.log('大肥鱼 dev.3 · 离线基础能力验收（不访问 B站、无真实账号资料）')
for(const row of result.checks)console.log((row.ok?'PASS':'FAIL')+'  '+row.label)
console.log(`结果：${result.passed}/${result.total} 通过`)
if(!result.ok){process.exitCode=1}
if(process.argv.includes('--crosslang')||process.argv.includes('--all')){
 console.log('\n跨语言预约与待办并发专项：使用虚拟账号和真实子进程')
 const cmd=spawnSync(process.execPath,['--test','--test-concurrency=1','test/v271-dev3-discussion-shared-gate.test.mjs','test/v271-dev3-crosslang-todo-transaction.test.mjs','test/v271-dev3-danmaku-read-gate.test.mjs','test/v271-dev3-subtitle-read-gate.test.mjs'],{cwd:new URL('../',import.meta.url),stdio:'inherit',timeout:120000})
 if(cmd.error||cmd.status!==0)process.exitCode=1
}

if(process.argv.includes('--scenario')||process.argv.includes('--all')){
 console.log('\n自主生活、真实评论顺路参与、人物边界与动作协调 · 模拟场景测试（不访问 B站）')
 const suite=[
  'test/v271-dev3-cross-scene-capabilities.test.mjs',
  'test/v271-dev3-unified-life-intentions.test.mjs',
  'test/v271-dev3-private-life-affinity.test.mjs',
  'test/v271-dev3-side-hot-replies.test.mjs',
  'test/v271-dev3-shared-action-coordination.test.mjs'
 ]
 const command=spawnSync(process.execPath,['--test',...suite],{cwd:new URL('../',import.meta.url),stdio:'inherit',timeout:120000})
 if(command.error||command.status!==0)process.exitCode=1
}
