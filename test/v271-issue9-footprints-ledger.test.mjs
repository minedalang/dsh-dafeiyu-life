import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readFileSync} from 'node:fs'
import {recentComments} from '../lib/recent-comments.mjs'

const BV='BV1234567890'
const open=t=>{const dir=mkdtempSync(join(tmpdir(),'issue9-footprints-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}

test('完整评论和附图绑定真实成功 rpid，历史 20 字摘要不被虚构补齐',t=>{
 const dir=open(t),long='确实发过的长评论'.repeat(40)
 writeFileSync(join(dir,'seen.md'),[
  '## 评论记录（发送工具自动写入；成功回执不代表公开可见）',
  `| ${BV} | 1234567890120 | 0 | 2026-11-06 08:30:00 | ${long} | meme_image_name=表情包/猫咪大笑 | meme_status=submitted_unverified |`,
  `| ${BV} | 1234567890121 | 0 | 2026-11-06 08:20:00 | 旧版只保存了十几个字 |`,
  `| ${BV} | 1234567890122 | 0 | 2026-11-06 08:10:00 | 非法图片 | meme_image_name=../secret | meme_status=submitted_unverified |`,
 ].join('\n'))
 const data=recentComments(dir)
 assert.equal(data.total,3)
 assert.equal(data.rows[0].snippet,long)
 assert.equal(data.rows[0].memeImageName,'表情包/猫咪大笑')
 assert.equal(data.rows[0].memeStatus,'submitted_unverified')
 assert.equal(data.rows[1].snippet,'旧版只保存了十几个字')
 assert.equal(data.rows[1].memeImageName,undefined)
 assert.equal(data.rows[2].memeImageName,undefined)
 assert.match(data.rows[0].url,/comment_root_id=1234567890120/)
})

test('删除主 Session 的评论足迹页但保留后台真实评论回执与管理中心图文证据',()=>{
 const frontend=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 assert.doesNotMatch(frontend,/function FootprintComments\(\)/)
 assert.doesNotMatch(frontend,/h\(FootprintComments\)/)
 assert.doesNotMatch(frontend,/slots\.inject\('conversation\.view'/)
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(server,/path === '\/api\/bili-duty\/recent-comments'/)
 const admin=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(admin,/meme-receipt-preview/)
})
