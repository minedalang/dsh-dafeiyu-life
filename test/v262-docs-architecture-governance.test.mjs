import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const read=relative=>readFileSync(path.join(root,relative),'utf8')

const liveDocs=['AGENTS.md','docs/README.md','docs/architecture/README.md','docs/archive/README.md','docs/architecture/2.6.2-unified-layer-change-gate.md']

test('AGENTS 聚焦当前约束，不再堆叠旧版 dev/RC 流水账',()=>{
 const agents=read('AGENTS.md')
 assert.ok(agents.split('\n').length<120,'AGENTS 应保持短小，具体历史写归档')
 for(const phrase of ['统一层归属检查','Life Voice Context','SocialContextAssembler','SocialPolicyGate','允许新增统一层','架构变更必须同步更新文档','跨 UID','Git Patch']){
  assert.ok(agents.includes(phrase),`missing: ${phrase}`)
 }
 assert.doesNotMatch(agents,/^##\s*(?:dev\.\d+|2\.6\.[01](?:-dev\.| RC)|v2\.6\.0-dev)/m)
})

test('架构门禁说明何时可新增公共层，且架构图与文档同提交更新',()=>{
 const gate=read('docs/architecture/2.6.2-unified-layer-change-gate.md')
 for(const phrase of ['允许创建新的统一层','准入条件','唯一所有者','渐进接线','Mermaid','同一个提交','跨渠道回归','lib/verified-life-facts.mjs','lib/life-voice-context.mjs','LifeMemoryGateway']){
  assert.ok(gate.includes(phrase),`missing: ${phrase}`)
 }
 const index=read('docs/architecture/README.md')
 for(const diagram of ['2.6.2-life-system-current.mmd','2.6.2-life-system-user.mmd','2.6.2-verified-facts-outbound.mmd','2.6.2-life-voice-unified.mmd']){
  assert.ok(index.includes(diagram),`missing diagram: ${diagram}`)
  assert.ok(existsSync(path.join(root,'docs/architecture/diagrams',diagram)))
 }
})

test('当前文档导航的本地链接都存在，历史文件不会被误称为当前实现',()=>{
 const pattern=/(?<!!)\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]+")?\)/g
 for(const file of liveDocs){
  const body=read(file)
  for(const match of body.matchAll(pattern)){
   const url=match[1]
   if(/^(https?:|mailto:|#)/.test(url))continue
   const target=path.resolve(root,path.dirname(file),decodeURIComponent(url.split('#')[0]))
   assert.ok(existsSync(target),`${file} has missing link ${url}`)
  }
 }
 assert.match(read('docs/architecture/README.md'),/历史基准（保留审计，不是最新运行图）/)
 assert.ok(existsSync(path.join(root,'docs/release/archive/RELEASE_NOTES_v2.6.1-RC2.md')),'仍需保留真实发布记录')
 const pkg=JSON.parse(read('package.json'))
 assert.ok(pkg.files.includes('docs/archive/README.md'),'随 npm 打包历史清理索引，避免失效链接')
})

test('废弃且无引用的早期草稿已清理，并由 Git 历史索引指引恢复',()=>{
 const legacy=['docs/README-legacy.md','docs/P6_FUTURE_SCOPE.md','docs/DEV11_SOCIAL_FEEDBACK_VISUALIZATION.md',
 'docs/architecture/2.6.1-p4-unified-todos-proposal.md','docs/archive/business-entrypoints-v2.6.0-dev.4.mmd']
 const guide=read('docs/archive/README.md')
 for(const file of legacy){
  assert.equal(existsSync(path.join(root,file)),false,`legacy still present: ${file}`)
  assert.ok(guide.includes(file),`${file} should be traceable`)
 }
})
