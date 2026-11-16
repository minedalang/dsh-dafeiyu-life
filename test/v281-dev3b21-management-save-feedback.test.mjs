import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('所有管理子页共用实时显式保存提醒，且保留原设置分组的保存按钮',()=>{
 assert.match(html,/id="settings-save-hint"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/)
 assert.match(html,/id="settings-save-hint-action"[^>]*type="button"/)
 assert.match(js,/addEventListener\('input',trackSettingChange,true\)/)
 assert.match(js,/addEventListener\('change',trackSettingChange,true\)/)
 assert.match(js,/settingDrafts\.set\(save\.id,\{panel,save,field\}\)/)
 assert.match(js,/if\(!save\)return/)
 assert.match(js,/if\(candidates\.length>1\)return null/)
 assert.match(js,/item\.save\.click\(\)/)
 assert.match(js,/if\(own\.length===1&&!item\.save\.disabled\)/)
})

test('不自动保存公开发送权限；只在确认成功提交时清除待保存提醒',()=>{
 assert.doesNotMatch(js,/localStorage\.setItem\([^\n]*settings-save-hint/)
 assert.match(js,/saveWriteCount>saveWritesBefore/)
 assert.match(js,/body\?\.previewOnly!==true/)
 assert.match(js,/if\(!button\|\|!success\|\|!settingDrafts\.has\(button\.id\)\)return/)
 assert.match(js,/addEventListener\('beforeunload'/)
 assert.match(js,/放弃本页修改并切换/)
 assert.match(js,/event\.stopImmediatePropagation\(\)/)
 assert.match(js,/confirmedDiscardNavigation=true/)
 assert.match(js,/if\(tab!==active&&\[\.\.\.settingDrafts\.values\(\)\]/)
 assert.match(js,/mobileViewOnly\|\|!field\?\.matches/)
 assert.match(js,/field\.closest\('dialog,\.settings-finder,\.headless-sync-board'\)/)
})
