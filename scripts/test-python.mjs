#!/usr/bin/env node
// Use the activated Conda interpreter and a single UTF-8 subprocess protocol.
// A WindowsApps python3 alias may exist yet exit with 9009; always probe first.
import {spawnSync} from 'node:child_process'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}
const configured=String(process.env.PYTHON||'').trim().replace(/^"(.*)"$/,'$1')
const conda=String(process.env.CONDA_PREFIX||'').trim()
const candidates=configured
  ? [[configured,[]]]
  : [
      ...(conda?[[join(conda,process.platform==='win32'?'python.exe':'bin/python'),[]]]:[]),
      ...(process.platform==='win32'
        ? [['python',[]],['py',['-3']],['python3',[]]]
        : [['python3',[]],['python',[]]])
    ]

let chosen
for(const [program,prefix] of candidates){
  const probe=spawnSync(program,[...prefix,'-c','import sqlite3,sys;print(sys.version_info.major)'],{
    cwd:root,env,encoding:'utf8',windowsHide:true,timeout:5000
  })
  if(probe.status===0&&probe.stdout?.trim()==='3'){
    chosen=[program,prefix]
    break
  }
}
if(!chosen){
  console.error('Python 全量测试需要可用的 Python 3（含标准库 sqlite3）。请激活 Conda 环境或通过 PYTHON 指定解释器；已尝试：'+candidates.map(([cmd])=>cmd).join('、'))
  process.exitCode=1
}else{
  const [program,prefix]=chosen
  const result=spawnSync(program,[...prefix,'-m','unittest','discover','-s','test','-p','test*.py'],{
    cwd:root,env,stdio:'inherit',windowsHide:true
  })
  process.exitCode=result.status??1
  if(result.error)console.error('Python 测试进程启动失败：'+result.error.message)
}
