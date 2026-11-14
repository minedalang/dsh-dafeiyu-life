import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const at=Date.parse('2026-11-13T08:32:10.300Z')
const receipt=(kind,t)=>({at:t,mode:'active',action:'verified_write',result:'verified-action',verifiedActionKind:kind})
const episode=(kind,t,id)=>({id,history:[{action:kind,at:t,outcome:'verified'}]})

test('one verified DM send appearing in the legacy ledger and Episode renders only once',()=>{
 const rows=buildLifeTimeline({now:at+60000,days:1,lifeDecisions:[receipt('dm_reply',at)],episodes:[episode('dm_reply',at+150,'test-a')]})
 assert.equal(rows.filter(r=>r.title==='回复了一条私信').length,1)
 assert.equal(rows.filter(r=>r.type==='life-write').length,0)
})
test('distinct verified DM sends remain distinct even on the same minute',()=>{
 const rows=buildLifeTimeline({now:at+60000,days:1,lifeDecisions:[receipt('dm_reply',at),receipt('dm_reply',at+2600)],
   episodes:[episode('dm_reply',at+150,'a'),episode('dm_reply',at+2800,'b')]})
 assert.equal(rows.filter(r=>r.title==='回复了一条私信').length,2)
})
test('two distinct confirmed chat bubbles within 1.5 seconds stay two diary events',()=>{
 const rows=buildLifeTimeline({now:at+60000,days:1,
  lifeDecisions:[receipt('dm_reply',at),receipt('dm_reply',at+600)],
  episodes:[episode('dm_reply',at+50,'burst-1'),episode('dm_reply',at+650,'burst-2')]})
 assert.equal(rows.filter(r=>r.title==='回复了一条私信').length,2)
})
test('unmatched Episode and legacy write receipts stay separate',()=>{
 const rows=buildLifeTimeline({now:at+60000,days:1,lifeDecisions:[receipt('dm_reply',at)],episodes:[episode('dm_reply',at+8000,'b')]})
 assert.equal(rows.filter(r=>r.title==='回复了一条私信').length,2)
})
test('attention-only social check stays in Life traces, not owner diary',()=>{
 const rows=buildLifeTimeline({now:at+60000,days:1,lifeDecisions:[{at:at+4000,mode:'active',action:'consider_social',result:'social-signal-considered',selectedSocialKind:'dm-received'},receipt('dm_reply',at)]})
 assert.equal(rows.filter(r=>r.label==='社交关注').length,0)
 assert.equal(rows.filter(r=>r.title==='回复了一条私信').length,1)
})
test('owner UI no longer contains the two redundant shortcut cards',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.doesNotMatch(html,/<h4>💡 生活契机<\/h4>/)
 assert.doesNotMatch(html,/🧭 最近想到的事/)
 assert.match(html,/鱼鱼想做/)
})
