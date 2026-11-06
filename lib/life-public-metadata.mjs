/**
 * Verified public video information, shared by Life's read-only paths.
 * Python's video-info tool emits only finite diagnostic fields on failure;
 * an old MCP error or a JS exception may still arrive as unstructured text.
 * Never persist raw tool errors, URLs, identifiers or response bodies.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const CODE=new Set(['metadata-api-error','metadata-timeout','metadata-read-busy','metadata-rate-limited',
  'metadata-account-unavailable','metadata-response-invalid','metadata-bvid-mismatch','metadata-title-missing'])
const ORIGINS=new Set(['python-bili-video-info','mcp-adapter','platform-read-gate','response-validation'])
const LAYERS=new Set(['platform','python-adapter','python-response','mcp-transport','platform-read-gate','response-validation'])
const errorText=error=>{
  const raw=error?.message??error?.error?.message??error?.error??error?.msg??error
  if(typeof raw==='object')return ''
  return String(raw??'').slice(0,320).toLowerCase()
}
const safePlatformCode=value=>{
  if(value===null||value===undefined||typeof value==='boolean'||String(value).trim()==='')return 0
  const number=Number(value)
  return Number.isSafeInteger(number)&&number!==0&&Math.abs(number)<=99999?number:0
}
export function classifyLifeMetadataFailure(error){
  if(CODE.has(error?.failureCode))return error.failureCode
  if(CODE.has(error?.code))return error.code
  const message=errorText(error)
  const platformCode=safePlatformCode(error?.platformCode)||safePlatformCode(error?.code)||safePlatformCode(error?.error?.code)
  if([-352,-412,429].includes(platformCode))return 'metadata-rate-limited'
  if([-101,-111,-401,-403].includes(platformCode))return 'metadata-account-unavailable'
  if(error?.status==='reservation-held'||error?.status==='reservation-unavailable'){
    return /账号|凭据|credential|account/.test(message)?'metadata-account-unavailable':'metadata-read-busy'
  }
  if(/readactionheld|reservation.held|预约|占用|执行中|冲突/.test(message))return 'metadata-read-busy'
  if(/配额|额度|限流|风控|频繁|\b-?412\b|\b429\b|rate.limit|budget|quota/.test(message))return 'metadata-rate-limited'
  if(/账号|登录|凭证|未就绪|切换|credential|not.ready|not.logged|unauthori[sz]ed/.test(message))return 'metadata-account-unavailable'
  if(/超时|timeout|timed.out/.test(message))return 'metadata-timeout'
  return 'metadata-api-error'
}
export function lifeMetadataDiagnostics(value,expectedBvid=''){
  // Public metadata failures can contain a known numeric platform code. No
  // exception text, BV, credential or link may enter the debug journal.
  const code=lifeMetadataFailureCode(value,expectedBvid)
  const origin=ORIGINS.has(value?.diagnosticOrigin)?value.diagnosticOrigin:
    (value?.source==='mcp-adapter'?'mcp-adapter':value?.status?.startsWith?.('reservation-')?'platform-read-gate':'response-validation')
  const layer=LAYERS.has(value?.failureLayer)?value.failureLayer:
    (origin==='mcp-adapter'?'mcp-transport':origin==='platform-read-gate'?'platform-read-gate':'response-validation')
  const platformCode=safePlatformCode(value?.platformCode)||safePlatformCode(value?.code)
  return {code,origin,layer,...(platformCode?{platformCode}:{})}
}
export function verifyLifePublicMetadata(bvid,raw){
  if(!BV.test(String(bvid||'')))return {ok:false,code:'metadata-response-invalid',diagnosticOrigin:'response-validation'}
  let value=raw
  if(typeof value==='string'){
    try{value=JSON.parse(value)}catch{return {ok:false,code:'metadata-response-invalid',diagnosticOrigin:'response-validation'}}
  }
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,code:'metadata-response-invalid',diagnosticOrigin:'response-validation'}
  if(value.ok===false||value.error||value.failureCode||typeof value.code==='number'&&value.code!==0){
    return {ok:false,...lifeMetadataDiagnostics(value,bvid),diagnosticOrigin:
      ORIGINS.has(value.diagnosticOrigin)?value.diagnosticOrigin:'response-validation',failureLayer:
      LAYERS.has(value.failureLayer)?value.failureLayer:'response-validation'}
  }
  if(value.data!==undefined){
    if(!value.data||typeof value.data!=='object'||Array.isArray(value.data))return {ok:false,code:'metadata-response-invalid',diagnosticOrigin:'response-validation'}
    value=value.data
  }
  if(value.ok===false||value.error||value.failureCode)return {ok:false,...lifeMetadataDiagnostics(value,bvid),diagnosticOrigin:
    ORIGINS.has(value.diagnosticOrigin)?value.diagnosticOrigin:'response-validation'}
  if(String(value.bvid||'')!==bvid)return {ok:false,code:'metadata-bvid-mismatch',diagnosticOrigin:'response-validation'}
  const title=typeof value.title==='string'?value.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim():''
  if(!title)return {ok:false,code:'metadata-title-missing',diagnosticOrigin:'response-validation'}
  return {ok:true,bvid,title:title.slice(0,100)}
}
export const lifeMetadataFailureCode=(value,expectedBvid='')=>CODE.has(value?.code)?value.code:
  value?.ok===true?(expectedBvid&&value.bvid!==expectedBvid?'metadata-bvid-mismatch':!String(value.title||'').trim()?'metadata-title-missing':''):
  classifyLifeMetadataFailure(value||'metadata-api-error')
