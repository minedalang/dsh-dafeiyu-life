/** Versioned first-launch gate for both new and existing users. No data migration or reset. */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {join} from 'node:path'
const VERSION=1
const hash=x=>createHash('sha256').update(x).digest('hex')
export function createFirstStart({stateDir,credentialPath,headlessSync}){
  const stateFile=join(stateDir,'first-start-v1.json')
  const current=()=>{
    try{const obj=JSON.parse(readFileSync(stateFile,'utf8'));return obj?.version===VERSION?obj:null}catch{return null}
  }
  const save=object=>{
    mkdirSync(stateDir,{recursive:true});const tmp=stateFile+'.'+randomUUID()+'.tmp'
    writeFileSync(tmp,JSON.stringify({version:VERSION,...object},null,2),{mode:0o600});renameSync(tmp,stateFile)
  }
  const credentialDigest=()=>{
    try{if(!existsSync(credentialPath))return '';const bytes=readFileSync(credentialPath);return bytes.length&&bytes.length<131072?hash(bytes):''}catch{return ''}
  }
  // Quick Setup revision is independent of the security onboarding gate.
  // Existing installations keep all permissions and runtime readiness.
  const QUICK_SETUP_REVISION=4
  const status=()=>{
    const saved=current()||{}
    const credential=credentialDigest()
    const biliVerified=!!credential&&saved.biliCredentialHash===credential
    let headlessVerified=false
    try{headlessVerified=headlessSync.hasAnyVerified()}catch{}
    const missing=[...(!biliVerified?['B站登录验证']:[]),...(!headlessVerified?['Headless 模型同步与验证']:[])]
    const requiredReady=missing.length===0
    // Existing users must see the wizard at least once after this upgrade.
    const welcomeSeen=!!saved.welcomeSeen
    return {ok:true,version:VERSION,quickSetupRevision:QUICK_SETUP_REVISION,quickSetupSeen:(Number(saved.quickSetupSeenRevision)||0)>=QUICK_SETUP_REVISION,welcomeSeen,biliVerified,hasCredential:!!credential,headlessVerified,requiredReady,missing,
      completed:!!saved.completed&&requiredReady,welcomeCompleted:!!saved.completed,skipped:Array.isArray(saved.skipped)?saved.skipped:[]}
  }
  const verifyBili=()=>{
    const credential=credentialDigest()
    if(!credential)throw Error('尚无 B站登录凭据，请先扫码登录')
    save({...current(),biliCredentialHash:credential})
    return status()
  }
  const markWelcome=()=>{save({...current(),welcomeSeen:true});return status()}
  const acknowledgeQuickSetup=()=>{save({...current(),quickSetupSeenRevision:QUICK_SETUP_REVISION});return status()}
  const complete=skipped=>{
    if(!status().requiredReady)throw Error('请先完成 B站登录验证和 Headless 模型验证，不能跳过必需配置')
    const allowed=['main-session','life-memory','personality','social-preferences']
    if(!Array.isArray(skipped)||skipped.some(x=>!allowed.includes(x)))throw Error('未知的可选步骤')
    save({...current(),completed:true,welcomeSeen:true,quickSetupSeenRevision:QUICK_SETUP_REVISION,skipped:[...new Set(skipped)]});return status()
  }
  const message=()=>{const s=status();return s.completed?'':s.requiredReady?'快速设置还需在大肥鱼管理中心确认完成，所有业务功能暂时锁定。':'快速设置未完成：'+s.missing.join('、')+'。请打开大肥鱼管理中心 → 快速设置。'}
  return {status,verifyBili,markWelcome,acknowledgeQuickSetup,complete,message,isReady:()=>status().completed}
}
