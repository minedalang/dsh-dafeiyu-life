/**
 * P6-A/P6-B durable, account-scoped *intention* ledger (2.7.0 foundation).
 * Does not store DM contents, prompts, emotions or scheduled outbound text.
 * Does not send messages. Pending entries are re-evaluated before a real send.
 * A claimed or uncertain entry is NEVER replayed automatically after a crash.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const UID = /^[1-9]\d{0,18}$/
const CHANNELS = new Set(['dm', 'comment', 'at', 'main'])
const PURPOSES = new Set(['delayed-supplement', 'silence-reconsideration'])
const DAY = 86400000
const HASH = /^[a-f0-9]{40}$/
const hash = x => createHash('sha256').update(x).digest('hex').slice(0, 40)
const validKey = x => typeof x === 'string' && x.length > 0 && x.length <= 240 && !/[\u0000-\u001f\u007f]/.test(x)
const empty = accountUid => ({ schema: 1, accountUid, entries: [] })

export function createSocialContinuityLedger({ dataDir, accountUid, now = Date.now } = {}) {
  if (!validKey(dataDir) || !UID.test(String(accountUid || ''))) throw TypeError('account-scoped dataDir and accountUid required')
  const owner = String(accountUid)
  const file = join(dataDir, 'social-continuity', 'intentions.json')
  function load() {
    const dir = dirname(file)
    if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()))
      throw Error('unsafe-continuity-dir')
    if (!existsSync(file)) return empty(owner)
    const st = lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink() || st.size > 400000) throw Error('unsafe-continuity-ledger')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (data?.schema !== 1 || data.accountUid !== owner || !Array.isArray(data.entries) || data.entries.length > 500)
      throw Error('continuity-account-or-schema-mismatch')
    if (data.entries.some(x => !HASH.test(String(x.id || '')) || !UID.test(String(x.uid || '')) || !CHANNELS.has(x.channel)))
      throw Error('invalid-continuity-entry')
    return data
  }
  function save(data) {
    const dir = dirname(file)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const ds = lstatSync(dir)
    if (!ds.isDirectory() || ds.isSymbolicLink()) throw Error('unsafe-continuity-dir')
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())) throw Error('unsafe-continuity-file')
    // Remove only old terminal entries. Never evict a pending intention silently.
    data.entries = data.entries.filter(x => !['sent', 'skipped', 'cancelled', 'uncertain', 'expired'].includes(x.status)
      || now() - (x.updatedAt || x.createdAt) < 30 * DAY)
    if (data.entries.length > 500) throw Error('continuity-ledger-full')
    const content = JSON.stringify(data, null, 2) + '\n'
    if (Buffer.byteLength(content) > 400000) throw Error('continuity-ledger-full')
    const tmp = file + '.' + randomUUID() + '.tmp'
    writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' })
    renameSync(tmp, file)
  }
  function schedule({ uid, channel, threadKey, sourceEventId, purpose, notBefore, expiresAt } = {}) {
    const idUid = String(uid || '')
    if (!UID.test(idUid) || !CHANNELS.has(channel) || !PURPOSES.has(purpose)
      || !validKey(threadKey) || !validKey(sourceEventId)) return { ok: false, reason: 'invalid-intention' }
    if (channel === 'main') return { ok: false, reason: 'host-message-adapter-required' }
    const due = Number(notBefore), expiry = Number(expiresAt), t = now()
    if (!Number.isSafeInteger(due) || !Number.isSafeInteger(expiry) || due < t + 1000
      || due > t + 7 * DAY || expiry <= due || expiry > t + 14 * DAY)
      return { ok: false, reason: 'invalid-intention-time' }
    const id = hash([owner, idUid, channel, threadKey, sourceEventId, purpose].join('\0'))
    const threadHash = hash([owner, idUid, channel, threadKey].join('\0'))
    const data = load()
    const existing = data.entries.find(x => x.id === id)
    if (existing) return { ok: true, duplicate: true, id, status: existing.status }
    const item = { id, uid: idUid, channel, threadHash, purpose, status: 'scheduled', notBefore: due,
      expiresAt: expiry, createdAt: t, updatedAt: t }
    data.entries.push(item)
    save(data)
    return { ok: true, scheduled: true, id, status: 'scheduled' }
  }
  function due({ limit = 20 } = {}) {
    const t = now()
    const data=load();let changed=false
    for(const x of data.entries)if(x.status==='scheduled'&&x.expiresAt<=t){x.status='expired';x.updatedAt=t;changed=true}
    if(changed)save(data)
    return data.entries.filter(x => x.status === 'scheduled' && x.notBefore <= t && x.expiresAt > t)
      .slice(0, Math.max(1, Math.min(50, Math.floor(limit) || 20))).map(x => ({ ...x }))
  }
  function claim(id) {
    const data = load(), x = data.entries.find(x => x.id === id), t = now()
    if (!x || x.status !== 'scheduled') return { ok: false, reason: 'not-scheduled' }
    if (x.expiresAt <= t) { x.status = 'expired'; x.updatedAt = t; save(data); return { ok: false, reason: 'expired' } }
    if (x.notBefore > t) return { ok: false, reason: 'not-due' }
    x.status = 'claimed'; x.updatedAt = t; save(data)
    return { ok: true, id, status: 'claimed', recheckPermissionAndMood: true }
  }
  function settle(id, { outcome, receiptId = '' } = {}) {
    const data = load(), x = data.entries.find(x => x.id === id)
    if (!x || x.status !== 'claimed') return { ok: false, reason: 'not-claimed' }
    if (!['sent', 'skipped', 'cancelled', 'uncertain'].includes(outcome)) return { ok: false, reason: 'invalid-outcome' }
    if (outcome === 'sent' && !validKey(receiptId)) return { ok: false, reason: 'missing-platform-receipt' }
    x.status = outcome; x.updatedAt = now()
    if (outcome === 'sent') x.receiptHash = hash([owner, x.uid, x.channel, receiptId].join('\0'))
    save(data)
    return { ok: true, id, status: outcome }
  }
  function cancelForIncoming({ uid, channel, threadKey } = {}) {
    const idUid = String(uid || '')
    if (!UID.test(idUid) || !CHANNELS.has(channel) || !validKey(threadKey)) return { ok: false, reason: 'invalid-thread' }
    const key = hash([owner, idUid, channel, threadKey].join('\0'))
    const data = load(); let cancelled = 0
    for (const x of data.entries) if (x.threadHash === key && x.status === 'scheduled') {
      x.status = 'cancelled'; x.updatedAt = now(); cancelled++
    }
    if (cancelled) save(data)
    return { ok: true, cancelled }
  }
  // No UI or caller can infer a stranger's raw chat content from this metadata.
  function status() {
    const data = load()
    return { ok: true, accountUid: owner,
      counts: Object.fromEntries(['scheduled', 'claimed', 'sent', 'skipped', 'cancelled', 'uncertain', 'expired']
        .map(state => [state, data.entries.filter(x => x.status === state).length])) }
  }
  return { schedule, due, claim, settle, cancelForIncoming, status, file }
}
