import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createFirstStart} from '../lib/first-start.mjs'

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('2.8.0 已完成安装须重新查看 2.8.1 引导，但旧凭据与业务解锁状态不变',t=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-281-upgrade-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const cred=join(dir,'bili_credential.json')
  writeFileSync(cred,'existing-user-credential')
  const digest=createHash('sha256').update('existing-user-credential').digest('hex')
  const stateFile=join(dir,'first-start-v1.json')
  const former={version:1,completed:true,welcomeSeen:true,quickSetupSeenRevision:4,
    biliCredentialHash:digest,skipped:['main-session'],otherLegacyState:'preserve'}
  writeFileSync(stateFile,JSON.stringify(former))
  const gate=createFirstStart({stateDir:dir,credentialPath:cred,headlessSync:{hasAnyVerified:()=>true}})
  assert.equal(gate.status().quickSetupRevision,5)
  assert.equal(gate.status().quickSetupSeen,false)
  assert.equal(gate.status().completed,true)
  assert.equal(gate.isReady(),true,'新版介绍不应暂停正常运行的后台 Life')
  assert.equal(gate.status().biliVerified,true)
  gate.acknowledgeQuickSetup()
  assert.equal(gate.status().quickSetupSeen,true)
  assert.equal(gate.isReady(),true)
  assert.equal(readFileSync(cred,'utf8'),'existing-user-credential')
  const updated=JSON.parse(readFileSync(stateFile,'utf8'))
  assert.equal(updated.otherLegacyState,'preserve')
  assert.deepEqual(updated.skipped,['main-session'])
  assert.equal(updated.quickSetupSeenRevision,5)
})

test('首次配置页包含独立视觉模型流程，默认不启用、不自动安装，且复用现有模型页',()=>{
  const page=read('lib/management-console.html')
  const js=read('lib/management-console.js')
  const server=read('index.js')
  assert.match(page,/id="fs-vision-guide"/)
  assert.match(page,/id="fs-vision-state"/)
  assert.match(page,/DSH 多模态 Provider \/ 模型/)
  assert.match(page,/自动修复视觉运行环境/)
  assert.match(page,/人工认可并启用/)
  assert.match(page,/data-open-tab="models" data-open-anchor="models-vision-settings"/)
  assert.match(page,/不自动下载安装/)
  assert.match(js,/renderFirstStartVision/)
  assert.match(js,/const needsSetup=!state\.completed\|\|!state\.requiredReady\|\|!state\.quickSetupSeen/)
  assert.match(server,/visionEnabled: z\.boolean\(\)\.default\(false\)/)
  assert.doesNotMatch(js,/\/onboarding\/vision\/autoenable/)
})

test('旧用户升级但未确认新版引导时保持后台工作；只在管理页显示提醒',()=>{
  const js=read('lib/management-console.js')
  const firstStart=read('lib/first-start.mjs')
  assert.match(firstStart,/isReady:\(\)=>status\(\)\.completed/)
  assert.match(js,/fs-warning'\)\.hidden=unlocked&&quickAcknowledged/)
  assert.match(js,/现有后台 Life 不会因此暂停/)
})

test('npm 安装包包含 2.8.1 升级指南、发布审计说明与检查单',()=>{
  const manifest=JSON.parse(read('package.json'))
  for(const path of ['docs/architecture','docs/release/README.md',
    'docs/release/2.8.1-user-upgrade-guide.md',
    'docs/release/2.8.1-release-checklist.md',
    'docs/release/RELEASE_NOTES_v2.8.1.md']){
    assert.ok(manifest.files.includes(path),`安装包遗漏 ${path}`)
  }
  assert.match(manifest.version,/^2\.8\.(?:1|2)(?:-dev\..+)?$/,'版本只能为 2.8.1 或同版开发候选')
})


test('2.8.1 快速设置入口定位 02B 且新版视觉卡片突出；模型开关位于标题和折叠外',()=>{
  const page=read('lib/management-console.html')
  const js=read('lib/management-console.js')
  assert.match(page,/href="#fs-vision-guide" data-fs-step="preferences"/)
  assert.match(page,/id="fs-vision-guide"/)
  assert.match(page,/fs-new-281-badge/)
  assert.match(page,/绿色|#47a782/)
  const vision=page.indexOf('id="models-vision-settings"')
  const content=page.indexOf('class="model-task-body" id="models-vision-settings-body"',vision)
  const toggle=page.indexOf('id="models-vision-enabled"',vision)
  assert.ok(vision>0&&content>vision&&toggle>content,'视频权限开关必须位于可展开的模型配置内，不能压在折叠标题上')
  assert.match(js,/visionSection\.dataset\.videoObservationEnabled/)
  assert.match(js,/if\(element\?\.tagName==='DETAILS'\)element\.open=true/)
  assert.match(js,/event\.preventDefault\(\)/)
  assert.match(js,/management-jump-cue/)
  assert.match(js,/revealTarget\(target\)/)
  assert.match(page,/prefers-reduced-motion:reduce/)
  assert.match(read('README.md'),/2\.8\.2 重点优化/)
  assert.match(read('docs\/release\/RELEASE_NOTES_v2.8.1.md'),/2\.8\.1/)
  // README must state the exact package version, including a stable release candidate.
  assert.match(read('README.md'),new RegExp(JSON.parse(read('package.json')).version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
})
