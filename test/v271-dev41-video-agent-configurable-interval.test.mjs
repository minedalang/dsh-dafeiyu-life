import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifePacePolicy,lifeVideoGate,MIN_VIDEO_AGENT_INTERVAL_MINUTES,MAX_VIDEO_AGENT_INTERVAL_MINUTES} from '../lib/life-pace-policy.mjs'
import {lifeSettingsV2,planLifeSettingsV2,assertLegacyLifeSettingsPatchCompatible} from '../lib/life-settings-control.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
import {lifeExperienceReadiness} from '../lib/life-experience-readiness.mjs'

const T=Date.parse('2026-11-09T20:00:00Z')
const config={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,
  autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
  videoAgentMinIntervalMinutes:20}
const request=(cfg,interval,extra={})=>({schemaVersion:2,revision:lifeSettingsV2(cfg).revision,
  mode:'active',pace:'custom',advanced:{minutes:30,dailyLimit:40,startHour:0,endHour:24},videoAgentMinIntervalMinutes:interval,previewOnly:true,...extra})

test('new-install Video Agent default is 30 minutes, saved custom cooldowns are preserved',()=>{
  assert.equal(MIN_VIDEO_AGENT_INTERVAL_MINUTES,1)
  assert.equal(MAX_VIDEO_AGENT_INTERVAL_MINUTES,1440)
  assert.equal(lifeSettingsV2({...config,videoAgentMinIntervalMinutes:undefined}).budget.videoAgentMinIntervalMinutes,30)
  assert.equal(lifePacePolicy({...config,autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:200}).videoCooldownMinutes,20)
  assert.equal(lifePacePolicy({...config,autonomousPlannerMinutes:80,autonomousPlannerDailyLimit:50,videoAgentMinIntervalMinutes:45}).videoCooldownMinutes,45)
  assert.equal(projectLifeSettings({...config,videoAgentMinIntervalMinutes:75}).budget.videoAgentMinIntervalMinutes,75)
})

test('custom Life setting accepts 1 through 1440 and preserves existing chosen interval',()=>{
  const atMinimum=planLifeSettingsV2(config,request(config,20))
  assert.equal(atMinimum.patch.videoAgentMinIntervalMinutes,undefined,'unchanged 20-minute default is omitted from the diff')
  const atMaximum=planLifeSettingsV2(config,request(config,1440))
  assert.equal(atMaximum.patch.videoAgentMinIntervalMinutes,1440)
  assert.equal(atMaximum.changed.videoAgentMinIntervalMinutes.after,1440)
  const oneMinute=planLifeSettingsV2(config,request(config,1))
  assert.equal(oneMinute.patch.videoAgentMinIntervalMinutes,1)
  assert.throws(()=>planLifeSettingsV2(config,request(config,0)),/1～1440/)
  assert.throws(()=>planLifeSettingsV2(config,request(config,1441)),/1～1440/)
  assert.throws(()=>planLifeSettingsV2(config,request(config,20.5)),/整数/)
})

test('the interval participates in the revision and survives ordinary Life saves when not edited',()=>{
  const changed={...config,videoAgentMinIntervalMinutes:60}
  assert.notEqual(lifeSettingsV2(config).revision,lifeSettingsV2(changed).revision)
  const ordinary=planLifeSettingsV2(changed,{schemaVersion:2,revision:lifeSettingsV2(changed).revision,
    mode:'active',pace:'custom',advanced:{minutes:30,dailyLimit:40,startHour:0,endHour:24},previewOnly:true})
  assert.equal(Object.hasOwn(ordinary.patch,'videoAgentMinIntervalMinutes'),false)
  assert.equal(lifePacePolicy({...changed,...ordinary.patch}).videoCooldownMinutes,60)
})

test('manual and automatic rounds share the configured minimum start interval',()=>{
  for(const source of ['manual','life-agent']){
    const budget={videoStartsToday:0,lastVideoAt:0,recentVideoRounds:[{source,state:'completed',startedAt:T}]}
    const cfg={...config,videoAgentMinIntervalMinutes:45}
    assert.equal(lifeVideoGate(cfg,budget,T+44*60_000).reason,'video-launch-cooldown',source)
    assert.equal(lifeVideoGate(cfg,budget,T+45*60_000).eligible,true,source)
  }
  const configured={...config,videoAgentMinIntervalMinutes:90}
  const status=lifeExperienceReadiness({config:configured,planner:{lifeRuns:0},events:{ok:true,lastVideoAt:T,
    recentVideoRounds:[{source:'manual',state:'completed',startedAt:T}]},capabilities:[{id:'bilibili.video-explore'}],at:T+30*60_000})
  assert.equal(status.videoCooldownMinutes,90)
  assert.equal(status.blockers.includes('video-cooldown'),true)
  const manualOnly=lifeExperienceReadiness({config:configured,planner:{lifeRuns:0},events:{ok:true,lastVideoAt:0,
    recentVideoRounds:[{source:'manual',state:'completed',startedAt:T}]},capabilities:[],at:T+30*60_000})
  assert.equal(manualOnly.blockers.includes('video-cooldown'),true,
    'a manual round blocks the next automatic round even when it is not counted as a planner start')
  assert.equal(manualOnly.videoCooldownUntil,T+90*60_000)
})

test('legacy config writes and the agent-facing config tool cannot bypass the versioned Life settings form',()=>{
  assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(config,{videoAgentMinIntervalMinutes:60}),/统一生活设置管理/)
  assert.equal(assertLegacyLifeSettingsPatchCompatible(config,{videoAgentMinIntervalMinutes:20}),true)
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(source,/videoAgentMinIntervalMinutes: z\.natural\(\)\.default\(30\)/)
  assert.match(source,/videoAgentMinIntervalMinutes','videoAgentReadTargetPerRound','videoAgentPickTargetPerRound','emotionRecallEnabled/)
  assert.match(source,/videoAgentMinIntervalMinutes','videoAgentReadTargetPerRound','videoAgentPickTargetPerRound'/)
  const gateCalls=(source.match(/lifeVideoGate\(cfg,budget,Date\.now\(\)\)\.eligible/g)||[]).length
  assert.ok(gateCalls>=2,'automatic capability admission and manual start both use the same configured gate')
})

test('normal Life management UI exposes and saves the interval without making it a developer setting',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/id="life-video-agent-interval-setting"/)
  assert.match(html,/id="life-v2-video-min-interval" min="1" max="1440"/)
  assert.match(js,/videoAgentMinIntervalMinutes:boundedInt\('life-v2-video-min-interval',1,1440/)
  assert.match(js,/budget\.videoAgentMinIntervalMinutes\?\?30/)
  assert.match(html,/视频 30 分钟 \/ 阅读 5 \/ 挑选 5/)
})

test('Life presets atomically own Video Agent cooldown/read/pick values and custom remains editable',()=>{
  const presets={quiet:[60,3,3],natural:[30,5,5],lively:[15,8,5]};
  for(const [pace,values] of Object.entries(presets)){
    const result=planLifeSettingsV2(config,{schemaVersion:2,revision:lifeSettingsV2(config).revision,mode:'active',pace,previewOnly:true,
      videoAgentMinIntervalMinutes:20,videoAgentReadTargetPerRound:20,videoAgentPickTargetPerRound:10});
    assert.deepEqual([result.after.budget.videoAgentMinIntervalMinutes,result.after.budget.videoAgentReadTargetPerRound,result.after.budget.videoAgentPickTargetPerRound],values);
  }
  const custom=planLifeSettingsV2(config,request(config,75,{videoAgentReadTargetPerRound:9,videoAgentPickTargetPerRound:4}));
  assert.equal(custom.after.budget.videoAgentMinIntervalMinutes,75);
  assert.equal(custom.after.budget.videoAgentReadTargetPerRound,9);
  assert.equal(custom.after.budget.videoAgentPickTargetPerRound,4);
})
