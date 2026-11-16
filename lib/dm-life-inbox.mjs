/** Account-scoped durable metadata-only continuation ledger for inbound DM Life.
 * No bodies/images/prompts/credentials. Network reads and platform sends remain
 * exclusively in the authenticated DM engine and its existing safety gates.
 */
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
const uid=v=>/^[1-9]\d{0,18}$/.test(String(v??''))?String(v):''
const messageId=v=>typeof v==='string'&&v.length>0&&v.length<=150&&!/[\r\n\0]/.test(v)?v:''
const ACTIVE=new Set(['pending','deciding','technical-deferred','send-unknown','review-required'])
export function createDmLifeInbox({dataDir,now=Date.now}={}) {
  if(!dataDir)throw TypeError('DM Life continuation requires account-scoped dataDir')
  const file=join(dataDir,'dm-life-inbox.json')
  let db={version:1,rows:[]}
  try{
    const obj=JSON.parse(readFileSync(file,'utf8'))
    if(obj?.version!==1||!Array.isArray(obj.rows)||obj.rows.length>2500||obj.rows.some(r=>
      !uid(r?.uid)||!messageId(r?.id)||!ACTIVE.has(r?.status)||
      !Number.isSafeInteger(r?.at)||!Number.isSafeInteger(r?.retryAt)||
      !Number.isSafeInteger(r?.attempts)||r.at<0||r.retryAt<0||r.attempts<0||r.attempts>100||
      !Number.isSafeInteger(r?.sourceAt)||r.sourceAt<=0)||
      new Set(obj.rows.map(r=>`${r.uid}\0${r.id}`)).size!==obj.rows.length)throw Error('invalid')
    db=obj
  }catch(e){if(e.code!=='ENOENT')throw Error('私信 Life 续办账本损坏：冻结自动续办以防重复发送')}
  const save=()=>{
    mkdirSync(dataDir,{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(db)+'\n',{mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
  }
  const get=(id,mid)=>db.rows.find(r=>r.uid===uid(id)&&r.id===messageId(mid))
  const observe=rows=>{
    let changed=false
    for(const m of rows){
      const id=uid(m?.uid),mid=messageId(m?.id),time=Number(m?.time)
      if(!id||!mid||!Number.isSafeInteger(time)||time<=0||get(id,mid))continue
      if(db.rows.length>=2500)throw Error('私信 Life 续办账本已满，暂停提交读取游标，等待人工核查')
      db.rows.push({uid:id,id:mid,sourceAt:time,at:Math.max(0,Math.trunc(now())),status:'pending',retryAt:0,attempts:0})
      changed=true
    }
    if(changed)save()
  }
  const has=(id,mid)=>Boolean(get(id,mid))
  const wakeForNewMessage=ids=>{
    let changed=false
    for(const r of db.rows){
      if(ids.has(r.uid)&&r.status==='technical-deferred'){
        r.status='pending';r.retryAt=0;changed=true
      }
    }
    if(changed)save()
  }
  const eligible=(id,mid)=>{
    const r=get(id,mid);if(!r)return true
    if(r.status==='send-unknown'||r.status==='review-required')return false
    if(r.status==='deciding')return now()-r.retryAt>=5*60_000 // lease ended; no send reservation was made
    return now()>=r.retryAt
  }
  const due=(limit=2)=>db.rows.filter(r=>eligible(r.uid,r.id))
    .sort((a,b)=>a.at-b.at).slice(0,Math.max(0,Math.min(10,limit)))
    .map(r=>({...r}))
  const claim=(id,mid)=>{
    const r=get(id,mid);if(!r||!eligible(id,mid))return false
    if(r.attempts>=12){r.status='review-required';save();return false}
    r.status='deciding';r.retryAt=Math.trunc(now());r.attempts++;save();return true
  }
  const defer=(id,mid,{delay=90_000}={})=>{
    const r=get(id,mid);if(!r||r.status==='send-unknown'||r.status==='review-required')return
    r.status='technical-deferred';r.retryAt=Math.trunc(now())+Math.max(30_000,Math.min(30*60_000,Math.round(delay)));save()
  }
  const uncertain=(id,mid)=>{const r=get(id,mid);if(!r)return;r.status='send-unknown';r.retryAt=0;save()}
  // Allowed only when the sender adapter proves it was never invoked.
  const noRemoteAttempt=(id,mid)=>{
    const r=get(id,mid);if(!r||r.status!=='send-unknown')return
    r.status='technical-deferred';r.retryAt=Math.trunc(now())+90_000;save()
  }
  const review=(id,mid)=>{const r=get(id,mid);if(!r)return;r.status='review-required';r.retryAt=0;save()}
  // Remove only after the ordinary DM state (seen/silent/delivery receipt) is durable.
  const complete=(id,mid)=>{const n=db.rows.length;db.rows=db.rows.filter(r=>r.uid!==uid(id)||r.id!==messageId(mid));if(db.rows.length!==n)save()}
  const status=()=>({pending:db.rows.filter(r=>r.status==='pending'||r.status==='deciding').length,
    technicalDeferred:db.rows.filter(r=>r.status==='technical-deferred').length,
    sendUnknown:db.rows.filter(r=>r.status==='send-unknown').length,
    reviewRequired:db.rows.filter(r=>r.status==='review-required').length,
    oldestPendingSeconds:Math.max(0,Math.round((now()-Math.min(now(),...db.rows.filter(r=>r.status!=='send-unknown').map(r=>r.at)))/1000))})
  return {observe,has,wakeForNewMessage,eligible,due,claim,defer,uncertain,noRemoteAttempt,review,complete,status}
}
