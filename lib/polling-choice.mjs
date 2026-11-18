/** @deprecated Legacy config migration/read compatibility only. The 2.8.1 runtime scheduler uses unified unread-count sentinels and does not import these per-category intervals. */
export const POLLING_PRESETS=Object.freeze({
  balanced:Object.freeze({dmWatchMinutes:5,dmQuietMaxMinutes:5,commentReplyWatchMinutes:2,commentAtWatchMinutes:2}),
  quiet:Object.freeze({dmWatchMinutes:5,dmQuietMaxMinutes:45,commentReplyWatchMinutes:10,commentAtWatchMinutes:10}),
  responsive:Object.freeze({dmWatchMinutes:5,dmQuietMaxMinutes:10,commentReplyWatchMinutes:2,commentAtWatchMinutes:2}),
});
export const POLLING_KEYS=Object.freeze(Object.keys(POLLING_PRESETS.balanced));
export const boundedPollingMinute=(value,fallback)=>Number.isSafeInteger(Number(value))&&Number(value)>=1
  ?Math.min(120,Math.max(1,Number(value))):fallback;
/** First and last values are configurable. Middle levels are calculated,
 * not hardcoded, and may coincide when the interval range is narrow. */
export function dmQuietIntervals({dmWatchMinutes=5,dmQuietMaxMinutes=5}={}){
  const min=boundedPollingMinute(dmWatchMinutes,5);
  const max=Math.max(min,boundedPollingMinute(dmQuietMaxMinutes,5));
  const span=max-min;
  return [min,Math.min(max,min+Math.round(span*.25)),Math.min(max,min+Math.round(span*.60)),max];
}
export function detectPollingPreset(config={}){
  return Object.entries(POLLING_PRESETS).find(([,values])=>POLLING_KEYS.every(k=>
    Number(config[k])===values[k]))?.[0]||'custom';
}
