/**
 * lib/dm.mjs —— B站 私信：读会话 / 读消息 / 发消息
 *
 * 为什么要它（2026-10-21 起）：「私信双向」= 使用者在 B站 私信里跟它说话，它能看见并回一句。
 *   接口是 2026-10-19 实测通过的（见记忆）：**只读、纯代码**，不花 token；
 *   只有真有人发来新消息时才去唤醒模型，所以平时零成本 ✓
 *
 * 接口（都要带登录 Cookie，且 GET）：
 *   ① 列会话：/session_svr/v1/session_svr/get_sessions?session_type=1&group_id=0&Build=0&mobi_app=web
 *   ② 读消息：/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=<uid>&session_type=1&size=<n>&build=0&mobi_app=web
 *   ③ 发消息：走 vendor 里的 bili_send_message（不在这份文件里）
 * ⚠️ 别用 /x/im/web/session/list（404）、/get_msgs（404）、fetch_session_msgs 用 POST（405）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {extractBiliPicture} from './incoming-image-vision.mjs'
import {parseBiliShareUrl} from './bili-share-link.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'

export function loadCred(stateDir) {
  const f = join(stateDir, 'bili_credential.json')
  if (!existsSync(f)) return null
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'))
    return c?.sessdata ? c : null
  } catch { return null }
}

function headers(cred) {
  return {
    'User-Agent': UA,
    Referer: 'https://message.bilibili.com/',
    Origin: 'https://message.bilibili.com',
    Cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
  }
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
function fetchFailure(error, host) {
  const cause = error?.cause || error
  const code = String(cause?.code || error?.code || '')
  const raw = String(cause?.message || error?.message || error || '未知网络错误')
    .replace(/https?:\/\/\S+/gi, host).replace(/[\r\n\t]+/g, ' ').slice(0, 150)
  return `私信接口网络请求失败 host=${host}${code ? ` code=${code}` : ''}：${raw}`
}
async function jget(url, cred, {readBudget,kind='dm'}={}) {
  const execute=async()=>{
  const host = new URL(url).hostname
  let r = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      readBudget?.acquire(kind)
      r = await fetch(url, { headers: headers(cred), signal: AbortSignal.timeout(10000) })
      break
    } catch (error) {
      const cause = error?.cause || error
      const code = String(cause?.code || error?.code || '')
      const transient = /fetch failed|timeout|aborted/i.test(String(error?.message || '')) ||
        ['ECONNRESET','ECONNREFUSED','EAI_AGAIN','ENOTFOUND','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','ENETUNREACH','ECONNABORTED'].includes(code)
      if(error?.name==='BiliReadDeferredError')throw error
      readBudget?.noteError(error,kind)
      // A get_sessions request already consumed the durable 5-minute token.
      // Retrying it 450ms later cannot reach the platform and only creates
      // a misleading 'interval' error that hides the real transient failure.
      if (attempt === 0 && transient && (kind!=='dm-list'||!readBudget)) {
        await wait(450)
        continue
      }
      throw new Error(fetchFailure(error, host), { cause: error })
    }
  }
  const j = await r.json().catch(() => null)
  // Bilibili can return HTTP 200 with application-level code -509. It is
  // a platform throttle: notify the shared persisted read budget *before*
  // throwing so every other guarded Bilibili read pauses as well.
  if (r.status===412||r.status===429||r.status===403||
      j?.code===-412||j?.code===-352||j?.code===-509||j?.code===429)
    readBudget?.noteError(Error(`HTTP ${r.status} code=${j?.code}`),kind)
  if (!j || j.code !== 0) throw new Error(`私信接口返回异常 host=${host} HTTP ${r.status} code=${j?.code} msg=${j?.message || ''}`)
  readBudget?.noteSuccess(kind)
  return j.data || {}
  }
  // DM keeps its existing persistent -509/read-budget safety. A shared
  // read lane arbitrates with comments/video only before the real request.
  return typeof readBudget?.schedule==='function'?readBudget.schedule(kind,execute):execute()
}

/** 会话列表：[{ uid, unread, lastTs, preview }] */
export async function listSessions(cred, {readBudget}={}) {
  const d = await jget('https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions?session_type=1&group_id=0&Build=0&mobi_app=web', cred, {readBudget,kind:'dm-list'})
  const list = d.session_list || []
  return list.map((s) => {
    let preview = ''
    try {
      const c = s.last_msg?.content ? JSON.parse(s.last_msg.content) : null
      preview = String(c?.content || c?.text || '').slice(0, 80)
    } catch { /* 非 JSON 就留空 */ }
    return {
      uid: Number(s.talker_id) || 0,
      nickname: String(s.talker_name||s.talker_uname||s.talker?.name||s.user?.name||'').replace(/[<>\r\n]/g,'').slice(0,60),
      unread: Number(s.unread_count) || 0,
      lastTs: Number(s.last_msg?.timestamp) || 0,
      preview,
    }
  }).filter((x) => x.uid > 0)
}

/** 读某个会话最近的 n 条：[{ key, ts, fromMe, text }] */
export async function fetchMsgs(cred, talkerId, size = 10, {readBudget}={}) {
  const url = `https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=${Number(talkerId)}`
    + `&session_type=1&size=${Math.max(1, Math.min(50, size))}&build=0&mobi_app=web`
  const d = await jget(url, cred, {readBudget,kind:'dm-messages'})
  const list = (d.messages || []).slice().reverse()   // 接口是倒序的
  return list.map((m) => {
    const mt = Number(m.msg_type) || 1
    let text = ''
    let isCard = false
    let imageUrl = ''
    try {
      const c = JSON.parse(m.content || '{}')
      // msg_type=7 is a generic share card; source=11 means a dynamic, not a video.
      // Keep validated official URLs so the Life shared-link parser can receive the actual resource.
      if (mt===2){
        imageUrl=extractBiliPicture(c)
        text=imageUrl?'[收到图片]':'[无法读取的图片消息]'
      } else if (mt === 7) {
        // B站 msg_type=7 is a generic share card, not always a video.
        // source=11 is a dynamic; its `url` field is the link the old parser
        // silently discarded, which prevented Life from seeing friend shares.
        isCard = true
        const source = Number(c.source || 0)
        const rawUrl = String(c.url || c.jump_url || '')
        const parsedUrl = parseBiliShareUrl(rawUrl)
        let safeUrl = ''
        if (parsedUrl?.kind === 'short') safeUrl = 'https://b23.tv/' + parsedUrl.code
        else if (parsedUrl?.kind === 'dynamic') safeUrl = 'https://t.bilibili.com/' + parsedUrl.dynamicId
        else if (parsedUrl?.kind === 'video') safeUrl = parsedUrl.bvid
          ? 'https://www.bilibili.com/video/' + parsedUrl.bvid
          : 'https://www.bilibili.com/video/av' + parsedUrl.aid
        else if (parsedUrl?.kind === 'profile') safeUrl = 'https://space.bilibili.com/' + parsedUrl.uid
        // A source=11 card may omit url while still carrying its numeric dynamic id.
        if (!safeUrl && source === 11 && /^[1-9]\d{5,19}$/.test(String(c.id || '')) &&
            (typeof c.id === 'string' || Number.isSafeInteger(c.id)))
          safeUrl = 'https://t.bilibili.com/' + String(c.id)
        const bv = String(c.bvid || '') || (safeUrl.match(/\bBV[0-9A-Za-z]{10}\b/) || [])[0] || ''
        if (!safeUrl && source === 5 && /^BV[0-9A-Za-z]{10}$/.test(bv))
          safeUrl = 'https://www.bilibili.com/video/' + bv
        const title = String(c.headline || c.title || c.desc || '').slice(0, 80)
        const who = String(c.author || '').slice(0, 30)
        const label = source === 11 ? '动态' : source === 5 || bv ? '视频' :
          source === 10 || source === 2 ? '图文' : '内容'
        text = '[分享' + label + '] ' + (title || '(无标题)') + (who ? ' / ' + who : '') +
          (safeUrl ? ' ' + safeUrl : bv ? ' ' + bv : '')
      } else if (mt === 13) {
        // Image/link cards can carry a Bilibili jump_url. Keep only URLs accepted
        // by the same strict HTTPS host/path parser used by Life opportunities.
        const parsedUrl = parseBiliShareUrl(String(c.jump_url || ''))
        let safeUrl = ''
        if (parsedUrl?.kind === 'short') safeUrl = 'https://b23.tv/' + parsedUrl.code
        else if (parsedUrl?.kind === 'dynamic') safeUrl = 'https://t.bilibili.com/' + parsedUrl.dynamicId
        else if (parsedUrl?.kind === 'video') safeUrl = parsedUrl.bvid
          ? 'https://www.bilibili.com/video/' + parsedUrl.bvid
          : 'https://www.bilibili.com/video/av' + parsedUrl.aid
        else if (parsedUrl?.kind === 'profile') safeUrl = 'https://space.bilibili.com/' + parsedUrl.uid
        const title = String(c.title || '').slice(0, 80)
        text = '[网页卡片] ' + (title || '(无标题)') + (safeUrl ? ' ' + safeUrl : '')
        isCard = true
      } else if (mt === 14) {
        const parsedUrl = parseBiliShareUrl(String(c.url || ''))
        let safeUrl = ''
        if (parsedUrl?.kind === 'short') safeUrl = 'https://b23.tv/' + parsedUrl.code
        else if (parsedUrl?.kind === 'dynamic') safeUrl = 'https://t.bilibili.com/' + parsedUrl.dynamicId
        else if (parsedUrl?.kind === 'video') safeUrl = parsedUrl.bvid
          ? 'https://www.bilibili.com/video/' + parsedUrl.bvid
          : 'https://www.bilibili.com/video/av' + parsedUrl.aid
        else if (parsedUrl?.kind === 'profile') safeUrl = 'https://space.bilibili.com/' + parsedUrl.uid
        const title = String(c.title || c.desc || '').slice(0, 80)
        text = '[分享内容] ' + (title || '(无标题)') + (safeUrl ? ' ' + safeUrl : '')
        isCard = true
      } else {
        text = String(c.content || c.text || '')
      }
    } catch { text = String(m.content || '') }
    if (!text) text = '[非文字消息]'
    return {
      key: String(m.msg_key || m.msg_seqno || m.timestamp),
      ts: Number(m.timestamp) || 0,
      fromMe: Number(m.sender_uid) === Number(cred.dedeuserid),
      kind: mt===2 ? 2 : isCard ? mt : 1,
      ...(imageUrl?{imageUrl}:{}),
      text: text.slice(0, 500),
    }
  })
}

/** 我自己的 uid（凭证里有） */
export function myUid(cred) {
  return Number(cred?.dedeuserid) || 0
}
