import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
test('两条视觉路线只使用一个共享图片与人工验收面板',()=>{
  for(const id of ['vision-unified-probe-panel','vision-probe-image','vision-probe-source','vision-probe-route','vision-probe-answer','vision-probe-verify','vision-probe-approve','vision-probe-reject'])
    assert.equal((page.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
  for(const removed of ['dsh-vision-probe-panel','local-vision-probe-panel','dsh-vision-probe-answer','local-vision-probe-answer'])assert.doesNotMatch(page,new RegExp(removed))
  assert.match(js,/visionIsLocal\(\)/)
  assert.match(js,/if\(visionIsLocal\(\)\)await reviewLocalVision\(true\);else await reviewDshVision\(true\)/)
  assert.match(js,/if\(visionIsLocal\(\)\)await reviewLocalVision\(false\);else await reviewDshVision\(false\)/)
})
test('本地识图方式禁用DSH模型填写区域而不改变保存值',()=>{
  assert.match(js,/fields\.querySelectorAll\('input,select,textarea'\)\.forEach\(el=>\{el\.disabled=local\}\)/)
  assert.match(js,/fields\.style\.opacity=local/)
  assert.match(js,/\$\('local-vision-controls'\)\.hidden=!local/)
  assert.match(js,/payload\.visionMode=\$\('models-vision-mode'\)\.value/)
})
test('DSH失败提示不把子会话失败误认为模型无图片能力',()=>{
  const py=readFileSync(new URL('../lib/vision_dsh.py',import.meta.url),'utf8')
  assert.match(py,/def _safe_dsh_headless_diagnostic/)
  assert.match(py,/普通 Session 可识图不代表独立 Headless/)
  assert.match(py,/result\.stderr,result\.stdout,result\.returncode/)
  assert.doesNotMatch(py,/DSH 视觉会话异常结束（exit=.*检查模型 Provider \/ 图片能力/)
})
