/**
 * Read/write route probe for the uv/pip download-cache partition.
 * No dependency installs, model loading, downloads or runtime migration.
 */
import {existsSync,lstatSync,openSync,writeSync,closeSync,unlinkSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {storageLayoutStatus,storageDataPath,storagePythonRuntimeRoot} from './storage-layout.mjs'
import {validateLocalDataPath} from './storage-location.mjs'

function probeDirectory(path){
  validateLocalDataPath(path,{allowMissing:true})
  const hasDirectory=existsSync(path)
  if(hasDirectory&&!lstatSync(path).isDirectory())throw Error('缓存位置不是正常目录：'+path)
  // Empty caches may not have been created yet. Check the verified domain root
  // without creating unexpected directories; the package manager may create them.
  return {probeRoot:hasDirectory?path:null,hasDirectory}
}

export function verifyPythonCachePaths({root}={}){
  const base=validateLocalDataPath(root)
  const python=storageLayoutStatus(base).domains.python
  if(!python.configured||python.mode!=='cache')
    throw Error('uv/pip 缓存尚未配置独立位置，无法验证迁移结果')
  if(storagePythonRuntimeRoot(base)!==base)
    throw Error('当前 Python 运行环境不在原位置，拒绝按缓存迁移方案验证')

  const target=validateLocalDataPath(python.root)
  const checks=[]
  for(const [name,rel] of [['uv','uv-cache'],['pip','pip-cache']]){
    const path=storageDataPath(base,rel)
    if(resolve(path)!==resolve(join(target,rel)))throw Error('包管理缓存仍指向旧位置：'+name)
    const {probeRoot,hasDirectory}=probeDirectory(path)
    const directory=probeRoot||target
    validateLocalDataPath(directory)
    const testFile=join(directory,'.dafeiyu-cache-write-probe-'+randomUUID())
    let fd,created=false
    try{
      fd=openSync(testFile,'wx',0o600)
      created=true
      writeSync(fd,'dsh-cache-probe')
    }finally{
      try{if(fd!==undefined)closeSync(fd)}
      finally{if(created)unlinkSync(testFile)}
    }
    checks.push({name,path,ok:true,hasDirectory,
      note:hasDirectory?'缓存目录路径及读写通过':'缓存尚为空：已验证目标分区可写，不代表执行了下载'})
  }
  // Verify the mapping is cache-only, not a relocation of existing venvs.
  for(const rel of ['.venv','.venv-asr','.vision-venv','uv-python','uv-tools'])
    if(storageDataPath(base,rel)!==join(base,rel))
      throw Error('检测到 Python 运行环境路径发生变化，停止验证')
  return {ok:true,target,checks,runtimeRoot:base,
    scope:'验证已配置缓存路径与本地写入；未下载软件、未重建依赖，亦未清理旧副本'}
}
