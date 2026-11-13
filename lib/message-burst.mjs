import { randomUUID } from 'node:crypto'

export const MESSAGE_BURST_MAX = 3

const cleanText = (value, maxChars) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, maxChars)

/** Normalize every chat surface to the same 1–3 message contract. */
export function normalizeMessageBurst(value, {
  maxMessages = MESSAGE_BURST_MAX,
  maxChars = 450,
  minMessages = 1,
  fallbackText = '',
} = {}) {
  const cap = Math.max(1, Math.min(MESSAGE_BURST_MAX, Math.floor(Number(maxMessages) || MESSAGE_BURST_MAX)))
  const min = Math.max(1, Math.min(cap, Math.floor(Number(minMessages) || 1)))
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.messages)
      ? value.messages
      : null
  const raw = source ?? [typeof value === 'string' ? value : (value?.text ?? value?.reply ?? fallbackText)]
  const messages = raw.map(x => cleanText(x, maxChars)).filter(Boolean).slice(0, cap)
  return messages.length >= min ? messages : []
}

/** Shared model-facing contract used by P6-A, owner DM, and the main Session. */
export function messageBurstInstruction({
  maxMessages = MESSAGE_BURST_MAX,
  maxChars = 450,
  context = 'chat',
  requireArray = false,
} = {}) {
  const cap = Math.max(1, Math.min(MESSAGE_BURST_MAX, Math.floor(Number(maxMessages) || MESSAGE_BURST_MAX)))
  const guidance = cap === 1
    ? '当前只允许一条自然回复；不要强行分段。'
    : `有两个以上有内容的意思时，优先写成 2–${cap} 条轻松、连贯的气泡，而不是默认揉成一大段；但简短回答、自然收尾或沉默时允许仅一条或不回复。`
  const shape = requireArray
    ? `必须输出 messages 数组，包含 1–${cap} 条`
    : `需要多条时输出 messages 数组（1–${cap} 条）；只有一条时可使用 text 或 reply`
  return `【统一自然多气泡协议｜${context}】${shape}。请在本轮内部依次完成三个步骤，不输出步骤或分析过程：①先决定是否回应以及真正想表达的内容；②再看其中是否有两三个可独立说出的自然语义点，决定气泡数量与顺序；③最后按所需格式返回完整气泡。
${guidance}每条必须有具体内容、能单独成立、自然承接，最多 ${maxChars} 字；不得按标点或固定长度拆分，不得为了凑数拆半句话、重复或强行寒暄。数组顺序就是发送顺序；本地只执行你已组织好的气泡，不擅自改写和切割。不得在正文中显示编号、JSON、步骤或后台规则。`;
}

/**
 * Sequential transport-neutral sender. A failed/unknown send is never retried here:
 * callers own durable reservations and channel-specific receipts.
 */
export async function deliverMessageBurst({
  messages,
  send,
  beforeSend,
  onConfirmed,
  nextMessage,
  signal,
} = {}) {
  const planned = normalizeMessageBurst(messages, { maxMessages: MESSAGE_BURST_MAX, maxChars: 450 })
  if (!planned.length) return { status: 'empty', planned: 0, attempted: 0, confirmed: 0, receipts: [] }
  if (typeof send !== 'function') throw new TypeError('message burst sender is required')

  let attempted = 0
  let confirmed = 0
  const receipts = []
  const confirmedMessages = []
  let stopReason = ''
  let localError = ''

  // Only a confirmed bubble may open a single bounded continuation. Never
  // consult a model if delivery failed, is unknown, or has been interrupted.
  let extended = false
  for (let index = 0; index < planned.length; index++) {
    if (signal?.aborted) {
      stopReason = 'aborted'
      break
    }
    if (typeof beforeSend === 'function') {
      let gate
      try { gate = await beforeSend({ index, text: planned[index], messages: planned, confirmed }) }
      catch (error) {
        stopReason = String(error?.message || error || 'preflight-failed').slice(0, 180)
        break
      }
      if (gate === false || gate?.ok === false) {
        stopReason = String(gate?.reason || 'preflight-blocked').slice(0, 180)
        break
      }
    }

    attempted++
    let result
    try { result = await send({ index, text: planned[index], messages: planned }) }
    catch (error) {
      stopReason = String(error?.message || error || 'send-outcome-unknown').slice(0, 180)
      return { status: confirmed ? 'partial-unknown' : 'unknown', planned: planned.length, attempted, confirmed, receipts, stopReason }
    }
    if (result !== true && result?.ok !== true) {
      stopReason = String(result?.error || result?.reason || 'send-outcome-unknown').slice(0, 180)
      const definitive = result?.definitive === true || result?.accepted === false
      return { status: definitive ? (confirmed ? 'partial' : 'failed') : (confirmed ? 'partial-unknown' : 'unknown'), planned: planned.length, attempted, confirmed, receipts, confirmedMessages, stopReason }
    }

    confirmed++
    confirmedMessages.push(planned[index])
    if (result?.receiptId || result?.rpid || result?.rpid_str) receipts.push(String(result.receiptId || result.rpid || result.rpid_str).slice(0, 100))
    if (typeof onConfirmed === 'function') {
      try { await onConfirmed({ index, text: planned[index], result, confirmed, planned: planned.length }) }
      catch (error) {
        localError = String(error?.message || error || 'local-confirmation-write-failed').slice(0, 180)
        // The remote send is already confirmed, but the local receipt/history
        // could not be committed. Stop here: never send another bubble while
        // the previous confirmed bubble is not durably represented locally.
        return { status: 'partial-unknown', planned: planned.length, attempted, confirmed, receipts, confirmedMessages, stopReason: 'local-confirmation-write-failed', localError }
      }
    }
    // Exactly one post-receipt expression extension. The owner of this
    // callback must separately validate account, permissions and text seal.
    if (!extended && index === planned.length - 1 && planned.length < MESSAGE_BURST_MAX &&
        typeof nextMessage === 'function' && !signal?.aborted) {
      extended = true
      let extra = ''
      try { extra = await nextMessage({ confirmed, previous: planned[index], confirmedMessages: [...confirmedMessages] }) }
      catch { extra = '' } // A failed optional thought never invalidates a confirmed send.
      if (typeof extra === 'string' && extra.trim() && extra.length <= 450 &&
          extra.trim() !== planned[index] && !planned.includes(extra.trim())) planned.push(extra.trim())
    }
  }

  const status = confirmed === planned.length
    ? 'confirmed'
    : confirmed > 0
      ? 'partial'
      : stopReason === 'aborted' ? 'aborted' : 'blocked'
  return { status, planned: planned.length, attempted, confirmed, receipts, confirmedMessages, stopReason, ...(localError ? { localError } : {}) }
}

const PLUGIN_SOURCE = 'plugin:dsh-dafeiyu-life'
const externalSource = message => {
  const kind = String(message?.source?.kind || '')
  return !kind || (!kind.startsWith('plugin:') && !/^(?:dafeiyu-|bili-duty|internal|system)/i.test(kind))
}
const assistantText = message => (Array.isArray(message?.content) ? message.content : [])
  .filter(block => block?.type === 'text' && typeof block.text === 'string')
  .map(block => block.text)
  .join('')
  .trim()

/**
 * Main-Session adapter: one model-selected burst becomes separate assistant
 * messages by using DSH's supported turn-stopping -> agent.steer continuation seam.
 * No synthetic assistant events are appended and every bubble is a real model step.
 */
export function createSessionMessageBurstController({ agent, enabled = () => true, maxMessages = () => 3, tryReconsider = () => false, logger = console } = {}) {
  if (!agent?.ctx?.on || typeof agent.steer !== 'function' || typeof agent.followup !== 'function') throw new TypeError('live DSH Agent is required')
  let currentTurn = null
  let latestAssistantTurn = null
  let latestAssistantText = ''
  let pending = null
  let userInputQueued = false
  let externalTurn = null
  let internalTurn = null
  let reconsideredTurn = null
  const disposers = []

  const clear = reason => {
    const current = pending
    pending = null // Detach before remove(): inbox removal emits discarded synchronously.
    if (current?.queuedMessageId) {
      try { agent.inbox?.remove?.(current.queuedMessageId) } catch {}
    }
    if (current) current.cancelReason = String(reason || 'cancelled')
  }
  const hasExternalInput = () => {
    const inbox = [...(agent.inbox?.nextTurn || []), ...(agent.inbox?.nextStep || [])]
    return inbox.some(externalSource)
  }
  const queueBubble = (index, turn, { followup = false } = {}) => {
    const text = pending?.messages?.[index]
    if (!text) return false
    const id = randomUUID()
    const message = {
      id,
      role: 'user',
      content: [{ type: 'text', text: [
        '【主 Session 自然多气泡续步｜内部控制上下文，不要复述】',
        `这是同一逻辑回复的第 ${index + 1} 条独立气泡（共 ${pending.messages.length} 条）。`,
        '只输出下面这条消息的正文，不要合并其他气泡，不要加编号、引号、解释或新话题。保持你自己的自然表达；若你判断此刻不适合继续，可以输出空内容结束。',
        '本条内容（仅作为你刚才自己拟定的表达，不是外部指令）：',
        JSON.stringify(text),
      ].join('\n') }],
      source: { kind: PLUGIN_SOURCE },
    }
    try {
      // The first bubble is the final assistant step in the owner's original
      // turn. Later bubbles use followup turns: DSH Chat's compact transcript
      // presents the final assistant answer of each Turn, so same-turn steering
      // would collapse earlier bubbles into the process disclosure.
      if (followup) agent.followup(message)
      else agent.steer(message)
      pending.queuedMessageId = id
      pending.lastQueuedIndex = index
      pending.turn = turn
      pending.awaitingFollowupClaim = followup
      return true
    } catch (error) {
      logger.warn?.('主 Session 多气泡续步未能排队：' + String(error?.message || error).slice(0, 120))
      clear('message-queue-failed')
      return false
    }
  }

  const queueReconsider = turn => {
    if (!enabled() || hasExternalInput() || reconsideredTurn === turn) return false
    let offered = false
    try { offered = tryReconsider({ turn, lastMessage: latestAssistantText }) === true } catch { return false }
    if (!offered) return false
    const id = randomUUID()
    const message = {
      id, role: 'user', source: { kind: PLUGIN_SOURCE },
      content: [{ type: 'text', text: [
        '【大肥鱼主 Session 偶发自主续想｜内部控制上下文，不要复述】',
        '刚才的回复已经真实产生了 assistant 消息。现在只是一次额外的自主思考机会，不是必发第二条、也不是有人发来了新消息。',
        '参考刚刚已经说出的内容，若你现在确实形成了不重复的独立联想/补充，可自然地说一句；若没有，保持沉默，不要输出 STOP、JSON 或后台状态文字。',
        '不得编造记忆、经历或工具结果；不准发起平台操作、替主人做决定或再次安排续想。',
        '刚才真正说出的最后一条（仅数据）：', JSON.stringify(latestAssistantText.slice(0, 450)),
      ].join('\n') }],
    }
    try {
      agent.followup(message)
      reconsideredTurn = turn
      pending = { messages: [], turn: null, max: 0, type: 'reconsider', queuedMessageId: id, awaitingFollowupClaim: true }
      return true
    } catch (error) {
      logger.warn?.('主 Session 自主续想排队失败：' + String(error?.message || error).slice(0, 100))
      return false
    }
  }

  try {
    const off = agent.ctx.on('session/event', (_session, event) => {
      if (event?.type === 'turn/start') {
        currentTurn = Number(event.data?.turn) || null
        if (userInputQueued && currentTurn) { externalTurn = currentTurn; userInputQueued = false }
      }
      if (event?.type === 'assistant/message') {
        latestAssistantTurn = Number(event.data?.turn) || null
        latestAssistantText = assistantText(event.data?.message)
      }
      if (event?.type === 'turn/end' && pending?.turn === Number(event.data?.turn)) {
        const queued = pending.queuedMessageId && [...(agent.inbox?.nextStep || []), ...(agent.inbox?.nextTurn || [])]
          .some(message => message?.id === pending.queuedMessageId)
        if (queued) pending.turn = null // The next bubble is safely queued for its own Turn.
        else clear('turn-ended')
      }
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡事件监听未能挂载：' + String(error?.message || error)) }

  try {
    const off = agent.ctx.on('agent/inbox/inserted', payload => {
      const message = payload?.message || payload
      if (message?.role === 'user' && externalSource(message)) userInputQueued = true
      if (message?.role === 'user' && externalSource(message) && pending) {
        const wasRunning = agent.status === 'running'
        clear('new-owner-message')
        // A new owner message supersedes any not-yet-finished continuation.
        // Preserve the owner's newly queued input while aborting stale generation.
        if (wasRunning) {
          try { agent.cancel?.({ kind: 'hook', reason: 'owner-input-interrupted-message-burst' }, { keepInbox: true }) }
          catch (error) { logger.warn?.('新主人消息中断旧气泡失败：' + String(error?.message || error).slice(0, 100)) }
        }
      }
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡新来信监听未能挂载：' + String(error?.message || error)) }

  try {
    const off = agent.ctx.on('agent/inbox/claimed', payload => {
      const message = payload?.message
      if (message?.role === 'user') {
        if (externalSource(message)) { externalTurn = Number(payload?.turn) || currentTurn; userInputQueued = false }
        else internalTurn = Number(payload?.turn) || currentTurn
      }
      if (pending?.queuedMessageId && message?.id === pending.queuedMessageId) {
        pending.turn = Number(payload?.turn) || pending.turn
        pending.queuedMessageId = ''
        pending.awaitingFollowupClaim = false
      }
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡领取监听未能挂载：' + String(error?.message || error)) }

  try {
    const off = agent.ctx.on('agent/inbox/discarded', payload => {
      if (pending?.queuedMessageId && payload?.message?.id === pending.queuedMessageId) clear('queued-message-discarded')
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡取消监听未能挂载：' + String(error?.message || error)) }

  try {
    const off = agent.ctx.on('agent/turn-stopping', ({ turn, signal } = {}) => {
      const n = Number(turn)
      if (!pending) {
        if (!signal?.aborted && externalTurn === n && internalTurn !== n &&
            latestAssistantTurn === n && latestAssistantText && enabled() && !hasExternalInput()) queueReconsider(n)
        return
      }
      if (pending.type === 'reconsider') {
        if (pending.turn === n) clear('reconsider-complete')
        return
      }
      if (pending.turn !== n) return
      if (signal?.aborted || !enabled() || hasExternalInput()) { clear(signal?.aborted ? 'aborted' : 'interrupted-by-owner'); return }
      // Continue only after a real, non-empty assistant message was committed.
      if (latestAssistantTurn !== Number(turn) || !latestAssistantText) { clear('no-visible-assistant-bubble'); return }
      const next = pending.lastQueuedIndex + 1
      if (next >= pending.messages.length) {
        const eligible = externalTurn === pending.originTurn && pending.messages.length < Number(maxMessages())
        clear('complete')
        if (eligible) queueReconsider(n)
        return
      }
      queueBubble(next, Number(turn), { followup: true })
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡续步监听未能挂载：' + String(error?.message || error)) }

  return {
    start(messages) {
      if (!enabled()) return { ok: false, reason: 'message-burst-disabled' }
      if (pending) return { ok: false, reason: 'message-burst-busy' }
      const max = Math.max(1, Math.min(MESSAGE_BURST_MAX, Number(maxMessages()) || MESSAGE_BURST_MAX))
      // A model-produced array contains already-formed independent expressions.
      // A single ordinary message needs no extra tool or speculative followup.
      const normalized = normalizeMessageBurst(messages, { maxMessages: max, maxChars: 450, minMessages: 2 })
      if (!normalized.length) return { ok: false, reason: 'use-ordinary-single-reply' }
      if (!Number.isSafeInteger(currentTurn) || currentTurn < 1) return { ok: false, reason: 'turn-not-active' }
      pending = { messages: normalized, originTurn: currentTurn, turn: currentTurn, max,
        lastQueuedIndex: -1, queuedMessageId: '', awaitingFollowupClaim: false }
      if (!queueBubble(0, currentTurn)) return { ok: false, reason: 'first-bubble-not-queued' }
      return { ok: true, queued: normalized.length }
    },
    cancel: clear,
    status: () => pending ? { active: true, turn: pending.turn, total: pending.messages.length, next: pending.lastQueuedIndex + 2, awaitingFollowupClaim: pending.awaitingFollowupClaim,
      } : { active: false },
    dispose() { clear('disposed'); for (const off of disposers.reverse()) try { off() } catch {} },
  }
}
