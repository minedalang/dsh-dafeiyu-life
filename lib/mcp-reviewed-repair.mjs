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
// Keep exact parity with the runtime integrity gate; partial repair may
// otherwise report success while another helper still blocks every poll.
const MCP_FILES=['mcp_server.py','read_action_gate.py','vision_fallback_evidence.py',
  'life_metadata_diagnostics.py','outbound_action_gate.py']
export function mcpIntegrity({stateDir,pluginDir}){
  const matches=MCP_FILES.map(name=>{
    const approved=safeRead(join(pluginDir,'vendor','bilibili-mcp',name))
    if(!approved)throw Error('当前插件安装包缺少受审 MCP 脚本：'+name)
    const old=safeRead(join(stateDir,name))
    return {name,matched:!!old&&digest(old)===digest(approved),present:!!old}
  })
  const matched=matches.every(x=>x.matched)
  return {ok:true,matched,needsRepair:!matched,currentPresent:matches.every(x=>x.present),hasLocalChanges:matches.some(x=>x.present&&!x.matched),
    message:matched?'Python MCP 与当前插件版本一致':'Python MCP 或共享只读预约模块与当前插件版本不一致，操作已安全暂停；需由电脑端人工确认备份并修复'}
}
export function repairReviewedMcp({stateDir,pluginDir,confirm}){
  if(confirm!=='BACKUP_AND_INSTALL_BUNDLED_MCP')throw Error('必须明确确认先备份旧 MCP 再采用当前插件内置受审版本')
  mkdirSync(stateDir,{recursive:true})
  // Read and validate *all* bundled files before changing any installed file.
  const files=MCP_FILES.map(name=>({name,installed:join(stateDir,name),approved:safeRead(join(pluginDir,'vendor','bilibili-mcp',name))}))
  if(files.some(x=>!x.approved))throw Error('安装包缺少受审 MCP 文件，拒绝部分修复')
  let repaired=false,backupCreated=false
  for(const file of files){
    const old=safeRead(file.installed)
    if(old&&digest(old)===digest(file.approved))continue
    if(old){
      const backup=file.name+'.before-repair-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.bak'
      writeFileSync(join(stateDir,backup),old,{mode:0o600,flag:'wx'});backupCreated=true
    }
    const tmp=join(stateDir,'.mcp-reviewed-'+randomUUID()+'.tmp')
    writeFileSync(tmp,file.approved,{mode:0o600,flag:'wx'})
    renameSync(tmp,file.installed)
    writeFileSync(join(stateDir,'.shipped-'+file.name+'.sha'),digest(file.approved)+'\n',{mode:0o600})
    repaired=true
  }
  return {ok:true,repaired,backupCreated,message:repaired?'已备份旧文件并安装当前插件受审 MCP 与共享预约模块；重启插件后生效':'文件本来就一致，无需修复'}
}
