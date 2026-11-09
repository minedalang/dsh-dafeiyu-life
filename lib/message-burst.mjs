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
  const shape = requireArray
    ? `必须输出 messages 数组，包含 2–${cap} 条`
    : `需要多条时输出 messages 数组（1–${cap} 条）；只有一条时可使用 text 或 reply`
  return `【统一自然多气泡协议｜${context}】${shape}。每条都是一条独立、完整、可单独发送的自然消息，每条最多 ${maxChars} 字；按真实表达需要决定条数，不得为了凑数拆句、重复或补寒暄。数组顺序就是发送顺序。空白项会被丢弃；不得在消息正文中加入编号、JSON 或发送说明。`;
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
export function createSessionMessageBurstController({ agent, enabled = () => true, maxMessages = () => 3, logger = console } = {}) {
  if (!agent?.ctx?.on || typeof agent.steer !== 'function' || typeof agent.followup !== 'function') throw new TypeError('live DSH Agent is required')
  let currentTurn = null
  let latestAssistantTurn = null
  let latestAssistantText = ''
  let pending = null
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

  try {
    const off = agent.ctx.on('session/event', (_session, event) => {
      if (event?.type === 'turn/start') currentTurn = Number(event.data?.turn) || null
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
      if (!pending || pending.turn !== Number(turn)) return
      if (signal?.aborted || !enabled() || hasExternalInput()) { clear(signal?.aborted ? 'aborted' : 'interrupted-by-owner'); return }
      // Continue only after a real, non-empty assistant message was committed.
      if (latestAssistantTurn !== Number(turn) || !latestAssistantText) { clear('no-visible-assistant-bubble'); return }
      const next = pending.lastQueuedIndex + 1
      if (next >= pending.messages.length) { clear('complete'); return }
      queueBubble(next, Number(turn), { followup: true })
    })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) { logger.warn?.('主 Session 多气泡续步监听未能挂载：' + String(error?.message || error)) }

  return {
    start(messages) {
      if (!enabled()) return { ok: false, reason: 'message-burst-disabled' }
      if (pending) return { ok: false, reason: 'message-burst-busy' }
      const max = Math.max(1, Math.min(MESSAGE_BURST_MAX, Number(maxMessages()) || MESSAGE_BURST_MAX))
      const normalized = normalizeMessageBurst(messages, { maxMessages: max, maxChars: 450, minMessages: 2 })
      if (!normalized.length) return { ok: false, reason: 'invalid-message-burst' }
      if (!Number.isSafeInteger(currentTurn) || currentTurn < 1) return { ok: false, reason: 'turn-not-active' }
      pending = { messages: normalized, turn: currentTurn, lastQueuedIndex: -1, queuedMessageId: '', awaitingFollowupClaim: false }
      if (!queueBubble(0, currentTurn)) return { ok: false, reason: 'first-bubble-not-queued' }
      return { ok: true, queued: normalized.length }
    },
    cancel: clear,
    status: () => pending ? { active: true, turn: pending.turn, total: pending.messages.length, next: pending.lastQueuedIndex + 2, awaitingFollowupClaim: pending.awaitingFollowupClaim } : { active: false },
    dispose() { clear('disposed'); for (const off of disposers.reverse()) try { off() } catch {} },
  }
}
