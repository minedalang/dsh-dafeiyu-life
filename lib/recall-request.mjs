/** dev.25: deterministic read-only recall semantics. Model supplies intent and
 * search formulations; the host decides clock/time-zone and authorization.
 * Never accept model-authored UID, domain, role, archives or raw timestamps.
 */
import {normalizeRecallQueries} from './active-recall-contract.mjs'

const INTENTS=new Set(['topic_recall','activity_recall','conversation_recall','event_recall','fact_recall'])
const KINDS=new Set(['watch','comment','social','private-social'])
const DAY=86400000
const DATE=/^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const relativeDays={today:0,yesterday:1,day_before_yesterday:2}
const DEFAULT_ZONE=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}catch{return 'UTC'}}
function zoneOf(value){try{const id=String(value||DEFAULT_ZONE());new Intl.DateTimeFormat('en-US',{timeZone:id});return id}catch{return 'UTC'}}
const dayParts=(ms,tz)=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]))
 return {year:Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute),second:Number(p.second)}
}
const dateString=ms=>new Date(ms).toISOString().slice(0,10)
const validDate=s=>{
 const m=String(s||'').match(DATE);if(!m)return false
 return dateString(Date.UTC(+m[1],+m[2]-1,+m[3]))===s
}
const shiftDay=(day,delta)=>{
 const [y,m,d]=day.split('-').map(Number)
 return dateString(Date.UTC(y,m-1,d+delta))
}
function startOfDay(day,tz){
 const [y,m,d]=day.split('-').map(Number)
 const wanted=Date.UTC(y,m-1,d)
 let utc=wanted
 // Local midnight is UTC midnight minus the time zone offset; iterate across
 // DST boundaries, rather than assuming that every civil day lasts 24h.
 for(let i=0;i<5;i++){
  const p=dayParts(utc,tz),asUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)
  const adjusted=utc+(wanted-asUtc)
  if(Math.abs(adjusted-utc)<1000)return adjusted
  utc=adjusted
 }
 return utc
}
export function normalizeRecallTime(raw,{now=Date.now(),timeZone}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
 const tz=zoneOf(timeZone)
 const clock=Number.isFinite(Number(now))?Number(now):Date.now()
 const p=dayParts(clock,tz),localDay=dateString(Date.UTC(p.year,p.month-1,p.day))
 let from='',to=''
 if(typeof raw.relative==='string'&&Object.hasOwn(relativeDays,raw.relative)){
  from=shiftDay(localDay,-relativeDays[raw.relative]);to=from
 }else if(typeof raw.day==='string'&&validDate(raw.day))from=to=raw.day
 else if(validDate(raw.fromDay)&&validDate(raw.toDay)){
  from=raw.fromDay;to=raw.toDay
  const count=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY
  if(count<0||count>30)return null
 }else return null
 return {start:startOfDay(from,tz),end:startOfDay(shiftDay(to,1),tz),fromDay:from,toDay:to,timeZone:tz}
}
export function normalizeRecallRequest(raw,{now=Date.now(),timeZone}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null
 const queries=normalizeRecallQueries(raw.queries||raw.query)
 if(!queries.length)return null
 const intent=INTENTS.has(raw.intent)?raw.intent:'topic_recall'
 const kinds=[...new Set((Array.isArray(raw.kinds)?raw.kinds:[]).filter(k=>typeof k==='string'&&KINDS.has(k)))].slice(0,4)
 const time=normalizeRecallTime(raw.time||raw.timeRange,{now,timeZone})
 // Malformed time is rejected rather than silently lifting a requested filter.
 if((raw.time||raw.timeRange)&&!time)return null
 return {queries,intent,kinds,time,structured:true}
}
export function isRecallRecordEligible(row,request,{type='episode'}={}){
 if(!request?.structured)return true
 const kind=String(row?.kind||'')
 const allowKinds=request.kinds?.length?request.kinds:(request.intent==='conversation_recall'?['social','comment','private-social']
  :request.intent==='activity_recall'||request.intent==='event_recall'?['watch','social','comment','private-social']:[])
 if(allowKinds.length){if(type!=='episode'||!allowKinds.includes(kind))return false}
 if(request.time){
  // Writing a fact today is not evidence that the event happened today.
  // Fuzzy / trace episodes deliberately no longer expose their exact time.
  if(type==='episode'&&row?.stage!=='clear')return false
  const raw=type==='episode'?row?.at:row?.occurredAt
  const at=typeof raw==='number'?raw:typeof raw==='string'&&raw?Date.parse(raw):NaN
  if(!Number.isFinite(at)||at<request.time.start||at>=request.time.end)return false
 }
 return true
}
export const __test={validDate,shiftDay,startOfDay,zoneOf}
