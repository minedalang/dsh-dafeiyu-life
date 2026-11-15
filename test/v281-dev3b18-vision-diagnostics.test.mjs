import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8')

test('Windows all controlled video subprocesses request both console suppression mechanisms',()=>{
 for(const file of ['../lib/adaptive_video.py','../lib/vision_dsh.py','../lib/frame_ocr.py','../vendor/bilibili-mcp/mcp_server.py']){
  const source=read(file)
  assert.match(source,/CREATE_NO_WINDOW/,file)
  assert.match(source,/STARTF_USESHOWWINDOW/,file)
  assert.match(source,/SW_HIDE/,file)
  assert.match(source,/\*\*_hidden_windows_child\(\)/,file)
 }
 const uvfetch=read('../lib/uvfetch.mjs')
 assert.match(uvfetch,/windowsHide:\s*true/)
})

test('exported last vision outcome is a bounded code receipt without raw picture, answer or BV',()=>{
 const source=read('../tools/导出B站日志.bat')
 const block=source.slice(source.indexOf('# This was previously absent'),source.indexOf('life_file = root/'))
 assert.ok(block.length>300)
 assert.match(block,/vision-production-last\.json/)
 assert.match(block,/dump\('visual-model-last-run\.json', vision_status\)/)
 assert.match(block,/allowed_status = \('analyzed'/)
 assert.doesNotMatch(block,/vision_status\s*=\s*vision\b/)
 assert.doesNotMatch(block,/vision_status\[[^\]]+\]\s*=\s*vision\['(?:model|description|bvid|answer|error)'\]/)
})
