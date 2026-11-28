/** Trusted host adapter for a single, read-only native vision call.
 * No bearer token in overlay/config, MCP arguments, or long-lived MCP.
 * The caller must already hold the platform/role admission and supply a
 * current-account/route guard. This helper does not grant read permission.
 */
import {lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {randomBytes,timingSafeEqual} from 'node:crypto'
import {McpClient} from './mcp.mjs'

export async function callScopedNativeVision({runtime,modelId,command,home,env={},args={},isCurrent,signal,
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
  signal?.throwIfAborted()
  assertScripts()
  return runtime.withVisionRuntime(modelId,async lease=>{
    lease.signal.throwIfAborted()
    if(isCurrent()!==true)throw Error('内置视觉调用范围已失效')
    assertScripts()
    if(lease.model!==modelId)throw Error('内置视觉模型与当前租约不一致')
    const client=makeClient({command,args:[script],cwd:home,log:()=>{},env:{...env,
      BILI_DUTY_HOME:home,BILI_MCP_TOOLS:'bili_preview_vision',BILI_JS_MCP_ADAPTER:'0',BILI_JS_READ_GATE_TOKEN:'',
      BILI_DUTY_VIDEO_PICK_FLOW:'0',BILI_DUTY_LIFE_ROUND_ID:'',DSH_NATIVE_ROUND_PORT:'',DSH_NATIVE_ROUND_TOKEN:'',
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
  },{signal})
}

/** One round's selected-video bridge. No arbitrary tool or model parameters. */
export async function startNativeVisionRoundHost({isCurrent,isSelected,observe}){
  const token=randomBytes(32).toString('hex'),abort=new AbortController()
  let busy=false
  const current=()=>!abort.signal.aborted&&isCurrent()===true
  const authorized=req=>{const got=Buffer.from(String(req.headers.authorization||'')),want=Buffer.from('Bearer '+token);return got.length===want.length&&timingSafeEqual(got,want)}
  const server=createServer(async(req,res)=>{
    const reply=(status,data)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}}
    const deny=()=>reply(403,{ok:false,status:'vision_model_unavailable',error:'内置视觉未取得当前选中视频执行范围'})
    try{
      if(req.method!=='POST'||req.url!=='/observe'||!authorized(req)||!current())return deny()
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024)return deny()}
      const a=JSON.parse(body)
      if(!a||Object.keys(a).sort().join(',')!=='bvid,view_depth'||!/^BV[0-9A-Za-z]{10}$/.test(a.bvid)||!['standard','deep'].includes(a.view_depth)||!current()||!isSelected(a.bvid))return deny()
      if(busy)return reply(409,{ok:false,status:'vision_model_unavailable',error:'内置视觉正在处理本轮观察'})
      busy=true
      try{const result=await observe({bvid:a.bvid,perception_source:'adaptive',view_depth:a.view_depth},{signal:abort.signal,isCurrent:()=>current()&&isSelected(a.bvid)})
        if(!current()||!isSelected(a.bvid))return deny()
        return reply(200,result)
      }finally{busy=false}
    }catch{return reply(503,{ok:false,status:'vision_model_unavailable',error:'内置视觉未取得有效观察回执'})}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  return {env:{DSH_NATIVE_ROUND_PORT:String(server.address().port),DSH_NATIVE_ROUND_TOKEN:token},async close(){abort.abort();if(server.listening){const done=new Promise(resolve=>server.close(resolve));server.closeAllConnections?.();await done}}}
}
