import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const at=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('cross-language test subprocesses use OS-native fileURLToPath and selected Python',()=>{
  for(const name of ['v271-dev3-crosslang-todo-transaction.test.mjs','v271-dev3-discussion-shared-gate.test.mjs','v271-dev3-danmaku-read-gate.test.mjs','v271-dev3-subtitle-read-gate.test.mjs']){
    const source=at('test/'+name)
    assert.match(source,/fileURLToPath\(new URL\('\.\.\/vendor\/bilibili-mcp\/'/)
    assert.match(source,/process\.env\.PYTHON\|\|/)
    assert.doesNotMatch(source,/decodeURIComponent\((?:pyPath|pyFolder\.pathname)\)/)
  }
})

test('Windows test launcher requires completed PASS marker; isolated Node test is mandatory',()=>{
  const batch=at('run-tests.bat')
  const powershell=at('run-tests.ps1')
  assert.match(batch,/DAFEIYU_TEST_COMPLETE_FLAG/)
  assert.match(batch,/findstr \/x \/c:"PASS"/)
  assert.match(powershell,/Set-Content -LiteralPath \$env:DAFEIYU_TEST_COMPLETE_FLAG/)
  assert.match(powershell,/v271-dev2-context-lazy-retrieval\.test\.mjs/)
  assert.match(powershell,/Node\.js 按需上下文专项（必须通过）/)
})


test('Windows all-Node runner batches all files, isolates cross-language probes, and fails on missing coverage',()=>{
  const powershell=at('run-tests.ps1')
  assert.match(powershell,/\$nodeTestConcurrency\s*=\s*2/)
  assert.match(powershell,/DAFEIYU_NODE_TEST_CONCURRENCY/)
  assert.match(powershell,/\$nodeTestBatchSize\s*=\s*12/)
  assert.match(powershell,/DAFEIYU_NODE_TEST_BATCH_SIZE/)
  assert.match(powershell,/for \(\$batchIndex = 0; \$batchIndex -lt \$batchCount;/)
  assert.match(powershell,/--test-concurrency=\$nodeTestConcurrency/)
  assert.match(powershell,/--test-concurrency=1/)
  assert.match(powershell,/\$mainTestFiles\s*=\s*@\(\$testFiles\s*\|\s*Where-Object/)
  for(const name of ['v271-dev3-crosslang-todo-transaction.test.mjs','v271-dev3-discussion-shared-gate.test.mjs','v271-dev3-danmaku-read-gate.test.mjs','v271-dev3-subtitle-read-gate.test.mjs']){
    assert.ok(powershell.includes(name),`missing independently-required ${name}`)
  }
  assert.match(powershell,/\$scheduledTestFiles -ne \$testFiles\.Count/)
  assert.match(powershell,/Node\.js 测试文件覆盖校验失败/)
})

test('cross-language subprocess fixture fails with a real error instead of unresolved Promise when Python exits',()=>{
  for(const [file,marker] of [['v271-dev3-crosslang-todo-transaction.test.mjs','LOCKED'],['v271-dev3-discussion-shared-gate.test.mjs','ENTERED']]){
    const source=at('test/'+file)
    assert.match(source,/child\.once\('close'/)
    assert.ok(source.includes('Python exited before '+marker))
    assert.match(source,/child\.stderr\.on\('data'/)
  }
})


test('cross-language Windows fixtures isolate console groups and do not send kill signals',()=>{
  for(const file of ['v271-dev3-crosslang-todo-transaction.test.mjs','v271-dev3-discussion-shared-gate.test.mjs','v271-dev3-danmaku-read-gate.test.mjs','v271-dev3-subtitle-read-gate.test.mjs']){
    const source=at('test/'+file)
    assert.match(source,/windowsHide:true,detached:process\.platform==='win32'/)
    assert.match(source,/stdio:\['pipe','pipe','pipe'\]/)
    assert.doesNotMatch(source,/child\.kill\(['"]SIG(?:INT|TERM|KILL)['"]\)/)
    assert.match(source,/child\.stdin\.end\(/)
  }
  const source=at('test/v271-dev3-crosslang-todo-transaction.test.mjs')
  assert.match(source,/os\._exit\(37\)/)
  assert.match(source,/assert\.equal\(code,37/)
})

test('Windows runner executes mandatory cross-language tests before long batches and exits early on failure',()=>{
  const powershell=at('run-tests.ps1')
  const gatePos=powershell.indexOf('foreach ($spec in $isolatedSpecs)')
  const batchesPos=powershell.indexOf('for ($batchIndex = 0; $batchIndex -lt $batchCount;')
  assert.ok(gatePos>=0 && batchesPos>gatePos, 'critical probes must run before all-suite batches')
  assert.match(powershell,/\$criticalFailed\s*=\s*@\(\$script:Results/)
  assert.match(powershell,/if \(\$criticalFailed\) \{/)
  assert.match(powershell,/关键专项失败：为节省时间/)
  assert.match(powershell,/Set-Content -LiteralPath \$env:DAFEIYU_TEST_COMPLETE_FLAG -Value "FAIL"/)
  assert.ok(powershell.indexOf('if ($criticalFailed) {') < batchesPos, 'fail-fast must precede the batch loop')
})
