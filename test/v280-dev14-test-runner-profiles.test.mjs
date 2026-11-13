import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const testDir = fileURLToPath(new URL('./', import.meta.url))
const root = resolve(testDir, '..')
const read = name => readFileSync(join(root, name), 'utf8')

test('quick test profile is explicitly bounded, current, and never silently includes legacy snapshots', () => {
  const names = read('test/current-core-tests.txt').split(/\r?\n/)
    .map(x => x.trim()).filter(x => x && !x.startsWith('#'))
  assert.ok(names.length >= 25 && names.length < 100)
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.includes('v280-dev14-one-life-one-intent.test.mjs'))
  assert.ok(names.includes('v271-dev3-three-phase-execution.test.mjs'))
  for (const name of names) {
    assert.match(name, /^[\w-]+\.test\.mjs$/)
    assert.equal(existsSync(join(testDir, name)), true, name)
  }
  for (const name of readdirSync(join(testDir, 'legacy'))) {
    assert.ok(!names.includes(name), `legacy test cannot sneak into quick checks: ${name}`)
  }
})

test('quick runner cannot be reported as exhaustive full suite', () => {
  const ps = read('run-tests.ps1')
  const bat = read('run-tests.bat')
  assert.match(ps, /ValidateSet\('quick','full','legacy'\)/)
  assert.match(ps, /current-core-tests\.txt/)
  assert.match(ps, /发布前必须执行 run-tests\.bat full/)
  assert.match(ps, /\$Mode -eq 'full'/)
  assert.match(ps, /\$testFiles = @\(\$allCurrentFiles\)/, 'full must exclude archived old-version snapshots')
  assert.match(ps, /\$testFiles = @\(\$legacyFiles\)/, 'legacy must remain explicitly runnable')
  assert.match(bat, /CURRENT RELEASE CORE TESTS PASSED\. Full maintained suite was NOT RUN/)
  assert.match(ps, /--test-reporter=tap/)
  assert.match(ps, /\.tap\.log/)
})

test('Windows symlink fixtures skip explicitly rather than weaken the security assertion', () => {
  const fixture = read('test/test-platform-fixtures.mjs')
  assert.match(fixture, /t\.skip\(/)
  assert.match(fixture, /symlinkSync\(target, link, type\)/)
  assert.doesNotMatch(fixture, /writeFileSync\(|copyFileSync\(/)
})
