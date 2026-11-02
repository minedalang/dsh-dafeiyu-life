import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
test('2.6.0 稳定版本、锁文件、正式发布说明与历史 dev.8 归档并存',()=>{
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'))
  assert.equal(pkg.version,'2.6.1-dev.2')
  assert.equal(lock.version,pkg.version)
  assert.equal(lock.packages[''].version,pkg.version)
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.1-dev.2.md'))
  assert.ok(!pkg.files.some(x=>x.startsWith('RELEASE_NOTES_v2.6.0-dev.')))
  assert.match(read('README.md'),/当前开发版本：\*\*`2\.6\.1-dev\.2`\*\*/)
  assert.match(read('README.md'),/RELEASE_NOTES_v2\.6\.1-dev\.2\.md/)
  assert.match(read('CHANGELOG.md'),/\[2\.6\.0\]/)
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.0-dev.8.md'),/DeepSeek/)
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.0-dev.7.md'),/^# 大肥鱼 · DSH 生活系统 `2\.6\.0-dev\.7`/)
})
