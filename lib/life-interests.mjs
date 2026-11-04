/**
 * 大肥鱼人生记忆的兴趣档案。由已经选择的真实 BV 作为证据，
 * 不把单条观看提升为长期偏好，也不自动改写主人配置的人设和搜索关键词。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {createHash} from 'node:crypto'
import { TOPICS } from './persona-growth.mjs'

const FILE = 'life-memory/interests.json'
const DAY = 86400000
const CURIOSITY_TTL=14*DAY,DISMISS_TTL=30*DAY
const topicKey=topic=>createHash('sha256').update(String(topic||'').toLowerCase().replace(/\s+/g,'')).digest('hex').slice(0,24)
const safeCandidate=(x,now)=>x?.source==='autonomous-selection'&&curiosityTopic(x.topic)===x.topic&&bvValid(x.bvid)&&Number.isFinite(x.at)&&now-x.at>=0&&now-x.at<=CURIOSITY_TTL
const safeDismissed=(x,now)=>x&&/^[a-f0-9]{24}$/.test(String(x.id||''))&&curiosityTopic(x.topic)===x.topic&&x.id===topicKey(x.topic)&&Number.isFinite(x.at)&&now-x.at>=0&&now-x.at<=DISMISS_TTL
const clean=(x,n=180)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
const bvValid = s=>/^BV[0-9A-Za-z]{10}$/.test(String(s||''))
const blank=()=>({schema:1,entries:[],curiosityCandidates:[],curiosityDismissed:[],updatedAt:''})
const pathOf=dir=>join(dir,'life-memory','interests.json')
function read(dir){
  const path=pathOf(dir)
  if(!existsSync(path))return blank()
  const st=lstatSync(path)
  if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)throw Error('兴趣档案文件不安全或过大')
  const data=JSON.parse(readFileSync(path,'utf8'))
  if(data?.schema!==1||!Array.isArray(data.entries)||
    (data.curiosityCandidates!==undefined&&!Array.isArray(data.curiosityCandidates))||
    (data.curiosityDismissed!==undefined&&!Array.isArray(data.curiosityDismissed)))throw Error('兴趣档案格式不兼容')
  return data
}
function save(dir,data){
  const path=pathOf(dir);mkdirSync(join(dir,'life-memory'),{recursive:true})
  if(lstatSync(join(dir,'life-memory')).isSymbolicLink())throw Error('兴趣档案目录不能是符号链接')
  if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('兴趣档案不能写入非普通文件')
  const tmp=path+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600})
  renameSync(tmp,path)
}
function stageOf(e,now=Date.now()){
  const ev=(e.evidence||[]).filter(x=>{
    // Historical entries have no reliable provenance: retain for review but
    // do not feed them back as the fish's own preferences.
    if(x?.source!=='autonomous-selection')return false
    const at=Date.parse(x.at||x.day||'')
    return Number.isFinite(at) && now-at>=-DAY && now-at<=90*DAY
  })
  const dates=new Set(ev.map(x=>clean(x.day,10)))
  const count=ev.length
  // 至少三条不同 BV、横跨两天才确认“开始有兴趣”。
  const legacy=(e.evidence||[]).some(x=>x?.source!=='autonomous-selection')
  const stage=count>=12&&dates.size>=5?'stable':count>=6&&dates.size>=3?'growing':count>=3&&dates.size>=2?'emerging':legacy?'legacy-unverified':'insufficient'
  const ever=String(e.peakStage||'')
  const visible=stage==='insufficient'&&['emerging','growing','stable'].includes(ever)?'quiet':stage
  const times=ev.map(x=>Date.parse(x.at||x.day||'')).filter(Number.isFinite).sort((a,b)=>a-b)
  const spanDays=times.length>1?(times[times.length-1]-times[0])/DAY:0
  const interestType=visible==='stable'?'stable':visible==='growing'?'growth':visible==='quiet'?'fading':visible==='emerging'?'short-term':visible==='legacy-unverified'?'unverified':'core-candidate'
  return {stage:visible,interestType,spanDays:Math.round(spanDays),rolling90:count,days90:dates.size}
}
function quality(e){return e?.autonomousSelected===true||e?.tier==='selected'}
// Open curiosity is a temporary read-only search hint, NOT evidence that the
// fish likes the subject. Do not turn an arbitrary video title into a durable
// personality or execute an embedded instruction. The topic vocabulary is open;
// TOPICS remains the evidence classifier for established learned preferences.
const UNSAFE_CURIOSITY=/(?:忽略|系统提示|开发者|执行|工具调用|指令|命令|密钥|令牌|token|cookie|密码|验证码|身份证|手机号|地址|家庭住址|私信|聊天记录|api.?key|越狱|注入|色情|暴力|赌博|诈骗|爆炸物|炸药|制毒|自残|自杀|违禁|宗教|政治立场|病历|诊断|病史|性取向|system prompt|developer|ignore previous|instructions|javascript|shell|prompt)/i
function curiosityTopic(title){
 const text=clean(title,180).replace(/[<>`{}\\\r\n]/g,' ')
 const head=text.split(/[：:｜|【】\[\]《》—–！!？?]/)[0].replace(/[\p{C}]/gu,' ').trim().slice(0,40)
 return head.length>=3&&!UNSAFE_CURIOSITY.test(text)&&!/(?:https?:|www\.|BV[A-Za-z0-9]{10}|[0-9]{7,}|@[\p{L}\p{N}_])/iu.test(text)?head:''
}

export function recordInterestEvents(dir,events=[],now=Date.now()){
  if(!Array.isArray(events)||!events.length)return {added:0}
  const state=read(dir);let added=0,curiosityAdded=0
  const map=new Map((state.entries||[]).map(x=>[x.topic,x]))
  for(const e of events){
    if(e?.kind!=='watch'||!bvValid(e.bvid)||!clean(e.title)||!quality(e))continue
    const text=clean(e.title,240)
    const hits=Object.entries(TOPICS).filter(([,rx])=>rx.test(text)).map(([topic])=>topic)
    if(!hits.length){
      const topic=curiosityTopic(text),at=Date.parse(e.time||e.day||'')||now
      const suppressed=new Set((state.curiosityDismissed||[]).filter(x=>safeDismissed(x,now)).map(x=>x.id))
      // The old owner-facing worth/not-worth label cannot be evidence of
      // the fish's autonomous curiosity. Only an explicit selected event
      // contributes an open-topic candidate; a pick is NOT a like.
      if((e.tier==='selected'||e.autonomousSelected===true)&&topic&&at<=now+DAY&&at>=now-CURIOSITY_TTL&&!suppressed.has(topicKey(topic))&&
        !((state.curiosityCandidates||[]).some(x=>x.bvid===e.bvid))){
        state.curiosityCandidates=[...(state.curiosityCandidates||[]).filter(x=>safeCandidate(x,now)),
          {topic,bvid:String(e.bvid),at,source:'autonomous-selection'}].slice(-60)
        curiosityAdded++
      }
    }
    for(const topic of hits){
      let row=map.get(topic)
      if(!row){row={topic,firstSeen:new Date(now).toISOString(),lastSeen:'',peakStage:'',evidence:[],history:[]};map.set(topic,row)}
      if(row.evidence.some(x=>x.bvid===e.bvid))continue
      const at=Date.parse(e.time||e.day||'')||now
      // 历史证据最多 90 条，避免兴趣记录无限增长
      row.evidence.push({bvid:String(e.bvid),at:new Date(at).toISOString(),day:new Date(at).toISOString().slice(0,10),source:'autonomous-selection'})
      row.evidence=row.evidence.slice(-90)
      row.lastSeen=new Date(at).toISOString()
      const next=stageOf(row,now)
      const prev=row.peakStage||'insufficient'
      if(next.stage!==prev&&next.stage!=='insufficient'&&next.stage!=='quiet'){
        row.history.push({at:new Date(now).toISOString(),from:prev,to:next.stage,evidenceCount:row.evidence.length})
        row.history=row.history.slice(-20)
        row.peakStage=next.stage
      }
      added++
    }
  }
  if(added||curiosityAdded){state.entries=[...map.values()].slice(0,30);state.updatedAt=new Date(now).toISOString();save(dir,state)}
  return {added,curiosityAdded}
}
const LABEL={'legacy-unverified':'旧版历史线索（来源待核验）',stable:'多次自主选看倾向',growing:'持续自主探索线索',emerging:'初步选看线索',quiet:'近期选看减少',insufficient:'证据不足'}
export function listLifeInterests(dir,now=Date.now()){
  const data=read(dir)
  return (data.entries||[]).map(e=>({...e,...stageOf(e,now),label:LABEL[stageOf(e,now).stage]}))
    .filter(e=>e.stage!=='insufficient')
    .sort((a,b)=>Date.parse(b.lastSeen||'')-Date.parse(a.lastSeen||''))
}
export function interestMemoryRows(dir,now=Date.now()){
  return listLifeInterests(dir,now).filter(e=>e.stage!=='legacy-unverified').map(e=>({
    id:'interest:'+e.topic,
    text:`大肥鱼在最近90天对「${e.topic}」有${e.rolling90}条自主选看线索，分布在${e.days90}天；这只证明曾多次选择探索，不等于已经喜欢、看完或必须继续观看。`,
    memoryKind:'interest',
    category:'interest_profile',
    tags:[e.topic,'兴趣','关注'],
    source:'life-interest',
    importance:e.stage==='stable'?.82:e.stage==='growing'?.74:.6,
    createdAt:e.lastSeen||'',
    evidenceKeys:(e.evidence||[]).slice(-12).map(x=>x.bvid),
  }))
}
/** Owner-curated core interests are explicit preferences, separate from learned trends. */
export function normalizeCoreInterestTopics(value){
  let rows=value
  if(typeof value==='string'){
    const text=value.trim()
    try{const parsed=JSON.parse(text);rows=Array.isArray(parsed)?parsed:text.split(/[\n、，,；;|]+/)}catch{rows=text.split(/[\n、，,；;|]+/)}
  }
  if(!Array.isArray(rows))return []
  const out=[],seen=new Set()
  for(const raw of rows){
    const topic=clean(raw,48).replace(/^(?:我)?(?:喜欢|爱看|爱玩|爱听|感兴趣于|偏好)\s*/,'').trim()
    const key=topic.toLowerCase()
    if(topic.length<2||seen.has(key)||/(系统提示|开发者|忽略.{0,8}指令|执行.{0,8}命令|读取.{0,8}文件|ignore.{0,12}instructions|system prompt|developer message|prompt injection|私信|聊天记录|密码|验证码|token|cookie|api.?key|凭据|住址|身份证)/i.test(topic))continue
    seen.add(key);out.push(topic);if(out.length>=12)break
  }
  return out
}
const queryForTopic=topic=>topic==='DeepSeek／DSH'?'DeepSeek Harness':topic==='AI模型拟人'?'AI 模型娘':topic==='AI陪伴与情感'?'AI 陪伴':topic==='白饭与美食'?'美食 料理':topic==='Token与模型技术'?'大模型 Agent':topic==='二次元与音乐'?'动漫 音乐':topic==='鬼畜与抽象'?'鬼畜 搞笑':topic==='奶娃'?'奶娃':topic==='奶蛙'?'奶蛙':topic
/** Core topics seed exploration; learned trends fill the remaining slots and never overwrite the owner baseline. */
export function selectionInterests(dir,now=Date.now(),max=3,coreTopics=[]){
  const limit=Math.max(1,Math.min(4,Number(max)||3)),core=normalizeCoreInterestTopics(coreTopics)
  const weights={stable:4,growing:3,emerging:1.5},coreKeys=new Set(core.map(x=>x.toLowerCase()))
  const learned=listLifeInterests(dir,now).filter(e=>weights[e.stage]&&e.interestType!=='fading'&&!coreKeys.has(e.topic.toLowerCase()))
    .sort((a,b)=>(weights[b.stage]-weights[a.stage]) || Date.parse(b.lastSeen||'')-Date.parse(a.lastSeen||''))
  const eligibleCore=core
  // Rotate the first core topic daily so several owner-set interests get a fair chance.
  const start=eligibleCore.length?Math.floor(now/DAY)%eligibleCore.length:0
  const rotated=eligibleCore.length?[...eligibleCore.slice(start),...eligibleCore.slice(0,start)]:[]
  const selectedCore=rotated.slice(0,Math.min(1,limit)).map(topic=>({topic,stage:'core',interestType:'core',query:queryForTopic(topic)}))
  const remaining=limit-selectedCore.length
  const selectedLearned=learned.filter(e=>!selectedCore.some(c=>c.topic.toLowerCase()===e.topic.toLowerCase())).slice(0,remaining).map(e=>({topic:e.topic,stage:e.stage,interestType:e.interestType,query:queryForTopic(e.topic)}))
  const fillCore=rotated.filter(topic=>!selectedCore.some(c=>c.topic===topic)&&!selectedLearned.some(e=>e.topic.toLowerCase()===topic.toLowerCase()))
    .slice(0,Math.max(0,limit-selectedCore.length-selectedLearned.length)).map(topic=>({topic,stage:'core',interestType:'core',query:queryForTopic(topic)}))
  const selected=[...selectedCore,...selectedLearned,...fillCore].slice(0,limit)
  // At most once every third day include one novel, time-bound topic in an
  // existing authorized read-only selection round. The other slots retain the
  // owner's core topics and established interests. Never represent this as like.
  const state=read(dir),suppressed=new Set((state.curiosityDismissed||[]).filter(x=>safeDismissed(x,now)).map(x=>x.id))
  const candidates=(state.curiosityCandidates||[]).filter(x=>safeCandidate(x,now)&&
    !suppressed.has(topicKey(x.topic))&&!selected.some(y=>y.topic===x.topic))
  // Repeated voluntary selections across distinct days are stronger *curiosity*
  // evidence, not proof of liking. Keep a single slot for discovery.
  const grouped=new Map()
  for(const x of candidates){const key=topicKey(x.topic),g=grouped.get(key)||{...x,count:0,days:new Set()}
    g.count++;g.days.add(new Date(x.at).toISOString().slice(0,10));grouped.set(key,g)}
  const ranked=[...grouped.values()].sort((a,b)=>
    (b.days.size>=2?1:0)-(a.days.size>=2?1:0)||b.at-a.at)
  if(ranked.length&&Math.floor(now/DAY)%3===0){
    const candidate=ranked[Math.floor(now/(3*DAY))%ranked.length]
    const revisited=candidate.count>=2&&candidate.days.size>=2
    const hint={topic:candidate.topic,stage:revisited?'revisited':'unknown',interestType:'curiosity',query:candidate.topic}
    if(selected.length<limit)selected.push(hint)
    else if(selected.length>=2)selected[selected.length-1]=hint
    else if(!selected.length)selected.push(hint)
  }
  return selected.slice(0,limit)
}
/** Review only already-observed, short-lived public-video curiosity hints.
 * A dismissal is a 30-day owner veto for that topic, not a statement of dislike.
 * This never changes long-term interests, owner core topics, or external permissions.
 */
export function curiosityReview(dir,{action,bvid='',id='',now=Date.now()}={}){
  const state=read(dir)
  state.curiosityCandidates=(state.curiosityCandidates||[]).filter(x=>safeCandidate(x,now)).slice(-60)
  state.curiosityDismissed=(state.curiosityDismissed||[]).filter(x=>safeDismissed(x,now)).slice(-60)
  if(action==='dismiss'){
    const candidate=state.curiosityCandidates.find(x=>x.bvid===String(bvid||''))
    if(!candidate)throw Error('找不到当前有效的好奇候选 BV')
    const key=topicKey(candidate.topic)
    state.curiosityDismissed=[...state.curiosityDismissed.filter(x=>x.id!==key),
      {id:key,topic:candidate.topic,at:now}].slice(-60)
    state.curiosityCandidates=state.curiosityCandidates.filter(x=>topicKey(x.topic)!==key)
  }else if(action==='restore'){
    if(!/^[a-f0-9]{24}$/.test(String(id||''))||!state.curiosityDismissed.some(x=>x.id===id))throw Error('找不到可恢复的排除记录')
    state.curiosityDismissed=state.curiosityDismissed.filter(x=>x.id!==id)
  }else if(action==='clear'){
    state.curiosityCandidates=[]
  }else throw Error('不支持的好奇候选操作')
  state.updatedAt=new Date(now).toISOString();save(dir,state)
  return {ok:true}
}
export function listCuriosityReview(dir,now=Date.now()){
  const state=read(dir),dismissed=(state.curiosityDismissed||[]).filter(x=>safeDismissed(x,now)).slice(-60)
  const veto=new Set(dismissed.map(x=>x.id))
  const raw=(state.curiosityCandidates||[]).filter(x=>safeCandidate(x,now)&&!veto.has(topicKey(x.topic)))
  const groups=new Map()
  for(const c of raw){const key=topicKey(c.topic),g=groups.get(key)||{...c,count:0,days:new Set(),lastAt:0}
    g.count++;g.days.add(new Date(c.at).toISOString().slice(0,10))
    if(c.at>=g.lastAt){g.lastAt=c.at;g.bvid=c.bvid;g.at=c.at}
    groups.set(key,g)}
  const candidates=[...groups.values()].map(({days,...g})=>({...g,days:days.size,
    stage:g.count>=2&&days.size>=2?'revisited':'first-contact'})).sort((a,b)=>b.at-a.at).slice(0,60)
  return {candidates,dismissed:dismissed.map(x=>({...x,until:x.at+DISMISS_TTL}))}
}
export const __test={stageOf,pathOf,quality,curiosityTopic,topicKey}
