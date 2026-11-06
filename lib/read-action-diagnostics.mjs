/** Diagnostics only. Never persist a platform response, message or target. */
const text=x=>String(x??'').slice(0,600).toLowerCase()
export function classifyReadFailure(result){
  const raw=typeof result==='string'?(()=>{try{return JSON.parse(result)}catch{return {}}})():result
  if(!raw||typeof raw!=='object')return {failed:false,code:''}
  const failed=raw.ok===false||raw.success===false||raw.isError===true||raw.code!==undefined&&Number(raw.code)!==0&&Number.isFinite(Number(raw.code))||typeof raw.error==='string'&&raw.error.length>0
  if(!failed)return {failed:false,code:''}
  // The Python MCP adapter returns a typed failure without raw exception text.
  // Preserve that category through the shared reservation receipt and read budget.
  // Only accept known categories; never put untrusted details in diagnostics.
  const typed={
    'metadata-rate-limited':'platform-rate-limit',
    'metadata-account-unavailable':'account-auth',
    'metadata-timeout':'platform-timeout',
    'metadata-read-busy':'reservation-held',
    'metadata-response-invalid':'invalid-response',
    'metadata-bvid-mismatch':'invalid-response',
    'metadata-title-missing':'invalid-response',
  }
  if(Object.hasOwn(typed,raw.failureCode))return {failed:true,code:typed[raw.failureCode]}
  // Only inspect a bounded message for categorization. Never return the message.
  const nested=Array.isArray(raw.content)?raw.content.find(x=>typeof x?.text==='string')?.text:''
  const msg=text([raw.error,raw.message,raw.msg,nested].filter(Boolean).join(' '))
  const code=Number(raw.platformCode??raw.code)
  if([-101,-111,-400,-401,-403].includes(code)||/(?:登录|凭据|cookie|credential|not logged|unauthori[sz]ed|session expired)/.test(msg))return {failed:true,code:'account-auth'}
  if([-352,-412,429].includes(code)||/(?:412|429|limit|风控|过于频繁|频繁|captcha|验证码|限流)/.test(msg))return {failed:true,code:'platform-rate-limit'}
  if(/(?:权限|forbidden|403|access denied)/.test(msg))return {failed:true,code:'platform-permission'}
  if(/(?:不存在|not found|404)/.test(msg))return {failed:true,code:'not-found'}
  if(/(?:timeout|timed out|超时)/.test(msg))return {failed:true,code:'platform-timeout'}
  if(/(?:参数|bad request|invalid argument)/.test(msg))return {failed:true,code:'invalid-argument'}
  return {failed:true,code:'platform-rejected-other'}
}
export function classifyReadException(error){
  const msg=text(error?.message||error)
  if(/(?:budget|cooldown|限流|频繁|风控|412|429)/.test(msg))return 'read-budget-cooldown'
  if(/(?:预约|held|reservation)/.test(msg))return 'reservation-held'
  if(/(?:账号|account|credential|登录|cookie)/.test(msg))return 'account-unavailable'
  if(/(?:timeout|timed out|超时)/.test(msg))return 'network-timeout'
  return 'transport-or-adapter-error'
}
