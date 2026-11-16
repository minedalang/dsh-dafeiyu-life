import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('dev3b28 exporter includes bounded CLI diagnostics and no raw output',()=>{
  const text=read('tools/导出B站日志.bat')
  assert.match(text,/cliExitCode.*255/)
  assert.match(text,/cliStderrKind/)
  assert.match(text,/stderrKind.*stage\(row\.get\('cliStderrKind'\)\)/)
  assert.doesNotMatch(text,/dump\('dsh-vision-selftest-last-run.json',\s*row\)/)
})

test('dev3b28 window tracer filters input-method status and disambiguates PID reuse',()=>{
  const body=read('tools/capture-intermittent-window.ps1')
  assert.ok([...Buffer.from(body,'utf8')].every(x=>x<128),'PowerShell 5.1 launcher remains ASCII-only')
  assert.match(body,/SoPY_Status/)
  assert.match(body,/\$window\.ClassName -notin @\('ConsoleWindowClass','PseudoConsoleWindow','CASCADIA_HOSTING_WINDOW_CLASS'\)/)
  assert.match(body,/ProcessStartUtc=\$created/)
  assert.match(body,/\$original=\$windowSeen\[\$key\]/)
  assert.doesNotMatch(body,/\$knownConsoleClass -and \$procName/)
})

test('dev3b28 management page reveals last persisted process exit evidence',()=>{
  const body=read('lib/management-console.js')
  assert.match(body,/last\.cliProcess==='exited'/)
  assert.match(body,/last\.cliStderrKind/)
})
