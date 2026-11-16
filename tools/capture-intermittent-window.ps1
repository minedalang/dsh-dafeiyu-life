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
$windowEvents = New-Object System.Collections.Generic.List[object]
$processSnapshot = New-Object System.Collections.Generic.List[object]
$processMap = @{}
$windowSeen = @{}
$lastWindowScan = [DateTime]::MinValue
$windowScanIntervalMs = 40
$windowTypeReady = $false
try {
  # Snapshot existing processes so an already-running parent PID can be named.
  # Only process name, PID and parent PID are collected; no command line or path.
  try {
    foreach ($proc in @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)) {
      $row = [pscustomobject]@{ Process=[string]$proc.Name; PID=[int]$proc.ProcessId; ParentPID=[int]$proc.ParentProcessId }
      $processSnapshot.Add($row)
      $processMap[[string]$row.PID] = $row
    }
  } catch { }
  try {
    $windowSource = @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public sealed class DafeiyuConsoleWindowRow { public int Pid; public string ClassName; }
public static class DafeiyuConsoleWindowEnum {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  public static List<DafeiyuConsoleWindowRow> GetVisibleConsoleWindows() {
    var rows = new List<DafeiyuConsoleWindowRow>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      var name = new StringBuilder(128);
      if (GetClassName(hWnd, name, name.Capacity) <= 0) return true;
      // Window titles are deliberately never requested. The caller only
      // retains console classes and selected tool-process owner PIDs.
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      if (pid > 0) rows.Add(new DafeiyuConsoleWindowRow { Pid=(int)pid, ClassName=name.ToString() });
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
    Add-Type -TypeDefinition $windowSource -Language CSharp -ErrorAction Stop | Out-Null
    $windowTypeReady = $true
  } catch { $windowTypeReady = $false }
  $sampleConsoleWindows = {
    if (-not $windowTypeReady) { return }
    try {
      $current = @{}
      foreach ($window in [DafeiyuConsoleWindowEnum]::GetVisibleConsoleWindows()) {
        $pidText = [string]$window.Pid
        $procInfo = $processMap[$pidText]
        $procName='unknown';$parent=0;$parentName='unknown'
        if ($procInfo) { $procName=[string]$procInfo.Process; $parent=[int]$procInfo.ParentPID }
        # Only console-class windows or known tool-process owners. Never store
        # windows from arbitrary desktop apps or any window title.
        $knownConsoleClass = $window.ClassName -eq 'ConsoleWindowClass' -or $window.ClassName -eq 'CASCADIA_HOSTING_WINDOW_CLASS'
        if (-not $knownConsoleClass -and $procName -notmatch '^(?:pythonw?|conhost|OpenConsole|cmd|powershell|pwsh|DeepSeek Harness|ffmpeg|WindowsTerminal)\.exe$') { continue }
        $key = $pidText + '|' + [string]$window.ClassName
        $current[$key] = $true
        if (-not $windowSeen.ContainsKey($key) -and $windowEvents.Count -lt 10000) {
          $parentInfo = $processMap[[string]$parent]
          if ($parentInfo) { $parentName=[string]$parentInfo.Process }
          $windowEvents.Add([pscustomobject]@{ Time=(Get-Date).ToString('o'); Process=$procName; PID=[int]$window.Pid; ParentPID=$parent; ParentProcess=$parentName; WindowClass=[string]$window.ClassName; Visible=$true; Source='EnumWindows' })
        }
      }
      foreach ($key in @($windowSeen.Keys)) {
        if (-not $current.ContainsKey($key) -and $windowEvents.Count -lt 10000) {
          $parts=$key.Split('|');$pidText=$parts[0]
          $procInfo = $processMap[$pidText]
          $procName='unknown';$parent=0;$parentName='unknown'
          if ($procInfo) { $procName=[string]$procInfo.Process; $parent=[int]$procInfo.ParentPID }
          $parentInfo = $processMap[[string]$parent]
          if ($parentInfo) { $parentName=[string]$parentInfo.Process }
          $windowEvents.Add([pscustomobject]@{ Time=(Get-Date).ToString('o'); Process=$procName; PID=[int]$pidText; ParentPID=$parent; ParentProcess=$parentName; WindowClass=$parts[1]; Visible=$false; Source='EnumWindows' })
        }
      }
      $windowSeen=$current
    } catch { }
  }
  . $sampleConsoleWindows
  $lastWindowScan=Get-Date
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
          $parentInfo = $processMap[[string][int]$item.ParentProcessID]
          $parentName = if ($parentInfo) { [string]$parentInfo.Process } else { 'unknown' }
          $processRow = [pscustomobject]@{ Process=[string]$item.ProcessName; PID=[int]$item.ProcessID; ParentPID=[int]$item.ParentProcessID }
          $processMap[[string]$processRow.PID] = $processRow
          $events.Add([pscustomobject]@{
            Time = $evt.TimeGenerated.ToString('o')
            Process = [string]$item.ProcessName
            PID = [int]$item.ProcessID
            ParentPID = [int]$item.ParentProcessID
            ParentProcess = $parentName
            Source = 'Win32_ProcessStartTrace'
          })
        } catch { }
        Remove-Event -EventIdentifier $evt.EventIdentifier -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 40
    } else {
      try {
        $batch = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
        $next = @{}
        foreach ($proc in $batch) {
          $id = [string]$proc.ProcessId
          $next[$id] = $true
          if (-not $seen.ContainsKey($id)) {
            $parentInfo = $processMap[[string][int]$proc.ParentProcessId]
            $parentName = if ($parentInfo) { [string]$parentInfo.Process } else { 'unknown' }
            $events.Add([pscustomobject]@{
              Time = (Get-Date).ToString('o')
              Process = [string]$proc.Name
              PID = [int]$proc.ProcessId
              ParentPID = [int]$proc.ParentProcessId
              ParentProcess = $parentName
              Source = 'Win32_ProcessPoll'
            })
          }
          $processMap[$id] = [pscustomobject]@{ Process=[string]$proc.Name; PID=[int]$proc.ProcessId; ParentPID=[int]$proc.ParentProcessId }
        }
        $seen = $next
      } catch { }
      Start-Sleep -Milliseconds 200
    }
    if (((Get-Date) - $lastWindowScan).TotalMilliseconds -ge $windowScanIntervalMs) {
      . $sampleConsoleWindows
      $lastWindowScan=Get-Date
    }
  }
  # Drain events that occurred immediately before capture ended.
  if ($registered) {
    foreach ($evt in @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
      try {
        $item = $evt.SourceEventArgs.NewEvent
        $parentInfo = $processMap[[string][int]$item.ParentProcessID]
        $parentName = if ($parentInfo) { [string]$parentInfo.Process } else { 'unknown' }
        $processRow = [pscustomobject]@{ Process=[string]$item.ProcessName; PID=[int]$item.ProcessID; ParentPID=[int]$item.ParentProcessID }
        $processMap[[string]$processRow.PID] = $processRow
        $events.Add([pscustomobject]@{
          Time = $evt.TimeGenerated.ToString('o')
          Process = [string]$item.ProcessName
          PID = [int]$item.ProcessID
          ParentPID = [int]$item.ParentProcessID
          ParentProcess = $parentName
          Source = 'Win32_ProcessStartTrace'
        })
      } catch { }
      Remove-Event -EventIdentifier $evt.EventIdentifier -ErrorAction SilentlyContinue
    }
  }
  . $sampleConsoleWindows
} finally {
  if ($registered) { Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue }
}
try {
  $snapshotCsv = Join-Path $work 'process-snapshot.csv'
  if ($processSnapshot.Count -gt 0) {
    foreach ($row in $processSnapshot) {
      $parentInfo = $processMap[[string]$row.ParentPID]
      $parentName = if ($parentInfo) { [string]$parentInfo.Process } else { 'unknown' }
      $row | Add-Member -NotePropertyName ParentProcess -NotePropertyValue $parentName -Force
    }
    $processSnapshot | Export-Csv -Path $snapshotCsv -NoTypeInformation -Encoding UTF8
  } else {
    'Process,PID,ParentPID' | Set-Content -Path $snapshotCsv -Encoding ASCII
  }
  $csv = Join-Path $work 'process-start-events.csv'
  if ($events.Count -gt 0) {
    $events | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
  } else {
    'Time,Process,PID,ParentPID,ParentProcess,Source' | Set-Content -Path $csv -Encoding ASCII
  }
  $windowCsv = Join-Path $work 'console-window-events.csv'
  if ($windowEvents.Count -gt 0) {
    $windowEvents | Export-Csv -Path $windowCsv -NoTypeInformation -Encoding UTF8
  } else {
    'Time,Process,PID,ParentPID,ParentProcess,WindowClass,Visible,Source' | Set-Content -Path $windowCsv -Encoding ASCII
  }
  $elapsedSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  @(
    ('Mode: ' + $mode),
    ('RequestedSeconds: ' + $Seconds),
    ('ElapsedSeconds: ' + $elapsedSeconds),
    ('StopReason: ' + $stopReason),
    ('ProcessSnapshot: ' + $processSnapshot.Count),
    ('ProcessEvents: ' + $events.Count),
    ('ConsoleWindowEvents: ' + $windowEvents.Count),
    ('WindowScanIntervalMs: ' + $windowScanIntervalMs),
    ('WindowEnumAvailable: ' + $windowTypeReady),
    'Captured process names, PID/parent PID snapshot and events, plus visible console/diagnostic process window owner PID/process/parent/class/visibility. No window title, command line, screenshot, message body, image or credentials.',
    'Window enumeration polls about every 40ms and may still miss shorter windows. A missing event does not prove no window appeared. WMI unavailability uses a slower process polling fallback.'
  ) | Set-Content -Path (Join-Path $work 'README.txt') -Encoding ASCII
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $archive -Force -ErrorAction Stop
  if ($stopReason -eq 'manual-q') { Write-Host 'Stopped by Q. Export completed early.' } else { Write-Host 'Capture duration completed. Export completed.' }
  Write-Host ('Safe process event trace: ' + $archive)
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
