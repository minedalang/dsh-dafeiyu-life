import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pruneDmContext, DM_CONTEXT_DAYS, DM_OLDER_CONTEXT_DAYS } from '../lib/dm-context-retention.mjs'
import { relationshipMemoryHalfLifeDays } from '../lib/life-memory-gateway.mjs'

const html=readFileSync(new URL('../lib/management-console.html', import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js', import.meta.url),'utf8')
const index=readFileSync(new URL('../index.js', import.meta.url),'utf8')

test('recent DM view shows no transcript text in the DOM, not even blurred raw text',()=>{
  const view=js.split('const loadDmRecent=async()=>{')[1]?.split('const checkMcpIntegrity=async()=>{')[0]
  assert.ok(view,'recent conversation view must exist')
  assert.doesNotMatch(view,/\.recent\b|\.text\b|\.innerHTML\b/, 'view must not render any raw recent message text')
  assert.match(view,/dm-private-preview-overlay/)
  assert.match(view,/\.contextEntries/)
  assert.match(html,/给鱼鱼留一小片自在的聊天空间/)
  assert.match(html,/dm-private-preview-lines/)
  assert.match(html,/backdrop-filter:blur/)
})

test('privacy only changes the management presentation, not server state or ordinary DM memory',()=>{
  assert.match(js,/const data=await request\('\/dm-recent'\)/)
  assert.match(index,/dmContextMessages: z\.natural\(\)\.default\(40\)/)
  assert.match(index,/dmP6Enabled: z\.boolean\(\)\.default\(true\)/)
  assert.match(index,/ownerDmSilenceFollowupEnabled: z\.boolean\(\)\.default\(true\)/)
  assert.doesNotMatch(js.split('const loadDmRecent=async()=>{')[1]?.split('const checkMcpIntegrity=async()=>{')[0]||'',/dm-memory-prune|dm-autoreply-state/)
})

test('previous days of verified DM context are retained within count and age limits',()=>{
  const now=Date.UTC(2026,10,13,12,0)
  const day=86400_000
  const person={history:[
    {role:'user',text:'三天前聊过自己的新想法',at:now-3*day},
    {role:'assistant',text:'记得这个话题',at:now-2*day},
    {role:'user',text:'十五天前过期的原文',at:now-15*day}
  ],olderContext:[]}
  const result=pruneDmContext(person,{atNow:now,historyLimit:40})
  assert.equal(DM_CONTEXT_DAYS,14)
  assert.equal(DM_OLDER_CONTEXT_DAYS,7)
  assert.equal(result.historyCount,2)
  assert.deepEqual(person.history.map(x=>x.text),['三天前聊过自己的新想法','记得这个话题'])
})

test('relationship-dependent public social half life is separate from private DM raw context',()=>{
  const newDays=relationshipMemoryHalfLifeDays({stage:'new'},30)
  const friendDays=relationshipMemoryHalfLifeDays({stage:'friend'},30)
  assert.equal(newDays,1.3)
  assert.equal(friendDays,24)
  assert.ok(friendDays>newDays)
})

test('natural DM bubbles and silence reconsideration are gated, not compulsory',()=>{
  const source=readFileSync(new URL('../lib/dm-autoreply.mjs', import.meta.url),'utf8')
  assert.match(source,/p6MaxBubbles:clamp\(config\.p6MaxBubbles,1,3,3\)/)
  assert.match(source,/idleRequested=decision\.idleReconsiderMinutes>0/)
  assert.match(source,/\['open-conversation','explicit-check-back'\]/)
  assert.match(source,/const eligible=dmConversationPhase\(latest\.text\)!=='closed'/)
})
