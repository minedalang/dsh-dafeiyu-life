import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeSettingsV2,planLifeSettingsV2,assertLegacyLifeSettingsPatchCompatible} from '../lib/life-settings-control.mjs'
import {lifeVideoGate,MIN_VIDEO_AGENT_INTERVAL_MINUTES} from '../lib/life-pace-policy.mjs'
import {memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
import {normalizeMessageBurst} from '../lib/message-burst.mjs'

const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const original={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,videoAgentMinIntervalMinutes:20,
  autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,videoAgentReadTargetPerRound:8,videoAgentPickTargetPerRound:4}
const request=(diff={})=>({schemaVersion:2,revision:lifeSettingsV2(original).revision,mode:'active',pace:'natural',previewOnly:true,...diff})

test('video Agent interval has configurable one-minute lower bound, with existing 20 minute default intact',()=>{
  assert.equal(MIN_VIDEO_AGENT_INTERVAL_MINUTES,1)
  const {patch}=planLifeSettingsV2(original,request({videoAgentMinIntervalMinutes:1}))
  assert.equal(patch.videoAgentMinIntervalMinutes,1)
  assert.equal(lifeVideoGate({...original,...patch},{lastVideoAt:100000},100000+59_999).cooling,true)
  assert.equal(lifeVideoGate({...original,...patch},{lastVideoAt:100000},100000+60_000).eligible,true)
  assert.throws(()=>planLifeSettingsV2(original,request({videoAgentMinIntervalMinutes:0})),/1～1440/)
  assert.equal(lifeVideoGate({...original,videoAgentMinIntervalMinutes:undefined},{lastVideoAt:100000},100000+60_000).cooling,true)
})

test('read and pick targets participate in revision and preview, are only optional non-compulsory references',()=>{
  const configured=planLifeSettingsV2(original,request({videoAgentReadTargetPerRound:18,videoAgentPickTargetPerRound:6}))
  assert.equal(configured.patch.videoAgentReadTargetPerRound,18)
  assert.equal(configured.patch.videoAgentPickTargetPerRound,6)
  assert.notEqual(lifeSettingsV2(original).revision,lifeSettingsV2({...original,...configured.patch}).revision)
  for(const field of ['videoAgentReadTargetPerRound','videoAgentPickTargetPerRound']){
    assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(original,{[field]:9}),/统一生活设置管理/)
  }
  assert.throws(()=>planLifeSettingsV2(original,request({videoAgentReadTargetPerRound:0})),/1～30/)
  assert.throws(()=>planLifeSettingsV2(original,request({videoAgentPickTargetPerRound:13})),/0～12/)
  assert.equal(planLifeSettingsV2(original,request({videoAgentPickTargetPerRound:0})).patch.videoAgentPickTargetPerRound,0)
  const code=source('index.js')
  assert.match(code,/cfg\.videoAgentReadTargetPerRound/)
  assert.match(code,/cfg\.videoAgentPickTargetPerRound/)
  assert.match(code,/不允许降低真实入选门槛/)
})

test('the home setup offers owner UID with explicit consent, roster/profile alignment and readback',()=>{
  const html=source('lib/management-console.html'),js=source('lib/management-console.js')
  assert.match(html,/id="fs-owner-uid"/)
  assert.match(html,/id="fs-owner-uid-save"/)
  assert.match(html,/id="fs-owner-uid-section"/)
  assert.ok(html.indexOf('id="fs-owner-uid-section"')<html.indexOf('id="fs-choices-stage"'))
  assert.match(js,/const loadFirstStartOwnerUid/)
  assert.match(js,/confirmAction\(\{title:'确认唯一授权主人'/)
  assert.match(js,/friendDirectory:JSON\.stringify\(rows\),mentionProfiles:JSON\.stringify\(profiles\),dmOwnerUid:Number\(uid\)/)
  assert.match(js,/保存后主人 UID 回读不一致/)
  assert.match(js,/uid===String\(account\.activeUid\|\|''\)/)
})

test('the main Session burst tool avoids minItems/maxItems unsupported by DSH DSL while retaining runtime validation',()=>{
  const code=source('lib/long-term-memory.mjs')
  const at=code.indexOf("name:'dafeiyu_chat_burst'")
  assert.ok(at>=0)
  const tool=code.slice(at,at+850)
  assert.doesNotMatch(tool,/(?:minItems|maxItems):/)
  assert.match(tool,/messages:\{type:'array',required:true,items:\{type:'string'\}/)
  const options={maxMessages:3,maxChars:450}
  assert.deepEqual(normalizeMessageBurst(['第一条','第二条'],{...options,minMessages:2}),['第一条','第二条'])
  assert.deepEqual(normalizeMessageBurst(['第一条'],{...options,minMessages:2}),[])
  assert.deepEqual(normalizeMessageBurst(['1','2','3','4'],{...options,minMessages:2}),['1','2','3'])
})

test('neural nodes fade by recorded clarity only; unknown decay is not fabricated',()=>{
  const gardenRows=[
    {id:'a',gardenKind:'experience',text:'a lifetime memory',stage:'clear'},
    {id:'b',gardenKind:'experience',text:'b lifetime memory',stage:'fuzzy'},
    {id:'c',gardenKind:'experience',text:'c lifetime memory',stage:'trace'},
    {id:'d',gardenKind:'experience',text:'d lifetime memory'},
  ]
  assert.deepEqual(memoryNeuralProjection({gardenRows}).nodes.map(n=>n.clarity),['clear','fuzzy','trace','unmarked'])
  const js=source('lib/management-console.js'),html=source('lib/management-console.html')
  const levels=[...js.matchAll(/\b(clear|fuzzy|trace|unmarked):\.(\d+)/g)].map(m=>[m[1],Number('0.'+m[2])])
  assert.ok(levels.some(([k])=>k==='clear'))
  assert.ok(levels.some(([k])=>k==='trace'))
  assert.match(js,/neuralClarityOpacity\(m\.clarity\)/)
  assert.match(html,/记忆衰减亮度图例/)
})
