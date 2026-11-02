/** Explicit, local-only repair of an old/customized MCP runtime copy.
 * A mismatched copy is never executed and never replaced without confirmation.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,writeFileSync,copyFileSync,renameSync,mkdirSync} from 'node:fs'
import {dirname,join} from 'node:path'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const safeRead=file=>{
  if(!existsSync(file))return null
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>4*1024*1024)throw Error('MCP 文件不是安全的普通文件，停止修复')
  return readFileSync(file)
}
export function mcpIntegrity({stateDir,pluginDir}){
  const installed=join(stateDir,'mcp_server.py')
  const bundled=join(pluginDir,'vendor','bilibili-mcp','mcp_server.py')
  const approved=safeRead(bundled)
  if(!approved)throw Error('当前插件安装包缺少受审 MCP 脚本')
  const old=safeRead(installed)
  const expected=digest(approved),current=old?digest(old):''
  return {ok:true,matched:expected===current,needsRepair:expected!==current,
    currentPresent:!!old,hasLocalChanges:!!old&&expected!==current,
    // Do not reveal raw paths/contents to browser.
    message:expected===current?'Python MCP 与当前插件版本一致':'Python MCP 与当前插件版本不一致，发送和监听已安全暂停；需由电脑端人工确认备份并修复'}
}
export function repairReviewedMcp({stateDir,pluginDir,confirm}){
  if(confirm!=='BACKUP_AND_INSTALL_BUNDLED_MCP')throw Error('必须明确确认先备份旧 MCP 再采用当前插件内置受审版本')
  const installed=join(stateDir,'mcp_server.py')
  const bundled=join(pluginDir,'vendor','bilibili-mcp','mcp_server.py')
  const approved=safeRead(bundled)
  if(!approved)throw Error('当前插件安装包缺少 MCP 安全脚本')
  const old=safeRead(installed)
  if(old&&digest(old)===digest(approved))return {ok:true,repaired:false,message:'文件本来就一致，无需修复'}
  mkdirSync(stateDir,{recursive:true})
  // Backup first, under the private plugin home, without sending custom code anywhere.
  let backup=''
  if(old){
    backup='mcp_server.py.before-repair-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.bak'
    writeFileSync(join(stateDir,backup),old,{mode:0o600,flag:'wx'})
  }
  const tmp=join(stateDir,'.mcp-reviewed-'+randomUUID()+'.tmp')
  writeFileSync(tmp,approved,{mode:0o600,flag:'wx'})
  renameSync(tmp,installed)
  writeFileSync(join(stateDir,'.shipped-mcp_server.py.sha'),digest(approved)+'\n',{mode:0o600})
  return {ok:true,repaired:true,backupCreated:!!backup,message:'已保存旧脚本备份并安装当前插件受审 MCP；重启插件后生效'}
}
