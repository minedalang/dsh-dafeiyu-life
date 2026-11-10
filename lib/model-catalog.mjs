/** Normalize only identifiers actually returned by DSH's model registry.
 * A selected or historically configured model is a UI hint, never a verified adapter. */
const id=x=>typeof x==='string'?x:typeof x?.id==='string'?x.id:
  typeof x?.modelId==='string'?x.modelId:typeof x?.name==='string'?x.name:''
const legal=x=>typeof x==='string'&&x.length>0&&x.length<=200&&!/[\r\n\0]/.test(x)
export function providerIds(raw){
  const arr=Array.isArray(raw)?raw:Array.isArray(raw?.providers)?raw.providers:[]
  return [...new Set(arr.map(id).filter(legal))].slice(0,40)
}
export function modelIds(raw){
  const arr=Array.isArray(raw)?raw:Array.isArray(raw?.models)?raw.models:[]
  return [...new Set(arr.map(id).filter(legal))].slice(0,100)
}
export function mergeObservedModel(rows,selected){
  const result=(Array.isArray(rows)?rows:[]).map(p=>({...p,models:[...(p.models||[])]}))
  if(!legal(selected?.provider)||!legal(selected?.model))return result
  const row=result.find(x=>x.id===selected.provider)
  if(row){if(!row.models.includes(selected.model))row.models.push(selected.model)}
  else result.push({id:selected.provider,models:[selected.model],kind:'observed-only',synced:false})
  return result
}
