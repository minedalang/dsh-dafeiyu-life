# dev.3b.33.7 — Offline, opt-in Python runtime repair for Windows.
# Run only after fully exiting DSH. No admin, ACL edits, credential reads or Bilibili calls.
param(
  [string]$BasePython = '',
  [string]$DutyHome = (Join-Path $HOME '.dsh\bili-duty')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $BasePython) {
  $cmd = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { throw 'Cannot find Python in PATH. Use -BasePython with a verified interpreter.' }
  $BasePython = $cmd.Source
}
$old = $null
$venv = $null
$created = $false
function Assert-HealthyPython([string]$Path, [bool]$RequirePackages) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw '指定的 Python 不存在。' }
  if ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝使用符号链接 Python。' }
  $code = @'
import os,sys,uuid,importlib.util,pathlib
valid=(sys.version_info.major==3 and 10<=sys.version_info.minor<=13)
if not valid: print('PYTHON_VERSION_UNSUPPORTED');sys.exit(23)
for folder in (os.environ.get('TEMP'), os.getcwd()):
    if not folder:print('PYTHON_DIRECTORY_UNAVAILABLE');sys.exit(24)
    p=pathlib.Path(folder)/('dsh-runtime-'+uuid.uuid4().hex+'.tmp')
    try:
        p.write_bytes(b'1')
    except OSError:
        print('PYTHON_PERMISSION_DENIED');sys.exit(25)
    finally:
        p.unlink(missing_ok=True)
if os.environ.get('DSH_REPAIR_CHECK_PACKAGES')=='1':
    if not all(importlib.util.find_spec(m) is not None for m in ('mcp','bilibili_api','qrcode','PIL')):
        print('PYTHON_PACKAGES_MISSING');sys.exit(26)
print('PYTHON_RUNTIME_HEALTHY')
'@
  $previous=$env:DSH_REPAIR_CHECK_PACKAGES
  try {
    $env:DSH_REPAIR_CHECK_PACKAGES=if ($RequirePackages) {'1'}else{'0'}
    $result = ($code | & $Path -I - 2>$null) | Out-String
    if ($LASTEXITCODE -ne 0 -or $result -notmatch 'PYTHON_RUNTIME_HEALTHY') { throw ('Python 健康检查失败：'+($result.Trim() -split '[\r\n]')[0]) }
  } finally { $env:DSH_REPAIR_CHECK_PACKAGES=$previous }
}
try {
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=[Security.Principal.WindowsPrincipal]::new($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '请使用普通 PowerShell，避免创建管理员专属文件。' }
  if (!(Test-Path -LiteralPath $DutyHome -PathType Container)) { throw '未找到插件家目录；请先安装插件。' }
  $DutyHome=(Resolve-Path -LiteralPath $DutyHome).Path
  if ((Get-Item -LiteralPath $DutyHome).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝通过符号链接修复家目录。' }
  $requirements=Join-Path $PSScriptRoot '..\vendor\bilibili-mcp\requirements.txt'
  if (!(Test-Path -LiteralPath $requirements -PathType Leaf)) { throw '未找到随插件交付的依赖清单。请从完整源码 source/tools 中运行本脚本。' }
  $BasePython=(Resolve-Path -LiteralPath $BasePython).Path
  Write-Host '检查普通权限基础 Python 的可写性与版本…'
  Assert-HealthyPython $BasePython $false
  $resolver=Join-Path $PSScriptRoot '..\scripts\resolve-bili-duty-storage.mjs'
  if (!(Test-Path -LiteralPath $resolver -PathType Leaf)) { throw '没有找到与当前版本匹配的安全分区路径解析器。' }
  $node=Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $node) { throw '需要可用的 Node.js 来解析已迁移的 Python 存储位置；拒绝误写旧 C 盘路径。' }
  $resolved=(& $node.Source $resolver '--root' $DutyHome '--item' '.venv' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or !$resolved -or ![IO.Path]::IsPathRooted($resolved)) { throw ('安全解析 Python 位置失败：' + $resolved) }
  $venv=$resolved
  $candidate=Join-Path $venv 'Scripts\python.exe'
  $stamp=(Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
  if (Test-Path -LiteralPath $venv) {
    if ((Get-Item -LiteralPath $venv).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '拒绝修改符号链接虚拟环境。' }
    $old=Join-Path (Split-Path -Parent $venv) ('.venv.backup-'+$stamp)
    Move-Item -LiteralPath $venv -Destination $old -ErrorAction Stop
    Write-Host '旧 .venv 已备份；没有清理 B站账号或 Life 账本。'
  }
  Write-Host '使用经过检查的基础 Python 创建新虚拟环境…'
  # Prefer the known-healthy base interpreter to create the environment.
  # uv's managed Python is known to fail unprivileged writes on this machine.
  & $BasePython '-m' 'venv' '--copies' $venv
  if ($LASTEXITCODE -ne 0) { throw 'python -m venv --copies 创建失败；未回退到可能受限的 uv Python。' }
  $uv=Get-Command uv -ErrorAction SilentlyContinue
  $created=$true
  Assert-HealthyPython $candidate $false
  Write-Host '安装 MCP 主依赖（可能需要网络；不会修改 Conda base 的包）…'
  if ($uv) {
    & $uv.Source 'pip' 'install' '--python' $candidate '-r' $requirements
  } else {
    & $candidate '-m' 'pip' 'install' '-r' $requirements
  }
  if ($LASTEXITCODE -ne 0) { throw '安装依赖失败。' }
  Assert-HealthyPython $candidate $true
  Write-Host '修复完成：新 Python 可在普通权限下写入，且 MCP/视觉依赖齐全。'
  if ($old) { Write-Host '旧环境备份已保留。请重启 DSH 并执行图片验收；确认后自行处理备份。' }
} catch {
  Write-Warning $_.Exception.Message
  if ($old -and (Test-Path -LiteralPath $old)) {
    try {
      if ($venv -and (Test-Path -LiteralPath $venv)) {
        $failed=Join-Path (Split-Path -Parent $venv) ('.venv.failed-'+[guid]::NewGuid().ToString('N').Substring(0,8))
        Move-Item -LiteralPath $venv -Destination $failed
      }
      Move-Item -LiteralPath $old -Destination $venv -ErrorAction Stop
      Write-Warning '已恢复旧虚拟环境。'
    } catch { Write-Warning '无法自动恢复旧虚拟环境；请检查 .venv.backup-*，不要删除备份。' }
  }
  exit 1
}
