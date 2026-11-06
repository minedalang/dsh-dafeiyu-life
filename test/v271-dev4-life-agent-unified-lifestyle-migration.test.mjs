import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {legacyVideoTimerAllowed,lifeDriverOwnership,lifeSettingsV2,planLifeSettingsV2,
  assertLegacyVideoPatchCompatible,assertLegacyLifeSettingsPatchCompatible} from '../lib/life-settings-control.mjs'
const old=()=>({masterEnabled:true,lifeAgentMode:'off',peakValley:true,
  peakWindows:'[{"start":"09:00","end":"12:00"}]',peakIntervalMinutes:5,
  autonomousPlannerEnabled:true,autonomousPlannerMinutes:42,autonomousPlannerDailyLimit:6,
  autonomousPlannerStartHour:10,autonomousPlannerEndHour:22,
  socialAutoSend:true,dmStrangerAutonomyEnabled:false,ownerTodoCompletionFollowupEnabled:true,
  lifeAgentSocialContextOptIn:false,dmWhitelist:'keep-user-existing-permissions'})
const plan=(config,options={})=>planLifeSettingsV2(config,{schemaVersion:2,
  revision:lifeSettingsV2(config).revision,mode:'active',pace:'natural',previewOnly:true,...options})
test('legacy timer is permanently retired on stale persisted configs and cannot be re-enabled',()=>{
 const c=old(),before=structuredClone(c)
 assert.equal(legacyVideoTimerAllowed(c),false)
 assert.equal(lifeDriverOwnership(c).videoWakeOwner,'none')
 assert.equal(lifeSettingsV2(c).legacyVideoTimerRetired,true)
 assert.equal(assertLegacyVideoPatchCompatible(c,{peakValley:true}),true)
 assert.throws(()=>assertLegacyVideoPatchCompatible({...c,peakValley:false},{peakValley:true}),/已退役/)
 assert.deepEqual(c,before)
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.doesNotMatch(index,/setInterval\(tick,\s*60_000\)/)
 assert.doesNotMatch(index,/runDuty\(`window:/)
 assert.match(index,/runDuty\('manual'\)/)
})
test('simple activation preserves unrelated hours, private data and every outbound consent',()=>{
 const c=old(),before=structuredClone(c)
 const preview=plan(c)
 assert.deepEqual(preview.patch,{lifeAgentMode:'active',peakValley:false,autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40})
 assert.deepEqual(c,before)
 const applied=plan(c,{previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'})
 assert.deepEqual(applied.patch,preview.patch)
 for(const key of ['masterEnabled','autonomousPlannerStartHour','autonomousPlannerEndHour',
   'socialAutoSend','dmStrangerAutonomyEnabled','ownerTodoCompletionFollowupEnabled',
   'lifeAgentSocialContextOptIn','dmWhitelist','peakWindows','peakIntervalMinutes']){
   assert.equal(Object.hasOwn(applied.patch,key),false,key)
 }
 assert.equal(lifeDriverOwnership({...c,...applied.patch}).videoWakeOwner,'life-agent')
})
test('custom advanced interval, limit and hours share the same existing config authority',()=>{
 const c=old(),advanced={minutes:75,dailyLimit:14,startHour:7,endHour:21}
 const preview=plan(c,{pace:'custom',advanced})
 assert.deepEqual(preview.patch,{lifeAgentMode:'active',peakValley:false,
  autonomousPlannerMinutes:75,autonomousPlannerDailyLimit:14,
  autonomousPlannerStartHour:7,autonomousPlannerEndHour:21})
 assert.deepEqual(plan(c,{pace:'custom',advanced,previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'}).patch,preview.patch)
 assert.equal(lifeSettingsV2({...c,...preview.patch}).pace,'custom')
 assert.throws(()=>plan(c,{pace:'custom',advanced:{...advanced,dailyLimit:0}}),/每日模型额度/)
 assert.throws(()=>plan(c,{pace:'custom',advanced:{...advanced,startHour:'7'}}),/开始时间/)
 assert.throws(()=>plan(c,{pace:'custom'}),/需要完整高级设置/)
})
test('explicit pause disables the planner, but does not revoke independently authorized social routes',()=>{
 const c={...old(),lifeAgentMode:'active',peakValley:false}
 const preview=plan(c,{mode:'off',pace:'custom'})
 assert.deepEqual(preview.patch,{lifeAgentMode:'off',autonomousPlannerEnabled:false})
 assert.equal(preview.after.socialReplyOwner,'legacy')
 assert.equal(preview.after.driverOwnership.videoWakeOwner,'none')
 assert.equal(Object.hasOwn(preview.patch,'socialAutoSend'),false)
 assert.throws(()=>plan({...c,masterEnabled:false}),/总开关/)
})
test('old generic editor cannot override active Life Agent; all three modes use one UI and one save path',()=>{
 const c={...old(),lifeAgentMode:'active'}
 for(const k of ['autonomousPlannerMinutes','autonomousPlannerStartHour','autonomousPlannerEndHour'])
   assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(c,{[k]:999}),/统一生活设置/)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.equal((html.match(/id="life-settings-v2-panel"/g)||[]).length,1)
 assert.ok(html.indexOf('id="panel-life-agent"')<html.indexOf('id="life-settings-v2-panel"'))
 assert.match(html,/id="life-v2-pace"/)
 assert.match(html,/id="life-settings-advanced"/)
 assert.match(js,/life:loadLifeMemory/)
 assert.match(js,/['"]life-agent['"]:async/)
 assert.doesNotMatch(js,/autonomousPlannerMinutes:legacyOwnsPlanner/)
})
