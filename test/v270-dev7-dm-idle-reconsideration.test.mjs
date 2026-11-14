import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {createNaturalExpressionOpportunity} from '../lib/natural-expression-opportunity.mjs'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
test('retired scheduled silence worker is absent and shared natural-expression opportunity is present',()=>{
 assert.equal(existsSync(new URL('../lib/social-continuity-ledger.mjs',import.meta.url)),false)
 assert.doesNotMatch(source('lib/dm-autoreply.mjs'),/scheduleContinuity|createSocialContinuityLedger/)
 assert.doesNotMatch(source('lib/comment-interact.mjs'),/scheduleP6|createSocialContinuityLedger/)
 assert.match(source('lib/dm-autoreply.mjs'),/createNaturalExpressionOpportunity/)
})
test('extra thinking remains a separately bounded opportunity, not an automatic scheduled message',()=>{
 assert.equal(typeof createNaturalExpressionOpportunity,'function')
})
