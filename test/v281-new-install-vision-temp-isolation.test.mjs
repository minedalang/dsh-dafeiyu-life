import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, existsSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

// A transient vision TEMP created by startup is *not* evidence of an upgrade.
// It must not silently switch a new user's experience back to historical defaults.
test('new install is classified before the vision Python scratch directory is allocated', async () => {
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-first-install-vision-'))
  let handler
  try{
    const ctx={
      get:key=>key==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},
      webServer:{register(route){handler=route.handler;return {dispose(){}}}},
      effect:fn=>fn(),settings:{describe(){return []}},slots:{register(){},inject(){}},
    }
    apply(ctx,{})
    const scratch=join(home,'bili-duty','tmp','vision')
    assert.ok(existsSync(scratch),'the scoped vision directory must still be provisioned')
    const req=Readable.from([])
    req.method='GET';req.url='/api/bili-duty/config';req.headers={host:'localhost'}
    let status=0,output
    await handler(req,{writeHead(code){status=code},end(payload){output=JSON.parse(payload)}})
    assert.equal(status,200)
    assert.equal(output.config.mainSessionMemoryMaxItems,8,'fresh-install quota must not be replaced with legacy 6')
    assert.equal(output.config.mainSessionMemoryMaxChars,1200,'fresh-install characters must not be replaced with legacy 800')
    assert.equal(output.config.autonomousPlannerMinutes,180,'fresh-install natural schedule is not a legacy 30-minute schedule')
    assert.equal(output.config.autonomousPlannerDailyLimit,4)
  }finally{rmSync(home,{recursive:true,force:true})}
})
