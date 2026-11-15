import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ensureHomeFiles} from '../lib/state.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const homeWith = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'bili-v2442-preview-'))
  try { fn(dir) } finally { rmSync(dir, {recursive:true,force:true}) }
}
const hash = x => createHash('sha256').update(x).digest('hex')

test('upgrading from shipped v2.4.41 updates the home preview script safely', () => homeWith(dir => {
  const old = '# simulated prior shipped preview script\n'
  const incoming = readFileSync(join(root, 'lib', 'preview_vision.py'), 'utf8')
  assert.notEqual(old, incoming)
  writeFileSync(join(dir, 'preview_vision.py'), old)
  writeFileSync(join(dir, '.shipped-preview_vision.py.sha'), hash(old))
  ensureHomeFiles(root, dir)
  assert.equal(readFileSync(join(dir, 'preview_vision.py'), 'utf8'), incoming)
  assert.equal(readFileSync(join(dir, '.shipped-preview_vision.py.sha'), 'utf8'), hash(incoming))
}))

test('user-edited preview script is never silently overwritten', () => homeWith(dir => {
  const old = '# simulated prior shipped preview script\n'
  const custom = old + '\n# edited by user\n'
  writeFileSync(join(dir, 'preview_vision.py'), custom)
  writeFileSync(join(dir, '.shipped-preview_vision.py.sha'), hash(old))
  ensureHomeFiles(root, dir)
  assert.equal(readFileSync(join(dir, 'preview_vision.py'), 'utf8'), custom)
  assert.equal(readFileSync(join(dir, 'preview_vision.py.new'), 'utf8'), readFileSync(join(root, 'lib', 'preview_vision.py'), 'utf8'))
}))

test('dev.3a.3 adaptive decoder is staged beside MCP and preview adapter',()=>homeWith(dir=>{
  ensureHomeFiles(root,dir)
  const expected=readFileSync(join(root,'lib','adaptive_video.py'),'utf8')
  assert.equal(readFileSync(join(dir,'adaptive_video.py'),'utf8'),expected)
  assert.equal(readFileSync(join(dir,'.shipped-adaptive_video.py.sha'),'utf8'),hash(expected))
}))
