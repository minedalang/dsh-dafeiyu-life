/** Typed Bilibili content references. Numeric IDs MUST remain strings. */
export const validVideoId = value => /^BV[0-9A-Za-z]{10}$/.test(String(value ?? ''))
export const validDynamicId = value => /^[1-9][0-9]{5,19}$/.test(String(value ?? ''))
export const validCommentId = value => /^[1-9][0-9]{0,29}$/.test(String(value ?? ''))
export function contentRef({bvid='',dynamicId=''}={}) {
  if(validVideoId(bvid) && !dynamicId) return {type:'video',id:String(bvid),bvid:String(bvid)}
  if(validDynamicId(dynamicId) && !bvid) return {type:'dynamic',id:String(dynamicId),dynamicId:String(dynamicId)}
  return null
}
export function contentUrl(ref) {
  return ref?.type==='video' ? `https://www.bilibili.com/video/${ref.id}`
    : ref?.type==='dynamic' ? `https://t.bilibili.com/${ref.id}` : ''
}
