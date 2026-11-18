# Windows PowerShell 5.1, read-only and privacy-preserving Ollama runner summary.
# Never exports raw log lines, paths, prompts, model names, URLs, or credentials.
param([ValidateRange(100,5000)][int]$Tail = 1800)
$ErrorActionPreference = 'Stop'
$logRoot = Join-Path $env:LOCALAPPDATA 'Ollama'
$rules = @(
  @{ Code = 'runner_load_failed'; Regex = '(?i)\b(load failed|failed to load model|unable to load model)\b' },
  @{ Code = 'runner_exited_or_crashed'; Regex = '(?i)\b(runner|llama-server)\b.{0,140}\b(crash|exited|exit code|terminated|signal)\b' },
  @{ Code = 'runner_start_timeout'; Regex = '(?i)\b(timed out waiting for|runner startup timeout|timeout waiting for)\b' },
  @{ Code = 'runner_connection_reset'; Regex = '(?i)\b(connection reset|connection refused|wsarecv|broken pipe)\b' },
  @{ Code = 'runner_memory_pressure'; Regex = '(?i)\b(out of memory|cuda out of memory|insufficient memory|not enough vram|oom)\b' },
  @{ Code = 'runner_client_cancelled'; Regex = '(?i)\b(client connection closed|context canceled|context cancelled)\b' },
  @{ Code = 'runner_started'; Regex = '(?i)\b(starting llama server|starting runner|llama-server started|starting llama\.cpp)\b' }
)
$results = @()
foreach ($fileName in @('server.log', 'app.log')) {
  $path = Join-Path $logRoot $fileName
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $results += [pscustomobject]@{ File = $fileName; State = 'missing'; Code = 'no_log'; Count = 0 }
    continue
  }
  try {
    $lines = @(Get-Content -LiteralPath $path -Tail $Tail -ErrorAction Stop)
    foreach ($rule in $rules) {
      $n = @($lines | Where-Object { $_ -match $rule.Regex }).Count
      if ($n -gt 0) { $results += [pscustomobject]@{ File = $fileName; State = 'read'; Code = $rule.Code; Count = $n } }
    }
    if (-not ($results | Where-Object { $_.File -eq $fileName -and $_.State -eq 'read' })) {
      $results += [pscustomobject]@{ File = $fileName; State = 'read_no_known_errors'; Code = 'none'; Count = 0 }
    }
  } catch {
    $results += [pscustomobject]@{ File = $fileName; State = 'unreadable'; Code = 'read_failed'; Count = 0 }
  }
}
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outFile = Join-Path $outDir ("ollama-runner-safe-summary-{0}.csv" -f $stamp)
$results | Export-Csv -LiteralPath $outFile -NoTypeInformation -Encoding UTF8
Write-Host 'Read-only Ollama diagnostic completed.'
Write-Host 'Contains only predefined error categories and counts; no raw log text.'
Write-Host ("Output: {0}" -f $outFile)
