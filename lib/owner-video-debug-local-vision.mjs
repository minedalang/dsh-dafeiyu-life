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
const OLLAMA_EVENTS=new Set(['request-start','http-received','response-parsed',
  'response-validated','request-failed','board-verified','board-invalid'])
const OLLAMA_CODES=new Set(['none','ollama_request_timeout','ollama_service_offline',
  'ollama_connection_failed','ollama_http_error','ollama_model_missing',
  'vision_board_deadline','vision_board_time_mismatch','vision_board_grid_mismatch',
  'vision_board_truncated','vision_board_empty_answer',
  'vision_board_unsegmented','vision_board_unclassified'])
const safeOllama=value=>value&&Number.isSafeInteger(value.attempt)&&value.attempt>0&&value.attempt<=40&&
  OLLAMA_EVENTS.has(value.event)&&OLLAMA_CODES.has(value.code)&&
  Number.isSafeInteger(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=9999999

export function ownerDebugOllamaSummary(value){
  if(!safeOllama(value))return ''
  const labels={'request-start':'已发起请求，尚未确认收到完整 HTTP 响应',
    'http-received':'已收到 HTTP 响应，正在解析',
    'response-parsed':'已解析 Ollama JSON，正在核验内容',
    'response-validated':'响应内容通过本次请求的初步检查，分镜归属仍需核验',
    'request-failed':'本次 Ollama 请求或内容检查失败',
    'board-verified':'已有分镜通过格号、时间码检查',
    'board-invalid':'分镜格号、时间码或内容未通过验证'}
  const codes={'none':'','ollama_request_timeout':'请求超时',
    'ollama_service_offline':'服务离线','ollama_connection_failed':'连接失败',
    'ollama_http_error':'HTTP 返回错误','ollama_model_missing':'模型未安装',
    'vision_board_deadline':'视觉预算耗尽','vision_board_time_mismatch':'时间码不匹配',
    'vision_board_grid_mismatch':'格号不匹配','vision_board_truncated':'内容截断',
    'vision_board_empty_answer':'回答为空','vision_board_unsegmented':'分镜归属不明',
    'vision_board_unclassified':'未分类错误'}
  return `Ollama 请求 ${value.attempt}：${labels[value.event]}`+
    (value.code==='none'?'':`（${codes[value.code]}）`)+`；该请求阶段已耗时约 ${value.elapsedMs} 毫秒。`
}

export function ownerDebugTimeoutMessage(job,now=Date.now()){
  const phase=safePhase(job?.visualDiagnostic?.phase)
  const phaseAt=Number(job?.visualDiagnostic?.at)
  const seconds=Number.isFinite(phaseAt)&&phaseAt>0&&phaseAt<=now
    ?Math.floor((now-phaseAt)/1000):null
  const last=ownerDebugPhaseLabel(phase)
  const ollama=ownerDebugOllamaSummary(job?.visualDiagnostic?.ollama)
  const hint=phase==='model-running'?'最后阶段为 Ollama 推理，但不能据此断言模型自身故障。':
    ['reservation-waiting','frames-reading'].includes(phase)?'最后阶段仍在取帧链路，无法断定是网络、解码还是进程等待。':
    '尚未收到足以确定具体故障点的底层错误。'
  return '本轮超过 8 分钟未取得最终视觉回执。最后确认：'+last+
    (seconds===null?'':`（该阶段已等待约 ${seconds} 秒）`)+`。${ollama}${hint}`+
    '这是调试超时，不代表已经取得视觉回答；程序将按当前视觉路由尝试安全收尾，无法确认已停止的只读预约仍保持隔离，不会自动重放 B站 请求。'
}

export async function ownerDebugLocalVision(sourceClient,args,{
  makeClient=config=>new McpClient(config),
  timeoutMs=OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS,
  onStage=()=>{},
  onDiagnostic=()=>{},
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
      else if(line.startsWith('DSH_OWNER_DEBUG_OLLAMA:')){
        const match=/^DSH_OWNER_DEBUG_OLLAMA:(\d{1,2}):([a-z-]+):([a-z_]+):(\d{1,7})$/.exec(line)
        if(!match)continue
        const entry={attempt:Number(match[1]),event:match[2],code:match[3],elapsedMs:Number(match[4])}
        if(safeOllama(entry))try{onDiagnostic(entry)}catch{}
      }
    }
  }
  const worker=makeClient({command:cfg.command,args:[...cfg.args],cwd:cfg.cwd,
    env:{...env,BILI_MCP_TOOLS:'bili_preview_vision',
      BILI_JS_MCP_ADAPTER:'0',BILI_JS_READ_GATE_TOKEN:'',
      DSH_OWNER_VIDEO_DEBUG_STAGE:'1',
      // Budget is measured from Python module import, includes actual frame
      // acquisition, and ends before this worker's outer watchdog.
      DSH_OWNER_DEBUG_VISION_BUDGET_SEC:String(Math.max(1,Math.min(360,Math.floor((timeoutMs-60_000)/1000)))),
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
