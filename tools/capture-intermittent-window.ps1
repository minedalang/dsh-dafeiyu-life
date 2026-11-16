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
$windowSeen = @{}
$lastWindowScan = [DateTime]::MinValue
$windowTypeReady = $false
try {
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
      if (!String.Equals(name.ToString(), "ConsoleWindowClass", StringComparison.Ordinal) &&
          !String.Equals(name.ToString(), "CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.Ordinal)) return true;
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
        $key = $pidText + '|' + [string]$window.ClassName
        $current[$key] = $true
        if (-not $windowSeen.ContainsKey($key) -and $windowEvents.Count -lt 10000) {
          $proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue | Select-Object -First 1
          $procEvent = $events | Where-Object { [int]$_.PID -eq [int]$pidText } | Select-Object -Last 1
          $procName='unknown';$parent=0
          if ($proc) { $procName=[string]$proc.ProcessName+'.exe' }
          if ($procEvent) { $parent=[int]$procEvent.ParentPID }
          $windowEvents.Add([pscustomobject]@{ Time=(Get-Date).ToString('o'); Process=$procName; PID=[int]$window.Pid; ParentPID=$parent; WindowClass=[string]$window.ClassName; Visible=$true; Source='EnumWindows' })
        }
      }
      foreach ($key in @($windowSeen.Keys)) {
        if (-not $current.ContainsKey($key) -and $windowEvents.Count -lt 10000) {
          $parts=$key.Split('|');$pidText=$parts[0]
          $proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue | Select-Object -First 1
          $procEvent = $events | Where-Object { [int]$_.PID -eq [int]$pidText } | Select-Object -Last 1
          $procName='unknown';$parent=0
          if ($proc) { $procName=[string]$proc.ProcessName+'.exe' }
          if ($procEvent) { $parent=[int]$procEvent.ParentPID }
          $windowEvents.Add([pscustomobject]@{ Time=(Get-Date).ToString('o'); Process=$procName; PID=[int]$pidText; ParentPID=$parent; WindowClass=$parts[1]; Visible=$false; Source='EnumWindows' })
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
    if (((Get-Date) - $lastWindowScan).TotalMilliseconds -ge 500) {
      . $sampleConsoleWindows
      $lastWindowScan=Get-Date
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
  . $sampleConsoleWindows
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
  $windowCsv = Join-Path $work 'console-window-events.csv'
  if ($windowEvents.Count -gt 0) {
    $windowEvents | Export-Csv -Path $windowCsv -NoTypeInformation -Encoding UTF8
  } else {
    'Time,Process,PID,ParentPID,WindowClass,Visible,Source' | Set-Content -Path $windowCsv -Encoding ASCII
  }
  $elapsedSeconds = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 1)
  @(
    ('Mode: ' + $mode),
    ('RequestedSeconds: ' + $Seconds),
    ('ElapsedSeconds: ' + $elapsedSeconds),
    ('StopReason: ' + $stopReason),
    ('ProcessEvents: ' + $events.Count),
    ('ConsoleWindowEvents: ' + $windowEvents.Count),
    ('WindowEnumAvailable: ' + $windowTypeReady),
    'Captured only visible ConsoleWindowClass PID, process name, parent PID and visibility; no window title, command line, screenshot, message body, image or credentials.',
    'A missing event does not prove no window appeared. WMI unavailability uses a slower polling fallback.'
  ) | Set-Content -Path (Join-Path $work 'README.txt') -Encoding ASCII
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $archive -Force -ErrorAction Stop
  if ($stopReason -eq 'manual-q') { Write-Host 'Stopped by Q. Export completed early.' } else { Write-Host 'Capture duration completed. Export completed.' }
  Write-Host ('Safe process event trace: ' + $archive)
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
