import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('2.6.0 稳定发布版本、锁文件、安装说明和历史发布材料一致', () => {
  assert.equal(pkg.version, '2.6.1-dev.2')
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.1-dev.2.md'))
  assert.ok(!pkg.files.includes('docs/release'))
  assert.match(read('README.md'), /当前开发版本：\*\*`2\.6\.1-dev\.2`\*\*/)
  assert.match(read('README.md'), /dsh plugin --profile desktop add dsh-dafeiyu-life/)
  assert.match(read('README.md'), /DSHMarket 网站/)
  assert.doesNotMatch(read('README.md'), /github:minedalang\/dsh-dafeiyu-life#dev/)
  assert.match(read('CHANGELOG.md'), /\[2\.6\.0-dev\.5\].*DSH Mobile/)
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.0-dev.5.md'), /尚未在真实 DSH Mobile 安卓 App 上完成端到端验收/)
})

test('dev.5 版本升级不意外改变 dev.4 推荐值源或安全边界', () => {
  const presets = read('lib/recommended-experience-settings.mjs')
  const mobileTest = read('test/android-management-open.test.mjs')
  assert.match(presets, /RECOMMENDED_EXPERIENCE_VERSION='2\.6\.0-dev\.4'/)
  assert.match(mobileTest, /手机.*?网关|安卓.*?同源/)
  assert.match(mobileTest, /桌面入口继续委托宿主打开/)
  assert.match(mobileTest, /后端仅返回 URL 时不打开系统浏览器，非本机来源仍拒绝/)
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.0-dev.5.md'), /不放开 First Start 强制验证/)
})
