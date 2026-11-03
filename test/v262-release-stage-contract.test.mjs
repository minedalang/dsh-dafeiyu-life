import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('2.6.2 开发版与正式版都遵循 SemVer 并与锁文件、README 同步', () => {
  assert.match(pkg.version, /^2\.6\.2(?:-dev\.[1-9]\d*)?$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  const readme = read('README.md')
  assert.ok(readme.includes(`**\`${pkg.version}\`**`))
  if (pkg.version.includes('-dev.')) {
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
