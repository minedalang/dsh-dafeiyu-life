# Windows PowerShell 5.1. Read-only, no model run or MCP execution.
# Stores ONLY exit status and closed-category error signatures. Never writes
# profile dumps, stdout, stderr, prompts, API keys or local paths.
param([string]$DshCommandPath = '')
$ErrorActionPreference = 'Stop'
function Probe([string]$exe, [string[]]$argList) {
  # Windows PowerShell 5.1 may promote redirected native stderr under Stop.
  # Keep it in memory for closed-category classification, never echo raw text.
  $ErrorActionPreference = 'Continue'
  $out = ''
  $code = -1
  try {
    $out = (& $exe @argList 2>&1 | Out-String)
    $code = [int]$LASTEXITCODE
  } catch {
    $out = $_.Exception.GetType().Name
  }
  $kind = 'unknown'
  if ($code -eq 0) { $kind = 'ok' }
  elseif ($out -match '(?i)unknown option|unknown argument|unrecognized option|unexpected argument') { $kind = 'unsupported_option' }
  elseif ($out -match '(?i)ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|Cannot find package') { $kind = 'module_resolution' }
  elseif ($out -match '(?i)ERR_REQUIRE_ESM|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_UNKNOWN_FILE_EXTENSION') { $kind = 'module_compatibility' }
  elseif ($out -match '(?i)SyntaxError|unexpected token') { $kind = 'syntax_error' }
  elseif ($out -match '(?i)TypeError|ReferenceError|RangeError') { $kind = 'node_runtime_exception' }
  elseif ($out -match '(?i)profile.+not found|invalid profile') { $kind = 'profile_error' }
  elseif ($out -match '(?i)ENOENT|EACCES|EPERM|access is denied') { $kind = 'filesystem_or_permissions' }
  elseif ($out -match '(?i)Error:|node:internal') { $kind = 'node_exception_other' }
  $size = if ($out) { [Text.Encoding]::UTF8.GetByteCount($out) } else { 0 }
  $out = $null
  return [pscustomobject]@{ exitCode=$code; kind=$kind; outputPresent=($size -gt 0) }
}
$path = $DshCommandPath.Trim()
if (-not $path) {
  $found = Get-Command 'dsh.cmd' -ErrorAction SilentlyContinue
  if ($found) { $path = $found.Source }
}
if (-not $path) {
  $path = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
}
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
  Write-Error 'Official Desktop dsh.cmd was not found. Pass -DshCommandPath to its path.'
  exit 2
}
# Reject arbitrary script paths: only the official Desktop command layout is used.
$norm = ($path -replace '/', '\').ToLowerInvariant()
if (-not $norm.EndsWith('\resources\runtime\cli\bin\dsh.cmd')) {
  Write-Error 'Only the official Desktop resources/runtime/cli/bin/dsh.cmd is accepted.'
  exit 2
}
$root = [IO.Path]::GetFullPath((Join-Path (Split-Path $path -Parent) '..\..\..\..'))
$exe = Join-Path $root 'DeepSeek Harness.exe'
$asar = Join-Path $root 'resources\app.asar'
$cli = Join-Path $asar 'dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
$results = [ordered]@{
  schemaVersion = 1
  dshCmdFound = $true
  desktopBundleFound = ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $asar -PathType Leaf))
  officialVersion = Probe $path @('--version')
  officialDefaultDump = Probe $path @('--profile','headless','--dump-default-config')
  officialHeadlessDump = Probe $path @('--profile','headless','--dump-config')
}
if ($results.desktopBundleFound) {
  $saved = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE','Process')
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $results.directElectronVersion = Probe $exe @('--expose-internals',$cli,'--version')
    $results.directElectronDefaultDump = Probe $exe @('--expose-internals',$cli,'--profile','headless','--dump-default-config')
    $results.directElectronHeadlessDump = Probe $exe @('--expose-internals',$cli,'--profile','headless','--dump-config')
  } finally {
    if ($null -eq $saved) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $saved }
  }
}
$outfile = Join-Path (Get-Location) ('dsh-headless-safe-diag-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $outfile -Encoding UTF8
Write-Host 'Safe diagnostic created (no keys, profile tree, or raw errors):'
Write-Host $outfile
$results | ConvertTo-Json -Depth 6
