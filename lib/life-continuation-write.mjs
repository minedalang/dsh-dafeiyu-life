/**
 * dev.27: guarded coordinator, NOT another writing gateway or action ledger.
 * The only external sender is the already-installed Python autonomous tool,
 * using the SAME loopback Life approval, Bilibili quota, dedup & receipts.
 */
import {continuationMenu,parseContinuationDecision,CONTINUATION_WRITES,lifeWriteKinds} from './life-continuation.mjs'
const BV=/^BV[0-9A-Za-z]{10}$/
const SCOPE=/^[a-f0-9]{16}$/
const ID=/^[a-f0-9]{24}$/
export function createLifeContinuationWriteExecutor({getConfig,getAccountTag,getAccountUid,getIntention,getPublicEvidence,
  markSelected,runWriter,bridgeReady=()=>true,now=Date.now}={}){
  for(const f of [getConfig,getAccountTag,getAccountUid,getIntention,getPublicEvidence,markSelected,runWriter,bridgeReady])
    if(typeof f!=='function')throw TypeError('dev27 Life 写入执行器缺少依赖')
  return async function execute(proposal,scope){
    const action=String(proposal?.action||''),id=String(proposal?.id||''),bvid=String(proposal?.bvid||'')
    if(!CONTINUATION_WRITES[action]||!ID.test(id)||!BV.test(bvid)||!SCOPE.test(String(scope||'')))
      return {ok:false,status:'blocked',code:'invalid-action'}
    const eligible=()=>{
      const cfg=getConfig(),account=getAccountTag()
      return account===scope&&getAccountUid()&&cfg.masterEnabled===true&&cfg.autonomousPlannerEnabled===true&&
        cfg.lifeAgentMode==='active'&&bridgeReady()===true&&cfg[CONTINUATION_WRITES[action]]===true
    }
    if(!eligible())return {ok:false,status:'blocked',code:'authorization-changed'}
    const intention=getIntention(id)
    const menu=continuationMenu(intention,{at:now(),writeActions:[action]})
    if(parseContinuationDecision(JSON.stringify(proposal),menu).action!==action)
      return {ok:false,status:'blocked',code:'invalid-write-proposal'}
    let evidence
    try{evidence=await getPublicEvidence(bvid,scope)}catch{return {ok:false,status:'blocked',code:'public-evidence-unavailable'}}
    if(!eligible()||getIntention(id)?.selectedBvid!==bvid)return {ok:false,status:'blocked',code:'authorization-changed'}
    if(!lifeWriteKinds(getConfig(),evidence).includes(action)||evidence.bvid!==bvid)
      return {ok:false,status:'blocked',code:'evidence-or-permission'}
    if(action==='comment_video'&&!(typeof proposal.text==='string'&&proposal.text.trim()&&proposal.text.length<=180))
      return {ok:false,status:'blocked',code:'invalid-comment'}
    // Record explicit selection through the EXISTING video ledger. A past
    // skipped/seen video cannot be silently promoted by this tool; its Python
    // autonomous writer will fail the original same-day provenance check.
    let selected
    try{selected=await markSelected({bvid,title:evidence.title,scope})}catch{return {ok:false,status:'blocked',code:'selection-not-recorded'}}
    if(selected?.ok!==true)return {ok:false,status:'blocked',code:'selection-not-recorded'}
    if(!eligible()||getIntention(id)?.selectedBvid!==bvid)return {ok:false,status:'blocked',code:'authorization-changed'}
    let result
    try{result=await runWriter({action,bvid,reason:proposal.reason,...(action==='comment_video'?{text:proposal.text}:{}),
      ...(action==='collect_video'?{folderTitle:proposal.folderTitle}:{})},{scope,accountUid:String(getAccountUid())})}
    catch{return {ok:false,status:'uncertain',code:'writer-outcome-unknown'}}
    // Python's raw ok is NEVER sufficient: only the existing independent
    // Life bridge's read-after-write status is a completed action.
    if(result?.status==='verified'&&result?.ok===true&&getAccountTag()===scope)
      return {ok:true,status:'verified',code:'verified-platform-write'}
    if(result?.status==='unavailable'&&result?.attempted===false)
      return {ok:false,status:'blocked',code:'writer-not-available'}
    return {ok:false,status:'uncertain',code:'write-unverified'}
  }
}
