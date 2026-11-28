/**
 * One read-only DSH video-vision call outside a spawned Video Agent (notably
 * the management-console end-to-end Debug). The existing long-lived JS MCP
 * intentionally has no DSH CLI route. Never attach an ephemeral host token
 * to that long-lived process or persist it in a Headless overlay.
 *
 * The caller must create and verify the official vision overlay/CLI and use
 * the existing public-read gate. Both child clients and one-shot host are
 * always closed, including on MCP launch/timeout/invalid response.
 */
import {McpClient} from './mcp.mjs'
import {VideoReadFailure,videoWorkerFailure} from './video-visual-failure.mjs'

export async function callScopedDshVision({command,script,home,env,args={},startHost=async()=>null,
  makeClient=options=>new McpClient(options),timeoutMs=250000,isCurrent=()=>true}={}) {
  if(typeof command!=='string'||!command||typeof script!=='string'||!script||typeof home!=='string'||!home)
    throw new VideoReadFailure('vision-python-unavailable','DSH 视频识图运行环境不完整')
  let route
  try{route=JSON.parse(env?.BILI_VISION_DSH_ARGV||'')}catch{}
  if(!Array.isArray(route)||route.length<3||!route.includes('--patch')||!route.includes('--profile')||
     env?.BILI_VISION_ENABLED!=='1'||env?.BILI_VISION_MODE!=='independent_dsh'||
     env?.BILI_MCP_TOOLS!=='bili_preview_vision')
    throw new VideoReadFailure('vision-dsh-route-unavailable','DSH 视觉模型执行路由未配置，已拒绝启动视频识图')
  const check=()=>{if(isCurrent()!==true)throw new VideoReadFailure('vision-scope-changed','DSH 视觉调用范围已失效');return true}
  check()
  let host
  try{host=await startHost()}catch{throw new VideoReadFailure('vision-dsh-host-unavailable','DSH 视觉宿主未启动')}
  let client
  try{
    if(env?.BILI_VISION_HOST_REQUIRED==='1'&&(!host?.env?.BILI_VISION_HOST_PORT||!host?.env?.BILI_VISION_HOST_TOKEN))
      throw new VideoReadFailure('vision-dsh-host-unavailable','DSH 视觉宿主执行能力不可用；不能退回旧 Bridge')
    check()
    client=makeClient({command,args:[script],cwd:home,
      env:{...env,...(host?.env||{})},log:()=>{}})
    let result
    try{result=await client.call('bili_preview_vision',args,{timeoutMs,beforeRequest:check})}
    catch(error){throw videoWorkerFailure(error,'DSH 专用 Python 未取得有效回执')}
    check()
    if(!result||typeof result!=='object'||typeof result.ok!=='boolean')
      throw new VideoReadFailure('vision-worker-invalid-receipt','DSH 视频识图未返回有效的结构化回执')
    return result
  }finally{
    try{
      if(typeof client?.stopAndWait==='function') await client.stopAndWait()
      else client?.stop()
    }catch{}
    await host?.close()
  }
}
