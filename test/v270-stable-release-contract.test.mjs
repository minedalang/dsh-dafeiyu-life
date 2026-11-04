import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')

test('2.7.0 正式版元信息、更新说明和发布流水线一致', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  const readme = read('README.md')
  const notes = read('RELEASE_NOTES_v2.7.0.md')
  const changelog = read('CHANGELOG.md')
  const workflow = read('.github/workflows/release.yml')
  assert.match(pkg.version, /^(?:2\.7\.0|2\.7\.1-dev\.1)$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.match(readme, /当前稳定版：\*\*`2\.7\.0`\*\*/m)
  assert.match(readme, /坚持鱼的自由发展/)
  assert.match(readme, /RELEASE_NOTES_v2\.7\.0\.md/)
  if (pkg.version === '2.7.0') assert.doesNotMatch(readme, /当前开发版本：|开发预览，尚未正式发布/)
  assert.match(notes, /^# 大肥鱼 2\.7\.0 · 正式版/m)
  assert.doesNotMatch(notes, /开发预览，尚未发布/)
  assert.match(changelog, /^## \[2\.7\.0\] · 正式版/m)
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.7.0.md'))
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/)
  assert.match(workflow, /node --test test\/\*\.test\.mjs/)
  assert.match(workflow, /python -m unittest discover -s test/)
  assert.doesNotMatch(workflow, /(?:^|\n)\s+npm publish\s/m)
})
