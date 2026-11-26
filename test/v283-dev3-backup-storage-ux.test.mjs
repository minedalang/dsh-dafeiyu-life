import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const ui=source('lib/management-console.js'),html=source('lib/management-console.html'),host=source('index.js')
test('V2 storage page uses accessible two-zone layout and a single large-data target',()=>{
 for(const id of ['storage-location-panel','storage-current-path','storage-large-v2-current','storage-large-v2-target','storage-large-v2-check','storage-large-v2-result','storage-large-v2-schedule'])assert.ok(html.includes(`id="${id}"`),id)
 assert.match(html,/核心运行区/);assert.match(html,/大型数据区/)
 assert.match(html,/@media\(max-width:760px\)/)
 assert.match(html,/aria-live="polite"/)
})
test('backup and restore remain available and separate from data migration',()=>{
 for(const id of ['backup-directory','backup-directory-save','backup-export','backup-recovery-tools','memory-backup-export','life-memory-health'])assert.ok(html.includes(`id="${id}"`),id)
 assert.match(ui,/const loadBackupDirectory=async/)
 assert.match(host,/\/api\/bili-duty\/data-backup\/export/)
})
test('V2 models can be tested without old-copy SHA/delete workflows',()=>{
 assert.match(ui,/request\('\/storage\/verify-model-runtime'/)
 assert.match(ui,/request\('\/storage\/review-model-vision'/)
 assert.doesNotMatch(ui,/request\('\/storage\/(verify-retained-model|schedule-model-cleanup)'/)
 assert.doesNotMatch(html,/id="storage-retained-model-copy-check"/)
 assert.doesNotMatch(html,/id="storage-retained-model-cleanup"/)
})
test('legacy partition picker, undo, python migration and stale-copy cleanup no longer render',()=>{
 for(const word of ['storage-domain-list','storage-domain-help','storage-relocate','storage-life-verify-panel','storage-python-cache-check-panel','storage-archive-panel','storage-offline-steps'])
  assert.doesNotMatch(html,new RegExp(`id="${word}"`),word)
 assert.doesNotMatch(ui,/request\('\/storage\/(verify-life-memory|schedule-life-cleanup|schedule-external-life-cleanup)'/)
})


test('普通用户备份不暴露冷快照命令，npm 不分发旧冷快照工具',()=>{
 const section=html.slice(html.indexOf('<section id="panel-backup" hidden>'),html.indexOf('<section id="panel-home" hidden>'))
 assert.doesNotMatch(section,/plan-recovery|dev4-cold-state-backup|停机封存|分盘完整冷备份|cold-guide/)
 assert.doesNotMatch(ui,/cold-guide|plan-recovery/)
 const pkg=JSON.parse(source('package.json'));assert.ok(!pkg.files.includes('tools/dev4-cold-state-backup.mjs'));assert.ok(pkg.files.includes('!lib/cold-state-snapshot.mjs'))
 assert.match(html,/#fs-wizard-content #headless-model-sync-panel \.headless-provider-stack\{min-height:290px;max-height:720px;overflow:auto\}/)
})
