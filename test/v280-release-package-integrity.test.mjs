import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'))
const included=new Set(pkg.files||[])

test('npm package includes linked roadmap and correctly named Windows diagnostic exporter',()=>{
  assert.ok(included.has('docs/ROADMAP.md'),'README future roadmap must be shipped')
  assert.ok(included.has('tools/导出B站日志.bat'),'Windows diagnostic exporter must be packaged')
  assert.match(readFileSync(resolve(root,'README.md'),'utf8'),/\]\(docs\/ROADMAP\.md\)/)
  const bats=readdirSync(resolve(root,'tools')).filter(name=>name.endsWith('.bat'))
  assert.deepEqual(bats,['导出B站日志.bat'])
  const bat=readFileSync(resolve(root,'tools/导出B站日志.bat'))
  assert.equal(bat.subarray(0,11).toString('ascii'),'@echo off\r\n')
  assert.equal(bat.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])),false)
  assert.match(bat.toString('utf8'),/diagnostic-coverage/i)
})

test('official release remains blocked until preview version and release gates are cleared',()=>{
  const notes=readFileSync(resolve(root,'RELEASE_NOTES_v2.8.0.md'),'utf8')
  const gate=readFileSync(resolve(root,'docs/architecture/2.8.0-release-readiness.md'),'utf8')
  const workflow=readFileSync(resolve(root,'.github/workflows/release.yml'),'utf8')
  if(pkg.version.includes('-dev.')){
    assert.match(notes,/尚未发布到 npm|不代表已发布到 npm/)
    assert.match(gate,/releaseReady:false/)
    assert.match(workflow,/关于当前\.\*预览版/)
    assert.match(workflow,/开发预览提醒/)
  }
})
