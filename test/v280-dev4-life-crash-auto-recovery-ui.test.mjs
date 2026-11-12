import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('owner dashboard exposes orphaned run lock and completed automatic reclaim without conflating model backoff',()=>{
  const ui=read('lib/management-console.js')
  assert.match(ui,/lease\.held&&lease\.needsReview/)
  assert.match(ui,/runLease\.held&&runLease\.needsReview/)
  assert.match(ui,/autoRecovery\?\.count/)
  assert.match(ui,/planner-lock-review-required/)
  assert.match(ui,/planner-recovery-guard-orphaned/)
})

test('planner startup proactively recovers only the proven-dead run lease',()=>{
  const planner=read('lib/autonomous-planner.mjs')
  const locks=read('lib/life-planner-atomic.mjs')
  assert.match(planner,/const recovered=runLease\.recoverAbandoned\(\)/)
  assert.match(planner,/timer=setInterval/)
  assert.ok(planner.indexOf('const recovered=runLease.recoverAbandoned()')<planner.indexOf('timer=setInterval'))
  assert.match(locks,/function reclaimDeadPlannerRun/)
  assert.match(locks,/autonomous-planner-run-recovery\.lock/)
  assert.match(locks,/ownerAlive!==false/)
  assert.match(locks,/renameSync\(path,tombstone\)/)
  assert.ok(!locks.slice(locks.indexOf('function reclaimDeadPlannerRun'),locks.indexOf('export function createPlannerRunLease')).includes("const name='life-willingness-ledger.lock'"))
})
