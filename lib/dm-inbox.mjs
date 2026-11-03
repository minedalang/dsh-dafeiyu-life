import {readUidList} from './uid-labels.mjs'
/** 把项目现有 lib/dm.mjs 的会话/消息结构转成自动回复引擎的结构。
 * 不读取陌生平台接口，不给消息中的文字任何工具调用权限。
 */
const uidOf = (v) => {
  const s = String(v ?? '').trim()
  return /^[1-9]\d{0,18}$/.test(s) ? s : ''
}

export function parseDmWhitelist(text) {
  return new Set(Array.isArray(text) ? text.map(uidOf).filter(Boolean) : [...readUidList(text).keys()])
}

const epochMs = (t) => {
  const value = Number(t)
  if (!Number.isSafeInteger(value) || value <= 0) return 0
  return value < 1e11 ? value * 1000 : value
}

export async function collectDmInbox({ sessions, ownUid, whitelist = [], readConversation, maxSessions = 40, shouldRead=()=>true, onRead=()=>{}, now = Date.now, logger = console }) {
  const self = uidOf(ownUid)
  if (!self) throw new Error('B站登录 UID 缺失，不能判断自己发送的消息')
  if (!Array.isArray(sessions)) throw new TypeError('私信会话列表不是数组')
  if (typeof readConversation !== 'function') throw new TypeError('缺少私信读取函数')
  const allow = parseDmWhitelist(whitelist)
  // 未读、两天内活跃、白名单会话均参与扫描，减少后台请求数量。
  // 白名单和未读会话优先，旧会话没有新消息就不主动请求。
  const recent = now() - 2 * 86400_000
  const candidates = sessions.filter(s => {
    const uid = uidOf(s?.uid)
    return uid && uid !== self && (Number(s.unread) > 0 || epochMs(s.lastTs) >= recent || allow.has(uid)) && shouldRead(s)
  }).sort((a, b) => {
    const aScore = (Number(a.unread) > 0 ? 2 : 0) + (allow.has(uidOf(a.uid)) ? 1 : 0)
    const bScore = (Number(b.unread) > 0 ? 2 : 0) + (allow.has(uidOf(b.uid)) ? 1 : 0)
    return bScore - aScore || Number(b.lastTs) - Number(a.lastTs)
  })
  const limit = Math.max(1, Math.min(100, Number(maxSessions) || 40))
  if (candidates.length > limit) logger.warn?.(`私信会话数为 ${candidates.length}，本轮仅检查最优先的 ${limit} 个`)
  const rows = []
  for (const s of candidates.slice(0, limit)) {
    const uid = uidOf(s.uid)
    try {
      const msgs = await readConversation(uid)
      if (!Array.isArray(msgs)) throw new Error('消息接口没有返回数组')
      // The endpoint returns only a bounded recent window. If the unread
      // count exceeds that window, do not claim the session is fully checked;
      // leave it eligible for a subsequent pass and emit an explicit warning.
      // This is detection, not a promise to backfill beyond the API window.
      if(Number(s.unread)>msgs.length){
        logger.warn?.(`私信会话 UID=${uid} 报告 ${Number(s.unread)} 条未读，但本轮仅取得 ${msgs.length} 条；未推进游标，可能需要人工检查历史会话`)
      }else onRead(s)
      for (const m of msgs) {
        // 非文字类型里，当前 lib/dm.mjs 支持视频分享卡片 (7 / 8)。
        if (m.fromMe !== false || !m.key || !epochMs(m.ts)) continue
        if (!String(m.text || '').trim() || String(m.text) === '[非文字消息]') continue
        rows.push({
          senderUid: uid,
          senderName: String(s.nickname||'').slice(0,60),
          messageId: `${uid}:${String(m.key).slice(0, 100)}`,
          timestampMs: epochMs(m.ts),
          text: String(m.text).slice(0, 4000),
          incoming: true,
          system: ![1, 7, 8].includes(Number(m.kind) || 1),
        })
      }
    } catch (e) {
      // 某一个人的会话拉取失败时不要阻止检查其他人；下轮继续尝试。
      logger.warn?.(`读取私信会话 UID=${uid} 失败：${String(e?.message || e).slice(0, 200)}`)
    }
  }
  return rows
}
