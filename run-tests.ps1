#requires -Version 5.1
param([ValidateSet('quick','full','legacy')][string]$Mode = 'quick')
# The ordinary double-click run is an explicit CURRENT-RELEASE quick gate.
# run-tests.bat full performs the exhaustive historical audit.
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot
$script:VerboseOutput = $env:DAFEIYU_TEST_VERBOSE -eq '1'
# Windows PowerShell 5.1 otherwise decodes Node/Python UTF-8 output as ANSI/GBK.
try {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
} catch { Write-Host '终端 UTF-8 初始化失败，详细文件仍会保存。' -ForegroundColor Yellow }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $env:TEMP "dsh-bili-scroll-plus-tests-$stamp.log"
$script:Results = @()
# Always preserve the native TAP/traceback output, not only batch exit codes.
# Files are local diagnostic artifacts; no credentials or model content are added.
$script:DetailDir = Join-Path $env:TEMP "dsh-bili-scroll-plus-details-$stamp"
$script:StepLogFiles = @()
$script:StepNumber = 0
$script:SecurityFixtureSkipped = $false
try { New-Item -ItemType Directory -Path $script:DetailDir -Force | Out-Null }
catch { Write-Host "诊断日志目录不可用：$($_.Exception.Message)" -ForegroundColor Yellow }


try {
    Start-Transcript -Path $logPath -Force | Out-Null
} catch {
    Write-Host "无法创建测试日志，将继续运行：$($_.Exception.Message)" -ForegroundColor Yellow
}

function Invoke-NativeStep {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host "开始：$Name" -ForegroundColor Cyan
    Write-Host ("命令：`"$FilePath`" " + ($Arguments -join " "))
    Write-Host ("=" * 72) -ForegroundColor DarkCyan

    $exitCode = 1
    $script:StepNumber++
    $detailPath = Join-Path $script:DetailDir ("step-{0:D2}.tap.log" -f $script:StepNumber)
    $outputLines = New-Object 'System.Collections.Generic.List[string]'
    try {
        & $FilePath @Arguments 2>&1 | ForEach-Object {
            $line = [string]$_
            $outputLines.Add($line)
            if ($script:VerboseOutput) { Write-Host $line }
        }
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
    } catch {
        $outputLines.Add("diagnostic-runner-exception: $($_.Exception.Message)")
        Write-Host "执行异常：$($_.Exception.Message)" -ForegroundColor Red
        $exitCode = 1
    } finally {
        try {
            [System.IO.File]::WriteAllLines($detailPath, $outputLines.ToArray(), [System.Text.UTF8Encoding]::new($false))
            $script:StepLogFiles += [pscustomobject]@{ Name=$Name; File=$detailPath; ExitCode=$exitCode }
        } catch { Write-Host "保存专项 TAP 失败：$($_.Exception.Message)" -ForegroundColor Yellow }
    }

    if (@($outputLines | Where-Object { $_ -match 'Windows symlink privilege unavailable' }).Count -gt 0) {
        $script:SecurityFixtureSkipped = $true
        Write-Host '安全测试提示：当前 Windows 缺少符号链接创建权限，相关测试为 SKIP，必须在具备权限的环境补测。' -ForegroundColor Yellow
    }
    if (-not $script:VerboseOutput) {
        $failedCases = @($outputLines | Where-Object { $_ -match '^\s*not ok\s+\d+\s+-|^(?:FAIL|ERROR):\s+test_' })
        $counts = @($outputLines | Where-Object { $_ -match '^#\s+(?:tests|pass|fail|skipped)\s+\d+|^Ran\s+\d+\s+tests|^FAILED\s*\(' })
        if ($counts.Count -gt 0) { Write-Host (($counts | Select-Object -Last 5) -join ' | ') }
        if ($exitCode -ne 0) {
            foreach ($item in ($failedCases | Select-Object -First 12)) { Write-Host $item -ForegroundColor Red }
            if ($failedCases.Count -gt 12) { Write-Host ("... 其余 " + ($failedCases.Count - 12) + ' 项见详细文件') -ForegroundColor Yellow }
            Write-Host "错误详情：$detailPath" -ForegroundColor Yellow
        }
    }
    $status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
    $script:Results += [pscustomobject]@{
        Name = $Name
        Status = $status
        ExitCode = $exitCode
    }

    if ($exitCode -eq 0) {
        Write-Host "结果：通过" -ForegroundColor Green
    } else {
        Write-Host "结果：失败（退出码 $exitCode）" -ForegroundColor Red
    }
}

Write-Host "大肥鱼 Plus 自动化测试（$Mode）" -ForegroundColor Cyan
if ($Mode -eq 'quick') {
    Write-Host '当前 2.8.0 核心回归：不会执行全部历史断言；正式发布必须另外执行 full。' -ForegroundColor Yellow
} elseif ($Mode -eq 'legacy') {
    Write-Host '历史发行快照审计：预期部分旧版断言不适用于 2.8.0，不代表当前版验收。' -ForegroundColor Yellow
}
Write-Host "项目目录：$PSScriptRoot"
Write-Host "日志文件：$logPath"

# Locate Node.js.
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) {
    Write-Host "找不到 Node.js。请安装 Node.js，或在已配置 Node.js 的终端中运行。" -ForegroundColor Red
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}
$nodePath = $nodeCommand.Source
if (-not $nodePath) { $nodePath = $nodeCommand.Definition }

# Locate Python. Prefer the active Conda environment, then common Conda installs.
$pythonPath = $null
$pythonArgsPrefix = @()

if ($env:CONDA_PREFIX) {
    $candidate = Join-Path $env:CONDA_PREFIX "python.exe"
    if (Test-Path -LiteralPath $candidate) { $pythonPath = $candidate }
}

if (-not $pythonPath) {
    $candidates = @(
        (Join-Path $HOME "anaconda3\python.exe"),
        (Join-Path $HOME "Anaconda3\python.exe"),
        (Join-Path $HOME "miniconda3\python.exe"),
        (Join-Path $HOME "Miniconda3\python.exe"),
        "C:\ProgramData\anaconda3\python.exe",
        "C:\ProgramData\miniconda3\python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $pythonPath = $candidate
            break
        }
    }
}

if (-not $pythonPath) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notmatch "\\WindowsApps\\") {
        $pythonPath = $pythonCommand.Source
    }
}

if (-not $pythonPath) {
    $pyCommand = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyCommand) {
        $pythonPath = $pyCommand.Source
        $pythonArgsPrefix = @("-3")
    }
}

# Make the resolved interpreter available to Node.js SQLite tests.
# Those tests use process.env.PYTHON || 'python3'.
if (-not $pythonPath -and $env:PYTHON -and (Test-Path -LiteralPath $env:PYTHON -PathType Leaf)) {
    $pythonPath = $env:PYTHON
}
if ($pythonPath) {
    $env:PYTHON = $pythonPath
    Write-Host "Node.js 测试使用 Python：$env:PYTHON" -ForegroundColor Cyan
} else {
    Write-Host "警告：未找到 Python，Node.js SQLite 测试可能失败。" -ForegroundColor Yellow
}

# Force UTF-8 for every Python subprocess in both Node.js and Python tests.
# Windows would otherwise use the local ANSI code page (often GBK), while
# Node.js decodes child stdout as UTF-8 and some Python tests read UTF-8 files.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
Write-Host "Python 测试编码：UTF-8 (PYTHONUTF8=1, PYTHONIOENCODING=utf-8)" -ForegroundColor Cyan

# Node.js defaults to running many test files concurrently. Under the Windows
# test runner, child-process IPC can become unstable when too many workers are
# launched at once. Use a conservative cap, without skipping a single test.
# To diagnose a constrained workstation, set DAFEIYU_NODE_TEST_CONCURRENCY=1.
$nodeTestConcurrency = 2
if ($env:DAFEIYU_NODE_TEST_CONCURRENCY) {
    $requestedConcurrency = $env:DAFEIYU_NODE_TEST_CONCURRENCY.Trim()
    if ($requestedConcurrency -match '^[1-4]$') {
        $nodeTestConcurrency = [int]$requestedConcurrency
    } else {
        Write-Host "忽略无效测试并发数：仅支持 1～4，使用默认值 2。" -ForegroundColor Yellow
    }
}
Write-Host "Node.js 测试文件并发上限：$nodeTestConcurrency" -ForegroundColor Cyan

# A single Node --test call with hundreds of file arguments can end with
# unresolved queued file tests on Windows, even with low worker concurrency.
# Keep each invocation small and require every batch to finish successfully.
$nodeTestBatchSize = 12
if ($env:DAFEIYU_NODE_TEST_BATCH_SIZE) {
    $requestedBatchSize = $env:DAFEIYU_NODE_TEST_BATCH_SIZE.Trim()
    if ($requestedBatchSize -match '^(?:[1-9]|[12][0-9]|3[0-2])$') {
        $nodeTestBatchSize = [int]$requestedBatchSize
    } else {
        Write-Host "忽略无效分批大小：仅支持 1～32，使用默认值 12。" -ForegroundColor Yellow
    }
}
Write-Host "Node.js 每批最大测试文件数：$nodeTestBatchSize" -ForegroundColor Cyan

# Fast, no-network evidence check before the long Node.js suite. This tests
# the subtitle -> vision return contract without a real Bilibili account.
if ($pythonPath) {
    Invoke-NativeStep -Name "Python 字幕视觉证据专项（必须通过）" `
        -FilePath $pythonPath `
        -Arguments @($pythonArgsPrefix + @("-m", "unittest", "discover", "-s", "test", "-p", "test_v271_subtitle_visual_evidence.py", "-v"))
    if ($script:Results[-1].Status -ne "PASS") {
        Write-Host "字幕视觉证据专项失败：已提前停止，未运行全量测试。" -ForegroundColor Red
        try { Stop-Transcript | Out-Null } catch {}
        if ($env:DAFEIYU_TEST_COMPLETE_FLAG) {
            try { Set-Content -LiteralPath $env:DAFEIYU_TEST_COMPLETE_FLAG -Value "FAIL" -Encoding ASCII } catch {}
        }
        exit 1
    }
}

# First-principles three-phase regression: no network, no real outbound writes.
if ($pythonPath) {
    Invoke-NativeStep -Name "Python 对外写入预约专项（必须通过）" -FilePath $pythonPath `
        -Arguments @($pythonArgsPrefix + @("-m", "unittest", "discover", "-s", "test", "-p", "test_v271_three_phase_outbound_gate.py", "-v"))
    if ($script:Results[-1].Status -ne "PASS") {
        Write-Host "写入预约安全专项失败：已提前停止。" -ForegroundColor Red
        try { Stop-Transcript | Out-Null } catch {}
        if ($env:DAFEIYU_TEST_COMPLETE_FLAG) {
            try { Set-Content -LiteralPath $env:DAFEIYU_TEST_COMPLETE_FLAG -Value "FAIL" -Encoding ASCII } catch {}
        }
        exit 1
    }
}

# 1. Focused regression test.
Invoke-NativeStep -Name "白名单好友推荐偏好专项测试" `
    -FilePath $nodePath `
    -Arguments @("--test", "--test-reporter=tap", "--test-concurrency=1", "test/dev4-friend-recommendation-feedback.test.mjs")

# 2. Full Node.js test suite.
$testDir = Join-Path $PSScriptRoot "test"
$allCurrentFiles = @(
    Get-ChildItem -LiteralPath $testDir -Filter '*.test.mjs' -File |
    Sort-Object FullName |
    ForEach-Object { $_.FullName }
)
$legacyDir = Join-Path $testDir 'legacy'
$legacyFiles = @()
if (Test-Path -LiteralPath $legacyDir -PathType Container) {
    $legacyFiles = @(Get-ChildItem -LiteralPath $legacyDir -Filter '*.test.mjs' -File |
        Sort-Object FullName | ForEach-Object { $_.FullName })
}
$testFiles = @()
if ($Mode -eq 'quick') {
    $manifest = Join-Path $testDir 'current-core-tests.txt'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        Write-Host "缺少当前版本核心测试清单：$manifest" -ForegroundColor Red
        exit 2
    }
    $relativeNames = @(Get-Content -LiteralPath $manifest -Encoding UTF8 |
        ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
    if ($relativeNames.Count -ne @($relativeNames | Sort-Object -Unique).Count) {
        Write-Host '核心测试清单含重复文件，拒绝误报覆盖。' -ForegroundColor Red
        exit 2
    }
    foreach ($relative in $relativeNames) {
        if ($relative -notmatch '^[A-Za-z0-9_-]+\.test\.mjs$') {
            Write-Host "核心测试清单存在非法路径：$relative" -ForegroundColor Red
            exit 2
        }
        $candidate = Join-Path $testDir $relative
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            Write-Host "核心测试文件缺失：$relative" -ForegroundColor Red
            exit 2
        }
        $testFiles += $candidate
    }
} elseif ($Mode -eq 'legacy') {
    $testFiles = @($legacyFiles)
} else {
    $testFiles = @($allCurrentFiles)
}
Write-Host "本次 Node 测试文件：$($testFiles.Count)（当前目录 $($allCurrentFiles.Count)；归档 $($legacyFiles.Count)）" -ForegroundColor Cyan

if ($testFiles.Count -gt 0) {
    # These subprocess-sensitive files are mandatory and independently reported,
    # so a Python bridge failure cannot be hidden among other queued file tests.
    $isolatedContextFile = Join-Path $testDir "v271-dev2-context-lazy-retrieval.test.mjs"
    $isolatedCrosslangFile = Join-Path $testDir "v271-dev3-crosslang-todo-transaction.test.mjs"
    $isolatedDiscussionFile = Join-Path $testDir "v271-dev3-discussion-shared-gate.test.mjs"
    $isolatedDanmakuFile = Join-Path $testDir "v271-dev3-danmaku-read-gate.test.mjs"
    $isolatedSubtitleFile = Join-Path $testDir "v271-dev3-subtitle-read-gate.test.mjs"
    $isolatedThreePhaseFile = Join-Path $testDir "v271-dev3-three-phase-execution.test.mjs"
    $isolatedNestedReadFile = Join-Path $testDir "v271-dev4-life-nested-read-identity.test.mjs"
    $isolatedSpecs = @(
        [pscustomobject]@{ Name = "Node.js 按需上下文专项（必须通过）"; File = $isolatedContextFile },
        [pscustomobject]@{ Name = "Node.js 跨语言事务专项（必须通过）"; File = $isolatedCrosslangFile },
        [pscustomobject]@{ Name = "Node.js 讨论共享门禁专项（必须通过）"; File = $isolatedDiscussionFile },
        [pscustomobject]@{ Name = "Node.js 弹幕跨语言预约专项（必须通过）"; File = $isolatedDanmakuFile },
        [pscustomobject]@{ Name = "Node.js 字幕跨语言预约专项（必须通过）"; File = $isolatedSubtitleFile },
        [pscustomobject]@{ Name = "Node.js 三阶段跨语言与外发保护专项（必须通过）"; File = $isolatedThreePhaseFile },
        [pscustomobject]@{ Name = "Node.js 嵌套 Python 读取预约专项（必须通过）"; File = $isolatedNestedReadFile }
    )
    $isolatedSpecs = @($isolatedSpecs | Where-Object { $_.File -in $testFiles })
    $isolatedTestFiles = @($isolatedSpecs | ForEach-Object { $_.File })
    $mainTestFiles = @($testFiles | Where-Object { $_ -notin $isolatedTestFiles })
    $scheduledTestFiles = 0

    # Run process/locking acceptance first: a Windows Python bridge failure
    # must not be discovered only after the long full-suite batches.
    foreach ($spec in $isolatedSpecs) {
        if (Test-Path -LiteralPath $spec.File -PathType Leaf) {
            $scheduledTestFiles++
            Invoke-NativeStep -Name $spec.Name `
                -FilePath $nodePath -Arguments @("--test", "--test-reporter=tap", "--test-concurrency=1", $spec.File)
        } else {
            $script:Results += [pscustomobject]@{
                Name = $spec.Name
                Status = "FAIL"
                ExitCode = 2
            }
            Write-Host "找不到必需的专项测试文件：$($spec.File)" -ForegroundColor Red
        }
    }

    $criticalFailed = @($script:Results | Where-Object { $_.Status -ne "PASS" }).Count -gt 0
    if ($criticalFailed) {
        Write-Host "关键专项失败：为节省时间，已停止，不运行后续 Node/Python 全量测试。" -ForegroundColor Red
        $script:Results | Format-Table -AutoSize
        Write-Host "已执行专项 $scheduledTestFiles / 共 $($testFiles.Count) 个 Node.js 文件；本次不是全量通过。" -ForegroundColor Yellow
        Write-Host "完整日志：$logPath"
        try { Stop-Transcript | Out-Null } catch {}
        if ($env:DAFEIYU_TEST_COMPLETE_FLAG) {
            try { Set-Content -LiteralPath $env:DAFEIYU_TEST_COMPLETE_FLAG -Value "FAIL" -Encoding ASCII } catch {}
        }
        exit 1
    }

    if ($mainTestFiles.Count -gt 0) {
        $batchCount = [int][Math]::Ceiling($mainTestFiles.Count / $nodeTestBatchSize)
        for ($batchIndex = 0; $batchIndex -lt $batchCount; $batchIndex++) {
            $from = $batchIndex * $nodeTestBatchSize
            $to = [Math]::Min($from + $nodeTestBatchSize - 1, $mainTestFiles.Count - 1)
            $batchFiles = @($mainTestFiles[$from..$to])
            $scheduledTestFiles += $batchFiles.Count
            Invoke-NativeStep -Name "Node.js 主测试集 $($batchIndex + 1)/$batchCount 批（$($batchFiles.Count) 文件）" `
                -FilePath $nodePath -Arguments (@("--test", "--test-reporter=tap", "--test-concurrency=$nodeTestConcurrency") + $batchFiles)
        }
    }

    # Fail closed when the enumerated test-file set differs from the scheduled set.
    Write-Host "Node.js 测试文件覆盖：安排 $scheduledTestFiles / 共 $($testFiles.Count) 个" -ForegroundColor Cyan
    if ($scheduledTestFiles -ne $testFiles.Count) {
        $script:Results += [pscustomobject]@{
            Name = "Node.js 测试文件覆盖校验"
            Status = "FAIL"
            ExitCode = 2
        }
        Write-Host "Node.js 测试文件覆盖校验失败：禁止报告全部测试通过。" -ForegroundColor Red
    }
} else {
    $script:Results += [pscustomobject]@{
        Name = "Node.js 全量测试"
        Status = "FAIL"
        ExitCode = 2
    }
    Write-Host "没有找到 test\*.test.mjs 测试文件。" -ForegroundColor Red
}

# 3. Plugin self-check.
Invoke-NativeStep -Name "插件自检" `
    -FilePath $nodePath `
    -Arguments @("selfcheck.mjs")

# Python: quick gate uses current receipt/quota contracts; full runs all historical cases.
if ($pythonPath) {
    if ($Mode -eq 'quick') {
        foreach ($pattern in @('test_dev37_episode_comment_review.py', 'test_v271_dev11_unified_comment_quota.py')) {
            Invoke-NativeStep -Name "Python 当前关键契约 $pattern" -FilePath $pythonPath `
                -Arguments @($pythonArgsPrefix + @('-m', 'unittest', 'discover', '-s', 'test', '-p', $pattern))
        }
    } elseif ($Mode -eq 'full') {
        $pythonTestArgs = $pythonArgsPrefix + @(
            '-m', 'unittest', 'discover', '-s', 'test', '-p', 'test*.py'
        )
        Invoke-NativeStep -Name 'Python 全量测试' -FilePath $pythonPath -Arguments $pythonTestArgs
    }
} elseif ($Mode -ne 'legacy') {
    $script:Results += [pscustomobject]@{
        Name = "Python 全量测试"
        Status = "SKIP"
        ExitCode = 9009
    }
    Write-Host ""
    Write-Host "找不到可用的 Python。请从 Anaconda PowerShell Prompt 运行此脚本，或安装/配置 Conda Python。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("=" * 72) -ForegroundColor DarkCyan
Write-Host "测试汇总" -ForegroundColor Cyan
$script:Results | Format-Table -AutoSize

$allPassed = ($script:Results.Count -gt 0) -and (@($script:Results | Where-Object { $_.Status -ne "PASS" }).Count -eq 0)
if ($Mode -eq 'full' -and $script:SecurityFixtureSkipped) {
    $allPassed = $false
    Write-Host '完整发布验收未完成：Windows 符号链接安全用例被跳过，不能宣布 full 通过。' -ForegroundColor Red
}
if ($allPassed) {
    Write-Host "全部测试通过。" -ForegroundColor Green
} else {
    Write-Host "存在失败或跳过的测试；请查看上方输出和日志。" -ForegroundColor Red
}
Write-Host "完整日志：$logPath"
Write-Host "逐批完整 TAP / Python traceback：$script:DetailDir"
if ($Mode -eq 'quick') { Write-Host '注意：快速通过不是全量通过；发布前必须执行 run-tests.bat full。' -ForegroundColor Yellow }
if ($script:SecurityFixtureSkipped) { Write-Host '注意：安全符号链接测试曾因 Windows 权限不足跳过。' -ForegroundColor Yellow }
try {
    $report = New-Object 'System.Collections.Generic.List[string]'
    $report.Add('# 大肥鱼完整测试失败诊断')
    $report.Add('')
    $report.Add('模式：' + $Mode + '。该清单由 run-tests.ps1 实际运行自动生成。打开对应 step-XX.tap.log 查看断言和堆栈。')
    foreach ($entry in $script:StepLogFiles) {
        if ($entry.ExitCode -eq 0) { continue }
        $report.Add('')
        $report.Add(('## ' + $entry.Name + ' (exit ' + $entry.ExitCode + ')'))
        $report.Add('Log: ' + [System.IO.Path]::GetFileName($entry.File))
        $failedRows = @(Select-String -LiteralPath $entry.File -Pattern '^\s*(?:not ok [0-9]+ - |(?:FAIL|ERROR): test_)' -Encoding UTF8 -ErrorAction SilentlyContinue)
        foreach ($row in $failedRows) { $report.Add('- ' + $row.Line) }
        if ($failedRows.Count -eq 0) { $report.Add('- 此步骤失败，但没有 Node TAP `not ok`；请查看完整日志（可能是 Python traceback 或运行错误）。') }
    }
    [System.IO.File]::WriteAllLines((Join-Path $script:DetailDir 'FAILED-TESTS.md'), $report.ToArray(), [System.Text.UTF8Encoding]::new($false))
} catch { Write-Host "生成失败清单时遇到问题：$($_.Exception.Message)" -ForegroundColor Yellow }

try { Stop-Transcript | Out-Null } catch {}

# The .bat wrapper must not report success if PowerShell was interrupted before
# reaching the final result (Ctrl+C can otherwise preserve an earlier exit 0).
if ($env:DAFEIYU_TEST_COMPLETE_FLAG) {
    try {
        $resultWord = if ($allPassed) { "PASS" } else { "FAIL" }
        Set-Content -LiteralPath $env:DAFEIYU_TEST_COMPLETE_FLAG -Value $resultWord -Encoding ASCII -ErrorAction Stop
    } catch {
        Write-Host "无法写入测试完成标记：$($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

if ($allPassed) { exit 0 } else { exit 1 }
