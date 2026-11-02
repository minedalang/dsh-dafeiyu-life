import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, renameSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {seedCompletedFirstStart} from './helpers/ready-host.mjs'

function fixture(home, {collectCleanup = false} = {}) {
  const cleanups = []
  let handler
  const ctx = {
    get: key => key === 'dshHomePath' ? (...parts) => join(home, ...parts) : undefined,
    logger: {info() {}, warn() {}},
    tools: {register() {}},
    webServer: {register(route) {handler = route.handler; return {dispose() {}}}},
    // Simulates old HTTP test fixtures that do not run plugin shutdown effects.
    effect(callback) {
      const cleanup = callback()
      if (collectCleanup && typeof cleanup === 'function') cleanups.push(cleanup)
    },
    settings: {describe() {return []}},
  }
  const file = join(home, 'bili-duty', 'social-relationships', 'relationships.sqlite3')
  async function get(path) {
    const req = Readable.from([])
    req.method = 'GET'
    req.url = path
    req.headers = {host: '127.0.0.1:3080'}
    let status = 0, body = ''
    await handler(req, {
      writeHead(code) {status = code},
      end(text) {body = String(text ?? '')},
    })
    return {status, body}
  }
  return {ctx, file, get, cleanup() {for (const fn of cleanups.reverse()) fn()}}
}

test('Windows fixture: plugin initialization does not leave an eager relationship SQLite handle', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dafeiyu-dev9-lazy-index-'))
  try {
    const host = fixture(home)
    apply(host.ctx, {})
    assert.equal(existsSync(host.file), false, 'apply() must not open the relationship SQLite file')
    const page = await host.get('/api/bili-duty/manage?tab=firststart')
    assert.equal(page.status, 200)
    assert.equal(existsSync(host.file), false, 'unrelated management requests must not open the relationship SQLite file')
  } finally {
    // On Windows an open SQLite handle in the directory would make this fail EPERM.
    rmSync(home, {recursive: true, force: true})
  }
})

test('relationship index opens on first use and closes when the real host disposes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dafeiyu-dev9-lazy-index-dispose-'))
  let host
  try {
    seedCompletedFirstStart(home)
    host = fixture(home, {collectCleanup: true})
    apply(host.ctx, {})
    assert.equal(existsSync(host.file), false)
    const response = await host.get('/api/bili-duty/relationships?limit=10')
    assert.equal(response.status, 200, response.body.slice(0, 150))
    assert.equal(JSON.parse(response.body).ok, true)
    assert.equal(existsSync(host.file), true)
    host.cleanup()
    // A Windows rename cannot reliably succeed while sqlite retains a file lock.
    const moved = `${host.file}.closed`
    renameSync(host.file, moved)
    renameSync(moved, host.file)
  } finally {
    rmSync(home, {recursive: true, force: true})
  }
})
