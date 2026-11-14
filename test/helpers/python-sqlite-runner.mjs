import {spawnSync} from 'node:child_process'
import {join} from 'node:path'

// Only for the SQLite backup tests. The WindowsApps `python3` alias is an
// executable but exits 9009 instead of raising ENOENT; probe actual execution.
let selected

function candidates(){
  const configured=String(process.env.PYTHON||'').trim().replace(/^"(.*)"$/,'$1')
  // `conda activate` does not guarantee a `python3.exe` on Windows.
  // Use the activated interpreter, rather than a WindowsApps Store alias.
  if(configured)return [{command:configured,prefix:[]}]
  const conda=String(process.env.CONDA_PREFIX||'').trim()
  const activeConda=conda?[{command:join(conda,process.platform==='win32'?'python.exe':'bin/python'),prefix:[]}]:[]
  return process.platform==='win32'
    ? [...activeConda,{command:'python',prefix:[]},{command:'py',prefix:['-3']},{command:'python3',prefix:[]}]
    : [...activeConda,{command:'python3',prefix:[]},{command:'python',prefix:[]}]
}

function pythonEnv(extra={}){
  return {...process.env,...extra,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}
}

function resolvePython(){
  if(selected)return selected
  const attempted=[]
  for(const candidate of candidates()){
    const probe=spawnSync(candidate.command,[...candidate.prefix,'-c',
      'import sqlite3,sys; print(sys.version_info.major)'],{
      encoding:'utf8',windowsHide:true,timeout:5000,env:pythonEnv()})
    if(probe.status===0&&probe.stdout?.trim()==='3'){
      selected=candidate
      return selected
    }
    attempted.push(`${candidate.command}${candidate.prefix.length?' '+candidate.prefix.join(' '):''} (${probe.error?.code||`exit ${probe.status}`})`)
  }
  throw new Error(`SQLite 测试需要能导入 sqlite3 的 Python 3；尝试失败：${attempted.join('、')}。Windows 请先检查 python --version 或 py -3 --version，并可设置 $env:PYTHON=(Get-Command python).Source 后重试。`)
}

export function spawnPython(args,options={}){
  const candidate=resolvePython()
  return spawnSync(candidate.command,[...candidate.prefix,...args],{
    ...options,windowsHide:true,env:pythonEnv(options.env)
  })
}
