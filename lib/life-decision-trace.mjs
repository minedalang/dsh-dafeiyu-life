/**
 * A bounded local debugging journal for actual Life Agent turns. It does NOT
 * record prompts, model prose, UIDs, video identifiers, filenames or targets.
 * Account-scoped, read-only from the management console and not model memory.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {trustedVideoVisionErrorCode} from './video-visual-failure.mjs'

const ID=/^[0-9a-f-]{36}$/i, SCOPE=/^[0-9a-f]{16}$/i
const ROOT='life-decision-traces', MAX_STEPS=96, MAX_RUNS=60, MAX_AGE=7*86400000
const TYPES=new Set(['start','candidate-scan','context-evidence','quota-reserved','video-round-feedback','video-visual-attempt','episode-context','video-comment-summary','model-call','model-choice','preflight','action-start','read-result','memory-projection','experience-yield','next-wake','action-result','delegation-result','event-settlement','journal','finish','error','blocked','candidate-detail','model-input','model-output','execution-plan','execution-result','event-resolution','unknown-stage'])
const cleanCode=value=>{
  const s=String(value??'').slice(0,64)
  return /^[a-z0-9][a-z0-9._-]*$/i.test(s)?s:'unclassified'
}
const sanitize=fields=>{
  const out={}
  for(const key of ['action','result','code','reason','mode','trigger','tool','state','origin','layer','reservationReason','latestOutcome','kind','platform','selection','modelScene','modelValidity','delivery','eventStatus','restReasonCode']){
    if(Object.hasOwn(fields||{},key))out[key]=cleanCode(fields[key])
  }
  for(const key of ['episodeCount','episodeOffered','todos','cues','intentions','opportunities','social','video','reflection','eventCount','charged','waiting','review','provided','picked','reviewed','wanted','passed','insufficient','reviewRejected','proposed','approved','blocked','verified','unverified','ageMinutes','inputChars','outputChars','menuCount','reasonChars','targetCount','candidateCount','eventAgeMinutes','observations','verifiedDiscussionExcerpts','episodeStepsUsed','visionBoardsTotal','visionBoardsFailed']){
    if(Number.isSafeInteger(fields?.[key])&&fields[key]>=0)out[key]=Math.min(10000,fields[key])
  }
  if(Object.hasOwn(out,'restReasonCode')&&!['need-rest','not-now','not-interested','need-evidence','avoid-disturb','no-priority'].includes(out.restReasonCode))delete out.restReasonCode
  if(typeof fields?.latestPickedKnown==='boolean')out.latestPickedKnown=fields.latestPickedKnown
  if(typeof fields?.commentOffered==='boolean')out.commentOffered=fields.commentOffered
  for(const key of ['metadataVerified','descriptionAvailable','recentReadNovel'])
    if(typeof fields?.[key]==='boolean')out[key]=fields[key]
  if(Object.hasOwn(fields||{},'visualStatus'))out.visualStatus=cleanCode(fields.visualStatus)
  const visionFailureCode=trustedVideoVisionErrorCode(fields?.visionFailureCode)
  if(visionFailureCode)out.visionFailureCode=visionFailureCode
  if(['reused-memory','reused-cache','new-overview','new-focus-evidence','retry-after-failure'].includes(fields?.attemptKind))
    out.attemptKind=fields.attemptKind
  if(['not-invoked','cache-hit-reported','analysis-reported','attempt-reported','unknown'].includes(fields?.modelRun))
    out.modelRun=fields.modelRun
  if(['not-run','verified','unverified'].includes(fields?.verification))
    out.verification=fields.verification
  if(Object.hasOwn(fields||{},'commentNotOfferedCode')) {
    const reason=cleanCode(fields.commentNotOfferedCode)
    if(['offered','no-verified-public-evidence','comment-permission-off',
      'comment-quota-off','missing-verified-title','episode-or-write-aftercare'].includes(reason))
      out.commentNotOfferedCode=reason
  }
  if(typeof fields?.newEvidence==='boolean')out.newEvidence=fields.newEvidence
  if(typeof fields?.reasonProvided==='boolean')out.reasonProvided=fields.reasonProvided
  for(const key of ['promptHash','targetRef','sourceRef','actionRef']){
    if(typeof fields?.[key]==='string'&&/^[a-f0-9]{16}$/.test(fields[key]))out[key]=fields[key]
  }
  // Code-only representations: no model prompt, private messages, UIDs, BVIDs,
  // freeform model rationale, addresses or usernames in ordinary Life traces.
  for(const key of ['menuActions','contextSources']){
    if(Array.isArray(fields?.[key]))out[key]=[...new Set(fields[key].map(cleanCode))].slice(0,30)
  }
  if(['selection-reader-timeout','selection-ledger-busy','selection-ledger-unavailable','selection-ledger-missing','account-not-ready'].includes(fields?.selectionLedgerCode))
    out.selectionLedgerCode=fields.selectionLedgerCode
  if(typeof fields?.modelCallMs==='number'&&Number.isFinite(fields.modelCallMs))out.modelCallMs=Math.max(0,Math.min(600000,Math.round(fields.modelCallMs)))
  if(Array.isArray(fields?.eventRefs))out.eventRefs=fields.eventRefs.filter(x=>typeof x==='string'&&/^[a-f0-9]{16}$/.test(x)).slice(0,4)
  if(Number.isSafeInteger(fields?.platformCode)&&fields.platformCode!==0&&Math.abs(fields.platformCode)<=99999)out.platformCode=fields.platformCode
  return out
}
/** A trace can remain running *after* Life granted a short-lived proof.
 * Only the execution receipt closes the trace. Do not label that as a crash.
 * A stale approval is unresolved evidence, never permission to resend.
 */
export function lifeTracePresentation(row,at=Date.now()){
  const steps=Array.isArray(row?.steps)?row.steps:[]
  const has=(type,pred=()=>true)=>steps.some(s=>s?.type===type&&pred(s))
  if(row?.state==='running'){
    if(has('execution-plan',s=>s.action==='act'&&s.delivery==='approval-only'))
      return at-Math.max(Number(row.updatedAt)||0,Number(row.at)||0)>5*60_000
        ?'approval-unsettled':'approval-pending'
    if(has('model-call'))return at-Math.max(Number(row.updatedAt)||0,Number(row.at)||0)>10*60_000
      ?'decision-unsettled':'decision-running'
    return 'decision-running'
  }
  // The presentation and the explanation must share one terminal judgment.
  // In particular, an older success must not mask a later unknown outcome.
  const category=lifeTraceExplanation(row,at).category
  if(category==='result-uncertain'||category==='mixed-outcomes')return 'result-uncertain'
  if(category==='platform-verified')return 'platform-verified'
  if(category==='action-verified')return 'action-verified'
  if(row?.state==='error'||row?.state==='failed')return 'failed'
  if(row?.state==='blocked')return 'blocked'
  return 'decision-finished'
}
/**
 * Read-only owner-facing interpretation of the existing, account-scoped trace.
 * This is not a second decision/receipt ledger. All values are finite enums;
 * neither a model's freeform reason nor a target identifier is projected.
 * A model choice proves only a choice, never execution or platform delivery.
 */
const TRACE_CHOICE_OK=new Set(['valid','model-accepted'])
const TRACE_REST_CODES=new Set(['need-rest','not-now','not-interested','need-evidence','avoid-disturb','no-priority'])
const TRACE_COMMENT_CODES=new Set(['offered','no-verified-public-evidence','comment-permission-off',
  'comment-quota-off','missing-verified-title','episode-or-write-aftercare'])
const TRACE_BLOCK_CATEGORIES=new Map([
  ['life-resource-deferred','resource-deferred'],['life-cross-channel-rest','resource-deferred'],
  ['life-choice-in-progress','reservation-held'],['life-choice-review-required','reservation-held'],
  ['visual-read-in-progress','reservation-held'],['visual-lease-busy','reservation-held'],
  ['life-willingness-quota','budget-deferred'],['global-quota','budget-deferred'],
  ['quota','budget-deferred'],['social-quota','budget-deferred'],
  ['metadata-rate-limited','platform-rate-limit'],['platform-rate-limit','platform-rate-limit'],
  ['metadata-read-busy','reservation-held'],['metadata-account-unavailable','account-unavailable'],
  ['life-account-changed','account-unavailable'],['account-not-ready','account-unavailable'],
  ['model-backoff','model-unavailable'],['model-call-failed','model-unavailable'],
  ['life-continuation-model-unavailable','model-unavailable'],['life-willingness-unavailable','model-unavailable'],
  ['life-context-unavailable','evidence-insufficient'],['no-verified-public-evidence','evidence-insufficient'],
  ['comment-permission-off','permission-blocked'],['comment-quota-off','budget-deferred'],
  ['network-backoff','network-deferred'],['dns-backoff','network-deferred']
])
const traceBlockCategory=code=>{
  if(TRACE_BLOCK_CATEGORIES.has(code))return TRACE_BLOCK_CATEGORIES.get(code)
  if(typeof code!=='string')return 'technical-blocked'
  if(/^(?:permission-|.*-permission-denied|authorization-)/.test(code))return 'permission-blocked'
  if(/^(?:quota-|.*-quota-exhausted|read-budget-)/.test(code))return 'budget-deferred'
  if(/^(?:metadata-|read-)/.test(code))return 'read-unavailable'
  return 'technical-blocked'
}
export function lifeTraceExplanation(row,at=Date.now()){
  const steps=Array.isArray(row?.steps)?row.steps.slice(-96):[]
  const lastIndex=type=>steps.findLastIndex(s=>s?.type===type)
  const last=type=>{const i=lastIndex(type);return i<0?null:steps[i]}
  const choiceAt=lastIndex('model-choice'),choice=choiceAt<0?null:steps[choiceAt]
  const receiptAt=Math.max(lastIndex('execution-result'),lastIndex('action-result'))
  const receipt=receiptAt>choiceAt&&receiptAt>=0?steps[receiptAt]:null
  const exec=receipt?.type==='execution-result'?receipt:
    steps.slice(choiceAt+1).reverse().find(s=>s?.type==='execution-result')||null
  const tail=type=>steps.slice(choiceAt+1).reverse().find(s=>s?.type===type)||null
  const final=last('finish'),blocked=tail('blocked'),error=tail('error')
  const validChoice=Boolean(choice&&TRACE_CHOICE_OK.has(choice.code))
  const commentStep=steps.slice().reverse().find(s=>s?.type==='model-call'&&
    (typeof s.commentOffered==='boolean'||TRACE_COMMENT_CODES.has(s.commentNotOfferedCode)))
  const commentOpportunity=commentStep?.commentOffered===true?'offered':
    TRACE_COMMENT_CODES.has(commentStep?.commentNotOfferedCode)?commentStep.commentNotOfferedCode:'unknown'
  const restReason=validChoice&&TRACE_REST_CODES.has(choice.restReasonCode)?choice.restReasonCode:'none'
  const base={version:1,phase:'unresolved',category:'evidence-unresolved',actor:'unknown',proof:'none',
    hasChoice:!!choice,hasExecutionReceipt:!!exec,commentOpportunity,restReason}
  const result=(category,phase,actor,proof)=>({...base,category,phase,actor,proof})
  const presentation=row?.state==='running'?lifeTracePresentation(row,at):''
  if(row?.state==='running'){
    if(exec)return result('receipt-unsettled','unresolved','system','local-receipt')
    if(presentation==='approval-pending')return result('approval-pending','execution','life','model-choice')
    if(presentation==='approval-unsettled')return result('approval-review-required','unresolved','system','technical-status')
    if(presentation==='decision-unsettled')return result('decision-review-required','unresolved','system','technical-status')
    if(tail('action-start')||tail('execution-plan'))return result('execution-in-progress','execution','system','model-choice')
    if(validChoice)return result('choice-awaiting-result','decision','life','model-choice')
    return result('decision-in-progress','decision','system','none')
  }
  // A run can contain several separate actions without per-child receipt IDs.
  // Any uncertain side effect or conflicting terminal events must override a
  // verified sibling; do not claim the entire run was platform successful.
  const terminalSteps=steps.filter(s=>['execution-result','action-result'].includes(s?.type))
  // dev.11: only an explicit, sanitized child-action reference may join two
  // receipts. The old rows have no reference and remain conservatively mixed.
  // A shared decision id is NOT sufficient for identifying two physical sends.
  const fullyCorrelated=terminalSteps.length>0&&terminalSteps.every(s=>/^[a-f0-9]{16}$/.test(s?.actionRef||''))
  if(fullyCorrelated){
    const groups=new Map()
    for(const step of terminalSteps){
      const group=groups.get(step.actionRef)||[]
      group.push(step);groups.set(step.actionRef,group)
    }
    const statuses=[...groups.values()]
    if(statuses.some(group=>group.some(s=>s.result==='uncertain'||s.delivery==='outcome-unknown')||
      new Set(group.map(s=>s.result)).size>1))
      return result('result-uncertain','unresolved','system','technical-status')
    const failed=statuses.some(group=>group.some(s=>['failed','not-sent','invalid-decision'].includes(s.result)))
    const verified=statuses.some(group=>group.some(s=>s.result==='verified'))
    // A later uncertainty or terminal host failure cannot be erased by a
    // matching pair of earlier receipts with the same action reference.
    if(final?.result==='action-outcome-unknown')
      return result('result-uncertain','unresolved','system','technical-status')
    if(verified&&(row?.state==='error'||row?.state==='failed'||row?.state==='blocked'||
      steps.slice(receiptAt+1).some(s=>['error','blocked'].includes(s?.type))))
      return result('mixed-outcomes','unresolved','system','technical-status')
    if(verified&&(failed||statuses.some(group=>!group.every(s=>s.result==='verified'))))
      return result('mixed-outcomes','unresolved','system','technical-status')
    // Only receipt-backed action(s) prove platform delivery. A local summary
    // with matching result text is NOT another platform receipt.
    if(verified&&!steps.slice(receiptAt+1).some(s=>['error','blocked'].includes(s?.type))){
      const allPlatform=statuses.every(group=>group.some(s=>s.type==='execution-result'&&
        s.result==='verified'&&s.delivery==='platform-confirmed'))
      return allPlatform?result('platform-verified','settled','platform','platform-receipt'):
        result('local-result-unverified','unresolved','system','local-receipt')
    }
  }
  const uncertain=terminalSteps.some(s=>s.result==='uncertain'||s.delivery==='outcome-unknown')
  const hasVerified=terminalSteps.some(s=>s.result==='verified')
  const hasFailed=terminalSteps.some(s=>['failed','not-sent','invalid-decision'].includes(s.result))
  const resultAt=Math.max(lastIndex('execution-result'),lastIndex('action-result'))
  const hasLaterBlock=steps.some((s,i)=>i>resultAt&&['error','blocked'].includes(s?.type))
  if(uncertain||exec&&receipt?.type==='action-result'&&receipt.result!==exec.result)
    return result('result-uncertain','unresolved','system','technical-status')
  if((hasVerified&&hasFailed)||(hasVerified&&hasLaterBlock))
    return result('mixed-outcomes','unresolved','system','technical-status')
  // Different terminal action and execution results cannot be joined into
  // one success. An older verified child must not mask a later failed child.
  if(exec&&receipt?.type==='action-result'&&receipt.result!==exec.result)
    return result('result-uncertain','unresolved','system','technical-status')
  // A known unknown external side effect outranks an earlier local read or
  // model choice. Never make it eligible for a resend via a diagnostic label.
  if(exec?.result==='uncertain'||exec?.delivery==='outcome-unknown'||
    receipt?.result==='uncertain'||final?.result==='action-outcome-unknown')
    return result('result-uncertain','unresolved','system','technical-status')
  if(exec?.result==='verified'&&exec?.delivery==='platform-confirmed')
    return result('platform-verified','settled','platform','platform-receipt')
  if(exec?.result==='verified')return result('action-verified','settled','system','local-receipt')
  if(exec?.result==='delegated'||exec?.delivery==='delegated-not-confirmed')
    return result('delegated-unconfirmed','execution','system','local-receipt')
  if(exec?.delivery==='host-queued-not-delivered')
    return result('host-queued','execution','system','local-receipt')
  if(choice&&!validChoice||exec?.result==='invalid-decision'||
    final?.result==='invalid-decision'||tail('preflight')?.state==='denied')
    return result('invalid-decision','settled','system','technical-status')
  if(error||row?.state==='error'||row?.state==='failed'){
    const code=error?.code||final?.code
    return result(['model-call-failed','life-willingness-unavailable'].includes(code)?'model-unavailable':'technical-error',
      'unresolved','system','technical-status')
  }
  if(blocked&&(row?.state==='blocked'||!exec))
    return result(traceBlockCategory(blocked.code),'unresolved','system','technical-status')
  if(row?.state==='blocked')return result(traceBlockCategory(final?.code),'unresolved','system','technical-status')
  if(validChoice&&choice.action==='skip'&&
    (exec?.result==='no-action'||exec?.result==='voluntary-rest'||receipt?.result==='voluntary-rest'))
    return result('voluntary-rest','settled','life','model-choice')
  if(validChoice&&choice.action==='defer'&&
    (exec?.result==='no-action'||exec?.result==='deferred'||receipt?.result==='deferred'))
    return result('voluntary-defer','settled','life','model-choice')
  if(final?.result==='no-actionable-options'||exec?.result==='no-actionable-options')
    return result('no-opportunity','settled','system','technical-status')
  if(exec?.result==='metadata-read-failed'||exec?.result==='creator-read-failed'||
    receipt?.result==='metadata-read-failed'||receipt?.result==='creator-read-failed'||
    tail('read-result')?.state==='rejected'){
    const rejected=tail('read-result')
    return result(rejected?.state==='rejected'?traceBlockCategory(rejected.code):'read-unavailable',
      'settled','system','local-receipt')
  }
  if(exec?.result==='failed'||exec?.result==='not-sent')
    return result('execution-failed','settled','system','local-receipt')
  if(exec?.delivery==='not-sent'||exec?.delivery==='no-send-attention-only')
    return result('local-only','settled',validChoice?'life':'system','local-receipt')
  if(exec||receipt)return result('local-result-unverified','settled','system','local-receipt')
  if(validChoice&&tail('execution-plan')?.delivery==='approval-only')
    return result('approval-review-required','unresolved','system','model-choice')
  if(validChoice)return result('choice-without-receipt','unresolved','life','model-choice')
  if(steps.some(s=>s?.type==='candidate-scan'))return result('candidates-only','candidate','system','none')
  return base
}
const safeDir=path=>{if(existsSync(path)){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Life 决策诊断目录不安全')}}
const safeFile=path=>{if(existsSync(path)){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>75000)throw Error('Life 决策诊断文件不安全')}}
export function createLifeDecisionTrace({dataDir,getAccountTag,now=Date.now,onChange=()=>{}}={}){
  if(!dataDir||typeof getAccountTag!=='function')throw TypeError('Life 决策诊断依赖缺失')
  const scope=()=>{const tag=getAccountTag();if(!SCOPE.test(String(tag||'')))throw Error('当前 Life 账号尚未核验');return createHash('sha256').update(String(tag)).digest('hex').slice(0,24)}
  const directory=()=>{
    const base=join(dataDir,ROOT);safeDir(dataDir);safeDir(base);mkdirSync(base,{recursive:true,mode:0o700})
    const dir=join(base,scope());safeDir(dir);mkdirSync(dir,{recursive:true,mode:0o700});return dir
  }
  const write=(file,row)=>{
    safeFile(file);const tmp=file+'.'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{try{rmSync(tmp,{force:true})}catch{}}
  }
  const prune=dir=>{
    const names=readdirSync(dir).filter(name=>ID.test(name.slice(0,-5))&&name.endsWith('.json'))
      .map(name=>({name,at:lstatSync(join(dir,name)).mtimeMs})).sort((a,b)=>a.at-b.at)
    for(const item of names.filter((row,i)=>i<Math.max(0,names.length-MAX_RUNS)||row.at<now()-MAX_AGE)){
      try{rmSync(join(dir,item.name),{force:true})}catch{}}
  }
  const begin=({mode='off',trigger='automatic'}={})=>{
    const dir=directory(),id=randomUUID(),account=scope(),startedAt=now()
    const file=join(dir,id+'.json')
    const row={version:1,id,at:startedAt,updatedAt:startedAt,mode:cleanCode(mode),trigger:cleanCode(trigger),state:'running',steps:[]}
    const step=(type,fields={})=>{
      if(row.steps.length>=MAX_STEPS)return
      if(scope()!==account)throw Error('Life 决策诊断账号已切换')
      row.steps.push({at:now(),type:TYPES.has(type)?type:'unknown-stage',...sanitize(fields),...(TYPES.has(type)?{}:{code:'unsupported-trace-stage'})})
      row.updatedAt=now();write(file,row);try{onChange(type)}catch{}
    }
    write(file,row);try{onChange('begin')}catch{};prune(dir)
    return {id,step,discard:()=>{if(scope()===account)rmSync(file,{force:true})},finish:fields=>{
      if(scope()!==account)return
      const result=sanitize(fields||{})
      row.state=result.state||'finished';step('finish',result)
      row.state=result.state||'finished';write(file,row)
    }}
  }
  const list=({limit=20}={})=>{
    const dir=directory(),cutoff=now()-MAX_AGE
    const records=[]
    for(const name of readdirSync(dir).filter(x=>x.endsWith('.json')&&ID.test(x.slice(0,-5))).sort().reverse().slice(0,MAX_RUNS)){
      try{const file=join(dir,name);safeFile(file);const row=JSON.parse(readFileSync(file,'utf8'))
        if(row?.version===1&&row.id===name.slice(0,-5)&&row.at>=cutoff&&row.at<=now()+60000)
          records.push(row)
      }catch{}
    }
    return {ok:true,runs:records.sort((a,b)=>b.at-a.at).slice(0,Math.max(1,Math.min(60,limit))).map(row=>({id:row.id,at:row.at,updatedAt:row.updatedAt,state:row.state,mode:row.mode,trigger:row.trigger,steps:row.steps,presentation:lifeTracePresentation(row,now()),explanation:lifeTraceExplanation(row,now())}))}
  }
  const get=id=>{
    if(!ID.test(String(id||'')))return {ok:false,error:'无效诊断 ID'}
    const dir=directory(),file=join(dir,id+'.json');if(!existsSync(file))return {ok:false,error:'没有当前账号的该次诊断'}
    safeFile(file);const row=JSON.parse(readFileSync(file,'utf8'))
    return row?.version===1&&row.id===id&&row.at>=now()-MAX_AGE?{ok:true,run:row,explanation:lifeTraceExplanation(row,now())}:{ok:false,error:'诊断已过期或不兼容'}
  }
  return {begin,list,get}
}
