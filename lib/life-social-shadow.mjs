/**
 * dev.4 Phase 5: opt-in, volatile social context bridge for Life Agent shadow
 * decisions. The verified legacy receive chain alone may stage a short excerpt.
 * This is NOT a new inbox, contact index, memory, sender or authorization.
 * No identifiers or conversation contents are persisted or returned by status().
 */
import {createHash} from 'node:crypto'

const SCOPE=/^[a-f0-9]{16}$/
const EVENT=/^[a-f0-9]{24}$/
const UID=/^[1-9]\d{0,18}$/
const TTL=10*60_000,MAX=80
const channels=new Set(['dm','comment'])
const shadowActions=new Set(['reply','defer','silent'])
const plain=text=>String(text||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,420)
const lookup=(scope,channel,uid,sourceKey)=>createHash('sha256')
  .update(['life-social-shadow-v1',scope,channel,uid,sourceKey].join('\0')).digest('hex').slice(0,32)

export function parseLifeSocialShadowDecision(raw){
  let value
  try{value=JSON.parse(String(raw||'').trim())}catch{return 'invalid'}
  if(!value||typeof value!=='object'||Array.isArray(value)||!shadowActions.has(value.action)||Object.keys(value).length!==1)return 'invalid'
  // No model-authored contacts, send instructions, goals, identifiers or prose
  // are consumed here. This is a categorical dry-run choice only.
  return value.action
}

export function createLifeSocialShadow({getAccountTag,getConsent,now=Date.now}={}){
  if(typeof getAccountTag!=='function'||typeof getConsent!=='function')throw TypeError('Social shadow needs live account and opt-in providers')
  const staged=new Map(),byKey=new Map()
  const scope=()=>String(getAccountTag()||'')
  let lastScope=scope()
  const consent=()=>getConsent()===true
  const prune=()=>{
    const current=scope()
    if(current!==lastScope){staged.clear();byKey.clear();lastScope=current}
    if(!consent()){staged.clear();byKey.clear();return}
    const cutoff=now()-TTL
    for(const [id,row] of staged)if(row.at<cutoff||row.at>now()+60_000){staged.delete(id);byKey.delete(row.key)}
    while(staged.size>MAX){const id=staged.keys().next().value,row=staged.get(id);staged.delete(id);byKey.delete(row.key)}
  }
  const capture=({eventId,channel,uid,sourceKey,text,role,verified=false}={})=>{
    prune();const current=scope()
    if(!consent())return {ok:false,reason:'not-opted-in'}
    if(!SCOPE.test(current))return {ok:false,reason:'account-not-ready'}
    if(verified!==true||!EVENT.test(String(eventId||''))||!channels.has(channel)||!UID.test(String(uid||''))||
       typeof sourceKey!=='string'||!sourceKey||sourceKey.length>180||
       !(channel==='dm'?role==='friend':['friend','stranger'].includes(role)))
      return {ok:false,reason:'unverified-or-ineligible'}
    const excerpt=plain(text)
    if(!excerpt)return {ok:false,reason:'no-content'}
    const key=lookup(current,channel,String(uid),sourceKey)
    // Never move an already verified event to another origin.
    if(staged.has(eventId)&&staged.get(eventId).key!==key)return {ok:false,reason:'event-collision'}
    if(staged.has(eventId))return {ok:true,created:false}
    staged.set(eventId,{key,scope:current,channel,at:now(),excerpt,life:'',legacy:''})
    byKey.set(key,eventId);prune()
    return {ok:true,created:true}
  }
  const preview=({eventId,channel,expectedScope}={})=>{
    prune();const current=scope()
    if(!consent())return {ok:false,reason:'not-opted-in'}
    if(current!==expectedScope||!SCOPE.test(current))return {ok:false,reason:'account-changed'}
    const row=staged.get(eventId)
    if(!row||row.scope!==current||row.channel!==channel||!EVENT.test(String(eventId||'')))
      return {ok:false,reason:'verified-context-expired'}
    return {ok:true,channel:row.channel,excerpt:row.excerpt}
  }
  const noteLife=({eventId,expectedScope,action}={})=>{
    prune();if(!consent()||scope()!==expectedScope||!shadowActions.has(action))return {ok:false}
    const row=staged.get(eventId)
    if(!row||row.scope!==expectedScope)return {ok:false}
    row.life=action;return {ok:true,paired:!!row.legacy}
  }
  const noteLegacy=({channel,uid,sourceKey,action}={})=>{
    prune();const current=scope()
    if(!consent()||!SCOPE.test(current)||!channels.has(channel)||!UID.test(String(uid||''))||
      typeof sourceKey!=='string'||!sourceKey||!shadowActions.has(action))return {ok:false}
    const id=byKey.get(lookup(current,channel,String(uid),sourceKey)),row=staged.get(id)
    if(!row||row.scope!==current)return {ok:false}
    row.legacy=action;return {ok:true,paired:!!row.life}
  }
  const revoke=()=>{staged.clear();byKey.clear()}
  const status=()=>{
    prune();const current=scope(),rows=[...staged.values()].filter(x=>x.scope===current&&SCOPE.test(current))
    const paired=rows.filter(x=>x.life&&x.legacy)
    return {enabled:consent(),mode:'read-only-shadow',retentionMinutes:10,staged:rows.length,
      lifeChoices:rows.filter(x=>x.life).length,legacyChoices:rows.filter(x=>x.legacy).length,
      paired:paired.length,disagreed:paired.filter(x=>x.life!==x.legacy).length,
      note:'仅本进程 10 分钟内的合成决策统计，不含对话内容；不等于发送或平台回执'}
  }
  return {capture,preview,noteLife,noteLegacy,status,revoke}
}

export function classifyLegacySocialDecision(result){
  if(typeof result==='string')return result.trim()&&result!=='SKIP'?'reply':'silent'
  if(result&&typeof result==='object'){
    if(result.action==='reply'&&Array.isArray(result.messages)&&result.messages.some(x=>String(x).trim()))return 'reply'
    if(result.action==='defer')return 'defer'
    if(['skip','close'].includes(result.action))return 'silent'
  }
  return 'invalid'
}
