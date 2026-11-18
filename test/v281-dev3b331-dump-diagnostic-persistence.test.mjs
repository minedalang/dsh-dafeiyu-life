import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDshVisionReview} from '../lib/dsh-vision-review.mjs'

test('failed real DSH configuration dump persists safe CLI cause and failed layer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-dump-diagnostic-'))
 try{
  const stateFile=join(dir,'dsh-vision-selftest-last-run.json')
  const diagnostics={
   headlessConfig:{status:'failed',reason:'headless_config_dump_exit',failureLayer:'vision_overlay',failureKind:'patch_parse_error',defaultDump:'ready',baseDump:'ready'},
   mcpPreflight:{status:'ready'},providerApi:{status:'not_started'},mcpImage:{status:'not_run'},modelAnswer:{status:'not_returned'},
   cliProcess:{status:'exited',exitCode:1,stderr:'present',stderrKind:'node_exception',stdout:'empty',nodeErrorCode:'err_module_not_found',path:'C:/secret/key'}
  }
  const review=createDshVisionReview({stateFile,getRoute:()=>({provider:'example',model:'vision',complete:true}),
   probe:async()=>({ok:false,status:'headless_config_failed',diagnosticCode:'headless_config_dump_exit',diagnostics})})
  await assert.rejects(()=>review.verify())
  const saved=JSON.parse(readFileSync(stateFile,'utf8')).last
  assert.equal(saved.headlessConfigFailureLayer,'vision_overlay')
  assert.equal(saved.headlessConfigFailureKind,'patch_parse_error')
  assert.equal(saved.headlessConfigDefaultDump,'ready')
  assert.equal(saved.headlessConfigBaseDump,'ready')
  assert.equal(saved.cliExitCode,1)
  assert.equal(saved.cliStderrKind,'node_exception')
  assert.doesNotMatch(JSON.stringify(saved),/C:\/|secret|api.?key/i)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
