/** Bounded quick-setup adapters over the existing single config, not a second profile store. */
import {createHash} from 'node:crypto'

export const QUICK_MEMORY_PROFILES=Object.freeze({
  gentle:Object.freeze({mainSessionMemoryHalfLifeDays:24,mainSessionMemoryThreshold:.45,mainSessionMemoryMaxItems:5,mainSessionMemoryMaxChars:800,mainSessionReflectionMinCandidates:8,mainSessionReflectionBatchSize:16,mainSessionReflectionIntervalHours:6,mainSessionReflectionDailyBatches:4}),
  balanced:Object.freeze({mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:8,mainSessionMemoryMaxChars:1200,mainSessionReflectionMinCandidates:6,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16}),
  curious:Object.freeze({mainSessionMemoryHalfLifeDays:45,mainSessionMemoryThreshold:.3,mainSessionMemoryMaxItems:10,mainSessionMemoryMaxChars:1600,mainSessionReflectionMinCandidates:4,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16})
})
const memoryKeys=[...Object.keys(QUICK_MEMORY_PROFILES.balanced),'mainSessionMemoryEnabled','mainSessionReflectionAuto']
const socialKeys=['dmWatch','dmStrangerAutonomyEnabled','dmApprovalEnabled','socialOutreachEnabled','socialLifeIntentEnabled','socialAutoSend','socialVideoRecommendationsAuthorizedV2']
const snap=(cfg,keys)=>Object.fromEntries(keys.map(k=>[k,cfg?.[k]??null]))
export const quickRevision=(cfg,kind)=>createHash('sha256').update(JSON.stringify(snap(cfg,kind==='memory'?memoryKeys:socialKeys))).digest('hex').slice(0,16)
export const quickMemoryState=cfg=>({values:snap(cfg,memoryKeys),profiles:QUICK_MEMORY_PROFILES,revision:quickRevision(cfg,'memory')})
export const quickSocialState=cfg=>({values:snap(cfg,socialKeys),revision:quickRevision(cfg,'social')})
const changed=(cfg,patch)=>Object.fromEntries(Object.entries(patch).filter(([k,v])=>cfg[k]!==v).map(([k,v])=>[k,{before:cfg[k]??null,after:v}]))
export function quickMemoryPlan(cfg,body){
  if(!body||!(body.choice==='custom'||Object.hasOwn(QUICK_MEMORY_PROFILES,body.choice)))throw Error('请选择有效的记忆与反思方案')
  if(body.revision!==quickRevision(cfg,'memory'))throw Error('记忆设置已更新，请刷新后重试')
  if(body.previewOnly!==true&&body.confirm!=='APPLY_QUICK_MEMORY')throw Error('必须明确确认保存记忆设置')
  // Historical boolean arguments are intentionally ignored: these are always-on Life capabilities.
  const patch={...(body.choice==='custom'?{}:QUICK_MEMORY_PROFILES[body.choice]),mainSessionMemoryEnabled:true,mainSessionReflectionAuto:true}
  return {changed:changed(cfg,patch),patch:Object.fromEntries(Object.entries(patch).filter(([k,v])=>cfg[k]!==v)),profile:body.choice}
}
export function quickSocialPlan(cfg,body,{ready=false}={}){
  if(!body||!['dm','share'].includes(body.channel))throw Error('不支持的社交设置')
  if(body.revision!==quickRevision(cfg,'social'))throw Error('社交设置已更新，请刷新后重试')
  if(body.previewOnly!==true&&body.confirm!=='APPLY_QUICK_SOCIAL')throw Error('必须明确确认社交权限变更')
  let patch;
  if(body.channel==='dm'){
    if(!['paused','friends','free'].includes(body.choice))throw Error('不支持的私信交流方案')
    patch=body.choice==='paused'?{dmWatch:false,dmStrangerAutonomyEnabled:false,dmApprovalEnabled:false}:
      body.choice==='friends'?{dmWatch:true,dmStrangerAutonomyEnabled:false,dmApprovalEnabled:false}:
        {dmWatch:true,dmStrangerAutonomyEnabled:true,dmApprovalEnabled:false}
  }else{
    if(!['paused','autonomous'].includes(body.choice))throw Error('不支持的自主视频分享方案')
    if(body.choice==='paused')patch={socialOutreachEnabled:false,socialLifeIntentEnabled:false,socialAutoSend:false,socialVideoRecommendationsAuthorizedV2:false}
    else{
      patch={socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,socialVideoRecommendationsAuthorizedV2:true}
    }
  }
  if(!ready&&((body.channel==='dm'&&body.choice!=='paused')||(body.channel==='share'&&body.choice==='autonomous')))throw Error('先完成 B站登录与模型验证，才能启用自主社交方案')
  return {changed:changed(cfg,patch),patch:Object.fromEntries(Object.entries(patch).filter(([k,v])=>cfg[k]!==v)),channel:body.channel,choice:body.choice,permissionsChanged:true}
}
