import {createHash} from 'node:crypto'
import {lifeSettingsV2} from './life-settings-control.mjs'
export const interactionRepliesAllowed=(c={})=>c.interactionRepliesEnabled===undefined||c.interactionRepliesEnabled===true
export function runtimeControls(c={},scope='',ready=false,masterAvailable=ready){
 const life=lifeSettingsV2(c), replies=interactionRepliesAllowed(c)
 return {lifeMode:life.mode,lifeEnabled:life.mode==='active'&&life.plannerEnabled,lifeRunning:life.mode==='active'&&life.plannerEnabled&&life.masterEnabled&&ready,
  repliesEnabled:replies,repliesAvailable:replies&&life.masterEnabled&&ready,masterEnabled:life.masterEnabled,ready:ready===true,masterAvailable:masterAvailable===true,
  revision:createHash('sha256').update(JSON.stringify([life.revision,replies,scope,ready,masterAvailable])).digest('hex').slice(0,24)}
}
export function planRuntimeControl(c,body,scope,ready,masterAvailable=ready){
 const state=runtimeControls(c,scope,ready,masterAvailable)
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['control','enabled','revision'].includes(k))||
  !['master','life','replies'].includes(body.control)||typeof body.enabled!=='boolean'||body.revision!==state.revision)throw Error('控制状态已变化或参数无效，请刷新后重试')
 if(body.control==='master'){
  if(body.enabled&&!state.masterAvailable)throw Error('请先完成 B站平台及必要设置核验')
  return {masterEnabled:body.enabled}
 }
 if(body.enabled&&(!ready||!state.masterEnabled))throw Error('请先完成当前账号、模型与总开关检查')
 return body.control==='replies'?{interactionRepliesEnabled:body.enabled}:{lifeAgentMode:body.enabled?'active':'off',autonomousPlannerEnabled:body.enabled,peakValley:false}
}
export function isReplyDispatch(tool,args={}){
 return ['bili_send_message','bili_send_observation_image','bili_send_message_manual','bili_reply_existing_dm_manual','bili_dynamic_reply_inbox'].includes(tool)||
  (['bili_reply','bili_reply_manual'].includes(tool)&&(Number(args.rpid)>0||Number(args.root)>0))||
  (tool==='bili_dynamic_comment_manual'&&(Number(args.target_rpid)>0||Number(args.root)>0))
}
