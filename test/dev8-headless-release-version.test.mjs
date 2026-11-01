import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
test('dev.8 版本、锁文件、README 与发布说明保持一致',()=>{
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'))
  assert.equal(pkg.version,'2.6.0-dev.8')
  assert.equal(lock.version,pkg.version)
  assert.equal(lock.packages[''].version,pkg.version)
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.0-dev.8.md'))
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.0-dev.7.md'))
  assert.match(read('README.md'),/当前开发版本：`2\.6\.0-dev\.8`/)
  assert.match(read('README.md'),/RELEASE_NOTES_v2\.6\.0-dev\.8\.md/)
  assert.match(read('CHANGELOG.md'),/^## \[2\.6\.0-dev\.8\]/)
  assert.match(read('RELEASE_NOTES_v2.6.0-dev.8.md'),/DeepSeek/)
  assert.match(read('RELEASE_NOTES_v2.6.0-dev.7.md'),/^# 大肥鱼 · DSH 生活系统 `2\.6\.0-dev\.7`/)
})
