# dev.3b.33.10 — Independent, opt-in Windows DSH vision Python repair.
# Never edits the main .venv, ACLs, Bilibili credentials, Life queues or DSH overlay.
# ProbeOnly can run while DSH is open. For repair, exit DSH before invoking.
param(
  [string]$BasePython = '',
  [string]$DutyHome = (Join-Path $HOME '.dsh\bili-duty'),
  [switch]$ProbeOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $BasePython) {
  $cmd = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { throw 'Cannot find Python in PATH. Use -BasePython with a verified interpreter.' }
  $BasePython = $cmd.Source
}
$backup = $null
$target = $null
$repaired = $false
$code = @'
import sys,os,uuid,pathlib,json,importlib.util,tempfile
out={'version':list(sys.version_info[:2]),'temp':False,'duty_home':False,'missingModules':[]}
for name,folder in (('temp',os.environ.get('TEMP') or tempfile.gettempdir()),('duty_home',os.getcwd())):
    p=pathlib.Path(folder)/('dsh-vision-health-'+uuid.uuid4().hex+'.tmp')
    try:
        p.write_bytes(b'1')
        p.unlink()
        out[name]=True
    except OSError:
        pass
try:
    out['missingModules']=[m for m in ('mcp','bilibili_api','qrcode','PIL') if importlib.util.find_spec(m) is None]
except (ImportError,ValueError,AttributeError):
    out['missingModules']=['mcp','bilibili_api','qrcode','PIL']
print('VISION_PYTHON_CHECK:'+json.dumps(out,separators=(',',':')))
'@
function Inspect-Python([string]$Executable, [string]$HomePath, [bool]$RequirePackages) {
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw '指定的 Python 文件不存在。' }
  if ([IO.Path]::GetFileName($Executable).ToLowerInvariant() -ne 'python.exe') { throw '基础解释器必须是 python.exe。' }
  if ((Get-Item -LiteralPath $Executable).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝使用符号链接 Python。' }
  Push-Location -LiteralPath $HomePath
  try {
    $result = ($code | & $Executable -I - 2>$null) | Out-String
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  if ($rc -ne 0) { throw 'Python 进程运行检查失败；未进行环境改动。' }
  $record = ($result -split '[\r\n]+' | Where-Object { $_ -match '^VISION_PYTHON_CHECK:\{' } | Select-Object -First 1)
  if (-not $record) { throw 'Python 健康检查未返回可信标记。' }
  $report = ($record.Substring('VISION_PYTHON_CHECK:'.Length) | ConvertFrom-Json)
  $supported=($report.version[0] -eq 3 -and $report.version[1] -ge 10 -and $report.version[1] -le 13)
  $missing=@($report.missingModules | Where-Object { $_ })
  Write-Host ('Python 版本支持: ' + $supported)
  Write-Host ('TEMP 可写: ' + $report.temp)
  Write-Host ('Duty Home 可写: ' + $report.duty_home)
  Write-Host ('视觉 MCP 缺少模块: ' + $(if ($missing.Count) { $missing -join ', ' } else { '无' }))
  if (-not $supported) { throw 'Python 版本不支持；要求 Python 3.10–3.13。' }
  if (-not $report.temp -or -not $report.duty_home) { throw 'Python 在 TEMP 或 Duty Home 没有普通权限写入能力。' }
  if ($RequirePackages -and $missing.Count) { throw '视觉环境仍缺少必要的 MCP 模块。' }
  return $true
}
try {
  $id=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($id)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '请使用普通 PowerShell，不以管理员权限创建环境。'
  }
  if (-not (Test-Path -LiteralPath $DutyHome -PathType Container)) { throw '未找到 Duty Home；请先确认插件已安装。' }
  $DutyHome=(Resolve-Path -LiteralPath $DutyHome).Path
  if ((Get-Item -LiteralPath $DutyHome).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝修改符号链接 Duty Home。' }
  $BasePython=(Resolve-Path -LiteralPath $BasePython).Path
  Write-Host '=== 健康基础 Python 读写/依赖检查 ==='
  [void](Inspect-Python $BasePython $DutyHome $false)
  if ($ProbeOnly) { Write-Host '只读检查完成：没有安装或改动环境。'; exit 0 }
  if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
    throw '检测到 DSH 进程：请完整退出 Desktop Host 后再执行修复。'
  }
  $req=Join-Path $PSScriptRoot '..\vendor\bilibili-mcp\requirements.txt'
  if (-not (Test-Path -LiteralPath $req -PathType Leaf)) { throw '找不到随完整源码交付的 MCP requirements.txt。' }
  $target=Join-Path $DutyHome '.vision-venv'
  $candidate=Join-Path $target 'Scripts\python.exe'
  $stamp=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
  if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝修改符号链接视觉环境。' }
    $backup=Join-Path $DutyHome ('.vision-venv.backup-'+$stamp)
    Move-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    Write-Host '已保留旧视觉环境的备份；主 .venv 未改动。'
  }
  Write-Host '使用 Conda 基础解释器创建独立视觉环境（venv --copies，非 uv venv）...'
  & $BasePython '-m' 'venv' '--copies' $target
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'Conda Python 创建视觉 venv 失败。' }
  Write-Host '检查新视觉解释器实际读写权限...'
  [void](Inspect-Python $candidate $DutyHome $false)
  Write-Host '安装独立视觉 MCP 依赖；不会安装到 Conda base ...'
  & $candidate '-m' 'pip' 'install' '-r' $req
  $installExit=$LASTEXITCODE
  if ($installExit -ne 0) {
    $uv=Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
      Write-Host '新 venv 内 pip 不可用或安装失败，尝试 uv pip（不使用 uv venv）...'
      & $uv.Source 'pip' 'install' '--python' $candidate '-r' $req
      $installExit=$LASTEXITCODE
    }
  }
  if ($installExit -ne 0) { throw '视觉 MCP 依赖安装失败；原环境备份将尝试恢复。' }
  Write-Host '验证新环境的写入能力和全部视觉 MCP 模块...'
  [void](Inspect-Python $candidate $DutyHome $true)
  $repaired=$true
  Write-Host '=== 修复成功 ==='
  Write-Host '管理中心 → AI 模型 → 视觉专用 Python 完整路径：'
  Write-Host $candidate
  Write-Host '保存设置、完整启动 DSH 后再进行图片验收。成功构建环境不代表图片模型已经验收通过。'
  if ($backup) { Write-Host '旧视觉环境备份已保留，请在实机验收后自行管理。' }
} catch {
  Write-Warning $_.Exception.Message
  if ($target -and (Test-Path -LiteralPath $target)) {
    try {
      $failed=Join-Path $DutyHome ('.vision-venv.failed-'+[guid]::NewGuid().ToString('N').Substring(0,8))
      Move-Item -LiteralPath $target -Destination $failed -ErrorAction Stop
      Write-Warning '未通过检查的视觉环境已隔离为 .vision-venv.failed-*。'
    } catch { Write-Warning '无法隔离未通过检查的新视觉环境，请不要将它填写到配置中。' }
  }
  if ($backup -and (Test-Path -LiteralPath $backup)) {
    try {
      Move-Item -LiteralPath $backup -Destination $target -ErrorAction Stop
      Write-Warning '已恢复旧视觉环境；主 .venv 始终未改动。'
    } catch { Write-Warning '无法自动恢复旧视觉环境，请人工检查 .vision-venv.backup-*；不要删除备份。' }
  }
  exit 1
}
