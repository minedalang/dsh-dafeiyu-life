/**
 * Current Bilibili identity is transport state, never an autobiographical fact.
 * Do NOT rewrite, migrate or resurrect faded episodes. Historical UID facts may
 * remain searchable, but they cannot impersonate the currently verified account.
 */
const UID=/^[1-9]\d{0,18}$/
const uid=v=>UID.test(String(v||''))?String(v):''
const trim=(v,n=100)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n)
const selfClaim=/(?:我的|我自己的|鱼鱼的|大肥鱼的|本鱼的|本人(?:在B站)?的|自己(?:在B站)?的|我(?:现在|以前|曾经)?在?B站的?)(?:.{0,22})(?:B站|bilibili|账号|账户|UID|uid|用户ID|个人空间)/i
const identityKey=/(?:^|[.。_])(?:身份|账号|账户|B站|bilibili|大肥鱼|鱼鱼).*(?:UID|uid|B站|bilibili|账号|账户)|^(?:我的|本人).*(?:UID|账号|B站)/i
export const currentAccountSnapshot=(getAccount=()=>null)=>{
  let raw;try{raw=getAccount()}catch{return {activeUid:'',oldUids:[],blocked:true,available:false,reason:'unavailable'}}
  if(!raw||typeof raw!=='object')return {activeUid:'',oldUids:[],blocked:false,available:false,reason:'unavailable'}
  const activeUid=uid(raw?.activeUid)
  const bound=(Array.isArray(raw?.boundAccounts)?raw.boundAccounts:[]).map(x=>uid(x?.uid)).filter(Boolean)
  const oldUids=[...new Set(bound.filter(x=>x!==activeUid))]
  return {activeUid,oldUids,available:true,blocked:raw?.blocked===true,reason:trim(raw?.reason,45)}
}
export function isSelfBiliAccountFact(m,knownUids=[]){
  const text=trim(m?.text,3000),key=trim(m?.事实键||m?.fact_key,200)
  return knownUids.some(x=>text.includes(String(x)))&&(identityKey.test(key)||selfClaim.test(text))
}
export function historicalAccountMemoryRows(rows=[],account={}){
  const old=Array.isArray(account.oldUids)?account.oldUids:[]
  if(!old.length)return rows
  return rows.map(m=>isSelfBiliAccountFact(m,old)
    ?{...m,text:'【历史B站账号资料；不是当前登录账号UID】'+String(m.text||''),accountHistorical:true}
    :m)
}
export function accountMemoryHint(account={},query='',selectedMemories=[]){
  if(account.available===false)return ''
  const q=trim(query,600)
  const topic=/(?:B站|bilibili|账号|账户|UID|uid|换号|登录|自己的身份|我的身份|以前的我|我是谁)/i.test(q)
  const history=selectedMemories.some(m=>m?.accountHistorical===true)
  if(!topic&&!history)return ''
  const current=uid(account.activeUid)
  const status=account.blocked?'；账号运行已冻结，不能依据记忆中的旧UID执行平台操作':''
  return '【当前B站账号身份｜来自本地账号绑定账本，不是人生记忆】\n'
    +(current?'当前绑定UID：'+current:'当前没有已绑定的B站账号')
    +'；旧账号UID若出现在历史记忆中，仅代表曾经的经历，不能当作当前登录账号，也不能据此授权对外操作'+status+'。'
}
