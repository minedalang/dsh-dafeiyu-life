/** Ephemeral, verified *in-flight* activity for the Life management page.
 * No UID, private DM text, prompt, file path, or inferred video contents are stored.
 * This is process-local: after restart, previously running actions are NOT claimed active.
 */
const validBvid=value=>/^BV[0-9A-Za-z]{10}$/.test(String(value||''))
const TYPES=Object.freeze({
  video:{title:'正在探索 B站视频',detail:'视频 Agent 已启动；不代表看完或理解画面'},
  'video-observe':{title:'正在看视频画面',detail:'Life 已自主决定读取画面；等待实际视觉模型回执，未证实已理解'},
  'video-observe-debug':{title:'主人正在测试视频画面',detail:'手动只读验收，不是鱼鱼的自主生活行动；正在等待画面与模型回执'},
  dm:{title:'正在考虑一条私信回复',detail:'已进入当前账号的私信决策；未确认发送'},
  comment:{title:'正在考虑评论回复',detail:'已进入当前账号的评论决策；未确认发表'},
  life:{title:'正在考虑接下来做什么',detail:'Life Planner 已开始；鱼鱼可以选择休息'},
})
export function createLiveLifeActivity({now=Date.now,onChange=()=>{}}={}){
  const active=new Map();const completed=[];let seq=0
  function start(kind,scope,{maxAgeMs=3600_000,bvid=''}={}){
    if(!Object.hasOwn(TYPES,kind)||typeof scope!=='string'||!scope)return ()=>{}
    const token=++seq
    const age=Math.max(1000,Math.min(3600_000,maxAgeMs));
    active.set(token,{kind,scope,since:now(),expires:now()+age,
      ...(kind.startsWith('video')&&validBvid(bvid)?{bvid:String(bvid)}:{})});try{onChange()}catch{}
    // One expiry event, not a periodic poll. A stale in-flight action is never
    // falsely recorded as a completed action.
    const expiry=setTimeout(()=>{if(active.delete(token))try{onChange()}catch{}},age+50);expiry.unref?.()
    let stopped=false
    return ()=>{if(!stopped){stopped=true;clearTimeout(expiry);active.delete(token);if(kind!=='comment')completed.push({scope,at:new Date(now()).toISOString(),kind,text:({'video':'视频探索进程已结束（不代表已观看）','video-observe':'视频画面观察阶段已结束（是否理解以视觉回执为准）','video-observe-debug':'主人视频感知试运行已结束（非 Life 自主行动，是否理解以回执为准）',dm:'私信决策已结束（未核实发送）',comment:'评论决策已结束（未核实发表）',life:'一次 Life 决策已结束'})[kind]});if(completed.length>30)completed.splice(0,completed.length-30);try{onChange()}catch{}}}
  }
  function snapshot(scope){
    // Fail closed on identity errors; never expose another account's activity.
    const valid=typeof scope==='string'&&scope.length>0,ts=now()
    for(const [id,row] of active){if(row.expires<=ts)active.delete(id)}
    const rows=valid?[...active.values()].filter(row=>row.scope===scope).sort((a,b)=>b.since-a.since).map(row=>({kind:row.kind,title:TYPES[row.kind].title,detail:TYPES[row.kind].detail,since:new Date(row.since).toISOString(),
      ...(validBvid(row.bvid)?{bvid:row.bvid,videoUrl:'https://www.bilibili.com/video/'+row.bvid}:{})})):[]
    const history=valid?completed.filter(row=>row.scope===scope&&Date.parse(row.at)>ts-48*3600_000).slice(-8).map(({scope:_scope,...publicRow})=>publicRow):[]
    return {ok:true,live:rows.length>0,active:rows,recent:history,verified:'process-in-flight-only',accountReady:valid}
  }
  return {start,snapshot}
}
