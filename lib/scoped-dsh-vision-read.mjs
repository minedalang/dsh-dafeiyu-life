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

export async function callScopedDshVision({command,script,home,env,args={},startHost=async()=>null,
  makeClient=options=>new McpClient(options),timeoutMs=250000}={}) {
  if(typeof command!=='string'||!command||typeof script!=='string'||!script||typeof home!=='string'||!home)
    throw Error('DSH 视频识图运行环境不完整')
  let route
  try{route=JSON.parse(env?.BILI_VISION_DSH_ARGV||'')}catch{}
  if(!Array.isArray(route)||route.length<3||!route.includes('--patch')||!route.includes('--profile')||
     env?.BILI_VISION_ENABLED!=='1'||env?.BILI_VISION_MODE!=='independent_dsh'||
     env?.BILI_MCP_TOOLS!=='bili_preview_vision')
    throw Error('DSH 视觉模型执行路由未配置，已拒绝启动视频识图')
  const host=await startHost()
  let client
  try{
    if(env?.BILI_VISION_HOST_REQUIRED==='1'&&(!host?.env?.BILI_VISION_HOST_PORT||!host?.env?.BILI_VISION_HOST_TOKEN))
      throw Error('DSH 视觉宿主执行能力不可用；不能退回旧 Bridge')
    client=makeClient({command,args:[script],cwd:home,
      env:{...env,...(host?.env||{})},log:()=>{}})
    const result=await client.call('bili_preview_vision',args,{timeoutMs})
    if(!result||typeof result!=='object'||typeof result.ok!=='boolean')
      throw Error('DSH 视频识图未返回有效的结构化回执')
    return result
  }finally{
    try{client?.stop()}catch{}
    await host?.close()
  }
}
