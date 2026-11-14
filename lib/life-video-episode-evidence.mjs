/** Only trusted completed read-only TODO receipts may seed a Life video episode. */
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=x=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,85)
export function verifiedCompletedVideoTodo(task,completed){
  if(task?.type!=='watch_video'||!BV.test(String(task.bvid||''))||
    completed?.ok!==true||completed?.item?.status!=='done'||
    completed.item.type!=='watch_video'||completed.item.bvid!==task.bvid||
    completed.item.id!==task.id||!Number.isSafeInteger(completed.item.completedAt)||
    completed.item.completedAt<=0||completed?.result?.ok!==true||
    completed.result.data?.ok!==true||completed.result.data.bvid!==task.bvid)
    return null
  let info=completed.result.data.info
  if(typeof info==='string'){try{info=JSON.parse(info)}catch{return null}}
  if(info?.data&&typeof info.data==='object')info=info.data
  if(info?.bvid!==task.bvid||!clean(info.title))return null
  return {ok:true,bvid:task.bvid,title:clean(info.title),completedAt:completed.item.completedAt}
}
