import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDshVisionReview} from '../lib/dsh-vision-review.mjs'

test('failed headless composition persists sanitized closed-vocabulary diagnostic',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-vision-stage-'))
 try{
  const stateFile=join(dir,'dsh-vision-selftest-last-run.json')
  const diagnostics={headlessConfig:{status:'failed',reason:'headless_vision_patch_not_composed'},
   mcpPreflight:{status:'ready'},mcpImage:{status:'not_received'},providerApi:{status:'not_confirmed'},
   modelAnswer:{status:'not_returned'},cliProcess:{status:'exited',exitCode:1,stderr:'present',
    stdout:'empty',stderrKind:'node_exception',nodeExceptionType:'TypeError'}}
  const review=createDshVisionReview({stateFile,getRoute:()=>({provider:'example',model:'vision',complete:true}),
   probe:async()=>({ok:false,status:'failed',diagnosticCode:'headless_vision_patch_not_composed',diagnostics})})
  await assert.rejects(()=>review.verify())
  const persisted=JSON.parse(readFileSync(stateFile,'utf8')).last
  assert.equal(persisted.headlessConfig,'failed')
  assert.equal(persisted.headlessConfigReason,'headless_vision_patch_not_composed')
  assert.equal(persisted.cliNodeExceptionType,'TypeError'.toLowerCase() /* safeStage currently rejects uppercase */)
  assert.doesNotMatch(JSON.stringify(persisted),/secret|password|private\/path|image\/png/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
