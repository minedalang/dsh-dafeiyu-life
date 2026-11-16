import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDshVisionReview} from '../lib/dsh-vision-review.mjs'

test('dev3b27 persists only bounded CLI process metadata, no stdout/stderr raw data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vision-dev3b27-'))
 try {
  const secret='MY_PRIVATE_123'
  const store=join(dir,'diagnostic.json')
  const mgr=createDshVisionReview({stateFile:store,getRoute:()=>({provider:'muze-gpt',model:'gpt-6-luna'}),probe:async()=>({
   ok:false,status:'headless_launch_failed',error:'DSH failed',diagnosticCode:'headless_exit_unknown',
   diagnostics:{mcpPreflight:{status:'ready'},mcpImage:{status:'not_received'},
     cliProcess:{status:'exited',exitCode:1,stdout:'empty',stderr:'present',originalStderr:secret},
     providerApi:{status:'not_confirmed'},modelAnswer:{status:'not_returned'}}
  })})
  await assert.rejects(mgr.verify())
  const persisted=readFileSync(store,'utf8')
  assert.equal(persisted.includes(secret),false)
  assert.equal(persisted.includes('originalStderr'),false)
  const last=JSON.parse(persisted).last
  assert.equal(last.cliExitCode,1)
  assert.equal(last.cliProcess,'exited')
  assert.equal(last.cliStderr,'present')
  assert.equal(last.cliStdout,'empty')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
