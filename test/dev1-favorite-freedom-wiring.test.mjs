import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=(f)=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
test('dev.1 version and docs explicitly separate shipped actions from P4 design',()=>{
 const p=JSON.parse(read('package.json'))
 assert.match(p.version,/^(?:2\.6\.2(?:-dev\.[1-9]\d*)?|2\.7\.0(?:-dev\.[1-9]\d*)?|2\.7\.1-dev\.[1-9]\d*)$/)
 assert.ok(p.files.includes('RELEASE_NOTES_v2.6.2.md'))
 assert.match(read('README.md'),/当前稳定版：\*\*`2\.7\.0`\*\*；当前开发预览：\*\*`2\.7\.1-dev\.1`\*\*/)
 assert.match(read('docs/release/archive/RELEASE_NOTES_v2.6.1-dev.1.md'),/P4 统一待办/)
})
test('backend, overlay and regular Python client enforce the independent default-on deletion gate',()=>{
 const js=read('index.js'),py=read('vendor/bilibili-mcp/mcp_server.py')
 assert.match(js,/autoFavoriteDelete: z\.boolean\(\)\.default\(true\)/)
 assert.match(js,/autoFavoriteVisibility: z\.string\(\)\.default\('auto'\)/)
 assert.match(js,/if \(cfg\.autoFavoriteDelete\) list\.push\('bili_fish_created_folders','bili_favorite_folder_delete'\)/)
 assert.match(js,/BILI_FISH_FOLDER_DELETE: cfg\.autoFavoriteDelete\?'1':'0'/)
 assert.match(js,/BILI_FISH_FOLDER_VISIBILITY: cfg\.autoFavoriteVisibility/)
 assert.match(py,/if os\.environ\.get\('BILI_FISH_FOLDER_DELETE'\)!='1'/)
 assert.match(py,/created_folders WHERE uid=\? AND fid=\?/)
})
test('UI has persisted visibility tri-state and deletion checkbox on management page',()=>{
 const html=read('lib/management-console.html'),js=read('lib/management-console.js')
 for(const id of ['bili-favorite-visibility','bili-favorite-delete']){
   assert.match(html,new RegExp(`id="${id}"`));assert.match(js,new RegExp(id))
 }
 assert.match(html,/value="auto"/);assert.match(html,/value="private"/);assert.match(html,/value="public"/)
 assert.match(js,/payload\.autoFavoriteVisibility/)
})
