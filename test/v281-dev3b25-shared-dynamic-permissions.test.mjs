import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const index=readFileSync('index.js','utf8')
const html=readFileSync('lib/management-console.html','utf8')
const js=readFileSync('lib/management-console.js','utf8')
const python=readFileSync('vendor/bilibili-mcp/mcp_server.py','utf8')

test('friend dynamic like/comment permissions are independent and default off',()=>{
 assert.match(index,/lifeSharedDynamicLikeEnabled:\s*z\.boolean\(\)\.default\(false\)/)
 assert.match(index,/lifeSharedDynamicCommentEnabled:\s*z\.boolean\(\)\.default\(false\)/)
 assert.match(html,/id="life-shared-dynamic-like-enabled" type="checkbox"/)
 assert.match(html,/id="life-shared-dynamic-comment-enabled" type="checkbox"/)
 assert.doesNotMatch(html,/id="life-shared-dynamic-like-enabled"[^>]*checked/)
 assert.doesNotMatch(html,/id="life-shared-dynamic-comment-enabled"[^>]*checked/)
 assert.match(js,/confirmAction\(\{title:'开启好友分享动态自主点赞'/)
 assert.match(js,/confirmAction\(\{title:'开启好友分享动态自主评论'/)
 assert.match(index,/confirmSharedDynamicLike!=='ENABLE_FRIEND_SHARED_DYNAMIC_LIKE'/)
 assert.match(index,/confirmSharedDynamicComment!=='ENABLE_FRIEND_SHARED_DYNAMIC_COMMENT'/)
})

test('dynamic write functions are host-only plain functions, not DSH MCP tools',()=>{
 const likeAt=python.indexOf('async def bili_dynamic_like_life'),commentAt=python.indexOf('async def bili_dynamic_comment_life')
 const commentContextAt=python.indexOf('async def bili_dynamic_comment_context')
 const likePrefix=python.slice(0,likeAt).trimEnd(),commentPrefix=python.slice(0,commentAt).trimEnd()
 assert.doesNotMatch(likePrefix.slice(-24),/@tool\(\)$/)
 assert.doesNotMatch(commentPrefix.slice(-24),/@tool\(\)$/)
 assert.ok(commentContextAt>commentAt)
 assert.match(index,/life-shared-dynamic-write\.py/)
 const whitelist=index.slice(index.indexOf('const mcpWhitelist ='),index.indexOf('// 不依赖模型自觉',index.indexOf('const mcpWhitelist =')))
 for(const name of ['bili_dynamic_info','bili_video_info_by_aid','bili_dynamic_like_life','bili_dynamic_comment_life'])assert.doesNotMatch(whitelist,new RegExp(name))
 assert.match(index,/lifeWillingness\.adoptDynamicDecisionQueued/)
 assert.match(index,/lifeWillingness\.verify\(proof,kind,payload,\{requireSealed:true\}\)/)
})
