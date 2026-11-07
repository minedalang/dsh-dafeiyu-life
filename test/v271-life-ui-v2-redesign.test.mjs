import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const share=readFileSync(new URL('../lib/social-intentions.mjs',import.meta.url),'utf8')
test('legacy top navigation and stable panel IDs survive the UI redesign',()=>{
  for(const id of ['life-agent','life','social','dm','relationships','personality','bili','dynamic']){
    assert.match(html,new RegExp(id==='life-agent'?'data-tab="life-agent"':`data-tab="${id}"`))
    assert.match(html,new RegExp(`id="panel-${id}"`))
  }
  assert.match(html,/class="tabs" aria-label="管理分类"/)
  assert.doesNotMatch(html,/class="sidebar"|class="mobile-bottom-nav"/)
})
test('Life overview has single primary navigation with technical cards collapsed and timeline visible',()=>{
  assert.match(html,/<details class="life-now-timeline" open>/)
  assert.match(html,/<details class="life-technical-details"><summary>/)
  assert.match(html,/class="life-day-shortcuts"/)
  assert.match(html,/name="life-mode-card" value="active"/)
  assert.match(html,/name="life-mode-card" value="off"/)
  assert.match(html,/class="life-pace-cards"/)
  assert.match(js,/syncLifeChoiceCards/)
})
test('memory and whitelist have illustrated, responsive cards without replacing real data IDs',()=>{
  assert.match(html,/class="life-hero life-memory-hero"/)
  assert.match(html,/class="life-memory-character" src="\/api\/bili-duty\/life-character.png"/)
  assert.match(html,/class="life-memory-tiles"/)
  assert.match(html,/id="friend-directory-editor"/)
  assert.match(html,/class="friend-directory-banner"/)
  assert.match(html,/\.friend-directory-card/)
  assert.match(html,/@media\(max-width:590px\)/)
})
test('outreach is automatic-choice only, >=50 preset and no operator approval',()=>{
  assert.match(html,/name="social-share-choice" value="free"/)
  assert.match(html,/name="social-share-choice" value="off"/)
  assert.match(html,/name="social-share-choice" value="custom"/)
  assert.doesNotMatch(html,/name="social-share-choice" value="draft"/)
  assert.match(js,/free:\{enabled:true,auto:true,max:100\}/)
  assert.match(html,/id="social-daily-limit"[^>]+min="50"[^>]+max="1000"/)
  assert.match(server,/body\?\.action==='dismiss'\|\|body\?\.action==='send'/)
  assert.match(server,/human-approval-not-allowed/)
  assert.match(share,/videoRecommendationsOnly&&!automatic/)
  assert.match(html,/历史严格审核记录（只读/)
  assert.match(server,/人工逐条审核|人工审核|人工审批|自主社交不允许逐条人工审核/)
})
test('settings remain real native inputs; visual cards do not auto-save or override previous permissions',()=>{
  for(const id of ['life-v2-mode','life-v2-pace','life-v2-save-btn','social-save','dm-settings-save','owner-dm-agent-save','owner-comment-agent-enabled']) assert.match(html,new RegExp(`id="${id}"`))
  assert.match(js,/socialOutreachDailyLimit/)
  assert.match(js,/confirm:/)
  assert.match(server,/dmApprovalEnabled===true/)
})
