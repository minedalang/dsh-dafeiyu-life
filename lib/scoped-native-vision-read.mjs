/** Trusted host adapter for a single, read-only native vision call.
 * No bearer token in overlay/config, MCP arguments, or long-lived MCP.
 * The caller must already hold the platform/role admission and supply a
 * current-account/route guard. This helper does not grant read permission.
 */
import {lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {McpClient} from './mcp.mjs'

export async function callScopedNativeVision({runtime,modelId,command,home,env={},args={},isCurrent,
  makeClient=options=>new McpClient(options)}={}){
  if(typeof runtime?.withVisionRuntime!=='function'||typeof command!=='string'||!command||typeof home!=='string'||!home||typeof isCurrent!=='function'||isCurrent()!==true)
    throw Error('内置视觉调用未取得当前宿主执行范围')
  const script=join(home,'mcp_server.py')
  // A custom or stale staged script must never receive a local service secret.
  const files=[['mcp_server.py','../vendor/bilibili-mcp/mcp_server.py'],['preview_vision.py','./preview_vision.py']]
  const assertScripts=()=>{
    for(const [name,source] of files){
      const target=join(home,name),st=lstatSync(target)
      if(!st.isFile()||st.isSymbolicLink()||readFileSync(target,'utf8')!==readFileSync(new URL(source,import.meta.url),'utf8'))
        throw Error('内置视觉 Python 脚本未通过安装包一致性核验')
    }
  }
  assertScripts()
  return runtime.withVisionRuntime(modelId,async lease=>{
    lease.signal.throwIfAborted()
    if(isCurrent()!==true)throw Error('内置视觉调用范围已失效')
    assertScripts()
    if(lease.model!==modelId)throw Error('内置视觉模型与当前租约不一致')
    const client=makeClient({command,args:[script],cwd:home,log:()=>{},env:{...env,
      BILI_DUTY_HOME:home,BILI_MCP_TOOLS:'bili_preview_vision',BILI_JS_MCP_ADAPTER:'0',BILI_JS_READ_GATE_TOKEN:'',
      BILI_VISION_ENABLED:'1',BILI_VISION_MODE:'independent_local',BILI_VISION_PROVIDER:'llama.cpp',
      BILI_VISION_MODEL:modelId.replace('-',':'),BILI_VISION_LOCAL_THINKING:'off',
      DSH_NATIVE_VISION_PORT:String(lease.port),DSH_NATIVE_VISION_KEY:lease.key,DSH_NATIVE_VISION_MODEL:lease.model}})
    let rejectAbort
    const cancelled=new Promise((_,reject)=>{rejectAbort=reject})
    const abort=()=>rejectAbort(Error('内置视觉运行时已取消或退出'))
    lease.signal.addEventListener('abort',abort,{once:true})
    try{
      if(lease.signal.aborted)throw Error('内置视觉运行时已取消或退出')
      let result
      try{result=await Promise.race([client.call('bili_preview_vision',args,{timeoutMs:600000}),cancelled])}
      catch{throw Error('内置视觉专用 Python 未取得有效回执')}
      if(isCurrent()!==true)throw Error('内置视觉调用范围已失效')
      lease.signal.throwIfAborted()
      if(!result||typeof result!=='object'||typeof result.ok!=='boolean')throw Error('内置视觉未返回有效的结构化回执')
      return result
    }finally{
      lease.signal.removeEventListener('abort',abort)
      if(typeof client.stopAndWait==='function')await client.stopAndWait()
      else client.stop?.()
    }
  })
}
