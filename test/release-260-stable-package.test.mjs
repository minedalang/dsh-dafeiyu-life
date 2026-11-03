import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const read=x=>readFileSync(join(root,x),'utf8')

test('正式版标识与 npm 发行清单一致，旧版说明只留历史归档',()=>{
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'))
  assert.equal(pkg.name,'dsh-dafeiyu-life')
  assert.equal(pkg.version,'2.6.2')
  assert.equal(lock.version,pkg.version)
  assert.equal(lock.packages[''].version,pkg.version)
  assert.ok(readdirSync(root).includes('RELEASE_NOTES_v2.6.1.md'),'保留已发布的上一版说明')
  assert.ok(readdirSync(root).includes('RELEASE_NOTES_v2.6.2.md'),'新版本单独开发说明')
  assert.ok(!pkg.files.includes('RELEASE_NOTES_v2.6.1.md'),'安装包只带当前说明')
  assert.ok(pkg.files.includes('RELEASE_NOTES_v2.6.2.md'))
  assert.ok(!pkg.files.includes('docs/release'))
  assert.ok(readdirSync(join(root,'docs/release/archive')).some(x=>x.includes('2.6.0-dev.9')))
  assert.match(read('.github/workflows/release.yml'),/GITHUB_REF_NAME/)
  assert.ok(existsSync(join(root,'docs/release/2.6.0-readiness.md')))
})

test('安装文案有三种市场路径，模型说明简洁且不再推荐使用 dev 分支',()=>{
  const readme=read('README.md')
  const install=readme.split('## 🚀 安装与首次设置')[1].split('### 老用户升级：')[0]
  assert.match(install,/dsh plugin --profile desktop add dsh-dafeiyu-life/)
  assert.match(install,/在 `dshmarket` 插件中搜索/)
  assert.match(install,/https:\/\/dshmarket\.com\/zh\//)
  assert.doesNotMatch(install,/#dev|一键使用已验证模型（可选）/)
  assert.match(install,/自动继承/)
  assert.ok(install.length<1200,'首次设置段落不应重新写成长篇 Provider 技术说明')
  assert.match(read('RELEASE_NOTES_v2.6.2.md'),/请求|记忆|界面/)
  assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.1-dev.1.md'),/2\.6\.1-dev\.1/)
})
