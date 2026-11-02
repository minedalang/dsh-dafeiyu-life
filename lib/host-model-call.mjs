/**
 * Tool-free one-shot calls through the HOST's already-configured DSH LLM runtime.
 * No headless profile, model configuration copy, API key copy or model-facing tools.
 * Explicit routes never silently fall back to another paid provider.
 */
export function hostLlmService(ctx) {
  let llm
  try { llm = ctx?.get?.('llm') || ctx?.llm } catch { llm = ctx?.llm }
  return llm && typeof llm.stream === 'function' ? llm : null
}

export function resolveHostModelRoute(selection = {}, custom = {}) {
  const provider = String(custom.provider || selection?.provider || selection?.providerId || '').trim()
  const model = String(custom.model || selection?.model || selection?.modelId || '').trim()
  let reasoningEffort = String(custom.reasoningEffort || selection?.reasoningEffort || '').trim()
  if (reasoningEffort.startsWith('"')) {
    try { const parsed = JSON.parse(reasoningEffort); if (typeof parsed === 'string') reasoningEffort = parsed }
    catch { /* validation below */ }
  }
  if (!provider || !model) throw Error('当前 DSH 没有可用的默认 Provider/模型 ID，请先在 DSH 模型设置中选择模型')
  if ([provider, model, reasoningEffort].some(s => /[\r\n\0]/.test(s))) throw Error('模型字段格式错误')
  if (reasoningEffort.startsWith('{') || reasoningEffort.startsWith('[')) {
    throw Error('宿主直接模型调用只支持字符串思考深度，请在模型设置中选择普通档位')
  }
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
}

export async function runHostModelText({ llm, selection, custom, prompt, maxChars = 4500, timeoutMs = 120_000 }) {
  if (!llm || typeof llm.stream !== 'function') throw Error('DSH 宿主模型服务尚未就绪')
  const route = resolveHostModelRoute(selection, custom)
  // listProviders returns actually registered adapters, not merely saved model names.
  if (typeof llm.listProviders === 'function') {
    const active = llm.listProviders()
    if (Array.isArray(active) && !active.some(p => (typeof p === 'string' ? p : p?.id) === route.provider)) {
      throw Error(`DSH 当前未注册模型提供方「${route.provider}」（NO_ADAPTER）。请先在 DSH 的 Models 页面修复该提供方；插件不会偷偷切换模型。`)
    }
  }
  const text = String(prompt ?? '')
  if (!text.trim() || text.length > 180_000) throw Error('模型输入为空或过长')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(300_000, timeoutMs)))
  timeout.unref?.()
  let answer = ''
  let blockText = ''
  let finish = null
  try {
    // Critical: NO tools or tool history. This is not an agent turn and cannot
    // access filesystem, Bilibili MCP, browser or the main session's tools.
    const request = {
      ...route,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      tools: [],
      signal: controller.signal,
    }
    for await (const chunk of llm.stream(request)) {
      if (chunk?.type === 'text-delta') answer += String(chunk.text || '')
      else if (chunk?.type === 'block-end' && chunk.block?.type === 'text') blockText += String(chunk.block.text || '')
      else if (chunk?.type === 'tool-call-delta' || (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call')) {
        throw Error('无工具模型请求返回了工具调用，已拒绝执行')
      }
      else if (chunk?.type === 'finish') { finish = chunk.reason; break }
      if (answer.length > Math.max(12_000, maxChars * 4)) throw Error('模型输出超出安全长度限制')
    }
    if (controller.signal.aborted) throw Error('DSH 宿主模型请求超时')
    if (!finish || !['stop', 'max-tokens'].includes(finish.kind)) {
      const detail = finish?.failure?.message || finish?.failure?.code || finish?.kind || '没有收到完成标记'
      throw Error('DSH 宿主模型调用失败：' + String(detail).slice(0, 280))
    }
    if (finish.kind === 'max-tokens') throw Error('模型输出达到 token 上限，结果可能不完整，已拒绝使用')
    const result = (answer || blockText).trim().slice(0, maxChars)
    if (!result) throw Error('DSH 宿主模型返回空内容')
    return result
  } catch (e) {
    if (controller.signal.aborted) throw Error('DSH 宿主模型请求超时')
    throw e
  } finally {
    clearTimeout(timeout)
  }
}
