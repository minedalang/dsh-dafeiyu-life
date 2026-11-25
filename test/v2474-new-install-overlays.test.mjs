import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { validateHeadlessOverlayFile } from '../lib/headless-security.mjs'

test('fresh install creates main and DM security overlays during plugin apply',()=>{
  const home=mkdtempSync(join(tmpdir(),'v2474-fresh-home-'))
  const stateDir=join(home,'bili-duty')
  const effects=[]
  const ctx={
    get(k){
      if(k==='dshHomePath') return (...xs)=>join(home,...xs)
      return undefined
    },
    logger:{info(){},warn(){}},
    tools:{register(){}},
    connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(){return {dispose(){}}}},
    effect(cb){ effects.push(cb); try{return cb()}catch{return undefined}},
    settings:{register(){return {}}},
    slots:{inject(){},register(){return {}}},
  }
  try {
    apply(ctx,{headlessProfile:'unsafe-custom-profile'})
    assert.equal(validateHeadlessOverlayFile(join(stateDir,'headless-overlay.yml'),{kind:'main',stateDir}).ok,true)
    assert.equal(validateHeadlessOverlayFile(join(stateDir,'headless-dm-overlay.yml'),{kind:'dm',stateDir}).ok,true)
  } finally { rmSync(home,{recursive:true,force:true}) }
})
