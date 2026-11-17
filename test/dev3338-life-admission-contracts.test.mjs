import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=(file)=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('DM admission is inspected before social model generation, but only the existing seal path grants send proof',()=>{
  const src=read('index.js')
  const start=src.indexOf('generateReply: async (req) => {')
  const section=src.slice(start,src.indexOf('onConversationSettled:',start))
  assert(start>0&&section.length>0)
  const before=section.indexOf('inspectSocialReadiness({kind:\'dm_reply\'})')
  const invoke=section.indexOf('interactionBatcher.generate(')
  assert(before>0&&invoke>before)
  assert.match(section,/adoptSocialDecisionQueued\(/)
  assert.match(section,/life-admission-preflight-deferred/)
})

test('DM read gate uses existing shared Bilibili read budget and preserves platform guarded continuation',()=>{
  const src=read('index.js'),engine=read('lib/dm-autoreply.mjs')
  assert.match(src,/const pause=biliReadBudget\.status\(\),network=dmRecoveryNetworkGate\(\)/)
  assert.match(src,/dmRecoveryNetworkGate=\(\)=>interactionScheduler\.recoveryReadGate\(\)/)
  assert.match(engine,/if\(readGate\?\.allowed!==true\)/)
  assert.match(engine,/lifeInbox\.defer\(task\.uid,task\.id/)
  assert.match(engine,/unattempted:true/)
})

test('focusReview scope regression remains closed, admission UI and export have privacy-safe bounded status',()=>{
  const src=read('index.js'),ui=read('lib/management-console.js'),exp=read('tools/导出B站日志.bat')
  assert.match(src,/let focusReview=null,focusReviewStatus=null/)
  assert.match(src,/lifeWillingnessStatus:lifeWillingness\?\.status\(\)/)
  assert.match(ui,/admission\.ownerChannel/)
  const start=exp.indexOf("# Life admission is stored in the root stateDir")
  const end=exp.indexOf("dump('dm-expression-overview.json'",start)
  const safe=exp.slice(start,end)
  assert(start>0&&end>start)
  assert.match(safe,/lastReleaseReason/)
  for(const forbidden of ['token','uid','sourceKey','pid','messageId'])assert.doesNotMatch(safe,new RegExp(`['\\"]${forbidden}['\\"]\\s*:`))
})
