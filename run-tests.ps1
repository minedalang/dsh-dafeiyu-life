#requires -Version 5.1
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $env:TEMP "dsh-bili-scroll-plus-tests-$stamp.log"
$script:Results = @()

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
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }
    } catch {
        Write-Host "执行异常：$($_.Exception.Message)" -ForegroundColor Red
        $exitCode = 1
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

Write-Host "大肥鱼 Plus 自动化测试" -ForegroundColor Cyan
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
    -Arguments @("--test", "--test-concurrency=1", "test/dev4-friend-recommendation-feedback.test.mjs")

# 2. Full Node.js test suite.
$testDir = Join-Path $PSScriptRoot "test"
$testFiles = @(
    Get-ChildItem -LiteralPath $testDir -Filter "*.test.mjs" -File |
    Sort-Object FullName |
    ForEach-Object { $_.FullName }
)

if ($testFiles.Count -gt 0) {
    # These subprocess-sensitive files are mandatory and independently reported,
    # so a Python bridge failure cannot be hidden among other queued file tests.
    $isolatedContextFile = Join-Path $testDir "v271-dev2-context-lazy-retrieval.test.mjs"
    $isolatedCrosslangFile = Join-Path $testDir "v271-dev3-crosslang-todo-transaction.test.mjs"
    $isolatedDiscussionFile = Join-Path $testDir "v271-dev3-discussion-shared-gate.test.mjs"
    $isolatedDanmakuFile = Join-Path $testDir "v271-dev3-danmaku-read-gate.test.mjs"
    $isolatedSubtitleFile = Join-Path $testDir "v271-dev3-subtitle-read-gate.test.mjs"
    $isolatedThreePhaseFile = Join-Path $testDir "v271-dev3-three-phase-execution.test.mjs"
    $isolatedSpecs = @(
        [pscustomobject]@{ Name = "Node.js 按需上下文专项（必须通过）"; File = $isolatedContextFile },
        [pscustomobject]@{ Name = "Node.js 跨语言事务专项（必须通过）"; File = $isolatedCrosslangFile },
        [pscustomobject]@{ Name = "Node.js 讨论共享门禁专项（必须通过）"; File = $isolatedDiscussionFile },
        [pscustomobject]@{ Name = "Node.js 弹幕跨语言预约专项（必须通过）"; File = $isolatedDanmakuFile },
        [pscustomobject]@{ Name = "Node.js 字幕跨语言预约专项（必须通过）"; File = $isolatedSubtitleFile },
        [pscustomobject]@{ Name = "Node.js 三阶段跨语言与外发保护专项（必须通过）"; File = $isolatedThreePhaseFile }
    )
    $isolatedTestFiles = @($isolatedSpecs | ForEach-Object { $_.File })
    $mainTestFiles = @($testFiles | Where-Object { $_ -notin $isolatedTestFiles })
    $scheduledTestFiles = 0

    # Run process/locking acceptance first: a Windows Python bridge failure
    # must not be discovered only after the long full-suite batches.
    foreach ($spec in $isolatedSpecs) {
        if (Test-Path -LiteralPath $spec.File -PathType Leaf) {
            $scheduledTestFiles++
            Invoke-NativeStep -Name $spec.Name `
                -FilePath $nodePath -Arguments @("--test", "--test-concurrency=1", $spec.File)
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
                -FilePath $nodePath -Arguments (@("--test", "--test-concurrency=$nodeTestConcurrency") + $batchFiles)
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

# 4. Full Python unittest suite.
if ($pythonPath) {
    $pythonTestArgs = $pythonArgsPrefix + @(
        "-m", "unittest", "discover",
        "-s", "test",
        "-p", "test*.py"
    )
    Invoke-NativeStep -Name "Python 全量测试" -FilePath $pythonPath -Arguments $pythonTestArgs
} else {
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
if ($allPassed) {
    Write-Host "全部测试通过。" -ForegroundColor Green
} else {
    Write-Host "存在失败或跳过的测试；请查看上方输出和日志。" -ForegroundColor Red
}
Write-Host "完整日志：$logPath"

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
