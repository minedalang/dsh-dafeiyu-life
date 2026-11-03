/** Existing accepted-TODO parentage, never an authorization source. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Resolve the new explicit link while preserving RC1 owner child records. */
export function todoParentId(todo){
  const explicit=String(todo?.parentTodoId||'')
  if(UUID.test(explicit))return explicit
  return String(todo?.sourceKey||'').match(/^(?:owner-ai-watch|social-ai-watch|explore-watch):([0-9a-f-]{36}):BV[0-9A-Za-z]{10}$/i)?.[1]||''
}
export const childOf=(row,id)=>Boolean(id)&&row?.type==='watch_video'&&todoParentId(row)===id
/** Compare verifiable original-request provenance; a shared parent alone is not proof. */
export function sameRequest(a,b){
  const x=a?.origin||{},y=b?.origin||{}
  return Boolean(x.kind&&x.kind===y.kind&&x.messageId&&x.messageId===y.messageId&&
    x.uid&&String(x.uid)===String(y.uid))
}

/** A corrupted or mismatched group must never mix two original requesters. */
export function consistentChildGroup(rows){
  if(!Array.isArray(rows)||rows.length<2)return true
  const o=rows[0]?.origin||{}
  return rows.every(row=>{
    const x=row?.origin||{}
    return String(x.kind||'')===String(o.kind||'')&&
      String(x.uid||'')===String(o.uid||'')&&
      String(x.messageId||'')===String(o.messageId||'')
  })
}
