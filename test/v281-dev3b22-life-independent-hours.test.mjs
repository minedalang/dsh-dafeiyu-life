import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
const config=()=>({masterEnabled:true,lifeAgentMode:'active',peakValley:false,autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:250,autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,
  videoAgentMinIntervalMinutes:15,videoAgentReadTargetPerRound:8,videoAgentPickTargetPerRound:5,socialAutoSend:true})
const plan=(cfg,rest={})=>planLifeSettingsV2(cfg,{schemaVersion:2,mode:'active',pace:'lively',revision:lifeSettingsV2(cfg).revision,previewOnly:true,...rest})
test('independent hours change leaves lively pace and Video Agent unchanged',()=>{
 const c=config(),before=structuredClone(c)
 const r=plan(c,{schedule:{startHour:7,endHour:21}})
 assert.deepEqual(r.patch,{autonomousPlannerStartHour:7,autonomousPlannerEndHour:21})
 assert.equal(r.after.pace,'lively')
 assert.deepEqual(c,before)
})
test('quiet/natural/lively preset changes never overwrite the owner-chosen hours',()=>{
 const c=config()
 for(const pace of ['quiet','natural','lively']){
   const r=plan(c,{pace,schedule:{startHour:7,endHour:21}})
   assert.equal(r.patch.autonomousPlannerStartHour,7)
   assert.equal(r.patch.autonomousPlannerEndHour,21)
   assert.equal(r.after.pace,pace)
 }
})
test('overnight window and full-day are supported while ambiguous equal hours are refused',()=>{
 const c=config()
 assert.deepEqual(plan(c,{schedule:{startHour:20,endHour:2}}).patch,{
  autonomousPlannerStartHour:20,autonomousPlannerEndHour:2})
 assert.deepEqual(plan(c,{schedule:{startHour:0,endHour:24}}).patch,{
  autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
 assert.throws(()=>plan(c,{schedule:{startHour:9,endHour:9}}),/不能相同/)
})
test('schedule can be saved even while Life is paused; not activating or granting permissions',()=>{
 const c=config()
 const r=plan(c,{mode:'off',schedule:{startHour:11,endHour:20}})
 assert.deepEqual(r.patch,{lifeAgentMode:'off',autonomousPlannerEnabled:false,
  autonomousPlannerStartHour:11,autonomousPlannerEndHour:20})
 assert.equal(Object.hasOwn(r.patch,'socialAutoSend'),false)
})
test('legacy callers without schedule retain existing time; old custom advanced still works',()=>{
 const c=config()
 assert.equal(Object.hasOwn(plan(c,{pace:'quiet'}).patch,'autonomousPlannerStartHour'),false)
 const r=plan(c,{pace:'custom',advanced:{minutes:80,dailyLimit:15,startHour:3,endHour:22}})
 assert.deepEqual([r.patch.autonomousPlannerStartHour,r.patch.autonomousPlannerEndHour],[3,22])
})
test('custom mode accepts separate window and rejects contradictory legacy window',()=>{
 const c=config()
 const advanced={minutes:70,dailyLimit:20}
 const r=plan(c,{pace:'custom',advanced,schedule:{startHour:5,endHour:20}})
 assert.equal(r.patch.autonomousPlannerStartHour,5)
 assert.equal(r.patch.autonomousPlannerEndHour,20)
 assert.throws(()=>plan(c,{pace:'custom',advanced:{...advanced,startHour:8,endHour:20},schedule:{startHour:5,endHour:20}}),/不一致/)
})
test('time input strict validation and revision/explicit confirmation remain in force',()=>{
 const c=config()
 for(const schedule of [null,{},[],{startHour:'7',endHour:22},{startHour:-1,endHour:23},{startHour:9,endHour:25}])
  assert.throws(()=>plan(c,{schedule}),/格式|整数/)
 assert.throws(()=>plan(c,{schedule:{startHour:2,endHour:3},revision:'stale'}),/旧设置已变化/)
 assert.throws(()=>plan(c,{schedule:{startHour:2,endHour:3},previewOnly:false}),/明确确认/)
 assert.deepEqual(plan(c,{schedule:{startHour:2,endHour:3},previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'}).patch,
  {autonomousPlannerStartHour:2,autonomousPlannerEndHour:3})
})
test('UI controls are below all pace cards, above advanced panel, and one each',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.ok(html.indexOf('class="life-pace-cards"')<html.indexOf('id="life-hours-card"'))
 assert.ok(html.indexOf('id="life-hours-card"')<html.indexOf('id="life-settings-advanced"'))
 for(const id of ['life-v2-start','life-v2-end','life-hours-display','life-hours-timeline','life-hours-pending'])
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)
 assert.match(js,/schedule:\{startHour:boundedInt\('life-v2-start'/)
 assert.match(js,/for\(const id of \['life-v2-start','life-v2-end'\]\)\$\(id\)\.addEventListener\('input',paintLifeHours\)/)
 assert.match(js,/for\(const id of \['life-v2-minutes','life-v2-limit'\]\)/)
 assert.doesNotMatch(js,/\['life-v2-minutes','life-v2-limit','life-v2-start','life-v2-end'\]/)
})
