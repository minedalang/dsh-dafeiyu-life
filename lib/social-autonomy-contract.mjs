/**
 * 2.7.0 development foundation: pure social-agency contracts.
 * No model call, external write, runtime feature enablement, or secondary persona.
 * The host supplies the SINGLE Life Voice context and the existing policy gate
 * makes the final authorization decision independently of any proposal here.
 */
const UID = /^[1-9]\d{0,18}$/
const CHANNELS = new Set(['dm', 'comment', 'at', 'main'])
const ACTIONS = new Set(['reply', 'defer', 'skip', 'close'])
const clean = (s, limit = 2000) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit)
const isAtMention = text => /(?<![A-Za-z0-9._%+-])@[^\s@，,。！？!?；;]{1,48}/u.test(String(text || ''))
/** A reply-to-rpid is not an invitation to create a new @username notification. */
export function validateSocialReplyText(text, { allowProactiveMention = false } = {}) {
  // This flag is supplied ONLY by a trusted host policy, never model JSON.
  const body = String(text ?? '').trim()
  if (!body) return { ok: false, reason: 'empty-reply' }
  if (isAtMention(body) && !allowProactiveMention) return { ok: false, reason: 'proactive-at-forbidden' }
  return { ok: true }
}


/** No interest evidence is UNKNOWN, never proof of dislike or a veto. */
export function interestEvidenceForTopic(topic, observations = []) {
  const q = clean(topic, 80).toLocaleLowerCase()
  const rows = Array.isArray(observations) ? observations : []
  const matches = rows.filter(x => clean(x?.topic, 80).toLocaleLowerCase() === q)
  const explicitReject = matches.find(x => x?.stance === 'dislike' && x?.source === 'explicit-self-report')
  if (explicitReject) return { status: 'explicit-dislike', evidence: true, hardVeto: false }
  const explicitLike = matches.find(x => x?.stance === 'like' && x?.source === 'explicit-self-report')
  if (explicitLike) return { status: 'explicit-like', evidence: true, hardVeto: false }
  if (matches.some(x => x?.source === 'observed-exploration')) return { status: 'explored', evidence: true, hardVeto: false }
  return { status: 'unknown', evidence: false, hardVeto: false }
}

/**
 * Pass through the Life Voice output ONCE. Relationship and conversation facts
 * are merely evidence; neither contains a synthesized emotion/persona prompt.
 */
export function composeSocialDecisionContext({
  channel, actorUid, threadKey, trigger = 'incoming',
  lifeVoiceContext, topic = '', verifiedScene = '',
  conversation = {}, relationship = {}, interests = [],
} = {}) {
  if (!CHANNELS.has(channel)) return { ok: false, reason: 'invalid-channel' }
  if (!UID.test(String(actorUid || ''))) return { ok: false, reason: 'invalid-actor-uid' }
  if (!clean(threadKey, 200)) return { ok: false, reason: 'missing-thread-key' }
  if (!['incoming', 'scheduled', 'continuation'].includes(trigger)) return { ok: false, reason: 'invalid-trigger' }
  if (!clean(lifeVoiceContext, 12000)) return { ok: false, reason: 'life-voice-required' }
  return {
    ok: true,
    channel,
    actorUid: String(actorUid),
    threadKey: clean(threadKey, 200),
    trigger,
    // Only this field can contain persona/emotion. Never add score or mood copy.
    lifeVoiceContext: clean(lifeVoiceContext, 12000),
    scene: { verifiedText: clean(verifiedScene, 3000), topic: clean(topic, 100) },
    continuity: {
      confirmedReplies: Math.max(0, Math.min(100, Math.floor(Number(conversation.confirmedReplies) || 0))),
      lastConfirmedAt: Number.isSafeInteger(conversation.lastConfirmedAt) ? conversation.lastConfirmedAt : 0,
      phase: ['new', 'ongoing', 'closing', 'closed'].includes(conversation.phase) ? conversation.phase : 'new',
    },
    relationship: {
      stage: ['new', 'known', 'familiar', 'friend', 'owner'].includes(relationship.stage) ? relationship.stage : 'new',
      // Verified/correctable portrait summary; never interpreted as authorization.
      portrait: relationship.verifiedPortrait === true ? clean(relationship.portrait, 800) : '',
    },
    interestEvidence: interestEvidenceForTopic(topic, interests),
    requiresSeparatePolicyGate: true,
  }
}

/**
 * Only validates a model PROPOSAL, never sends or grants permission. The
 * existing SocialPolicyGate, channel quotas, opt-outs, cooldown and receipt
 * adapters still run at delivery time.
 */
export function validateSocialActionProposal(proposal = {}, context = {}, { now = Date.now() } = {}) {
  if (context?.ok !== true || !CHANNELS.has(context.channel)) return { ok: false, reason: 'invalid-context' }
  const action = clean(proposal.action, 30)
  if (!ACTIONS.has(action)) return { ok: false, reason: 'invalid-action' }
  // Being mentioned permits CONSIDERATION of a reply, not proactively tagging others.
  if (context.channel === 'at' && !['incoming', 'continuation', 'scheduled'].includes(context.trigger))
    return { ok: false, reason: 'invalid-at-trigger' }
  const closed=['closed','closing'].includes(context.continuity?.phase)
  if (closed && action==='defer')return {ok:false,reason:'conversation-closed-no-reconsideration'}
  if (action === 'reply') {
    const messages = Array.isArray(proposal.messages) ? proposal.messages : []
    if (messages.length < 1 || messages.length > (context.channel==='dm'?3:1)) return { ok: false, reason: 'reply-bubble-limit' }
    const normalized = messages.map(x => clean(x, 451))
    if (normalized.some(x => !x || x.length > 450)) return { ok: false, reason: 'invalid-reply-text' }
    if (normalized.some(x => !validateSocialReplyText(x).ok) && proposal.explicitMentionAuthorization !== true)
      return { ok: false, reason: 'proactive-at-forbidden' }
    // A model cannot create an authority token by setting a JSON field. No
    // authorization bit is accepted from proposals; approval is external.
    if (normalized.some(isAtMention)) return { ok: false, reason: 'mention-requires-external-policy' }
    return { ok: true, action, messages: normalized, topicState:['settled','waiting'].includes(proposal.topicState)?proposal.topicState:'open',
      requiresSeparatePolicyGate: true }
  }
  if (action === 'defer') {
    // A real choice to pause is not a reservation for a future unsolicited reply.
    // New incoming messages may open a new turn via the ordinary policy gate.
    return { ok: true, action, requiresSeparatePolicyGate: true }
  }
  return { ok: true, action, requiresSeparatePolicyGate: true }
}
