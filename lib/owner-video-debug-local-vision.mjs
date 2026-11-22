/**
 * Isolated one-shot local Ollama owner Debug. Only this dedicated Python worker
 * is stopped on deadline; shared Life/ASR/social MCP remains untouched.
 * A stage marker is an operational hint, NOT proof of an Ollama root cause,
 * visual understanding or a safe-to-release platform reservation.
 */
import {McpClient} from './mcp.mjs'

export const OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS=420_000
const STAGES=Object.freeze({
  'worker-starting':'正在启动独立 Python 视频调试进程',
  'tool-started':'Python 视觉工具已开始',
  'reservation-waiting':'正在等待 B站 只读取帧预约',
  'frames-reading':'正在读取或处理 B站 视频画面',
  'frames-settled':'B站 画面读取已结算',
  'model-running':'画面已读取，正在等待 Ollama 视觉推理',
  'tool-finished':'Python 视觉工具已返回',
})
export const ownerDebugPhaseLabel=phase=>STAGES[phase]||'尚未取得可验证的底层阶段回执'
const safePhase=phase=>Object.hasOwn(STAGES,phase)?phase:'unknown'

export function ownerDebugTimeoutMessage(job,now=Date.now()){
  const phase=safePhase(job?.visualDiagnostic?.phase)
  const phaseAt=Number(job?.visualDiagnostic?.at)
  const seconds=Number.isFinite(phaseAt)&&phaseAt>0&&phaseAt<=now
    ?Math.floor((now-phaseAt)/1000):null
  const last=ownerDebugPhaseLabel(phase)
  const hint=phase==='model-running'?'最后阶段为 Ollama 推理，但不能据此断言模型自身故障。':
    ['reservation-waiting','frames-reading'].includes(phase)?'最后阶段仍在取帧链路，无法断定是网络、解码还是进程等待。':
    '尚未收到足以确定具体故障点的底层错误。'
  return '本轮超过 8 分钟未取得最终视觉回执。最后确认：'+last+
    (seconds===null?'':`（该阶段已等待约 ${seconds} 秒）`)+`。${hint}`+
    '这是调试超时，不代表已经取得视觉回答；程序将按当前视觉路由尝试安全收尾，无法确认已停止的只读预约仍保持隔离，不会自动重放 B站 请求。'
}

export async function ownerDebugLocalVision(sourceClient,args,{
  makeClient=config=>new McpClient(config),
  timeoutMs=OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS,
  onStage=()=>{},
}={}){
  const cfg=sourceClient?.cfg,env=cfg?.env
  if(!cfg||!env||env.BILI_VISION_ENABLED!=='1'||
    env.BILI_VISION_MODE!=='independent_local'||
    !env.BILI_DUTY_HOME||!Array.isArray(cfg.args)||cfg.args.length!==1||
    typeof cfg.command!=='string'||!cfg.command)
    throw Error('只读视频调试的本地 Python 环境未经核验')
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS)
    throw Error('只读视频调试超时参数无效')
  let phase='worker-starting',lineBuffer='',closed=false
  const stage=token=>{
    if(closed||!Object.hasOwn(STAGES,token))return
    phase=token
    try{onStage(token)}catch{}
  }
  stage(phase)
  const onStderr=chunk=>{
    // Never forward stderr or untrusted model content; accept only exact
    // fixed markers. Bound the parser even if Python emits giant log lines.
    lineBuffer=(lineBuffer+String(chunk)).slice(-1024)
    let cut
    while((cut=lineBuffer.indexOf('\n'))>=0){
      const line=lineBuffer.slice(0,cut).trim();lineBuffer=lineBuffer.slice(cut+1)
      if(line.startsWith('DSH_OWNER_DEBUG_STAGE:'))stage(line.slice(22))
    }
  }
  const worker=makeClient({command:cfg.command,args:[...cfg.args],cwd:cfg.cwd,
    env:{...env,BILI_MCP_TOOLS:'bili_preview_vision',
      BILI_JS_MCP_ADAPTER:'0',BILI_JS_READ_GATE_TOKEN:'',
      DSH_OWNER_VIDEO_DEBUG_STAGE:'1',
      // No parent adapter identity: Python owns the real frame reservation.
    },onStderr,log:()=>{}})
  let timer
  try{
    // The deadline covers Python initialization AND tools/call. Previously
    // they could each consume their own budget and outlast the 8m UI watchdog.
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
      const error=Error('专用 Python 视频调试超过总计时限，未取得最终视觉回执')
      error.code='owner_debug_worker_deadline'
      reject(error)
    },timeoutMs)})
    return await Promise.race([worker.call('bili_preview_vision',args,{timeoutMs}),deadline])
  }catch(error){
    if(error&&typeof error==='object'){
      error.phase=safePhase(phase)
      if(!error.code&&/MCP .*超时/.test(String(error.message||'')))error.code='owner_debug_worker_deadline'
    }
    throw error
  }finally{
    closed=true;clearTimeout(timer)
    // A timeout is NOT authorization to erase a durable Bilibili lock.
    // The existing shared read gate still verifies ownership and liveness.
    if(typeof worker.stopAndWait==='function')await worker.stopAndWait({timeoutMs:3000})
    else worker.stop?.()
  }
}
