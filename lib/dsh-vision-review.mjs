/**
 * Model-scoped, one-shot manual review for the exact DSH mascot probe.
 * Does not grant Bilibili writes; no model-derived auto-approval.
 */
import {randomUUID,createHash} from 'node:crypto'
import {readFileSync,writeFileSync,renameSync,statSync,lstatSync,rmSync} from 'node:fs'

const defaultDiagnostics = route => ({
  route: {
    status: route?.complete ? (route?.headlessVerified ? 'verified' : 'not_verified') : 'missing',
    provider: String(route?.provider||''), model: String(route?.model||''),
    api: String(route?.api||''), imageInputDeclared: route?.imageInputDeclared ?? null,
    reasoningEfforts: Array.isArray(route?.reasoningEfforts)?route.reasoningEfforts:null,
  },
  mcpPreflight: {status:'not_run'},
  headlessConfig: {status:'not_run'},
  mcpImage: {status:'not_run'},
  attachmentBridge: {status:'not_observable',note:'插件无法读取 DSH 内部附件桥接的独立回执；需结合模型回答人工判断'},
  providerApi: {status:'not_run'},
  modelAnswer: {status:'not_run'},
  cliProcess: {status:'not_run'},
})
const mergeDiagnostics = (route, supplied={}) => {
  const base=defaultDiagnostics(route)
  const out={...base}
  for(const key of ['route','mcpPreflight','headlessConfig','mcpImage','attachmentBridge','providerApi','modelAnswer','cliProcess']){
    const value=supplied?.[key]
    if(value&&typeof value==='object'&&!Array.isArray(value))out[key]={...out[key],...value}
  }
  out.route={...base.route,...(supplied?.route||{})}
  return out
}

// Only a bounded, sanitized diagnostic ledger is durable. Never persist response
// text, prompts, images, credentials, raw errors, URLs, or a review token.
const safeStatus=value=>['idle','running','failed','awaiting_review','approved','rejected'].includes(value)?value:'unknown'
const safeCode=value=>/^[a-z][a-z0-9_]{0,63}$/.test(String(value||''))?String(value):''
const safeIdentity=value=>/^[A-Za-z0-9_.:/-]{1,120}$/.test(String(value||''))?String(value):'unavailable'
const safeStage=value=>/^[a-z][a-z0-9_]{0,39}$/.test(String(value||''))?String(value):'unknown'
function loadLastRun(file){
  if(!file)return null
  try{
    if(lstatSync(file).isSymbolicLink()||statSync(file).size>8192)return null
    const d=JSON.parse(readFileSync(file,'utf8'))
    return d?.schema===1&&typeof d.last?.at==='string'?d.last:null
  }catch{return null}
}
export function createDshVisionReview({getRoute,probe,stateFile}={}){
  if(typeof getRoute!=='function'||typeof probe!=='function')throw TypeError('DSH probe requires route and executor')
  let record=null,verifiedKey='',busy=false,lastRun=loadLastRun(stateFile)
  const recordDiagnostic=(result,currentRoute)=>{
    const d=result?.diagnostics||{}
    const stamp=new Date().toISOString()
    const next={at:stamp,status:safeStatus(result?.status),
      provider:safeIdentity(currentRoute?.provider),model:safeIdentity(currentRoute?.model),
      routeId:createHash('sha256').update(JSON.stringify(currentRoute||{})).digest('hex').slice(0,16),
      diagnosticCode:safeCode(result?.diagnosticCode),
      preflight:safeStage(d.mcpPreflight?.status),
      headlessConfig:safeStage(d.headlessConfig?.status),
      headlessConfigReason:safeStage(d.headlessConfig?.reason||'not_run'),
      headlessConfigFailureLayer:safeStage(d.headlessConfig?.failureLayer||'unknown'),
      headlessConfigFailureKind:safeStage(d.headlessConfig?.failureKind||'unknown'),
      headlessConfigDefaultDump:safeStage(d.headlessConfig?.defaultDump||'not_run'),
      headlessConfigBaseDump:safeStage(d.headlessConfig?.baseDump||'not_run'),
      headlessConfigNodeEnvRetry:safeStage(d.headlessConfig?.nodeEnvRetry||'not_run'),
      headlessConfigWorkdirRetry:safeStage(d.headlessConfig?.workdirRetry||'not_run'),
      headlessConfigLaunchCwd:safeStage(d.headlessConfig?.launchCwd||'unknown'),
      mcpImage:safeStage(d.mcpImage?.status),
      attachmentBridge:'not_observable',providerApi:safeStage(d.providerApi?.status),
      modelAnswer:safeStage(d.modelAnswer?.status),
      cliProcess:safeStage(d.cliProcess?.status),
      cliExitCode:Number.isInteger(d.cliProcess?.exitCode)&&d.cliProcess.exitCode>=0&&d.cliProcess.exitCode<=255?d.cliProcess.exitCode:-1,
      cliStdout:d.cliProcess?.stdout==='present'?'present':'empty',
      cliStderr:d.cliProcess?.stderr==='present'?'present':'empty',
      cliStderrKind:safeStage(d.cliProcess?.stderrKind||'unknown'),
      cliNodeErrorCode:safeStage(d.cliProcess?.nodeErrorCode||'unknown'),
      cliNodeExceptionType:safeStage(String(d.cliProcess?.nodeExceptionType||'unknown').toLowerCase())}
    lastRun=next
    if(!stateFile)return
    const tmp=stateFile+'.'+randomUUID()+'.tmp'
    try{
      try{if(lstatSync(stateFile).isSymbolicLink())return}catch(error){if(error?.code!=='ENOENT')return}
      writeFileSync(tmp,JSON.stringify({schema:1,last:next})+'\n',{flag:'wx',mode:0o600})
      renameSync(tmp,stateFile)
    }catch{}finally{try{rmSync(tmp,{force:true})}catch{}}
  }
  const route=()=>{try{return getRoute()||{}}catch{return {}}}
  const key=()=>JSON.stringify(route())
  const status=()=>{
    const currentRoute=route(),routeKey=JSON.stringify(currentRoute)
    if(record&&record.routeKey!==routeKey)return {
      status:'route_changed',verified:false,answer:'',error:'视觉 Provider / 模型或实际路由配置已变更，请重新识图',
      route:currentRoute,diagnostics:mergeDiagnostics(currentRoute),lastRun,
    }
    return record?{...record,route:currentRoute,lastRun,verified:record.status==='approved'&&verifiedKey===routeKey}:
      {status:'idle',verified:false,answer:'',error:'',route:currentRoute,lastRun,diagnostics:mergeDiagnostics(currentRoute)}
  }
  async function verify(){
    if(busy)throw Error('DSH 图片验收正在进行，请稍后重试')
    busy=true;verifiedKey=''
    const currentRoute=route(),routeKey=JSON.stringify(currentRoute)
    record={status:'running',routeKey,route:currentRoute,diagnostics:mergeDiagnostics(currentRoute),
      reviewId:randomUUID(),answer:'',error:'',startedAt:new Date().toISOString()}
    recordDiagnostic(record,currentRoute)
    try{
      const result=await probe()
      if(!result?.ok){
        const error=Error(String(result?.error||'未得到真实图片识别回复'))
        error.status=String(result?.status||'probe_failed')
        error.diagnosticCode=String(result?.diagnosticCode||'')
        error.diagnostics=result?.diagnostics||{}
        throw error
      }
      if(key()!==routeKey)throw Error('验证期间视觉模型配置发生变化，结果已作废')
      if(!String(result.answer||'').trim())throw Error('未得到真实图片识别回复')
      record={...record,status:'awaiting_review',answer:String(result.answer),
        diagnostics:mergeDiagnostics(currentRoute,result.diagnostics),finishedAt:new Date().toISOString()}
      recordDiagnostic(record,currentRoute)
      return {ok:true,awaitingReview:true,reviewId:record.reviewId,diagnostics:record.diagnostics}
    }catch(error){
      const diagnostics=mergeDiagnostics(currentRoute,error?.diagnostics)
      record={...record,status:'failed',answer:'',error:String(error?.message||error).slice(0,400),
        diagnosticCode:safeCode(error?.diagnosticCode),diagnostics,finishedAt:new Date().toISOString()}
      recordDiagnostic(record,currentRoute)
      throw error
    }finally{busy=false}
  }
  function review({reviewId,accepted}={}){
    if(busy)throw Error('图片识别尚未结束')
    if(typeof accepted!=='boolean')throw Error('需要明确认可或否决')
    if(!record||record.status!=='awaiting_review'||reviewId!==record.reviewId||record.routeKey!==key())
      throw Error('当前识图结果不匹配或已失效，请重新识图')
    record={...record,status:accepted?'approved':'rejected',reviewedAt:new Date().toISOString()}
    verifiedKey=accepted?key():''
    recordDiagnostic(record,route())
    return {ok:true,verified:accepted}
  }
  return {status,verify,review,clear(){record=null;verifiedKey=''},isVerified(){return status().verified}}
}
