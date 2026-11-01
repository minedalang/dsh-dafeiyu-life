import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=rel=>readFileSync(path.join(root,rel),'utf8')

test('dev.4 current and target Mermaid diagrams are archived, not embedded in the user README',()=>{
  const index=read('docs/architecture/README.md')
  for(const name of ['business-entrypoints','social-interaction-current','memory-event-sync-current','unified-layers-target','implemented-unification']){
    const rel=`docs/architecture/diagrams/${name}-v2.6.0-dev.4.mmd`
    assert.ok(existsSync(path.join(root,rel)),rel)
    assert.ok(index.includes(`${name}-v2.6.0-dev.4.mmd`),name)
    assert.match(read(rel),/^flowchart\s+(TB|LR)/)
  }
  const README=read('README.md')
  assert.match(README,/RELEASE_NOTES_v2\.6\.0-dev\.4\.md/)
  assert.ok(existsSync(path.join(root,'docs/architecture/system-architecture-audit-v2.6.0-dev.4.md')))
  assert.match(index,/system-architecture-audit-v2\.6\.0-dev\.4\.md/)
})

test('dev.5 pack whitelist retains archived dev.4 diagrams and notes',()=>{
  const p=JSON.parse(read('package.json'))
  assert.equal(p.version,'2.6.0-dev.5')
  assert.ok(p.files.includes('RELEASE_NOTES_v2.6.0-dev.4.md'))
  assert.ok(p.files.includes('RELEASE_NOTES_v2.6.0-dev.5.md'))
  assert.ok(p.files.includes('docs/architecture'))
  assert.ok(p.files.includes('lib'))
})
