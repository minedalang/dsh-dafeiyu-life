/**
 * A single, durable extra-thought opportunity budget shared by chat channels.
 * Frequency limits MODEL RECONSIDERATION, never the normal reply, willingness,
 * platform-send quotas, or a recipient's contact permissions.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

export const NATURAL_RECONSIDER_COOLDOWN_MS = Object.freeze({
  owner: 2 * 60_000,
  intimate: 5 * 60_000,
  familiar: 10 * 60_000,
  stranger: 30 * 60_000,
})
// It is deliberately a minority of *eligible* replies, not a probability of
// sending. The second model can decide there is nothing worth saying.
export const NATURAL_RECONSIDER_PROBABILITY = 0.25

export function naturalRelationshipTier(stage) {
  const s = String(stage || '').toLowerCase()
  if (s === 'owner') return 'owner'
  if (['friend', 'regular', 'intimate', 'close'].includes(s)) return 'intimate'
  if (s === 'familiar') return 'familiar'
  return 'stranger'
}

export function createNaturalExpressionOpportunity({ dataDir, now = Date.now, random = Math.random } = {}) {
  if (!dataDir) throw new TypeError('missing dataDir')
  const dir = join(dataDir, 'natural-expression')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (lstatSync(dir).isSymbolicLink()) throw Error('unsafe expression opportunity directory')
  const file = join(dir, 'cooldown.json')
  const identity = (account, peer) => createHash('sha256').update(String(account) + '\0' + String(peer)).digest('hex')
  const read = () => {
    if (!existsSync(file)) return {}
    const st = lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink() || st.size > 150_000) throw Error('unsafe expression opportunity state')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data?.version !== 1 || !data?.lastAt || typeof data.lastAt !== 'object') throw Error('invalid expression opportunity state')
    return data.lastAt
  }
  const save = lastAt => {
    const tmp = file + '.' + process.pid + '.tmp'
    writeFileSync(tmp, JSON.stringify({ version: 1, lastAt }) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  }
  return {
    tryAcquire({ account, peer, stage, enabled = true, probability = NATURAL_RECONSIDER_PROBABILITY } = {}) {
      if (!enabled || !String(account || '').trim() || !String(peer || '').trim()) return { ok: false, reason: 'not-eligible' }
      const tier = naturalRelationshipTier(stage)
      const t = now(), key = identity(account, peer)
      if (!Number.isSafeInteger(t) || t <= 0) return { ok: false, reason: 'invalid-time' }
      let lastAt
      try { lastAt = read() } catch { return { ok: false, reason: 'state-unavailable' } } // fail closed
      const last = Number(lastAt[key]) || 0
      const cooldownMs = NATURAL_RECONSIDER_COOLDOWN_MS[tier]
      if (last && t - last < cooldownMs) return { ok: false, reason: 'cooldown', tier, cooldownMs }
      if (random() >= Math.max(0, Math.min(1, Number(probability) || 0))) return { ok: false, reason: 'not-selected', tier }
      // No per-day counter. Reserve *before* the extra model call; silence and
      // model failure also spend the cooldown. Never allow uncertain retry loops.
      lastAt[key] = t
      for (const [id, at] of Object.entries(lastAt)) if (t - Number(at) > 45 * 86400_000) delete lastAt[id]
      try { save(lastAt) } catch { return { ok: false, reason: 'reserve-failed' } }
      return { ok: true, tier, cooldownMs }
    },
  }
}
