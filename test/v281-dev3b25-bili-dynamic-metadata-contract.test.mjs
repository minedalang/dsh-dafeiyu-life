import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const py=readFileSync('vendor/bilibili-mcp/mcp_server.py','utf8')
const host=readFileSync('index.js','utf8')

test('image-only friend dynamic can be read without inventing caption text',()=>{
 assert.match(py,/title=text\[:100\] or 'B站好友分享的图文动态'/)
 assert.match(py,/i\[0-9\]\\\.hdslb\\\.com/)
 assert.match(host,/imageUrls:Array\.isArray\(raw\.imageUrls\)/)
 assert.match(host,/imageObservations:observations/)
})

test('public dynamic write checks real author identity and original content evidence, not the sharer',()=>{
 assert.doesNotMatch(host,/row\.authorUid!==row\.senderUid/)
 assert.match(host,/lifePublicInteractionEnabled!==true/)
 assert.match(host,/fresh\.authorUid!==row\.authorUid/)
 assert.match(host,/!String\(row\.summary\|\|''\)\.trim\(\)&&!row\.imageObservations\?\.length/)
 assert.match(py,/_dynamic_comment_area\(info,did\)/)
 assert.match(py,/str\(author\.get\('mid'\) or ''\)!=author_expected/)
})
