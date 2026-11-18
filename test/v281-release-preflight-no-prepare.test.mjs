import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const read=name=>readFileSync(resolve(root,name),'utf8')

test('git-hosted package must not run developer Git hooks during consumer installation',()=>{
 const p=JSON.parse(read('package.json'))
 assert.equal(p.scripts?.prepare,undefined)
 for(const k of ['preinstall','install','postinstall','prepack','postpack'])assert.equal(p.scripts?.[k],undefined)
 assert.equal(p.scripts?.['prepare:embedding-runtime'],'node scripts/prepare-embedding-runtime.mjs')
 assert.match(read('run-tests.ps1'),/install-git-hooks|test-governance/)
})
test('the 2.8.1 release, lockfile, README and release-note paths are consistent',()=>{
 const p=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'))
 assert.equal(p.version,'2.8.1')
 assert.equal(p.version,lock.version)
 assert.equal(p.version,lock.packages[''].version)
 assert.match(read('README.md'),/2\.8\.1/)
 assert.match(read('CHANGELOG.md'),/^## 2\.8\.1 · 稳定版候选发布收口/)
 const workflow=read('.github/workflows/release.yml')
 assert.match(workflow,/note_file="docs\/release\/RELEASE_NOTES_\$\{GITHUB_REF_NAME\}\.md"/)
 assert.ok(existsSync(resolve(root,'docs/release/RELEASE_NOTES_v2.8.1.md')))
})
test('README growth diagram clearly distinguishes planned 2.9.x stages',()=>{
 const readme=read('README.md')
 assert.match(readme,/docs\/architecture\/assets\/dafeiyu-growth-blueprint\.svg/)
 const svg=read('docs/architecture/assets/dafeiyu-growth-blueprint.svg')
 assert.match(svg,/角色认知/)
 assert.match(svg,/关系与经历成长/)
 assert.match(svg,/2\.9\.x 未实现/)
 assert.match(read('docs/architecture/2.9.x-character-learning-memory-trigger-plan.md'),/不在.*2\.8\.2|不属于.*2\.8\.2/)
})
