/**
 * Prompt-only context budgeting. Never use for authoritative ledgers, receipts,
 * tool arguments, permissions, or persistent memory. The caller must preserve
 * full source data separately. Returned JSON is ALWAYS valid; omission is
 * explicit rather than silently cutting a JSON string in the middle.
 */
const OMIT='…[中间内容已省略]…'
export function boundedText(value, maxChars, {mode='edges'}={}) {
  const text=String(value??'')
  const max=Math.max(0,Math.trunc(Number(maxChars)||0))
  if(text.length<=max)return text
  if(max<=OMIT.length+4)return text.slice(0,max)
  const left=Math.floor((max-OMIT.length)*(mode==='head'?0.8:mode==='tail'?0.25:0.5))
  const right=max-OMIT.length-left
  return text.slice(0,left)+OMIT+text.slice(-right)
}

/** Subtitles have a chronological beginning, middle and end, unlike ledgers. */
export function boundedTranscript(value,maxChars=12000) {
  const text=String(value??'')
  const max=Math.max(0,Math.trunc(Number(maxChars)||0))
  if(text.length<=max)return {text,truncated:false,originalChars:text.length,selection:'complete'}
  const marker='\n[字幕中段内容已省略，不能据此推断缺失片段]\n'
  if(max<marker.length+90)return {text:boundedText(text,max),truncated:true,originalChars:text.length,selection:'edges'}
  const available=max-marker.length*2
  const head=Math.floor(available*.34),middle=Math.floor(available*.33),tail=available-head-middle
  const center=Math.floor((text.length-middle)/2)
  return {text:text.slice(0,head)+marker+text.slice(center,center+middle)+marker+text.slice(-tail),
    truncated:true,originalChars:text.length,selection:'beginning-middle-end'}
}

const important=/^(?:id|bvid|uid|kind|action|source|verified|status|at|time|timestamp|eventRef|proof|candidateId)$/i
/**
 * For read-only model context only: give large sibling strings comparable room,
 * then drop older array entries. Do not slice the serialized JSON itself.
 * Supports records with many candidate IDs without favoring only the first.
 */
export function boundedJson(value,maxChars=1400) {
  const max=Math.max(64,Math.trunc(Number(maxChars)||1400))
  let root
  try {root=JSON.parse(JSON.stringify(value??null))}
  catch {return JSON.stringify({contextUnavailable:'unserializable'})}
  const encode=()=>JSON.stringify(root)
  let raw=encode()
  if(raw.length<=max)return raw
  let truncated=false
  for(let pass=0;pass<500&&raw.length>max;pass++){
    const strings=[],arrays=[],optional=[]
    const walk=(node,parent,key,depth=0)=>{
      if(depth>32)return
      if(typeof node==='string'){
        if(node.length>28&&!important.test(String(key)))strings.push({parent,key,length:node.length})
      } else if(Array.isArray(node)){
        if(node.length>1)arrays.push({node,length:node.length})
        node.forEach((entry,i)=>walk(entry,node,i,depth+1))
      } else if(node&&typeof node==='object'){
        for(const [k,v] of Object.entries(node)){
          if(!important.test(k))optional.push({node,key:k,value:v})
          walk(v,node,k,depth+1)
        }
      }
    }
    walk(root,null,'')
    // Shrink every long field proportionally, preserving both the first and
    // last parts so that late turns and endings are not completely discarded.
    if(strings.length){
      strings.sort((a,b)=>b.length-a.length)
      const item=strings[0],old=item.parent[item.key]
      const next=Math.max(24,Math.min(old.length-1,Math.floor(old.length*.65)))
      item.parent[item.key]=boundedText(old,next)
      truncated=true
    }else if(arrays.length){
      // Older entries go first; most recent evidence remains discoverable.
      arrays.sort((a,b)=>b.length-a.length)
      arrays[0].node.shift()
      truncated=true
    }else if(optional.length){
      // A brief, explicit omission beats malformed JSON. Identity/provenance
      // keys remain present whenever the caller supplied them.
      optional.sort((a,b)=>JSON.stringify(b.value).length-JSON.stringify(a.value).length)
      delete optional[0].node[optional[0].key]
      truncated=true
    }else break
    raw=encode()
  }
  if(raw.length>max)return JSON.stringify({contextUnavailable:'exceeded-safe-prompt-budget',originalChars:raw.length})
  return raw
}
