import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const repair=readFileSync(new URL('../tools/repair-dsh-vision-python.ps1',import.meta.url),'utf8')
const mainRepair=readFileSync(new URL('../tools/repair-dsh-python-runtime.ps1',import.meta.url),'utf8')
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))

test('visual interpreter configured by user outranks unhealthy main venv',()=>{
  assert.match(index,/selectVisionPython\(\{preferred:cfg\.visionPythonPath\|\|''\s*,configured:cfg\.pythonPath/)
  assert.match(index,/missing_mcp_dependencies|missingModules/)
})
test('isolated visual repair never renames or deletes the main .venv and requires native copies',()=>{
  assert.match(repair,/Join-Path \$DutyHome '\.vision-venv'/)
  assert.match(repair,/'-m' 'venv' '--copies'/)
  assert.match(repair,/\[switch\]\$ProbeOnly/)
  assert.match(repair,/Inspect-Python \$candidate \$DutyHome \$true/)
  assert.doesNotMatch(repair,/Move-Item.+(?<!vision-)\.venv/)
  assert.doesNotMatch(repair,/icacls|takeown|RunAs|Start-Process.+-Verb/)
})
test('main venv opt-in repair prefers healthy base Python not uv venv',()=>{
  assert.match(mainRepair,/& \$BasePython '-m' 'venv' '--copies'/)
  assert.doesNotMatch(mainRepair,/& \$uv\.Source 'venv'/)
  assert.ok(pkg.files.includes('tools/repair-dsh-vision-python.ps1'))
})
