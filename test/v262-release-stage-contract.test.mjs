import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('正式版与后续 dev 开发版都遵循 SemVer 并与锁文件、README 同步', () => {
  assert.match(pkg.version, /^(?:2\.6\.2(?:-dev\.[1-9]\d*)?|2\.7\.0(?:-dev\.[1-9]\d*)?|2\.7\.1-dev\.[1-9]\d*)$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  const readme = read('README.md')
  assert.ok(readme.includes(`**\`${pkg.version}\`**`))
  if (pkg.version.startsWith('2.7.1-dev.')) {
    assert.match(readme, /当前开发预览：\*\*`2\.7\.1-dev\.[1-9]\d*`/)
    assert.match(read('CHANGELOG.md'), /^## \[2\.7\.1-dev\.[1-9]\d*\]/m)
    assert.match(read('RELEASE_NOTES_v2.7.1.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('RELEASE_NOTES_v2.7.1.md'))
  } else if (pkg.version.startsWith('2.7.0-dev.')) {
    assert.match(readme, /开发预览，尚未正式发布/)
    assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm'))
    assert.match(read('RELEASE_NOTES_v2.7.0.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('RELEASE_NOTES_v2.7.0.md'))
  } else if (pkg.version === '2.7.0') {
    assert.match(readme, /^当前版本：\*\*`2\.7\.0`\*\*/m)
    assert.doesNotMatch(readme, /^当前开发版本：|开发预览，尚未正式发布/m)
    assert.match(read('CHANGELOG.md'), /^## \[2\.7\.0\] · 正式版/m)
    assert.match(read('RELEASE_NOTES_v2.7.0.md'), /^# 大肥鱼 2\.7\.0 · 正式版/m)
    assert.doesNotMatch(read('RELEASE_NOTES_v2.7.0.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('RELEASE_NOTES_v2.7.0.md'))
  } else if (pkg.version.includes('-dev.')) {
    assert.match(readme, /尚未正式发布/)
    assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm'))
    assert.match(read('RELEASE_NOTES_v2.6.2.md'), /开发预览，尚未发布/)
  } else {
    assert.doesNotMatch(readme, /^当前开发版本：/m)
    assert.doesNotMatch(read('RELEASE_NOTES_v2.6.2.md'), /开发预览，尚未发布/)
  }
})

test('Tag 发行流水线强制全量测试并将开发版和稳定版严格分开', () => {
  const workflow = read('.github/workflows/release.yml')
  assert.match(workflow, /GITHUB_REF_NAME.*package\.json/)
  assert.match(workflow, /node --test test\/\*\.test\.mjs/)
  assert.match(workflow, /python -m unittest discover -s test/)
  assert.match(workflow, /node selfcheck\.mjs/)
  assert.match(workflow, /git merge-base --is-ancestor/)
  assert.match(workflow, /prerelease:/)
  assert.match(workflow, /make_latest:/)
  assert.doesNotMatch(workflow, /(?:^|\n)\s+npm publish\s/m)
})
