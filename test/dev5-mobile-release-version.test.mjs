import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read = relative => readFileSync(new URL('../' + relative, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('dev.5 版本升级不意外改变 dev.4 推荐值源或安全边界', () => {
  const presets = read('lib/recommended-experience-settings.mjs')
  const mobileTest = read('test/android-management-open.test.mjs')
  assert.match(presets, /RECOMMENDED_EXPERIENCE_VERSION='2\.6\.0-dev\.4'/)
  assert.match(mobileTest, /手机.*?网关|安卓.*?同源/)
  assert.match(mobileTest, /桌面入口继续委托宿主打开/)
  assert.match(mobileTest, /后端仅返回 URL 时不打开系统浏览器，非本机来源仍拒绝/)
  assert.match(read('docs/release/README.md'), /正式版审计|正式版/)
})
