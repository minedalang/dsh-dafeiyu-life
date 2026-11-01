/** Public-only character/interest hints for the autonomous favorite-folder style.
 * These hints never grant write permission or alter a user-named folder.
 */
export function favoriteStyleFromPersona(prompt=''){
  const raw=String(prompt||'').slice(0,8000)
  if(/(?:傲娇|嘴硬|口是心非)/.test(raw))return 'tsundere'
  if(/(?:温柔|体贴|治愈)/.test(raw))return 'gentle'
  if(/(?:活泼|元气|调皮|搞笑)/.test(raw))return 'playful'
  if(/(?:冷静|理性|沉稳)/.test(raw))return 'calm'
  return ''
}
export function publicFavoriteTopics(core,interests=[]){
  let items=[]
  try{const x=typeof core==='string'?JSON.parse(core):core;if(Array.isArray(x))items=x}catch{}
  if(!Array.isArray(interests))interests=[]
  return [...new Set([...items,...interests.map(x=>x?.topic)].map(x=>String(x||'').trim()).filter(x=>/^[\p{L}\p{N}\s·-]{2,16}$/u.test(x)))].slice(0,10).join('、').slice(0,160)
}
