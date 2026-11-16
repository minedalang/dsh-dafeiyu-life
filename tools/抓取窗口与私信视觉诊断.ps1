# Read-only Windows DSH / video window / DM status diagnostic.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\抓取窗口与私信视觉诊断.ps1 -Uid 202573574 -Seconds 90
param([string]$Uid = '', [int]$Seconds = 90)
$ErrorActionPreference = 'Stop'
if ($Uid -and $Uid -notmatch '^[1-9][0-9]{0,18}$') { throw 'Uid must be a numeric Bilibili UID, or empty.' }
$Seconds = [Math]::Max(15,[Math]::Min(300,$Seconds))
$homeDir = Join-Path $env:USERPROFILE '.dsh\bili-duty'
if (-not (Test-Path -LiteralPath $homeDir -PathType Container)) { throw 'DSH runtime home not found.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$folder = Join-Path $PSScriptRoot ('dafeiyu-window-diagnostics-' + $stamp)
New-Item -ItemType Directory -Path $folder -Force | Out-Null
function SafeCode([object]$v) {
  $s=[string]$v
  if ($s -match '^[a-z][a-z0-9_-]{0,63}$') { return $s }
  return 'unknown'
}
function SafeTime([object]$v) {
  if ($v -is [DateTime]) { return $v.ToUniversalTime().ToString('o') }
  $s=[string]$v
  if ($s -match '^20[0-9]{2}-[0-9TZ:.+\-]{12,45}$') { return $s }
  return ''
}
function ReadSafeJson([string]$f) {
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $null }
  $obj=Get-Item -LiteralPath $f
  if ($obj.Length -gt 5000000 -or ($obj.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $null }
  try { return (Get-Content -LiteralPath $f -Encoding UTF8 -Raw | ConvertFrom-Json) } catch { return $null }
}
function SaveJson([string]$f,[object]$o) { [IO.File]::WriteAllText((Join-Path $folder $f),($o|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false)) }
$begin = (Get-Date).ToUniversalTime()
$tracked = @{}
$names = @('cmd.exe','conhost.exe','OpenConsole.exe','WindowsTerminal.exe','powershell.exe','pwsh.exe','python.exe','pythonw.exe','ffmpeg.exe','ffprobe.exe','uv.exe','node.exe','DeepSeek Harness.exe','dsh.exe','wscript.exe','cscript.exe')
Write-Host ("Recording for {0} seconds. Reproduce the black window now..." -f $Seconds)
$deadline = (Get-Date).AddSeconds($Seconds)
while((Get-Date) -lt $deadline) {
  try {
    $now=(Get-Date).ToUniversalTime().ToString('o')
    foreach($proc in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
      if ($names -notcontains [string]$proc.Name) { continue }
      $pidValue=[int]$proc.ProcessId
      $creation=''
      try { $creation=([DateTime]$proc.CreationDate).ToUniversalTime().ToString('o') } catch {}
      $key=('{0}:{1}' -f $pidValue,$creation)
      if (-not $tracked.ContainsKey($key)) {
        if ($tracked.Count -ge 450) { continue }
        $tracked[$key]=@{name=[string]$proc.Name;pid=$pidValue;parentPid=[int]$proc.ParentProcessId;createdUtc=$creation;firstSeenUtc=$now}
      }
    }
  } catch { Write-Warning 'Unable to read some process metadata; capture may be partial.' }
  Start-Sleep -Milliseconds 1500
}
$rows=@($tracked.Values | Sort-Object firstSeenUtc,pid)
SaveJson 'process-ancestry.json' @{captureStartUtc=$begin.ToString('o');captureEndUtc=(Get-Date).ToUniversalTime().ToString('o');processes=$rows;
  notes=@('No command line, executable path, environment variables or private content captured.',
          'The recorder itself runs PowerShell/cmd; distinguish it by process creation time and parent PID.',
          'An already-exited pop-up may have been missed between samples; absence is not proof of no pop-up.')}
$latest = ReadSafeJson (Join-Path $homeDir 'dsh-vision-selftest-last-run.json')
if ($latest -and $latest.schema -eq 1 -and $latest.last) {
  $a=$latest.last
  SaveJson 'dsh-vision-last-run.json' @{at=(SafeTime $a.at);status=(SafeCode $a.status);diagnosticCode=(SafeCode $a.diagnosticCode);
    preflight=(SafeCode $a.preflight);mcpImage=(SafeCode $a.mcpImage);attachmentBridge='not_observable';
    providerApi=(SafeCode $a.providerApi);modelAnswer=(SafeCode $a.modelAnswer);
    note='No raw stderr, tool payload, API credentials, model reply or image is collected.'}
} else { SaveJson 'dsh-vision-last-run.json' @{status='not_found';note='No persisted diagnostic was available.'} }
$DMs=@()
if ($Uid) {
  foreach($f in @(Get-ChildItem -Path (Join-Path $homeDir 'accounts') -Filter 'dm-autoreply-state.json' -File -Recurse -ErrorAction SilentlyContinue)) {
    $s=ReadSafeJson $f.FullName
    $p=$null
    if ($s -and $s.people) { $p=$s.people.PSObject.Properties[$Uid].Value }
    if (-not $p) { continue }
    $c=ReadSafeJson (Join-Path $f.DirectoryName 'dm-poll-cursor.json')
    $cur=$null
    if ($c -and $c.people) { $cur=$c.people.PSObject.Properties[$Uid].Value }
    $o=$p.lastInboundOutcome
    $DMs+=@{lastRepliedAtMs=[long]$p.lastRepliedAt;seenCount=@($p.seen).Count;
      latestHistoryRole=(@($p.history | Select-Object -Last 1 | ForEach-Object {if($_.role -eq 'user') {'user'} elseif ($_.role -eq 'assistant') {'assistant'} else {'unknown'}}) | Select-Object -First 1);
      latestHistoryAtMs=(@($p.history | Select-Object -Last 1 | ForEach-Object { [long]$_.at }) | Select-Object -First 1);
      recentOutcome= $(if($o){@{atMs=[long]$o.at;inboundAtMs=[long]$o.inboundAt;status=(SafeCode $o.status);reason=(SafeCode $o.reason)}}else{$null});
      platformUnreadHint=$(if($cur){[int]$cur.unread}else{$null});sessionCursorAtMs=$(if($cur){[long]$cur.at}else{$null});
      note='Only the selected contact in account-scoped runtime, without UID or message text.'}
  }
}
SaveJson 'dm-target-summary.json' @{selectedContactProvided=[bool]$Uid;matches=@($DMs);
  note='The newest inbound outcome exists only for turns processed after this diagnostic patch; a missing outcome does not mean no message or refusal.'}
SaveJson 'instructions.json' @{version='2.8.1-dev.3b.23';notes=@(
   'Run tools/导出B站日志.bat --no-pause after reproduction and share BOTH ZIPs in private chat.',
   'Untranslated exit=1 does not prove Headless lacks image support.',
   'Process ancestry is a sampling aid, not a kernel-level window-creation trace.')}
$dest=$folder+'.zip'
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $dest -CompressionLevel Optimal -Force
Write-Host ("Safe capture ZIP: {0}" -f $dest)
