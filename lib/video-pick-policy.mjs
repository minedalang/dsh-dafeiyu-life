/**
 * Historical daily pick quotas were retired before dev.54, but the installed
 * duty.md could still tell the model to stop reading once 50 were selected.
 * This is a prompt compatibility adapter, NOT a B站 write permission grant.
 * It never touches the user's on-disk charter or the seen/report evidence.
 */
const legacyLineReplacements = [
  [/^2\. 从结果里挑出\*\*值得的\*\*，条数同时受.*$/u,
    '2. 从候选里自主挑真正值得的作品。每天不设入选视频数量上限；每轮阅读/入选数是参考目标，不必凑数。已看过的 BV 仍要判重。'],
  [/^\s*⭐⭐ \*\*这一行是宿主数配额用的\*\*.*$/u,
    '   ⭐⭐ `### BV号` 标题用于统计真正入选的作品，不是每日名额或停止阅读的条件。'],
  [/^\s*⚠️ 只是\*\*提到过 \/ 跳过.*当天的额度会被它吃掉.*$/u,
    '   ⚠️ 只是提到过或跳过的 BV 不应写成入选标题，否则会污染真实入选统计。'],
  [/^\s*当天的额度会被它吃掉.*$/u,
    '   注意：错误地把跳过作品标为入选会污染真实经历统计，但没有每日入选限额。'],
  [/^\s*⭐ \*\*一天只有这一份\*\*.*$/u,
    '   ⭐ 一天的日报继续追加，不要覆盖之前的真实入选证据。'],
  [/^\s*「每天最多挑几条」是\*\*全天\*\*的总量.*$/u,
    '  当日入选数量只用于实际经历展示，不再控制后续视频探索。'],
  [/^\s*⭐ 补进去的每一段照样\*\*以 `### BV号` 开头\*\* —— 宿主数的就是这种标题行.*$/u,
    '  ⭐ 每个真实入选段落仍以 `### BV号` 开头，供报告和经历统计。'],
]
export function normalizeRetiredDailyPickCharter(value) {
  return String(value || '').split(/\r?\n/u).map(line => {
    for (const [pattern,replacement] of legacyLineReplacements) {
      if(pattern.test(line))return replacement
    }
    return line
  }).join('\n')
}
export const VIDEO_PICK_POLICY = `【当前视频探索规则·覆盖旧章程的每日选片条数说法】
从本轮起，每天不再设“最多挑中 50 条”或任何其它每日挑中数量上限；旧配置 perDay 与日报/判重表中的今日入选总数仅作兼容统计；pickPerRound 仍是本轮柔性目标，不应被当天累计入选数抵扣。
如果旧版 duty.md 或其它历史文字仍提到“每日挑中限额”“挑中额度已满”“按当天挑中数量停止浏览”，那些要求已退役，不能作为只看标题、跳过字幕、拒绝详情核验、停止挑选或拒绝发表评论的原因。即使今日已挑中超过 50 条，也可以继续自主选片。此前仅因“额度已满／额度不明”而只看标题、标记跳过的 BV 不等于真正读过，可以重新查详情和内容，再据实决定入选；不能因此重读已真正入选或已评论的 BV。
只保留每轮由主人设置的柔性阅读/入选目标，以及真实 BV 判重、视频热度与内容证据门槛、B站读取预算、模型/启动节奏。点赞、收藏、关注、评论、动态等外发行为仍受各自独立开关、每日额度、身份、防重、Life 意愿及平台回执限制；不要求为凑数量做出任何行为。`
