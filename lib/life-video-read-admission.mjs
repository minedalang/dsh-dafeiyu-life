/**
 * One Life-owned choice before a voluntary, read-only video exploration.
 * The caller supplies an already scoped, verified BV and an existing safe
 * reader. No new sender, quota or second agency vote is introduced.
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
      {id:'standard-read',kind:'explore_video',label:'普通观察这条公开视频的采样画面'},
      {id:'deep-read',kind:'explore_video',label:'深入观察这条公开视频并可复查疑点'}]
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
  const viewDepth=revisit?'deep':candidate.id==='deep-read'?'deep':candidate.id==='standard-read'?'standard':'skim'
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
