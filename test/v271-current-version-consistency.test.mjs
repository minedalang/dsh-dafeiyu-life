import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=(filename)=>readFileSync(new URL('../'+filename,import.meta.url),'utf8')

test('当前开发版本与 package lock、README、变更和架构文档一致',()=>{
  const pkg=JSON.parse(read('package.json'))
  const lock=JSON.parse(read('package-lock.json'))
  assert.match(pkg.version,/^2\.7\.1-dev\.[1-9]\d*$/)
  assert.equal(lock.version,pkg.version)
  assert.equal(lock.packages[''].version,pkg.version)
  assert.match(read('README.md').slice(0,2200),new RegExp('当前开发预览：\\*\\*`'+pkg.version.replaceAll('.','\\.')+'`'))
  assert.match(read('AGENTS.md'),new RegExp('当前开发版本 `'+pkg.version.replaceAll('.','\\.')+'`'))
  assert.ok(read('CHANGELOG.md').startsWith('## ['+pkg.version+'] ·'))
  assert.ok(read('docs/architecture/README.md').includes('当前版本 '+pkg.version+'：'))
  assert.ok(read('docs/architecture/2.7.1-dev17-life-trace-correction.md').startsWith('# '+pkg.version+' '))
  assert.ok(read('RELEASE_NOTES_v2.7.1.md').startsWith('# '+pkg.version+' ·'))
})
