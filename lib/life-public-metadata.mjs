/**
 * A single strict, privacy-safe boundary for Life Agent public video metadata.
 * The Python MCP normally returns {bvid,title}; older adapters can wrap it in
 * one {data:{...}} layer. Neither a model assertion nor a search snippet is a
 * verified metadata receipt. Failure codes deliberately exclude raw API text.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const CODE=new Set(['metadata-api-error','metadata-timeout','metadata-read-busy','metadata-rate-limited',
  'metadata-account-unavailable','metadata-response-invalid','metadata-bvid-mismatch','metadata-title-missing'])
export function classifyLifeMetadataFailure(error){
  const message=String(error?.message||error?.error?.message||error?.error||error||'').slice(0,300).toLowerCase()
  const code=Number(error?.code??error?.error?.code)
  if([-352,-412,429].includes(code))return 'metadata-rate-limited'
  if([-101,-111,-401,-403].includes(code))return 'metadata-account-unavailable'
  if(/readactionheld|reservation.held|预约|占用|执行中|冲突/.test(message))return 'metadata-read-busy'
  if(/配额|额度|限流|风控|频繁|412|429|rate.limit|budget|quota/.test(message))return 'metadata-rate-limited'
  if(/账号|登录|凭证|未就绪|切换|credential|not.ready|not.logged/.test(message))return 'metadata-account-unavailable'
  if(/超时|timeout|timed.out/.test(message))return 'metadata-timeout'
  return 'metadata-api-error'
}
export function verifyLifePublicMetadata(bvid,raw){
  if(!BV.test(String(bvid||'')))return {ok:false,code:'metadata-response-invalid'}
  let value=raw
  if(typeof value==='string'){
    try{value=JSON.parse(value)}catch{return {ok:false,code:'metadata-response-invalid'}}
  }
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false,code:'metadata-response-invalid'}
  if(value.ok===false||value.error||typeof value.code==='number'&&value.code!==0)
    return {ok:false,code:classifyLifeMetadataFailure(value)}
  if(value.data!==undefined){
    if(!value.data||typeof value.data!=='object'||Array.isArray(value.data))return {ok:false,code:'metadata-response-invalid'}
    value=value.data
  }
  if(value.ok===false||value.error)return {ok:false,code:classifyLifeMetadataFailure(value.error||'platform-error')}
  if(String(value.bvid||'')!==bvid)return {ok:false,code:'metadata-bvid-mismatch'}
  const title=typeof value.title==='string'?value.title.replace(/[\u0000-\u001f\u007f]/g,' ').trim():''
  if(!title)return {ok:false,code:'metadata-title-missing'}
  return {ok:true,bvid,title:title.slice(0,100)}
}
export const lifeMetadataFailureCode=(value,expectedBvid='')=>CODE.has(value?.code)?value.code:
  value?.ok===true?(expectedBvid&&value.bvid!==expectedBvid?'metadata-bvid-mismatch':!String(value.title||'').trim()?'metadata-title-missing':''):
  classifyLifeMetadataFailure(value||'metadata-api-error')
