/** Ephemeral, verified *in-flight* activity for the Life management page.
 * No UID, private DM text, prompt, file path, or inferred video contents are stored.
 * This is process-local: after restart, previously running actions are NOT claimed active.
 */
const TYPES=Object.freeze({
  video:{title:'正在探索 B站视频',detail:'视频 Agent 已启动；不代表看完或理解画面'},
  dm:{title:'正在考虑一条私信回复',detail:'已进入当前账号的私信决策；未确认发送'},
  comment:{title:'正在考虑评论回复',detail:'已进入当前账号的评论决策；未确认发表'},
  life:{title:'正在考虑接下来做什么',detail:'Life Planner 已开始；鱼鱼可以选择休息'},
})
export function createLiveLifeActivity({now=Date.now}={}){
  const active=new Map();const completed=[];let seq=0
  function start(kind,scope,{maxAgeMs=3600_000}={}){
    if(!Object.hasOwn(TYPES,kind)||typeof scope!=='string'||!scope)return ()=>{}
    const token=++seq
    active.set(token,{kind,scope,since:now(),expires:now()+Math.max(1000,Math.min(3600_000,maxAgeMs))})
    let stopped=false
    return ()=>{if(!stopped){stopped=true;active.delete(token);completed.push({scope,at:new Date(now()).toISOString(),kind,text:({video:'视频探索进程已结束（不代表已观看）',dm:'私信决策已结束（未核实发送）',comment:'评论决策已结束（未核实发表）',life:'一次 Life 决策已结束'})[kind]});if(completed.length>30)completed.splice(0,completed.length-30)}}
  }
  function snapshot(scope){
    // Fail closed on identity errors; never expose another account's activity.
    const valid=typeof scope==='string'&&scope.length>0,ts=now()
    for(const [id,row] of active){if(row.expires<=ts)active.delete(id)}
    const rows=valid?[...active.values()].filter(row=>row.scope===scope).sort((a,b)=>b.since-a.since).map(row=>({kind:row.kind,title:TYPES[row.kind].title,detail:TYPES[row.kind].detail,since:new Date(row.since).toISOString()})):[]
    const history=valid?completed.filter(row=>row.scope===scope&&Date.parse(row.at)>ts-48*3600_000).slice(-8).map(({scope:_scope,...publicRow})=>publicRow):[]
    return {ok:true,live:rows.length>0,active:rows,recent:history,verified:'process-in-flight-only',accountReady:valid}
  }
  return {start,snapshot}
}
