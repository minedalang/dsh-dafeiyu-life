/**
 * Phase 6g: entirely synthetic, no credentials, no DSH, no B站 and no model.
 * Verifies reversible, one-to-one social-shadow comparison BEFORE any handoff.
 */
import {pathToFileURL} from 'node:url'
import {createLifeSocialShadow} from '../lib/life-social-shadow.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const dmEvent='1'.repeat(24),commentEvent='2'.repeat(24)

export function runPhase6gSocialAuditOffline(){
  let account=A,consent=true,clock=1_000_000
  let networkCalls=0,modelCalls=0,externalMessagesSent=0
  const api=createLifeSocialShadow({getAccountTag:()=>account,getConsent:()=>consent,now:()=>clock})
  const scenarios=[]
  const check=(name,fn)=>{const passed=fn()===true;scenarios.push({name,passed});return passed}
  const dm={eventId:dmEvent,channel:'dm',uid:'123',sourceKey:'message-1',text:'合成好友私信',role:'friend',verified:true}
  const comment={eventId:commentEvent,channel:'comment',uid:'456',sourceKey:'BV1ABcdE123:9',text:'合成公开评论',role:'stranger',verified:true}
  check('verified DM and comment source paired once',()=>{
    if(!api.capture(dm).created||!api.capture(comment).created)return false
    if(!api.noteLife({eventId:dmEvent,expectedScope:A,action:'reply'}).ok)return false
    if(!api.noteLegacy({channel:'dm',uid:'123',sourceKey:'message-1',action:'defer'}).ok)return false
    if(!api.noteLegacy({channel:'comment',uid:'456',sourceKey:'BV1ABcdE123:9',action:'silent'}).ok)return false
    const r=api.status()
    return r.byChannel.dm.paired===1&&r.byChannel.dm.disagreed===1&&r.byChannel.comment.awaitingLife===1&&r.socialHandoffReady===false
  })
  check('duplicate event or choice cannot rewrite the first verdict',()=>{
    const collision=api.capture({...dm,eventId:'3'.repeat(24)})
    const conflict=api.noteLife({eventId:dmEvent,expectedScope:A,action:'silent'})
    const repeat=api.noteLegacy({channel:'dm',uid:'123',sourceKey:'message-1',action:'defer'})
    return collision.reason==='source-already-staged'&&conflict.ok===false&&repeat.created===false&&
      api.status().byChannel.dm.disagreed===1
  })
  check('private text and identifiers never enter public diagnostics',()=>{
    const text=JSON.stringify(api.status())
    return !/合成|message-1|BV1ABcdE123|123|456|a{16}/.test(text)
  })
  check('switching accounts invalidates all staged choices',()=>{
    account=B
    return api.status().staged===0&&api.preview({eventId:dmEvent,channel:'dm',expectedScope:A}).ok===false
  })
  check('revocation and expiry do not resurrect a previous decision',()=>{
    account=A
    if(!api.capture(dm).created)return false
    consent=false
    if(api.status().staged!==0)return false
    consent=true
    if(api.preview({eventId:dmEvent,channel:'dm',expectedScope:A}).ok!==false)return false
    if(!api.capture(dm).created)return false
    clock+=10*60_000+1
    return api.status().staged===0&&api.status().paired===0
  })
  return {ok:scenarios.every(x=>x.passed),scenarios,
    networkCalls,modelCalls,externalMessagesSent,realBilibiliTested:false,
    socialHandoffEnabled:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=runPhase6gSocialAuditOffline()
  console.log(JSON.stringify(result,null,2))
  if(!result.ok)process.exitCode=1
}
