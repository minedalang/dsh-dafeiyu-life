/** Track real user edits against the value before the first edit.
 * A change that returns to the original value clears the unsaved marker.
 * Programmatic hydration never creates a draft unless it is explicitly captured.
 */
const snapshot=field=>{
  if(!field||typeof field!=='object')return null
  if(field.type==='checkbox'||field.type==='radio')return {checked:field.checked===true}
  if(field.multiple&&field.selectedOptions)return {values:[...field.selectedOptions].map(x=>String(x.value)).sort()}
  return {value:String(field.value??'')}
}
const key=value=>JSON.stringify(value)
export function createSettingDraftTracker(){
  const baselines=new WeakMap(),drafts=new Map()
  const capture=field=>{
    if(!field||typeof field!=='object'||baselines.has(field))return false
    baselines.set(field,snapshot(field));return true
  }
  const change=(field,save,panel='当前页面')=>{
    if(!field||!save||!baselines.has(field))return false
    const baseline=baselines.get(field),current=snapshot(field)
    let row=drafts.get(save.id)
    if(key(current)===key(baseline)){
      row?.fields?.delete(field)
      if(!row?.fields?.size)drafts.delete(save.id)
    }else{
      if(!row){row={panel,save,fields:new Set()};drafts.set(save.id,row)}
      row.fields.add(field)
    }
    return drafts.has(save.id)
  }
  const saved=save=>{
    if(!save?.id||!drafts.has(save.id))return false
    const row=drafts.get(save.id)
    for(const field of row?.fields||[])baselines.set(field,snapshot(field))
    drafts.delete(save.id);return true
  }
  return {capture,change,saved,drafts,has:()=>drafts.size>0,clear:()=>drafts.clear()}
}
export const __test={snapshot}
