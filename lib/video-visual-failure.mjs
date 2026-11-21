/** Read-only video vision runtime outcome. Do not infer observation from sampled JPEGs. */
const allowed=new Set(['ollama_service_offline','ollama_model_missing','ollama_http_error',
  'ollama_request_timeout','ollama_connection_failed'])
const messages=Object.freeze({
  ollama_service_offline:'本地 Ollama 未启动：请先启动服务，再重新进行全局分镜识图。主人局部专项尚未开始。',
  ollama_model_missing:'Ollama 已连接，但所选视觉模型未安装：请先在模型管理页安装并验收。',
  ollama_http_error:'本地 Ollama 服务返回错误：图片识别未完成，请检查模型运行状态。',
  ollama_request_timeout:'本地 Ollama 识图请求超时：请检查模型是否正在加载或设备资源是否不足。',
  ollama_connection_failed:'无法连接本地 Ollama：请检查本机服务与端口，然后重新识图。',
  vision_incomplete:'全局分镜识图未完成；主人局部专项尚未启动。',
  vision_unavailable:'视觉模型未返回有效回答；本轮不能当作已经看过画面。'
})
export function explainVideoVisionFailure(visual){
  if(!visual||typeof visual!=='object')return null
  if(visual.status==='analyzed'||visual.status==='cached')return null
  if(!['vision_incomplete','vision_unavailable'].includes(visual.status))return null
  const receipts=Array.isArray(visual.visionBoardReceipts)?visual.visionBoardReceipts:[]
  const codes=receipts.filter(x=>x?.status!=='analyzed').map(x=>x?.errorCode).filter(x=>allowed.has(x))
  const code=codes[0]||(allowed.has(visual.errorCode)?visual.errorCode:visual.status)
  return {code,message:messages[code],stage:'vision-model',boardsFailed:receipts.filter(x=>x?.status!=='analyzed').length,
    boardsTotal:receipts.length}
}
