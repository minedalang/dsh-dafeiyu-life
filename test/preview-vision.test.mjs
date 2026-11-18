import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const root=new URL('../',import.meta.url)
const txt=file=>readFileSync(new URL(file,root),'utf8')
test('预览功能默认关闭，视觉与 debug 独立配置',()=>{
 const js=txt('index.js')
 assert.match(js,/visionEnabled: z\.boolean\(\)\.default\(false\)/)
 assert.match(js,/visionDebug: z\.boolean\(\)\.default\(false\)/)
 assert.match(js,/visionModelId/)
 assert.match(js,/BILI_VISION_PROVIDER/)
 assert.match(js,/if \(cfg\.visionEnabled\) list\.push\('bili_preview_vision'\)/)
 assert.match(js,/vision-preview-test/)
})
test('MCP 只接受 bvid，必须先过白名单与总开关',()=>{
 const py=txt('vendor/bilibili-mcp/mcp_server.py')
 assert.match(py,/async def bili_preview_vision\(bvid: str, focus_start_seconds: float/)
 assert.match(py,/_guard\("bili_preview_vision"\)/)
 assert.doesNotMatch(py,/async def bili_preview_vision\(bvid: str, url/)
})
test('前端有两个开关和独立视觉模型与测试按钮',()=>{
 const ui=txt('client.js')
 for(const s of ['预览识图','保存实际预览图','visionModelProvider','visionModelId','vision-preview-test'])assert.ok(ui.includes(s))
})
