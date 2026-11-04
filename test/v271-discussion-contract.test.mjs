import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = f => readFileSync(new URL('../' + f, import.meta.url),'utf8')

test('video Agent opens bounded independent read-only discussion tools, never widens writing gate',()=>{
 const src=read('index.js')
 const py=read('vendor/bilibili-mcp/mcp_server.py')
 assert.match(src,/const list = \['bili_search', 'bili_subtitle', 'bili_comments', 'bili_comment_thread', 'bili_discussion_note'/)
 assert.match(src,/BILI_DISCUSSION_VIDEO_AGENT: '\s*\+ yq\('1'\)/)
 assert.match(src,/即使完全不想发表评论，也可以/)
 assert.match(src,/只允许已经读到的根评论/)
 assert.match(src,/仍按原有启用开关、发送额度、事实证据与回执门禁/)
 assert.match(py,/async def bili_discussion_note\(/)
 assert.match(py,/async def bili_comment_thread\(/)
 assert.match(py,/_DISCUSSION_MAX_THREADS = 2/)
 assert.match(py,/_DISCUSSION_MAX_VIDEOS = 6/)
 assert.match(py,/str\(root\) not in _DISCUSSION_ROOTS\.get\(bvid, set\(\)\)/)
 assert.match(py,/externally_verified': False/)
 assert.doesNotMatch(src,/bili_discussion_note.*(?:ownerTodos\.add|bili_send_message)/)
})

test('2.7.1-dev.1 uses consistent prerelease metadata and implemented-architecture links',()=>{
 const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'))
 assert.equal(pkg.version,'2.7.1-dev.1')
 assert.equal(lock.version,pkg.version)
 assert.equal(lock.packages[''].version,pkg.version)
 assert.ok(pkg.files.includes('RELEASE_NOTES_v2.7.1.md'))
 assert.match(read('README.md'),/当前稳定版：\*\*`2\.7\.0`\*\*；当前开发预览：\*\*`2\.7\.1-dev\.1`\*\*/)
 assert.match(read('CHANGELOG.md'),/^## \[2\.7\.1-dev\.1\]/)
 assert.match(read('docs/architecture/README.md'),/2\.7\.1-dev\.1/)
 assert.match(read('docs/architecture/2.7.1-dev1-video-discussion-life.md'),/实际生产接线/)
 assert.match(read('docs/architecture/diagrams/2.7.1-dev1-video-discussion-live.mmd'),/bili_comments/)
})
