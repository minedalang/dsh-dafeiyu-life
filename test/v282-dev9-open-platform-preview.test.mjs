import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'

const project = new URL('../',import.meta.url)
const read = file => readFileSync(new URL(file,project),'utf8')
const html = read('lib/management-console.html')
const js = read('lib/management-console.js')
const readme = read('README.md')
const docs = read('docs/open-platform/README.md')
const manifest = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))

test('preview page is reachable through the real management console tab switcher',()=>{
  assert.match(html,/<button data-tab="open-platform" aria-selected="false">[^<]*桌宠开放平台（开发中）<\/button>/)
  assert.equal((html.match(/id="panel-open-platform"/g)||[]).length,1,'the panel must exist exactly once')
  assert.match(html,/<section id="panel-open-platform" hidden>/)
  const tabArray = js.match(/const tabNames=\[([^\]]+)\]/)?.[1]
  assert.ok(tabArray,'management console tab router must be present')
  assert.match(tabArray,/'open-platform'/,'otherwise the button cannot switch to the preview page')
  assert.match(js,/'open-platform':async\(\)=>\{\}/,'page refresh must not trigger model or B站 calls')
  assert.match(html,/预计 2\.9\.0 之后逐步开放/)
  assert.match(html,/仅供阅读 · 暂未开放/)
  assert.match(html,/当前页面仅用于展示规划/)
})

test('API previews cannot be confused with currently active integration',()=>{
  assert.match(html,/接口预览（草案）/)
  assert.match(html,/不代表当前插件已经提供这些可调用服务/)
  assert.match(html,/不开放调用/)
  assert.match(docs,/尚未开放真实接入/)
  assert.match(docs,/不发放真实开发者令牌/)
  assert.doesNotMatch(html.match(/<section id="panel-open-platform" hidden>([\s\S]*?)<\/section>/)?.[1]||'',/<(?:form|input|button)\b/i,'preview panel must not provide fake or active connection controls')
})

test('README showcases the long-term ecosystem with real local SVG assets and correct preview status',()=>{
  assert.match(readme,/## 🧩 桌宠开放平台（开发中）/)
  for(const asset of [
    'docs/architecture/assets/life-open-platform-ecosystem.svg',
    'docs/architecture/assets/life-open-platform-future-world.svg',
    'docs/architecture/assets/life-open-platform-roadmap.svg'
  ]){
    assert.ok(readme.includes(`](${asset})`),`README must reference ${asset}`)
    assert.ok(existsSync(new URL(asset,project)),`${asset} must exist`)
    const svg=read(asset)
    assert.match(svg,/<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    assert.match(svg,/<title\b/)
    assert.match(svg,/<desc\b/)
  }
  assert.match(readme,/社区做的桌宠/)
  assert.ok(manifest.files.includes('docs/open-platform'),'npm package must ship developer preview docs linked by README')
  assert.match(readme,/3D 房间/)
  assert.match(readme,/尚不能连接实际桌宠或第三方客户端/)
  assert.ok(readme.indexOf('## 🌱 未来规划：让生活更有故事')<readme.indexOf('## ❤️ 致谢'))
  assert.equal(readme.slice(readme.indexOf('## 🌱 未来规划：让生活更有故事')).match(/^## /gm)?.length,2)
  assert.match(readme,/c1overzz\/dsh-bili-scroll/)
  assert.match(readme,/THIRD_PARTY_NOTICES\.md/)
})

test('developer version identity is synchronized',()=>{
  assert.match(manifest.version,/^2\.8\.(?:2|3)(?:-dev\.[1-9]\d*)?$/)
  assert.equal(lock.version,manifest.version)
  assert.equal(lock.packages[''].version,manifest.version)
  assert.ok(readme.includes('当前版本源码：'+manifest.version))
  assert.ok(read('CHANGELOG.md').startsWith(manifest.version==='2.8.2'?'## [2.8.2] ·':'## '+manifest.version+' ·'))
})
