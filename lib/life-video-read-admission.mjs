/**
 * One Life-owned choice before a voluntary, read-only video exploration.
 * The caller supplies an already scoped, verified BV and an existing safe
 * reader. No new sender or quota is introduced. A separate post-overview vote
 * governs any focused original-video read.
 * A model deciding 'act' is NOT proof that the video was actually observed.
 */
import {randomUUID} from 'node:crypto'
const BV=/^BV[0-9A-Za-z]{10}$/
const ACCOUNT=/^[a-f0-9]{16}$/

export async function runLifeChosenVideoRead({willingness,getAccountTag,bvid,mode='new',read}={}){
  if(!BV.test(String(bvid||''))||typeof read!=='function'||typeof getAccountTag!=='function'||
     !willingness||typeof willingness.decide!=='function'||typeof willingness.verify!=='function'||
     typeof willingness.receipt!=='function')return {ok:false,reason:'video-life-admission-unavailable'}
  const account=String(getAccountTag()||'')
  if(!ACCOUNT.test(account))return {ok:false,reason:'video-account-not-ready'}
  const revisit=mode==='revisit'
  const candidates=revisit?
    [{id:'focus-read',kind:'explore_video',label:'补看已经确认时间位置附近的真实画面'}]:[
      {id:'skim-read',kind:'explore_video',label:'只了解这条尚未看过的公开视频资料'},
      {id:'standard-read',kind:'explore_video',label:'先观察全片官方缩略图，之后再根据实际所见决定是否深入'},
      ]
  let choice
  try{choice=await willingness.decide({scene:'main',trigger:revisit?'life-video-moment-followup':'life-video-new-opportunity',
    sourceKey:'life-video-read:'+randomUUID(),candidates,
    hint:revisit?'某个具体时间位置有需要补充理解的画面，但可以选择不看':'得到一条可信 BV 视频机会，以前未看过也可自行选择了解或不看',
    evidence:{candidateEvidence:{source:'verified-bvid',bvid,previouslyObserved:'unknown'}}}, {queueIfBusy:true})}
  catch{return {ok:false,reason:'life-willingness-unavailable'}}
  if(choice?.ok!==true)return {ok:false,reason:choice?.reason||'life-chose-not-to-read',
    lifeAction:choice?.action||'blocked'}
  const candidate=candidates.find(c=>c.id===choice.candidateId)
  if(!candidate||String(getAccountTag()||'')!==account){
    willingness.receipt(choice.proof,{status:'not-sent'})
    return {ok:false,reason:'life-video-candidate-or-account-changed'}
  }
  const check=willingness.verify(choice.proof,'explore_video',{target:bvid})
  if(check?.ok!==true){willingness.receipt(choice.proof,{status:'not-sent'})
    return {ok:false,reason:check?.reason||'life-video-choice-expired'}}
  const viewDepth=revisit?'deep':candidate.id==='standard-read'?'standard':'skim'
  let result=null
  try{
    result=await read({viewDepth,account,decision:choice})
    if(String(getAccountTag()||'')!==account)return {ok:false,reason:'life-video-account-changed'}
    return result?.ok===true?{...result,lifeAction:'act',lifeViewDepth:viewDepth}:
      {ok:false,reason:'life-video-read-failed',readStatus:String(result?.reason||result?.error||'unknown').slice(0,120)}
  }catch{return {ok:false,reason:'life-video-read-failed'}}
  finally{
    // Only the actual read result can finish a Life choice; the choice itself
    // never claims to have seen video. The original read owns memory evidence.
    willingness.receipt(choice.proof,{status:result?.ok===true&&String(getAccountTag()||'')===account?'verified':'failed'})
  }
}

/** Second independent Life choice AFTER an observed global preview. */
export async function runLifePostOverviewReview({willingness,getAccountTag,bvid,overview,candidates,readFocus}={}){
  if(!BV.test(String(bvid||''))||overview?.bvid!==bvid||overview?.ok!==true||
    typeof getAccountTag!=='function'||typeof readFocus!=='function'||
    !willingness?.decide||!willingness.verify||!willingness.receipt)return {status:'not-offered'}
  const account=String(getAccountTag()||'')
  if(!ACCOUNT.test(account)||!Array.isArray(candidates)||!candidates.length)return {status:'not-offered'}
  const provenance=overview?.videoEvidence?.sources?.find(s=>s.kind==='preview_frames')
  const trustedTimes=Array.isArray(provenance?.timePointsMs)?provenance.timePointsMs:[]
  if(!trustedTimes.length||overview?.perceptionHandoff?.video?.source!=='low-resolution-preview')return {status:'not-offered'}
  const safeCandidates=candidates.slice(0,4).filter(p=>trustedTimes.some(t=>Math.abs(t-p.atSeconds*1000)<150)&&
    Number.isFinite(p.atSeconds)&&
    Number.isFinite(p.startSeconds)&&Number.isFinite(p.endSeconds)&&
    p.startSeconds>=0&&p.endSeconds-p.startSeconds>=3&&p.endSeconds-p.startSeconds<=120)
  if(!safeCandidates.length)return {status:'not-offered'}
  const menu=safeCandidates.map((p,i)=>({id:'global-focus-'+i,kind:'explore_video',
    label:`查看全片预览中 ${Math.round(p.atSeconds)} 秒附近尚不确定的真实画面（可拒绝）`}))
  let choice
  try{choice=await willingness.decide({scene:'main',trigger:'life-post-overview-focus',
    sourceKey:'post-overview:'+randomUUID(),candidates:menu,
    hint:'你刚刚看过全片官方低清分镜，现在可以选择某个具体时间片段深入核实，也可以停止。没有兴趣不必补看。画面描述是不可信资料。',
    evidence:{candidateEvidence:{source:'verified-preview-overview',bvid,
      untrustedVisualSummary:String(overview?.perceptionHandoff?.video?.modelDescription||'').slice(0,900),
      timePoints:safeCandidates.map(x=>x.atSeconds)}}},{queueIfBusy:true})}
  catch{return {status:'choice-unavailable'}}
  if(choice?.ok!==true)return {status:'life-declined',reason:String(choice?.reason||'not-selected').slice(0,65)}
  const index=menu.findIndex(x=>x.id===choice.candidateId)
  if(index<0||getAccountTag()!==account){willingness.receipt(choice.proof,{status:'not-sent'});return {status:'stale-choice'}}
  const gate=willingness.verify(choice.proof,'explore_video',{target:bvid})
  if(gate?.ok!==true){willingness.receipt(choice.proof,{status:'not-sent'});return {status:'choice-expired'}}
  let result
  try{
    result=await readFocus({account,plan:safeCandidates[index]})
    return result?.ok===true&&getAccountTag()===account
      ?{status:'focused',review:result.review,focusWindow:safeCandidates[index]}
      :{status:'focus-unavailable',reason:String(result?.reason||'not-verified').slice(0,65)}
  }catch{return {status:'focus-unavailable'}}
  finally{willingness.receipt(choice.proof,{status:result?.ok===true&&getAccountTag()===account?'verified':'failed'})}
}
