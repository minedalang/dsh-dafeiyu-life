import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {verifyProductionVisionPacket} from '../lib/vision-host-owned-executor.mjs'

// The same Node verification is exercised with a real overlay/packet fixture
// in the existing protected production-vision test. This guards the explicit
// overflow refusal and prevents reintroducing .slice(0,4000) in the verifier.
test('production prompt verifier refuses oversized visualInstruction before building expected prompt',()=>{
  const verifier=readFileSync(new URL('../lib/vision-host-owned-executor.mjs',import.meta.url),'utf8')
  const py=readFileSync(new URL('../lib/vision_dsh.py',import.meta.url),'utf8')
  assert.match(verifier,/vision-instruction-too-long/)
  assert.doesNotMatch(verifier,/String\(visualInstruction\|\|''\)\.slice\(0,4000\)/)
  assert.match(py,/visual_instruction=_decode_visual_instruction\(env\)/)
  assert.doesNotMatch(py,/decode\('utf8'\)\[:4000\]/)
  assert.equal(typeof verifyProductionVisionPacket,'function')
})
