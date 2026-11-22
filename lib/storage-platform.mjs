/** Presentation only: the migration engine itself uses native node:fs/node:path. */
import {win32,posix} from 'node:path'
import {homedir} from 'node:os'

export function storageTargetSuggestions(platform=process.platform,home=homedir()){
 const layout=platform==='win32'?win32:posix
 const base=platform==='win32'?'D:\\DSHData\\bili-duty':layout.join(home,'DSHData','bili-duty')
 return Object.fromEntries([['model','modelData'],['python','pythonData'],['memory','lifeData']].map(([key,dir])=>[key,layout.join(base,dir)]))
}
const quotePowerShell=value=>"'"+String(value).replace(/'/g,"''")+"'"
const quotePosix=value=>"'"+String(value).replace(/'/g,"'\\''")+"'"
export function storageOfflineCommand({platform=process.platform,script,root,domain,target,mode='',operation='migrate'}){
 if(!script||!root||domain!=='model'&&domain!=='python'&&domain!=='memory')throw Error('离线命令参数无效')
 const quote=platform==='win32'?quotePowerShell:quotePosix
 if(operation==='cleanup'){
  if(domain!=='model')throw Error('仅允许验证后清理旧模型副本')
  return ['node',quote(script),'--root',quote(root),'--inspect-retained-model'].join(' ')
 }
 if(operation!=='migrate'||!target)throw Error('离线命令参数无效')
 if(domain==='python'&&mode&&mode!=='cache')throw Error('Python 迁移仅支持 uv/pip 包缓存')
 return ['node',quote(script),'--root',quote(root),'--domain',quote(domain),
  ...(domain==='python'?['--mode',quote('cache')]:[]),'--to',quote(target),'--confirm-stopped'].join(' ')
}
