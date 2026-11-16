# Bounded read-only Windows process-start trace for intermittent console windows.
# Windows PowerShell 5.1 compatible, ASCII-only source and file name.
param([int]$Seconds = 900)
$ErrorActionPreference = 'Stop'
$Seconds = [Math]::Max(60, [Math]::Min(3600, $Seconds))
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$work = Join-Path $base ('window-event-trace-' + $stamp)
$archive = Join-Path $base ('dafeiyu-window-event-trace-' + $stamp + '.zip')
New-Item -Path $work -ItemType Directory -Force | Out-Null
$source = 'DafeiyuWindowTrace' + $PID
$mode = 'wmi-process-start'
$events = New-Object System.Collections.Generic.List[object]
$registered = $false
$startedAt = Get-Date
$stopReason = 'timeout'
try {
  try {
    Register-WmiEvent -Query 'SELECT * FROM Win32_ProcessStartTrace' -SourceIdentifier $source -ErrorAction Stop | Out-Null
    $registered = $true
  } catch {
    $mode = 'process-poll-fallback'
  }
  $deadline = (Get-Date).AddSeconds($Seconds)
  $seen = @{}
  if (-not $registered) {
    Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | ForEach-Object {
      $seen[[string]$_.ProcessId] = $true
    }
  }
  Write-Host ('Recording process-start events for up to ' + $Seconds + ' seconds. Mode: ' + $mode)
  Write-Host 'When the black window appears, return to THIS capture console and press Q to stop and export immediately.'
  Write-Host 'Do not press Ctrl+C; Ctrl+C can cancel before the ZIP is written.'
  while ((Get-Date) -lt $deadline) {
    try {
      if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true)
        if ($key.KeyChar -eq 'q' -or $key.KeyChar -eq 'Q') {
          $stopReason = 'manual-q'
          break
        }
      }
    } catch { }
    if ($registered) {
      $batch = @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)
      foreach ($evt in $batch) {
        try {
          $item = $evt.SourceEventArgs.NewEvent
          $events.Add([pscustomobject]@{
            Time = $evt.TimeGenerated.ToString('o')
            Process = [string]$item.ProcessName
            PID = [int]$item.ProcessID
            ParentPID = [int]$item.ParentProcessID
            Source = 'Win32_ProcessStartTrace'
          })
        } catch { }
        Remove-Event -EventIdentifier $evt.EventIdentifier -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 250
    } else {
      try {
        $batch = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
        $next = @{}
        foreach ($proc in $batch) {
          $id = [string]$proc.ProcessId
          $next[$id] = $true
          if (-not $seen.ContainsKey($id)) {
            $events.Add([pscustomobject]@{
              Time = (Get-Date).ToString('o')
              Process = [string]$proc.Name
              PID = [int]$proc.ProcessId
              ParentPID = [int]$proc.ParentProcessId
              Source = 'Win32_ProcessPoll'
            })
          }
        }
        $seen = $next
      } catch { }
      Start-Sleep -Milliseconds 800
    }
  }
  # Drain events that occurred immediately before capture ended.
  if ($registered) {
    foreach ($evt in @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
      try {
        $item = $evt.SourceEventArgs.NewEvent
        $events.Add([pscustomobject]@{
          Time = $evt.TimeGenerated.ToString('o')
          Process = [string]$item.ProcessName
          PID = [int]$item.ProcessID
          ParentPID = [int]$item.ParentProcessID
          Source = 'Win32_ProcessStartTrace'
        })
      } catch { }
      Remove-Event -EventIdentifier $evt.EventIdentifier -ErrorAction SilentlyContinue
    }
  }
} finally {
  if ($registered) { Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue }
}
try {
  $csv = Join-Path $work 'process-start-events.csv'
  if ($events.Count -gt 0) {
    $events | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
  } else {
    'Time,Process,PID,ParentPID,Source' | Set-Content -Path $csv -Encoding ASCII
  }
  $elapsedSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  @(
    ('Mode: ' + $mode),
    ('RequestedSeconds: ' + $Seconds),
    ('ElapsedSeconds: ' + $elapsedSeconds),
    ('StopReason: ' + $stopReason),
    ('Events: ' + $events.Count),
    'Process names and numeric IDs only. No commands, titles, message bodies, or credentials.',
    'A missing event does not prove no window appeared. WMI unavailability uses a slower polling fallback.'
  ) | Set-Content -Path (Join-Path $work 'README.txt') -Encoding ASCII
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $archive -Force -ErrorAction Stop
  if ($stopReason -eq 'manual-q') { Write-Host 'Stopped by Q. Export completed early.' } else { Write-Host 'Capture duration completed. Export completed.' }
  Write-Host ('Safe process event trace: ' + $archive)
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
