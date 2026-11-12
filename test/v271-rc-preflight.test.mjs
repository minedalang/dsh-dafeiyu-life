import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lifeTransitionReadiness} from '../lib/life-transition-readiness.mjs'

const src=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const rc=()=>lifeTransitionReadiness({version:'2.7.1-dev.8',config:{masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active'},
  accountReady:true,planner:{lifeEvents:{ok:true}},
  handoff:{ok:true,accountReady:true,channels:{dm:{inFlight:0},comment:{inFlight:0}}},
  transactions:{ok:true,accountReady:true,channels:{dm:{},comment:{}}}})

test('RC thirteen questions are complete, unique and never automatically release the build',()=>{
  const result=rc()
  assert.equal(result.releaseReady,false)
  assert.equal(result.rc.releaseCandidate,false)
  assert.equal(result.rc.complete,0)
  assert.equal(result.rc.questions.length,13)
  assert.equal(new Set(result.rc.questions.map(x=>x.id)).size,13)
  assert.deepEqual(result.rc.questions.map(x=>x.id),[
    'connected-systems','owner-natural-care','natural-friend-dm','recent-social-voice','interest-activities','interest-friendship',
    'proposal-to-completion','reply-cadence','social-growth','growth-feedback','normal-ui','whole-life-naturalness','legacy-upgrade-memory'])
  assert.deepEqual(result.rc.questions.map(x=>x.status),[
    'partial','partial','partial','partial','partial','partial','partial','partial','unproven','unproven','needs-review','unproven','needs-review'])
  assert.equal(result.status.oldSocialOwner,true)
  assert.equal(result.checks.find(x=>x.id==='legacy-social-owner').status,'pending')
  assert.ok(result.remaining.includes('windows-real-model-bilibili'))
})

test('RC evidence diagnostics are bounded public categories, never raw identity or private text',()=>{
  const uid='99110022334455',raw='private-secret-message'
  const result=lifeTransitionReadiness({version:'2.7.1-dev.8'+raw,
    config:{masterEnabled:true,lifeAgentMode:'off',personaPrompt:raw,dmOwnerUid:uid},accountReady:false,
    shadow:{byChannel:{dm:{paired:0,rawText:raw,uid}},rawText:raw},
    planner:{lifeEvents:{ok:false,rawText:raw}},transactions:null,handoff:null})
  const json=JSON.stringify(result.rc)
  assert.doesNotMatch(json,new RegExp(uid+'|'+raw+'|receiptId|rpid|accountHash'))
  assert.equal(result.releaseReady,false)
  assert.equal(result.rc.questions.length,13)
  assert.ok(result.rc.questions.every(x=>['partial','unproven','needs-review'].includes(x.status)))
})

test('no automatic ownership promotion and paused emotion recall remains explicit RC blockers',()=>{
  const social=src('lib/social-decision-ownership.mjs')
  const planner=src('lib/autonomous-planner.mjs')
  const index=src('index.js')
  assert.match(social,/socialDecisionOwner:unavailable\?'unavailable'/)
  assert.match(social,/!\['legacy','life-agent'\]\.includes\(requester\)/)
  assert.match(planner,/不允许回复、发送、工具调用/)
  assert.match(index,/emotionRecall=createEmotionRecall\(\{[\s\S]{0,100}paused:true/)
  assert.match(index,/videoRecommendationsOnly:true/)
})

test('normal Life management wording is clear; developer-only controls are not exposed',()=>{
  const html=src('lib/management-console.html'),js=src('lib/management-console.js')
  for(const term of ['刷新生活状态','聊天与互动','保留你以前的活跃度设置'])
    assert.ok(html.includes(term),term)
  for(const term of ['开发者选项','RC 前需要回答的 13 个真实使用问题'])assert.doesNotMatch(html,new RegExp(term))
  for(const id of ['life-v2-mode','life-v2-pace'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
  assert.doesNotMatch(html,/life-rc-questions|life-transition-status|life-transition-checklist/)
  for(const val of ['off','active','shadow','quiet','natural','lively','custom'])
    assert.match(html,new RegExp('value="'+val+'"'),val)
  assert.doesNotMatch(html,/value="legacy-(?:quiet|natural|lively)"/)
  assert.doesNotMatch(js,/request\('\/life-agent\/transition-readiness'\)/)
})

test('2.8.0 README and developer navigation reflect the RC gates without falsely claiming release',()=>{
  const readme=src('README.md'),doc=src('docs/README.md'),notes=src('RELEASE_NOTES_v2.8.0.md')
  const opening=readme.slice(0,2200)
  for(const term of [JSON.parse(src('package.json')).version,'统一 Life','鱼鱼想做','尚未发布','新生活系统刚上线'])
    assert.ok(opening.includes(term),term)
  assert.match(readme,/2\.8\.0-release-readiness\.md/)
  assert.ok(doc.includes(JSON.parse(src('package.json')).version))
  assert.match(doc,/2\.8\.0-release-readiness\.md/)
  assert.match(notes,/正式发布需完成/)
  assert.match(src('docs/architecture/2.8.0-release-readiness.md'),/releaseReady:false/)
  assert.match(src('AGENTS.md'),/RC 十三项自然行为/)
  assert.match(src('docs/AGENT_ARCHITECTURE.md'),/历史示意/)
})
