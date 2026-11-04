/**
 * 补齐「刷过的视频」：优先信任原 seen.md 表格，另外合并 seen 的自由文本、
 * digest 的视频归档和 out 的「### BV」明确入选记录。
 * 只读取文件、不写判重表，避免补显示时修改 Agent 的判重规则。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BV = /\bBV[0-9A-Za-z]{10}\b/
const DAY = /(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/
const normalizedDay = (value) => {
  const m = DAY.exec(String(value || ''))
  if (!m) return ''
  const parts = m[1].split(/[-/]/)
  const day = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
  const d = new Date(day + 'T12:00:00Z')
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === day ? day : ''
}
const explicitSelection = status => /^(?:挑中|已挑中|选中|已选中|入选|已入选|收下|已收下|日报明确挑中)$/.test(String(status || '').trim())
const clean = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[\s|·—–]+$/g, '').replace(/^[\s|·—–*]+/g, '').trim()
const readText = (path) => { try { return readFileSync(path, 'utf8') } catch { return '' } }
const listFiles = (path, pattern, max) => { try { return readdirSync(path).filter(f => pattern.test(f)).sort().reverse().slice(0, max) } catch { return [] } }

// 已有行优先，报告中的明确入选标记优先于自由文本里的「看过」描述。
export function mergeWatchedRows(seenRows, stateDir) {
  const map = new Map()
  const keyFor = r => `${r.day}/${r.bvid}`
  const add = (r, fromReport = false) => {
    if (!r?.day || !/^BV[0-9A-Za-z]{10}$/.test(r.bvid)) return
    const key = keyFor(r)
    const old = map.get(key)
    if (!old) {
      map.set(key, {
        day: r.day, bvid: r.bvid, title: r.title || r.bvid, up: r.up || '',
        status: r.status || '', picked: Boolean(r.picked),
        autonomousSelected: Boolean(fromReport || r.autonomousSelected === true || explicitSelection(r.status)),
        commented: Boolean(r.commented),
        delivered: Boolean(r.delivered),
        url: 'https://www.bilibili.com/video/' + r.bvid,
      })
      return
    }
    if ((!old.title || old.title === old.bvid) && r.title && r.title !== r.bvid) old.title = r.title
    if (!old.up && r.up) old.up = r.up
    if (!old.status && r.status) old.status = r.status
    if (r.picked && (fromReport || !/跳过|没挑|未选/.test(old.status))) old.picked = true
    if (fromReport || r.autonomousSelected === true || explicitSelection(r.status)) old.autonomousSelected = true
    old.commented ||= Boolean(r.commented)
    old.delivered ||= Boolean(r.delivered)
    if (fromReport && !old.picked) { old.picked = true; old.status = '日报明确挑中' }
  }
  for (const row of seenRows || []) add(row)

  // ① 兼容 Agent 在「看过的视频」区域写入的自由文本（非规范表格）
  const seen = readText(join(stateDir, 'seen.md'))
  let inCommentSection = false
  for (const raw of seen.split(/\r?\n/)) {
    const t = raw.trim()
    if (/^#{1,6}\s*评论记录/.test(t)) { inCommentSection = true; continue }
    if (/^#{1,6}\s*/.test(t) && !/评论记录/.test(t)) inCommentSection = false
    if (inCommentSection || !t || t.startsWith('| ---') || !BV.test(t)) continue
    const day = normalizedDay(t)
    if (!day) continue
    const bvid = BV.exec(t)[0]
    // 存在 rpid 的「评论记录」不是视频观看记录
    if (/\|\s*\d{9,}\s*\|/.test(t)) continue
    const parts = t.replace(/^[-*]\s*/, '').split(/\s*[|·│]\s*/).map(clean).filter(Boolean)
    const i = parts.findIndex(p => p === bvid || p.includes(bvid))
    const title = i >= 0 ? clean(parts[i + 1]) : ''
    const up = i >= 0 ? clean(parts[i + 2]) : ''
    const skip = /跳过|未选|没挑|不收|无字幕|无语音/.test(t)
    add({ day, bvid, title, up, picked: !skip && /挑中|收下|已选|值得看|可以看/.test(t),
      autonomousSelected:!skip && /(?:挑中|收下|已选)/.test(t),
      status: skip ? '跳过（判重表）' : '看过（判重表）' })
  }

  // ② 读取当月及近期的视频归档：一行一条「日期 · BV · 标题 · UP · 结论 · 链接」
  // 归档只证明「看过」，不能凭出现一个 BV 就说「挑中了」。
  const digest = join(stateDir, 'digest')
  for (const f of listFiles(digest, /^20\d{2}-\d{2}\.md$/, 12)) {
    let currentDay = ''
    for (const raw of readText(join(digest, f)).split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(raw)) { currentDay = normalizedDay(raw) || currentDay; continue }
      const bv = BV.exec(raw)
      if (!bv) continue
      const day = normalizedDay(raw) || currentDay
      if (!day) continue
      const parts = raw.replace(/^\s*[-*]\s*/, '').split(/\s*[·|│]\s*/).map(clean).filter(Boolean)
      const i = parts.findIndex(p => p === bv[0] || p.includes(bv[0]))
      const title = i >= 0 ? parts[i + 1] : ''
      const up = i >= 0 ? parts[i + 2] : ''
      const skipped = /跳过|没挑|未读字幕|无字幕|未选择/.test(raw)
      add({ day, bvid: bv[0], title, up, status: skipped ? '跳过（视频归档）' : '看过（视频归档）' })
    }
  }

  // ③ 日报中的 `### BV...` 是明确的「挑中」标记，和每日额度计算使用同一口径。
  const out = join(stateDir, 'out')
  for (const f of listFiles(out, /^20\d{2}-\d{2}-\d{2}\.md$/, 60)) {
    const day = f.slice(0, 10)
    const txt = readText(join(out, f)).replace(/```[\s\S]*?```/g, '')
    const re = /^#{2,3}[ \t]*(BV[0-9A-Za-z]{10})\b[^\n]*$/gm
    const hits = [...txt.matchAll(re)]
    for (let i = 0; i < hits.length; i++) {
      const bv = hits[i][1]
      const block = txt.slice(hits[i].index + hits[i][0].length, hits[i + 1]?.index ?? txt.length).slice(0, 2000)
      const title = clean((/^(?:[-*]\s*)?(?:\*\*)?标题(?:\*\*)?\s*[：:]\s*(.+)$/mi.exec(block) || [])[1])
      const up = clean((/^(?:[-*]\s*)?(?:\*\*)?(?:UP主|UP)(?:\*\*)?\s*[：:]\s*(.+)$/mi.exec(block) || [])[1])
      add({ day, bvid: bv, title, up, status: '日报明确挑中', picked: true, autonomousSelected:true }, true)
    }
  }

  return [...map.values()].sort((a, b) => (a.day === b.day ? Number(b.picked) - Number(a.picked) : (a.day < b.day ? 1 : -1)))
}
