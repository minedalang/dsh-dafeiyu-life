'use strict';
(() => {
 const $=id=>document.getElementById(id),api='/api/bili-duty/migration',labels={python:'Python 包管理缓存',model:'模型与视觉缓存',memory:'Life 记忆'};
 let current=null,busy=false;
 const set=(id,value)=>{$(id).textContent=String(value)};
 const refresh=async()=>{
  try{
   const response=await fetch(api+'/status',{cache:'no-store'}),row=await response.json();
   if(!response.ok||!row.ok)throw Error('无法核对迁移状态');current=row;
   const active=row.status==='waiting'||row.status==='running',kind=labels[row.domain]||'数据';
   $('spinner').hidden=!active;$('cancel').disabled=!active||row.cancelRequested||busy;
   set('heading',active?kind+' · 正在安全迁移':row.status==='completed'?kind+' · 迁移已完成':row.status==='cancelled'?kind+' · 已安全取消':kind+' · 迁移已停止');
   set('detail',active?(row.cancelRequested?'已发送取消请求，正在等待离线迁移器完成安全收尾。':row.status==='waiting'?'正在等待旧 DSH 与相关进程结束，尚未复制数据。':'数据正在离线复制或校验；插件业务功能暂时不会启动。'):
    row.status==='completed'?'迁移已结算，路径已切换并验证。请重新启动 DSH 以启用完整插件。':
    row.status==='cancelled'?'没有切换未完成的迁移数据；原生效路径继续保留。请重新启动 DSH。':
    (row.reason||'任务已停止，原数据保留。')+' 请重新启动 DSH。');
   const ts=Date.parse(row.startedAt||row.createdAt||'');
   set('elapsed',active&&Number.isFinite(ts)?'已等待约 '+Math.max(0,Math.floor((Date.now()-ts)/1000))+' 秒 · 每 2 秒自动刷新':'维护模式不会在后台启动 Life、Python 或模型任务');
   set('hint',active?'取消只发出请求，不强制结束正在写入的操作；进入最终切换后可能无法取消。':'迁移任务已结算；重新启动 DSH 后会恢复正常管理中心。');
  }catch{set('detail','无法读取任务进度；为保护数据，业务模块继续暂停。请检查 DSH 宿主状态。');$('cancel').disabled=true;}
 };
 $('refresh').addEventListener('click',refresh);
 $('cancel').addEventListener('click',async()=>{
  if(!current||!['waiting','running'].includes(current.status)||busy)return;
  if(!confirm('请求安全取消此次迁移？原数据保留，复制中的半成品不会作为生效数据。'))return;
  busy=true;$('cancel').disabled=true;
  try{
   const res=await fetch(api+'/cancel',{method:'POST',headers:{'content-type':'application/json','x-dafeiyu-management-intent':'1'},body:JSON.stringify({jobId:current.id,confirm:true})});
   const data=await res.json();if(!res.ok)throw Error(data.error||'取消请求失败');
   set('detail','已提交安全取消请求，等待离线助手在安全点确认；不会强制杀进程。');
  }catch(e){set('detail',String(e?.message||'取消失败；保持等待'))}
  finally{busy=false;await refresh()}
 });
 refresh();setInterval(refresh,2000);
})();
