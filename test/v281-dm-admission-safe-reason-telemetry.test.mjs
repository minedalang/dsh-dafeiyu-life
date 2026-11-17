import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('DM pre-model admission deferral keeps safety, shows only allowlisted holder stage and age bucket',()=>{
 const source=read('index.js'),dm=read('lib/dm-autoreply.mjs')
 const fragment=source.slice(source.indexOf('const readiness=await waitForDmLifeReadiness'),source.indexOf("const dmPlanningPreference=lifeWillingness?.holdIncomingDmDecision"))
 assert.match(fragment,/life-admission-preflight-deferred/)
 assert.match(fragment,/waitForDmLifeReadiness/)
 assert.match(fragment,/maxWaitMs:6_000/)
 assert.match(fragment,/ownerChannel/)
 assert.match(fragment,/ownerStage/)
 assert.match(fragment,/ownerAgeMs/)
 assert.match(fragment,/Math\.min\(600/)
 assert.doesNotMatch(fragment,/err\.uid|err\.messageId|err\.admissionToken/)
 const catchSection=dm.slice(dm.indexOf("const admissionBusy=e?.code==='life-admission-preflight-deferred'"),dm.indexOf('let decision=normalizeGeneratedDecision'))
 assert.match(catchSection,/lifeInbox\.defer\(msg\.uid,msg\.id,\{delay,unattempted:true\}\)/)
 assert.match(catchSection,/reason=\$\{capacityBusy\?'model-capacity-busy':reason\} holder=\$\{channel\}\/\$\{stage\} ageBucketSeconds=\$\{age\}/)
 assert.match(catchSection,/logger\.warn\?\.\(`DM model not started; deferred without consuming a decision attempt/)
})
