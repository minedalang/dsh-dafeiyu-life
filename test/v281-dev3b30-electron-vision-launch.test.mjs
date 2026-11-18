import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8')

test('图片自检显式传递 Electron Node 模式，避免 Python 子会话丢失宿主标志', () => {
  const code = src('index.js')
  assert.match(code, /const runAsNode=Boolean\(process\.versions\.electron\|\|dsh\.env\?\.ELECTRON_RUN_AS_NODE==='1'\)/)
  assert.match(code, /BILI_VISION_DSH_RUN_AS_NODE:runAsNode\?'1':'0'/)
  assert.match(code, /BILI_VISION_DSH_RUN_AS_NODE: ' \+ yq\(independentVisionRunAsNode \? '1' : '0'\)/)
})

test('图片验收和生产视频观察都进入隔离后的相同受限 DSH 启动环境', () => {
  const code = src('lib/vision_dsh.py')
  assert.match(code, /def _vision_dsh_child_env\(env\):/)
  assert.equal(code.match(/child_env=_vision_dsh_child_env\(env\)/g)?.length,2)
  assert.match(code, /if run_as_node == '1':/)
  assert.match(code, /child_env\['ELECTRON_RUN_AS_NODE'\] = '1'/)
})

test('Ollama 只读诊断只输出安全分类，不导出原始日志行', () => {
  const script=src('tools/diagnose-ollama-runner.ps1')
  assert.match(script,/Get-Content -LiteralPath \$path -Tail \$Tail/)
  assert.match(script,/Export-Csv -LiteralPath \$outFile/)
  assert.doesNotMatch(script,/Export-Csv[^\n]*\$lines/)
  assert.match(script,/runner_exited_or_crashed/)
  const bat=src('tools/diagnose-ollama-runner.bat')
  assert.match(bat,/diagnose-ollama-runner\.ps1/)
  assert.ok([...bat].every(c=>c.charCodeAt(0)<128))
})
