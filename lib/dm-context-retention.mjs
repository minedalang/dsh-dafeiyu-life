/**
 * Per-recipient short-term DM context lifecycle. Not a personality memory.
 * Only plaintext reply context is pruned here: seen IDs, explicit no-contact
 * boundaries, approval decisions, quotas and send receipts are intentionally
 * not touched (they prevent repeated sends and unauthorized contact).
 */
export const DM_CONTEXT_DAYS = 14;
export const DM_OLDER_CONTEXT_DAYS = 7;
const DAY = 86400_000;
const bounded = (v, min, max, fallback) => Number.isFinite(Number(v))
  ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;
const validAt = (at, atNow, days) => Number.isSafeInteger(Number(at))
  && Number(at) > 0 && Number(at) <= atNow + 60_000
  && atNow - Number(at) <= days * DAY;
const plain = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
/** Mutate just a person's raw conversation context. Returns a count-only audit. */
export function pruneDmContext(person, {atNow = Date.now(), historyLimit = 40} = {}) {
  const limit = bounded(historyLimit, 0, 80, 40);
  const beforeHistory = Array.isArray(person.history) ? person.history.length : 0;
  const beforeOlder = Array.isArray(person.olderContext) ? person.olderContext.length : 0;
  const history = Array.isArray(person.history) ? person.history.filter(x => x &&
    ['user','assistant'].includes(x.role) && validAt(x.at, atNow, DM_CONTEXT_DAYS) && typeof x.text === 'string' && x.text.length > 0)
    .map(x=>({role:x.role,text:plain(x.text,4000),at:Number(x.at)})).filter(x=>x.text) : [];
  // Older versions saved un-dated raw strings. Without timestamps their age
  // cannot be proved: fail closed rather than letting them persist forever.
  const older = Array.isArray(person.olderContext) ? person.olderContext.filter(x=>x && typeof x === 'object'
    && validAt(x.at,atNow,DM_OLDER_CONTEXT_DAYS) && typeof x.text === 'string')
    .map(x=>({at:Number(x.at),text:plain(x.text,110)})).filter(x=>x.text) : [];
  const dropped = limit > 0 ? history.slice(0,Math.max(0,history.length-limit)) : [];
  const added = dropped.filter(x=>x.role==='user' && validAt(x.at,atNow,DM_OLDER_CONTEXT_DAYS))
    .map(x=>({at:x.at,text:plain(x.text,110)}));
  const nextHistory = limit > 0 ? history.slice(-limit) : [];
  const nextOlder = limit > 0 ? older.concat(added).slice(-12) : [];
  const changed = JSON.stringify(person.history||[]) !== JSON.stringify(nextHistory)
    || JSON.stringify(person.olderContext||[]) !== JSON.stringify(nextOlder);
  person.history = nextHistory;
  person.olderContext = nextOlder;
  return {changed,historyRemoved:Math.max(0,beforeHistory-nextHistory.length),
    olderRemoved:Math.max(0,beforeOlder+added.length-nextOlder.length),
    historyCount:nextHistory.length,olderCount:nextOlder.length};
}
export function dmOlderContextText(person){return (Array.isArray(person.olderContext)?person.olderContext:[])
  .filter(x=>x && typeof x === 'object' && typeof x.text === 'string')
  .map(x=>x.text).join('；').slice(-1100);}
