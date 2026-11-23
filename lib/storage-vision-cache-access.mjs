/**
 * Bounded permission probe for the current visual cache (including relocated
 * modelData). Unlike a copy checksum, this exercises the actual atomic writer:
 * create, flush, replace an existing file, read and delete. Only unpredictable
 * probe-owned files are touched; no ACLs or user cache records are modified.
 */
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,renameSync,readFileSync,unlinkSync,existsSync,rmdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateLocalDataPath} from './storage-location.mjs'

export function probeVisionCacheAccess(cacheDirectory){
 const directory=validateLocalDataPath(cacheDirectory,{allowMissing:true})
 const id=randomUUID(),prefix='.dafeiyu-vision-access-probe-'+id
 const source=join(directory,prefix+'.tmp'),target=join(directory,prefix+'.json')
 const files=[source,target]
 const originallyExists=existsSync(directory)
 let failure=null
 try{
  mkdirSync(directory,{recursive:true,mode:0o700})
  validateLocalDataPath(directory) // reject junction/symlink introduced after mkdir
  for(const [path,text] of [[source,'new'],[target,'old']]){
   let fd
   try{fd=openSync(path,'wx',0o600);writeSync(fd,text);fsyncSync(fd)}
   finally{if(fd!==undefined)closeSync(fd)}
  }
  // This is the important Windows case: rename over an existing destination.
  renameSync(source,target)
  if(readFileSync(target,'utf8')!=='new')throw Error('CACHE_PROBE_VERIFY_FAILED')
 }catch(error){failure=error}
 finally{
  for(const path of files)if(existsSync(path))try{unlinkSync(path)}catch(error){failure??=error}
  // Do not turn a previously absent cache directory into a false migration
  // difference. Remove only the empty directory created by THIS probe.
  if(!originallyExists&&existsSync(directory))try{rmdirSync(directory)}catch(error){failure??=error}
 }
 if(failure){
  const reason=['EACCES','EPERM','EBUSY','ENOSPC','EROFS'].includes(failure?.code)?failure.code:'WRITE_FAILED'
  const err=new Error('视觉缓存目录无法完成创建、替换或清理操作；未改动任何现有缓存（'+reason+'）')
  err.code='VISION_CACHE_NOT_WRITABLE';err.reason=reason
  throw err
 }
 return {ok:true,create:true,atomicReplace:true,delete:true}
}
