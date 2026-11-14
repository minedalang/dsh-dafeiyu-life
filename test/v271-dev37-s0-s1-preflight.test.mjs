import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {releaseAcceptanceEvidence} from '../lib/release-acceptance-evidence.mjs'
import {lifeTransitionReadiness} from '../lib/life-transition-readiness.mjs'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('S0 手动唤醒不再访问另一个加载函数局部变量 sched',()=>{
 const ui=source('lib/management-console.js')
 const from=ui.indexOf("$('life-agent-wake').addEventListener")
 const end=ui.indexOf("$('life-agent-wake-result').textContent=resultText",from)
 assert.ok(from>0&&end>from)
 const handler=ui.slice(from,end)
 assert.doesNotMatch(handler,/\bsched\./,'wake 按钮不应访问页面局部刷新变量')
 assert.match(handler,/video-launch-cooldown/)
 assert.match(ui,/request\('\/life-agent\/wake',\{\}\)/)
 // 现场流程并不会由这个纯代码测试模拟真实模型和 HTTP。
})

test('S1 社交旧归属退役不能在当前仍有未迁移的渠道时无条件显示通过',()=>{
 const r=lifeTransitionReadiness({accountReady:true,
   config:{masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active'},
   planner:{lifeEvents:{ok:true}},
   handoff:{ok:true,accountReady:true,channels:{dm:{owner:'life-agent',inFlight:0},comment:{owner:'legacy',inFlight:0}}},
   transactions:{ok:true,accountReady:true,channels:{dm:{},comment:{}}}})
 assert.equal(r.checks.find(x=>x.id==='legacy-social-owner').status,'pending')
 assert.equal(r.checks.find(x=>x.id==='legacy-social-retirement').status,'pending')
 assert.equal(r.releaseReady,false)
 const unknown=lifeTransitionReadiness()
 assert.equal(unknown.checks.find(x=>x.id==='legacy-social-retirement').status,'unknown')
})

test('S1 双渠道 Life 归属且无在途时只认可当前账本状态，不授予 RC',()=>{
 const r=lifeTransitionReadiness({accountReady:true,
   config:{masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active'},
   planner:{lifeEvents:{ok:true}},
   handoff:{ok:true,accountReady:true,channels:{dm:{owner:'life-agent',inFlight:0},comment:{owner:'life-agent',inFlight:0}}},
   transactions:{ok:true,accountReady:true,channels:{dm:{},comment:{}}}})
 assert.equal(r.checks.find(x=>x.id==='legacy-social-retirement').status,'passed')
 assert.equal(r.rc.releaseCandidate,false)
 assert.equal(r.releaseReady,false)
})

test('S0 匿名证据导出只能使用白名单计数，未知发送保持冻结且无法由报告自动验收',()=>{
 const uid='99110022334455',secret='a secret 私信',bv='BV1abcde1234'
 const r=releaseAcceptanceEvidence({config:{masterEnabled:true,autoComment:true,commentPerRound:5,commentDailyLimit:1000,lifeAgentMode:'active',dmOwnerUid:uid,personaPrompt:secret},
 planner:{lifeEvents:{recentVideoRounds:[{state:'completed',pickedCount:2,commentGate:'configured',commentDiagnostics:{reviewed:2,wanted:1,proposed:0,secret,uid,bvid:bv}}]},
  privateMessage:secret,events:[{uid,body:secret}]},
 lifeEpisodeHealth:{active:4,firstStepOnly:2,staleFirstStep:1,firstStepWithoutEligibleSource:1,eligibleToResume:2, uid,secret},
 transition:{status:{unknownSendResults:1,needsReview:2,accountReady:true,oldSocialOwner:true,uid,secret}},
 embedding:{enabled:true,supported:true,index:{ready:true},secret},hostPlatform:'win32'})
 assert.equal(r.comment.latestRoundDiagnosis,'wanted-but-not-proposed')
 assert.equal(r.comment.currentConfig.elevatedDailyQuota,true)
 assert.equal(r.outbound.risk,'freeze-and-review')
 assert.equal(r.episode.firstStepOnly,2)
 assert.equal(r.embedding.inferenceOnThisHost,'not-proven')
 assert.equal(r.releaseReady,false)
 assert.ok(r.checks.every(c=>c.state==='requires-real-acceptance'))
 const text=JSON.stringify(r)
 for(const value of [uid,secret,bv])assert.ok(!text.includes(value),value)
})

test('S0 未知视频轮次、账号缺失、不可信输入必须 fail closed',()=>{
 const r=releaseAcceptanceEvidence({config:{autoComment:true,commentDailyLimit:-1,lifeAgentMode:'evil'},
  planner:{lifeEvents:{recentVideoRounds:[{state:'started',pickedCount:2}]}},
  transition:{status:{accountReady:false}},hostPlatform:'not-real',now:-2})
 assert.equal(r.environment,'unknown')
 assert.equal(r.at,0)
 assert.equal(r.comment.latestRoundPicked,null)
 assert.equal(r.comment.currentConfig.lifeMode,'off')
 assert.equal(r.comment.currentConfig.configuredGate,'master-disabled')
 assert.equal(r.outbound.currentAccountReady,false)
 assert.equal(r.releaseReady,false)
})

test('S0/S1 发布快照使用 GET 只读接口且不增添写入权限、私信对象或模型调用',()=>{
 const idx=source('index.js'),ui=source('lib/management-console.js'),html=source('lib/management-console.html')
 assert.match(idx,/req\.method === 'GET' && path === '\/api\/bili-duty\/life-agent\/release-acceptance-evidence'/)
 assert.match(idx,/releaseAcceptanceEvidence\(/)
 assert.match(html,/id="life-release-evidence-export"/)
 assert.match(ui,/request\('\/life-agent\/release-acceptance-evidence'\)/)
 assert.match(ui,/evidence\?\.readOnly!==true/)
 assert.match(ui,/evidence\?\.releaseReady!==false/)
})
