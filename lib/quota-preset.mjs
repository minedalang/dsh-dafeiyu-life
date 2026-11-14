/** One set of numeric quota presets. Cards change ceilings, never send permissions. */
export const QUOTA_PRESETS = Object.freeze({
  gentle: Object.freeze({ commentDailyLimit:100,dmReplyPerDay:50,commentReplyPerDay:100,commentReplyPerPoll:8,dynamicDailyLimit:2,autoVideoLikeDailyLimit:30 }),
  natural: Object.freeze({ commentDailyLimit:500,dmReplyPerDay:200,commentReplyPerDay:500,commentReplyPerPoll:20,dynamicDailyLimit:6,autoVideoLikeDailyLimit:80 }),
  active: Object.freeze({ commentDailyLimit:800,dmReplyPerDay:300,commentReplyPerDay:800,commentReplyPerPoll:30,dynamicDailyLimit:12,autoVideoLikeDailyLimit:100 }),
})
export const QUOTA_MODES = Object.freeze(['gentle','natural','active','custom'])
// Every editable quota on this panel must switch the saved card to custom,
// even if it is not one of the six preset-controlled fields.
export const QUOTA_EDIT_KEYS = Object.freeze([
  'commentDailyLimit','commentPerRound','biliReadMinuteLimit','biliReadHourLimit',
  'dynamicDailyLimit','autoVideoLikeDailyLimit','commentReplyHotCount','commentReplyPerPoll',
  'commentReplyPerDay','commentOwnTopPerUser','commentOwnNestedPerUser','dmReplyPerDay',
  'dmContextMessages','dmStrangerMaxReplies','commentMemesPerDay','commentMemesPerRound',
  'memeMemoryMaxEntries','visionFrames','visionDailyLimit','minVideoViews','minVideoLikes','minVideoReplies',
])
/** Validate a card and invalidate it when an unrelated writer changes a quota. */
export function resolveQuotaPresetPatch(current={},patch={}) {
  const next={...patch}
  if (Object.hasOwn(next,'quotaPreset')) {
    if (!QUOTA_MODES.includes(next.quotaPreset)) throw Error('互动节奏方案不合法')
    if (next.quotaPreset!=='custom') {
      const controlled=QUOTA_PRESETS[next.quotaPreset]
      if (QUOTA_EDIT_KEYS.some(key=>!Object.hasOwn(controlled,key)&&Object.hasOwn(next,key)&&Number(next[key])!==Number(current[key])))
        throw Error('其他额度已修改，请先切换为自定义方案')
      for (const [key,value] of Object.entries(controlled)) {
        if (Number(Object.hasOwn(next,key)?next[key]:current[key])!==value)
          throw Error('方案 '+next.quotaPreset+' 与 '+key+' 的真实数值不一致，须选择自定义')
      }
    }
  } else if (QUOTA_EDIT_KEYS.some(key=>Object.hasOwn(next,key)&&Number(next[key])!==Number(current[key]))) {
    next.quotaPreset='custom'
  }
  return next
}
