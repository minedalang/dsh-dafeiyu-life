/**
 * 2.8.0 cross-scene action audit projection (NOT an execution authority).
 * Every agent may contribute a state transition, but only the existing
 * LifeWillingness proof + channel-specific sender can authorize a write.
 * No UID, message, BV, raw source, proof token or reply text is persisted.
 * A process restart never replays a stored action: pending writes require review.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {withLifeWillingnessLedgerLock} from './life-planner-atomic.mjs'
const FILE='life-action-records.json',LIMIT=512,MAX=360_000
const SCOPE=/^[a-f0-9]{16}$/,KIND=/^[a-z][a-z0-9_-]{1,45}$/
const STATES=new Set(['selected','queued','executing','verified','blocked','system_deferred','fish_deferred','declined','uncertain'])
const FINAL=new Set(['verified','blocked','fish_deferred','declined','uncertain'])
const fingerprint=(scope,value)=>createHash('sha256').update('life-action-record\0'+scope+'\0'+String(value)).digest('hex').slice(0,32)
const empty=()=>({version:1,rows:[]})
function read(dir){
 const path=join(dir,FILE)
 if(!existsSync(path))return empty()
 const st=lstatSync(path)
 if(!st.isFile()||st.isSymbolicLink()||st.size>MAX)throw Error('life-action-record-unsafe')
 const j=JSON.parse(readFileSync(path,'utf8'))
 if(j?.version!==1||!Array.isArray(j.rows)||j.rows.length>LIMIT||j.rows.some(r=>
   !/^[a-f0-9]{32}$/.test(r?.id)||!/^[a-f0-9]{32}$/.test(r?.account)||
   !KIND.test(r?.kind)||!STATES.has(r?.state)||!Number.isSafeInteger(r?.at)||r.at<1))
   throw Error('life-action-record-corrupt')
 return j
}
function write(dir,value){
 const path=join(dir,FILE)
 if(existsSync(path)){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('life-action-record-unsafe')}
 const encoded=JSON.stringify(value)
 if(Buffer.byteLength(encoded)>MAX)throw Error('life-action-record-capacity')
 const tmp=path+'.'+process.pid+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,encoded+'\n',{flag:'wx',mode:0o600})
 renameSync(tmp,path)
}
/** Identifier is a caller-owned decision/proof ID, never text or a platform id. */
export function createLifeActionRecords({dataDir,getAccountTag,now=Date.now}={}){
 if(!dataDir||typeof getAccountTag!=='function')throw TypeError('action-records dependencies missing')
 const current=()=>String(getAccountTag()||'')
 const update=({decisionId,kind,state,source='',receiptId=''}={})=>{
  const scope=current()
  if(!SCOPE.test(scope)||!KIND.test(String(kind||''))||!STATES.has(state)||
    typeof decisionId!=='string'||decisionId.length<3||decisionId.length>220)return {ok:false,reason:'invalid-action-record'}
  try{return withLifeWillingnessLedgerLock(dataDir,()=>{
   const document=read(dataDir),id=fingerprint(scope,decisionId),account=fingerprint(scope,'account'),row=document.rows.find(x=>x.id===id)
   if(row){
     if(row.account!==account||row.kind!==kind)return {ok:false,reason:'identity-mismatch'}
     if(FINAL.has(row.state)){
       // Multi-bubble confirmed replies can produce further independent receipts;
       // do not regress or reschedule the original choice.
       return {ok:row.state===state,reason:row.state===state?'already-recorded':'terminal-record'}
     }
     if(row.state==='executing'&&state==='queued')return {ok:false,reason:'state-regression'}
     row.state=state;row.at=now()
     if(receiptId&&state==='verified')row.receipt=fingerprint(scope,receiptId)
   }else{
     document.rows.push({id,account,kind,state,at:now(),source:source?fingerprint(scope,source):'',
       ...(receiptId&&state==='verified'?{receipt:fingerprint(scope,receiptId)}:{})})
   }
   document.rows.sort((a,b)=>b.at-a.at)
   document.rows=document.rows.slice(0,LIMIT)
   write(dataDir,document)
   return {ok:true,reason:'recorded'}
  },{now})}catch{return {ok:false,reason:'action-record-storage-unavailable'}}
 }
 const list=({limit=30}={})=>{
  const scope=current();if(!SCOPE.test(scope))return {ok:false,rows:[]}
  try{const account=fingerprint(scope,'account');return {ok:true,rows:read(dataDir).rows.filter(r=>r.account===account)
    .slice(0,Math.min(100,Math.max(1,Number(limit)||30)))
    .map(r=>({kind:r.kind,state:r.state,at:r.at,
      // Proofs in an interrupted process are never magically replayable.
      reviewRequired:r.state==='executing'||r.state==='selected'||r.state==='queued',
      hasVerifiedReceipt:Boolean(r.receipt)}))}}
  catch{return {ok:false,rows:[],reason:'action-record-storage-unavailable'}}
 }
 return {update,list}
}
