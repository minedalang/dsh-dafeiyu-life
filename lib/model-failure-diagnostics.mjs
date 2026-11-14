/** Stable, owner-safe model failure fingerprint. Never surface upstream raw bodies,
 * headers, prompt text, API keys or remote endpoint URLs. */
export function modelFailureEvidence(error){
  const source=String(error?.message||error||'').slice(0,2400)
  const lower=source.toLowerCase()
  const status=/\b(?:http|status|code)[\s:=#-]*(401|403|408|429|500|502|503|504)\b/i.exec(source)
    ||/\b(?:bad_response_status_code|bad response status code)\s*(401|403|408|429|500|502|503|504)\b/i.exec(source)
    ||/\b(401|403|408|429|500|502|503|504)\b/.exec(source)
  const httpStatus=status?Number(status[1]):0
  const transport=/\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNABORTED)\b/i.exec(source)
  const providerType=/["']type["']\s*:\s*["']([a-z_]{2,60})["']/i.exec(source)
  const request=/\brequest[ _-]?id\s*[:=#]?\s*([a-z0-9_-]{8,64})/i.exec(source)
  const category=httpStatus===429||/rate.?limit|too many requests|限流/.test(lower)?'rate-limited':
    [401,403].includes(httpStatus)||/unauthorized|invalid.*key|认证/.test(lower)?'authentication':
    [502,503,504,500].includes(httpStatus)||/bad gateway|service unavailable|gateway timeout|bad_response_status_code/.test(lower)?'upstream-gateway':
    httpStatus===408||/timed? ?out|etimedout|超时/.test(lower)?'timeout':
    transport||/\bdns\b|\bnetwork\b|\bsocket\b|\bconnection reset\b|连接失败|网络错误/.test(lower)?'network':
    'provider-unavailable'
  return {category,httpStatus,transportCode:transport?transport[1].toUpperCase():'',
    providerErrorType:providerType?providerType[1]:'',requestId:request?request[1]:''}
}
export const modelFailureExplanation=({category,httpStatus=0}={})=>({
  'upstream-gateway':`模型服务中转／上游返回 ${httpStatus||'5xx'}。属于服务端网关或上游异常响应；无法仅凭此错误确定具体故障节点，也不代表本机断网。`,
  'rate-limited':'模型服务或中转站限流；可能需等待供应商允许再次请求。',
  'authentication':'模型服务身份认证或权限未通过，请核对 DSH 中的 Provider 配置。',
  'timeout':'模型请求超时；无法仅凭超时区分本地网络、中转站与上游超时。',
  'network':'模型请求传输／DNS／连接发生错误；不代表已确认整个网络断线。',
  'provider-unavailable':'模型请求失败，但没有足够的可公开证据区分中转站、供应商、模型或协议故障。',
})[category]||'模型请求失败，具体原因无法确定。'
export function modelTestFailure(error){
  const evidence=modelFailureEvidence(error)
  return { ...evidence, explanation:modelFailureExplanation(evidence),
    // Safe diagnostics only: no upstream response body or secret URLs.
    error: ['模型连接测试失败：'+modelFailureExplanation(evidence),
      evidence.providerErrorType?'返回类型 '+evidence.providerErrorType:'',
      evidence.transportCode?'传输码 '+evidence.transportCode:'',
      evidence.requestId?'请求 ID '+evidence.requestId:''].filter(Boolean).join(' · ')}
}
