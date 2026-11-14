# Diagnose the failed batches of run-tests.ps1 without changing application code.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\diagnose-run-tests.ps1
param(
    [string]$SummaryLog = '',
    [ValidateRange(1,4)][int]$Concurrency = 2
)
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
if (-not $SummaryLog) {
    $latest = Get-ChildItem -LiteralPath $env:TEMP -Filter 'dsh-bili-scroll-plus-tests-*.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { throw 'Cannot find the original test transcript. Supply -SummaryLog with its path.' }
    $SummaryLog = $latest.FullName
}
if (-not (Test-Path -LiteralPath $SummaryLog -PathType Leaf)) { throw ('Test summary not found: ' + $SummaryLog) }
$summary = Get-Content -LiteralPath $SummaryLog -Raw
$failedMatches = [regex]::Matches($summary, 'Node\.js 主测试集\s+(\d+)/(\d+)\s+批[^\r\n]*?\s+FAIL\s+1')
$failedNums = @($failedMatches | ForEach-Object { [int]$_.Groups[1].Value } | Sort-Object -Unique)
if ($failedNums.Count -eq 0) { throw 'No failed batch numbers found in the summary. Check whether this log contains the final results table.' }
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue) }
if (-not $node) { throw 'Node.js not found on PATH.' }
$nodePath = $node.Source
$testDir = Join-Path $PSScriptRoot 'test'
$allFiles = @(Get-ChildItem -LiteralPath $testDir -Filter '*.test.mjs' -File | Sort-Object FullName | ForEach-Object { $_.FullName })
$isolated = @(
 'v271-dev2-context-lazy-retrieval.test.mjs',
 'v271-dev3-crosslang-todo-transaction.test.mjs',
 'v271-dev3-discussion-shared-gate.test.mjs',
 'v271-dev3-danmaku-read-gate.test.mjs',
 'v271-dev3-subtitle-read-gate.test.mjs',
 'v271-dev3-three-phase-execution.test.mjs',
 'v271-dev4-life-nested-read-identity.test.mjs'
)
$isolatedPaths = @($isolated | ForEach-Object { Join-Path $testDir $_ })
$mainFiles = @($allFiles | Where-Object { $_ -notin $isolatedPaths })
$batchSize = 12
if ($env:DAFEIYU_NODE_TEST_BATCH_SIZE -match '^(?:[1-9]|[12][0-9]|3[0-2])$') {
    $batchSize = [int]$env:DAFEIYU_NODE_TEST_BATCH_SIZE
}
$batchCount = [int][Math]::Ceiling($mainFiles.Count / $batchSize)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $PSScriptRoot ('test-diagnostics-' + $stamp)
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$lines = New-Object 'System.Collections.Generic.List[string]'
$lines.Add('# Test failure diagnostics')
$lines.Add('')
$lines.Add('Source: ' + $SummaryLog)
$lines.Add('Environment: Windows PowerShell; ' + (& $nodePath --version))
$lines.Add('Main test files: ' + $mainFiles.Count + '; batch size: ' + $batchSize + '; batches: ' + $batchCount)
$lines.Add('Failed batches from uploaded summary: ' + ($failedNums -join ', '))
$lines.Add('')
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
if ($env:CONDA_PREFIX -and (Test-Path -LiteralPath (Join-Path $env:CONDA_PREFIX 'python.exe'))) {
    $env:PYTHON = (Join-Path $env:CONDA_PREFIX 'python.exe')
}
foreach ($batchNo in $failedNums) {
    if ($batchNo -lt 1 -or $batchNo -gt $batchCount) {
        $lines.Add('Batch ' + $batchNo + ': mismatch with current source tree. No tests run.')
        continue
    }
    $start = ($batchNo - 1) * $batchSize
    $end = [Math]::Min($start + $batchSize - 1, $mainFiles.Count - 1)
    $files = @($mainFiles[$start..$end])
    $logName = ('node-batch-{0:D2}.tap.log' -f $batchNo)
    $logFile = Join-Path $outDir $logName
    Write-Host ('Rechecking batch ' + $batchNo + '/' + $batchCount + ' ...')
    $nativeArgs = @('--test','--test-reporter=tap',('--test-concurrency=' + $Concurrency)) + $files
    & $nodePath @nativeArgs 2>&1 | Out-File -FilePath $logFile -Encoding utf8
    $rc = $LASTEXITCODE
    $logLines = @(Get-Content -LiteralPath $logFile)
    $bad = @($logLines | Where-Object { $_ -match '^not ok\s+\d+\s+-\s+' })
    $total = @($logLines | Where-Object { $_ -match '^# tests\s+\d+' } | Select-Object -Last 1)
    $failed = @($logLines | Where-Object { $_ -match '^# fail\s+\d+' } | Select-Object -Last 1)
    $lines.Add(('## Batch {0}: exit {1}' -f $batchNo,$rc))
    $lines.Add(('Log: {0}' -f $logName))
    $lines.Add(('Summary: {0}; {1}' -f ($total -join ' '),($failed -join ' ')))
    if ($bad.Count) {
        foreach ($item in $bad) { $lines.Add('- ' + $item) }
    } elseif ($rc -ne 0) {
        $lines.Add('- No TAP `not ok` line found; inspect log for worker crash or infrastructure exception.')
    } else {
        $lines.Add('- Passed on rerun (possible concurrency or environment variation).')
    }
    $lines.Add('')
}
$report = Join-Path $outDir 'FAILED-TESTS.md'
$lines | Out-File -FilePath $report -Encoding utf8
Write-Host ''
Write-Host ('Diagnostic report: ' + $report) -ForegroundColor Cyan
Write-Host 'Upload FAILED-TESTS.md and the node-batch-*.tap.log files for exact root-cause fixes.' -ForegroundColor Yellow
