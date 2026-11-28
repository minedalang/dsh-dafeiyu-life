/** Read-only video vision runtime outcome. Do not infer observation from sampled JPEGs. */
const allowed=new Set(['ollama_service_offline','ollama_model_missing','ollama_http_error',
  'ollama_request_timeout','ollama_connection_failed',
  'vision_board_deadline','vision_board_time_mismatch','vision_board_grid_mismatch',
  'vision_board_truncated','vision_board_empty_answer','vision_board_unsegmented',
  'vision_board_unclassified'])
const messages=Object.freeze({
  ollama_service_offline:'本地 Ollama 未启动：请先启动服务，再重新进行分镜识图。',
  ollama_model_missing:'Ollama 已连接，但所选视觉模型未安装：请先在模型管理页安装并验收。',
  ollama_http_error:'本地 Ollama 服务返回错误：图片识别未完成，请检查模型运行状态。',
  ollama_request_timeout:'本地 Ollama 识图请求超时：请检查模型是否正在加载或设备资源是否不足。',
  ollama_connection_failed:'无法连接本地 Ollama：请检查本机服务与端口，然后重新识图。',
  vision_incomplete:'分镜识图未完成，未形成可信画面证据。',
  vision_board_deadline:'本次分镜总时限已用尽，仍有画面未完成识别。',
  vision_board_time_mismatch:'分镜文字的时间码与实际采样画面不一致，已拒绝作为视觉证据。',
  vision_board_grid_mismatch:'模型漏掉部分画面格号或使用了错误格号，已拒绝完整视觉证据。',
  vision_board_truncated:'模型输出不完整或达到生成额度，分镜不能视为已看完。',
  vision_board_empty_answer:'模型没有提供可用的画面描述，未形成视觉证据。',
  vision_board_unsegmented:'模型混合了多张拼图，无法分别核验；未得到可用的完整回执。',
  vision_board_unclassified:'视觉模型调用或分镜核验未完成，原因尚未分类。',
  vision_unavailable:'视觉模型未返回有效回答；本轮不能当作已经看过画面。'
})
export function trustedVideoVisionErrorCode(code){
  return allowed.has(code)?code:null
}
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
