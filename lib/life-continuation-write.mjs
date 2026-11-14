/**
 * dev.27: guarded coordinator, NOT another writing gateway or action ledger.
 * The only external sender is the already-installed Python autonomous tool,
 * using the SAME loopback Life approval, Bilibili quota, dedup & receipts.
 */
import {continuationMenu,parseContinuationDecision,CONTINUATION_WRITES,lifeWriteKinds} from './life-continuation.mjs'
import {VIDEO_ACTION_KIND} from './life-action-protocol.mjs'
const BV=/^BV[0-9A-Za-z]{10}$/
const SCOPE=/^[a-f0-9]{16}$/
const ID=/^[a-f0-9]{24}$/
export function createLifeContinuationWriteExecutor({getConfig,getAccountTag,getAccountUid,getIntention,getPublicEvidence,
  markSelected,runWriter,prepareIntent,cancelIntent,prepareBundleIntent=async()=>({ok:false}),cancelBundleIntent=()=>{},bridgeReady=()=>true,now=Date.now}={}){
  for(const f of [getConfig,getAccountTag,getAccountUid,getIntention,getPublicEvidence,markSelected,runWriter,prepareIntent,cancelIntent,bridgeReady])
    if(typeof f!=='function')throw TypeError('dev27 Life 写入执行器缺少依赖')
  const execute=async function execute(proposal,scope,{bundleProof=null,alreadySelected=false}={}){
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
    if((!bundleProof&&parseContinuationDecision(JSON.stringify(proposal),menu).action!==action)||
      (bundleProof&&(!intention?.writeBundle||bundleProof.kind!=='video_bundle'||
        !intention.writeBundle.actions.includes(action))))
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
    try{selected=alreadySelected?{ok:true}:await markSelected({bvid,title:evidence.title,scope})}catch{return {ok:false,status:'blocked',code:'selection-not-recorded'}}
    if(selected?.ok!==true)return {ok:false,status:'blocked',code:'selection-not-recorded'}
    if(!eligible()||getIntention(id)?.selectedBvid!==bvid)return {ok:false,status:'blocked',code:'authorization-changed'}
    // Reuse the *already completed* Episode model decision. The original
    // Life willingness ledger seals its exact action/BV/comment text; the
    // Python video tool only consumes that one-time ticket, never votes again.
    const uid=String(getAccountUid())
    const intent=await prepareIntent({sourceKey:'life-episode:'+id+':'+action+':'+bvid,
      kind:VIDEO_ACTION_KIND[action],target:bvid,
      commentText:action==='comment_video'?proposal.text:'',bundleProof},{scope,uid})
    if(intent?.ok!==true){
      const reason=intent?.reason||intent?.code||'life-intent-unavailable'
      return ['life-choice-in-progress','life-choice-queue-timeout','life-choice-queue-full',
        'life-admission-in-progress','life-cross-channel-rest'].includes(reason)
        ?{ok:false,status:'system-deferred',code:reason,attempted:false}
        :{ok:false,status:'blocked',code:reason,attempted:false}
    }
    // Queue admission is not an enduring grant: while another channel sends,
    // the owner may disable permissions, change account or close the Episode.
    if(!eligible()||getIntention(id)?.selectedBvid!==bvid){
      cancelIntent(intent.ticket)
      return {ok:false,status:'blocked',code:'authorization-changed-after-queue',attempted:false}
    }
    let result
    try{result=await runWriter({action,bvid,reason:proposal.reason,...(action==='comment_video'?{text:proposal.text}:{}),
      ...(action==='collect_video'?{folderTitle:proposal.folderTitle}:{})},{scope,accountUid:uid,
        intentTicket:intent.ticket})}
    catch{return {ok:false,status:'uncertain',code:'writer-outcome-unknown'}}
    finally{cancelIntent(intent.ticket)}
    // Python's raw ok is NEVER sufficient: only the existing independent
    // Life bridge's read-after-write status is a completed action.
    if(result?.status==='verified'&&result?.ok===true&&getAccountTag()===scope)
      return {ok:true,status:'verified',code:'verified-platform-write'}
    if(result?.status==='unavailable'&&result?.attempted===false)
      return {ok:false,status:'blocked',code:'writer-not-available'}
    return {ok:false,status:'uncertain',code:'write-unverified'}
  }
  execute.prepareBundle=async(proposals,scope)=>{
    if(!Array.isArray(proposals)||proposals.length<2||proposals.length>4||
      new Set(proposals.map(x=>x.action)).size!==proposals.length||
      new Set(proposals.map(x=>x.bvid)).size!==1)return {ok:false,status:'blocked',code:'bundle-invalid'}
    const first=proposals[0],id=first.id,bvid=first.bvid
    if(!ID.test(id)||!BV.test(bvid)||!SCOPE.test(String(scope||''))||getAccountTag()!==scope||
      !proposals.every(x=>x.id===id&&CONTINUATION_WRITES[x.action]))return {ok:false,status:'blocked',code:'bundle-target-invalid'}
    const intention=getIntention(id),cfg=getConfig(),eligible=continuationMenu(intention,{at:now(),
      writeActions:lifeWriteKinds(cfg,{ok:true,bvid,title:intention?.selectedTitle})})
    if(!eligible.some(x=>x.action==='write_bundle'&&x.bvid===bvid&&
      proposals.every(p=>x.allowedActions.includes(p.action))))return {ok:false,status:'blocked',code:'bundle-no-longer-offered'}
    const valid=proposals.every(p=>parseContinuationDecision(JSON.stringify(p),eligible).action===p.action)
    if(!valid)return {ok:false,status:'blocked',code:'bundle-payload-invalid'}
    return prepareBundleIntent({sourceKey:'life-episode:'+id+':bundle:'+bvid,
      actions:proposals.map(p=>({kind:VIDEO_ACTION_KIND[p.action],target:bvid,
        commentText:p.action==='comment_video'?p.text:''}))},{scope,uid:String(getAccountUid())})
  }
  execute.cancelBundle=(proof,firstChild)=>cancelBundleIntent(proof,firstChild)
  return execute
}
