import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('正式版与后续 dev 开发版都遵循 SemVer 并与锁文件、README 同步', () => {
  assert.match(pkg.version, /^2\.8\.(?:0|1|2|3)(?:-dev\.[0-9A-Za-z.-]+)?$/)
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  const readme = read('README.md')
  assert.match(readme, /一个 Life/)
  if (pkg.version.startsWith('2.8.0-dev.')) {
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.8.0.md'), /开发预览提醒|正式发布前/)
    assert.match(read('CHANGELOG.md'), new RegExp('2\\.8\\.0-dev\\.16'))
    assert.ok(pkg.files.includes('docs/release/archive/RELEASE_NOTES_v2.8.0.md'))
  } else if (pkg.version === '2.8.0') {
    assert.match(read('CHANGELOG.md'), /^## \[2\.8\.0\] · 正式版/m)
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.8.0.md'), /^# 大肥鱼 2\.8\.0 · 正式版更新说明/m)
    assert.doesNotMatch(readme,/关于当前.*预览版/)
    assert.ok(pkg.files.includes('docs/release/archive/RELEASE_NOTES_v2.8.0.md'))
  } else if (pkg.version.startsWith('2.8.1-dev.')) {
    assert.match(readme, /当前开发(?:分支|基线).*2\.8\.1-dev/)
    assert.match(read('CHANGELOG.md'), new RegExp('^## '+pkg.version.replaceAll('.', '\\.'), 'm'))
    assert.match(read('docs/architecture/2.8.1-video-perception-dev3b6.md'), /正式版门禁（尚未完成）/)
  } else if (pkg.version.startsWith('2.7.1-dev.')) {
    assert.match(readme, /当前开发预览：\*\*`2\.7\.1-dev\.[1-9]\d*`/)
    assert.match(read('CHANGELOG.md'), /^## \[2\.7\.1-dev\.[1-9]\d*\]/m)
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.7.1.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('docs/release/archive/RELEASE_NOTES_v2.7.1.md'))
  } else if (pkg.version.startsWith('2.7.0-dev.')) {
    assert.match(readme, /开发预览，尚未正式发布/)
    assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm'))
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.7.0.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('docs/release/archive/RELEASE_NOTES_v2.7.0.md'))
  } else if (pkg.version === '2.7.0') {
    assert.match(readme, /^当前版本：\*\*`2\.7\.0`\*\*/m)
    assert.doesNotMatch(readme, /^当前开发版本：|开发预览，尚未正式发布/m)
    assert.match(read('CHANGELOG.md'), /^## \[2\.7\.0\] · 正式版/m)
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.7.0.md'), /^# 大肥鱼 2\.7\.0 · 正式版/m)
    assert.doesNotMatch(read('docs/release/archive/RELEASE_NOTES_v2.7.0.md'), /开发预览，尚未发布/)
    assert.ok(pkg.files.includes('docs/release/archive/RELEASE_NOTES_v2.7.0.md'))
  } else if (pkg.version === '2.8.2') {
    assert.match(readme,/当前版本源码：2\.8\.2/);
    assert.match(read('CHANGELOG.md'),/^## \[2\.8\.2\] · 视频感知体验优化/m);
    assert.ok(pkg.files.includes('docs/release/RELEASE_NOTES_v2.8.2.md'));
    assert.doesNotMatch(readme,/尚未正式发布|开发预览/);
  } else if (pkg.version === '2.8.3') {
    assert.match(readme,/当前版本源码：2\.8\.3/);
    assert.match(read('CHANGELOG.md'),/^## \[2\.8\.3\] · 让经历成为记忆/m);
    assert.match(read('docs/release/2.8.3-release-checklist.md'),/状态：releaseReady:true/);
    assert.doesNotMatch(readme,/尚未正式发布|开发预览/);
  } else if (pkg.version.startsWith('2.8.3-dev.')) {
    assert.match(readme,new RegExp('当前版本源码：'+pkg.version.replaceAll('.', '\\.')))
    assert.match(readme,/尚未正式发布/)
    assert.match(read('CHANGELOG.md'),new RegExp('^## '+pkg.version.replaceAll('.', '\\.'),'m'))
  } else if (pkg.version.startsWith('2.8.2-dev.')) {
    assert.match(readme,new RegExp('当前版本源码：'+pkg.version.replaceAll('.', '\\.')))
    assert.match(readme,new RegExp(pkg.version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
    assert.match(read('CHANGELOG.md'),new RegExp('^## '+pkg.version.replaceAll('.', '\\.'),'m'))
  } else if (pkg.version.includes('-dev.')) {
    assert.match(readme, /尚未正式发布/)
    assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[${pkg.version.replaceAll('.', '\\.')}\\]`, 'm'))
    assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.2.md'), /开发预览，尚未发布/)
  } else {
    assert.doesNotMatch(readme, /^当前开发版本：/m)
    assert.doesNotMatch(read('docs/release/archive/RELEASE_NOTES_v2.6.2.md'), /开发预览，尚未发布/)
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


test('2.8.3 current docs and release scope are included in npm and aligned with candidate status',()=>{
 if(!pkg.version.startsWith('2.8.3'))return;
 for(const name of ['docs/release/RELEASE_NOTES_v2.8.3.md','docs/release/2.8.3-user-upgrade-guide.md','docs/release/2.8.3-publish-commands.md','docs/release/2.8.3-release-checklist.md']){assert.ok(pkg.files.includes(name),name);assert.ok(read(name).includes('2.8.3'));}
 assert.ok(pkg.files.includes('docs/architecture'));assert.match(read('docs/README.md'),/2\.8\.3-current-architecture\.md/);
 assert.match(read('docs/release/RELEASE_NOTES_v2.8.3.md'),/^# 大肥鱼 2\.8\.3 · 正式版功能说明/m);
 if(pkg.version.includes('-dev.'))assert.match(read('docs/release/2.8.3-release-checklist.md'),/状态：releaseReady:false/);
})
