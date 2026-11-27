/** 12-hour, account-bound display copies of actual video storyboards.
 * Never a Life memory source; images are neither model facts nor permanent audit.
 */
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {verifiedStoryboardCellTexts} from './video-experience.mjs'
const ACCOUNT=/^[a-f0-9]{16}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const ID=/^[a-f0-9]{32}$/
const IMAGE=/^(?:storyboard|focus)-\d{2}\.jpg$/
export const LIFE_GALLERY_RETENTION_HOURS=12
export const LIFE_GALLERY_TTL_MS=LIFE_GALLERY_RETENTION_HOURS*3600_000
const MAX_IMAGE=600_000
const MAX_RECORDS=35
const MAX_BYTES=90*1024*1024
const checkNode=(path)=>{
 if(!existsSync(path))return null
 const s=lstatSync(path)
 if(s.isSymbolicLink())throw Error('视频回放目录包含符号链接，已拒绝访问')
 return s
}
const ensureDirectory=(path)=>{const s=checkNode(path);if(s&&!s.isDirectory())throw Error('视频回放目录不是安全文件夹');if(!s)mkdirSync(path,{mode:0o700});return path}
const dirName=(root,account)=>{
 if(!ACCOUNT.test(account))throw Error('当前账号身份未核验')
 return join(root,'life-video-gallery',account)
}
const safeJson=(path)=>{
 const s=checkNode(path);if(!s?.isFile()||s.size>256*1024)throw Error('视频回放清单损坏')
 return JSON.parse(readFileSync(path,'utf8'))
}
function readRecord(folder,id,now){
 if(!ID.test(id))return null
 const dir=join(folder,id)
 try{
  if(!checkNode(dir)?.isDirectory())return null
  const row=safeJson(join(dir,'manifest.json'))
  if(row.schema!==1||row.id!==id||row.verified!==true||!BV.test(row.bvid)||!Number.isSafeInteger(row.at)||row.at>now+60_000||now-row.at>=LIFE_GALLERY_TTL_MS||
   !['global','focus'].includes(row.phase)||(row.groupId!==undefined&&!ID.test(row.groupId))||!Array.isArray(row.images)||row.images.length>14)return null
  for(const item of row.images){if(!IMAGE.test(item.file)||!Array.isArray(item.times)||item.times.length>12||
   item.times.some(t=>!Number.isFinite(t)||t<0||t>86_400)||
   (item.gridCols!==undefined&&(!Number.isSafeInteger(item.gridCols)||item.gridCols<1||item.gridCols>4))||
   (item.gridRows!==undefined&&(!Number.isSafeInteger(item.gridRows)||item.gridRows<1||item.gridRows>4))||
   (item.gridCols!==undefined&&item.gridRows!==undefined&&item.gridCols*item.gridRows<item.times.length)||
   (item.frameDescriptions!==undefined&&(!Array.isArray(item.frameDescriptions)||item.frameDescriptions.length!==item.times.length||item.frameDescriptions.some(x=>!x||typeof x.text!=='string'||!x.text.trim()||x.text.length>1800||typeof x.truncated!=='boolean'))))return null}
  return row
 }catch{return null}
}
export function listLifeVideoGallery(root,account,{now=Date.now()}={}){
 const folder=dirName(root,account)
 if(!checkNode(join(root,'life-video-gallery'))||!checkNode(folder))return []
 if(!checkNode(folder).isDirectory())throw Error('视频回放账号目录不安全')
 return readdirSync(folder).filter(x=>ID.test(x)).map(x=>readRecord(folder,x,now)).filter(Boolean)
  .sort((a,b)=>b.at-a.at).slice(0,MAX_RECORDS)
  .map(({schema,...row})=>row)
}
export function pruneLifeVideoGallery(root,account,{now=Date.now(),onError=()=>{}}={}){
 const folder=dirName(root,account)
 if(!existsSync(folder))return 0
 const valid=listLifeVideoGallery(root,account,{now})
 const retained=new Set();let bytes=0
 for(const row of valid){
  const folderPath=join(folder,row.id)
  let sum=0
  try{sum+=checkNode(join(folderPath,'manifest.json'))?.size||0;for(const item of row.images)sum+=checkNode(join(folderPath,item.file))?.size||0}catch{continue}
  if(retained.size>=MAX_RECORDS||bytes+sum>MAX_BYTES)continue
  retained.add(row.id);bytes+=sum
 }
 let removed=0
 for(const name of readdirSync(folder)){
  if(!ID.test(name)||retained.has(name))continue
  const target=join(folder,name)
  try{if(checkNode(target)?.isDirectory()){rmSync(target,{recursive:true,force:true});removed++}}catch(error){onError(error)}
 }
 return removed
}
/** Cleanup across past account folders without resolving or following unknown links. */
export function pruneAllLifeVideoGalleries(root,{now=Date.now(),onError=()=>{}}={}){
 const top=join(root,'life-video-gallery')
 if(!checkNode(top))return 0
 if(!checkNode(top).isDirectory())throw Error('视觉回放根目录不安全')
 let removed=0
 for(const account of readdirSync(top)){
  if(!ACCOUNT.test(account))continue
  const folder=join(top,account)
  try{
   if(!checkNode(folder)?.isDirectory())throw Error('视觉回放账号目录不安全')
   removed+=pruneLifeVideoGallery(root,account,{now,onError})
  }catch(error){onError(error)}
 }
 return removed
}
export function addLifeVideoGallery(root,{account,bvid,captures,verified=false,phase='global',groupId='',note='',analysis='',boardReceipts=[],memoryWrite=null,at=Date.now()}={}){
 if(!ACCOUNT.test(account)||!BV.test(bvid)||verified!==true||!['global','focus'].includes(phase))return {ok:false,reason:'not-verified'}
 if(!Array.isArray(captures)||!captures.length)return {ok:false,reason:'no-captures'}
 ensureDirectory(root)
 const top=ensureDirectory(join(root,'life-video-gallery'))
 const folder=ensureDirectory(dirName(root,account))
 const id=randomUUID().replaceAll('-','')
 const staging=join(folder,id)
 let images=[],total=0,committed=false,frameTextBytes=0
 try{
  mkdirSync(staging,{mode:0o700})
  for(const capture of captures.slice(0,3)){
   if(!ID.test(String(capture?.id||''))||!['storyboard','focus'].includes(capture?.kind)||!Array.isArray(capture.images))continue
   const sourceDir=join(root,'vision-perception-captures',capture.id)
   if(!checkNode(join(root,'vision-perception-captures'))?.isDirectory()||!checkNode(sourceDir)?.isDirectory())continue
   for(const image of capture.images.slice(0,14)){
    if(images.length>=14)break
    if(!IMAGE.test(String(image?.file||''))||!Array.isArray(image?.times)||image.times.length>12||
       image.times.some(t=>!Number.isFinite(t)||t<0||t>86_400)||total+MAX_IMAGE>MAX_BYTES)continue
    const source=join(sourceDir,image.file),stat=checkNode(source)
    if(!stat?.isFile()||stat.size>MAX_IMAGE||stat.size<4)continue
    const bytes=readFileSync(source)
    if(bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)continue
    const file=(capture.kind==='focus'?'focus':'storyboard')+'-'+String(images.length).padStart(2,'0')+'.jpg'
    writeFileSync(join(staging,file),bytes,{mode:0o600,flag:'wx'});total+=bytes.length
    const cols=Number(image.gridCols),rows=Number(image.gridRows)
    const grid=Number.isSafeInteger(cols)&&Number.isSafeInteger(rows)&&cols>=1&&cols<=4&&rows>=1&&rows<=4&&cols*rows>=image.times.length
    // Bind exact geometry and every actual sample time to one unique verified
    // board from this same observation. No cross-observation/BV/time guessing.
    const matches=grid&&Array.isArray(boardReceipts)&&boardReceipts.length<=12?boardReceipts.filter(b=>b?.status==='analyzed'&&b.gridCols===cols&&b.gridRows===rows&&Array.isArray(b.times)&&b.times.length===image.times.length&&b.times.every((t,j)=>t===image.times[j])):[]
    let frameDescriptions
    if(matches.length===1){
      const cells=verifiedStoryboardCellTexts(matches[0])
      if(cells?.length===image.times.length){
        const descriptions=cells.map(text=>({text:text.slice(0,1800),truncated:text.length>1800}))
        const size=Buffer.byteLength(JSON.stringify(descriptions),'utf8')
        if(frameTextBytes+size<=96*1024){frameTextBytes+=size;frameDescriptions=descriptions}
      }
    }
    images.push({file,kind:capture.kind,times:image.times.slice(0,12),resolution:String(image.resolution||'').slice(0,50),
      ...(grid?{gridCols:cols,gridRows:rows}:{}),...(frameDescriptions?{frameDescriptions}:{})})
   }
  }
  if(!images.length)return {ok:false,reason:'no-safe-images'}
  const record={schema:1,id,bvid,at,phase,verified:true,...(ID.test(groupId)?{groupId}:{}),note:String(note||'').slice(0,380),
    ...(typeof analysis==='string'&&analysis.trim()?{analysis:analysis.slice(0,24000),analysisTruncated:analysis.length>24000}:{}),
    ...(memoryWrite&&typeof memoryWrite.status==='string'?{memoryWrite:{status:memoryWrite.status.slice(0,40),detailStatus:String(memoryWrite.detailStatus||'').slice(0,40),detailReason:String(memoryWrite.detailReason||'').slice(0,100)}}:{}),images}
  writeFileSync(join(staging,'manifest.json'),JSON.stringify(record)+'\n',{mode:0o600,flag:'wx'})
  committed=true
  pruneLifeVideoGallery(root,account,{now:at})
  return {ok:true,id,images:images.length}
 }catch(error){return {ok:false,reason:'save-failed',error:String(error.message||error).slice(0,100)}}
 finally{if(!committed)try{rmSync(staging,{recursive:true,force:true})}catch{}}
}
export function readLifeVideoGalleryImage(root,account,id,file,{now=Date.now()}={}){
 if(!ID.test(String(id||''))||!IMAGE.test(String(file||'')))return null
 const folder=dirName(root,account)
 if(!checkNode(join(root,'life-video-gallery'))||!checkNode(folder))return null
 const row=readRecord(folder,id,now)
 if(!row||!row.images.some(x=>x.file===file))return null
 const path=join(folder,id,file)
 try{const s=checkNode(path);if(!s?.isFile()||s.size>MAX_IMAGE||s.size<4)return null
  const bytes=readFileSync(path)
  if(bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)return null
  return bytes
 }catch{return null}
}

/** Owner-facing projection; no filesystem paths or untrusted model prose. */
export function recentLifeObservations(root,account,{bvid='',limit=4,now=Date.now()}={}){
 if(bvid&&!BV.test(bvid))return {ok:false,reason:'invalid-bvid',rows:[]}
 const rows=listLifeVideoGallery(root,account,{now}).filter(x=>!bvid||x.bvid===bvid).map(x=>({...x,images:x.images.filter(i=>{try{const s=checkNode(join(dirName(root,account),x.id,i.file));return s?.isFile()&&s.size>=4&&s.size<=MAX_IMAGE}catch{return false}})})).filter(x=>x.images.length).slice(0,Math.max(1,Math.min(4,Math.floor(Number(limit)||4))))
 return {ok:true,retentionHours:LIFE_GALLERY_RETENTION_HOURS,imagesIncluded:false,imageBytesVerified:false,...(!rows.length?{reason:'no-current-observation-frames'}:{}),rows:rows.map(x=>({id:x.id,bvid:x.bvid,at:x.at,phase:x.phase,images:x.images.map(i=>({file:i.file,times:i.times}))}))}
}

/** A precise, current cache selection. Prior captions are evidence, not a new visual inference. */
export function readLifeObservationFrame(root,account,{id,file,now=Date.now()}={}){
 try{
  if(typeof id!=='string'||typeof file!=='string'||!ID.test(id)||!IMAGE.test(file))return {ok:false,reason:'invalid-frame'}
  const row=listLifeVideoGallery(root,account,{now}).find(x=>x.id===id),image=row?.images.find(x=>x.file===file)
  if(!image)return {ok:false,reason:'frame-unavailable'}
  const bytes=readLifeVideoGalleryImage(root,account,id,file,{now})
  if(!bytes)return {ok:false,reason:'frame-unavailable'}
  return {ok:true,bytes,receipt:{id,file,bvid:row.bvid,at:row.at,times:image.times,imageBytesVerified:true,
   previousDescriptions:(image.frameDescriptions||[]).map((x,i)=>({at:image.times[i],text:x.text,truncated:x.truncated})),previousObservationSummary:typeof row.analysis==='string'?row.analysis.slice(0,240):'',newVisualInference:false}}
 }catch{return {ok:false,reason:'frame-unavailable'}}
}

/** Explicit share, not implied by listing or reading. Host owns attachment admission. */
export async function prepareLifeObservationAttachment({frame,exec,agent,isCurrent,getService}){
 const current=()=>!exec?.signal?.aborted&&exec?.agent===agent&&isCurrent()
 if(!current())return {ok:false,reason:'owner-turn-required'}
 if(!frame?.ok||!Buffer.isBuffer(frame.bytes))return {ok:false,reason:frame?.reason||'frame-unavailable'}
 try{
  const store=getService('attachments'),llm=getService('llm'),config=agent.session?.requestHeader?.()?.config
  if(typeof store?.saveImages!=='function'||typeof llm?.resolveModelInfo!=='function'||!config?.provider||!config?.model)return {ok:false,reason:'host-attachment-unavailable'}
  const info=await llm.resolveModelInfo(config.provider,config.model,exec.signal)
  if(!current())return {ok:false,reason:'owner-turn-changed'}
  if(!info?.inputModalities?.includes('image'))return {ok:false,reason:'model-image-input-unavailable'}
  const refs=await store.saveImages([{data:frame.bytes,mediaType:'image/jpeg'}])
  if(!current())return {ok:false,reason:'owner-turn-changed'}
  if(!Array.isArray(refs)||refs.length!==1||!refs[0]||typeof refs[0].attachmentId!=='string'||!refs[0].attachmentId||!['image/jpeg','image/png','image/webp','image/gif'].includes(refs[0].mediaType)||!['bytes','width','height'].every(k=>Number.isSafeInteger(refs[0][k])&&refs[0][k]>0))return {ok:false,reason:'attachment-not-prepared'}
  return {ok:true,attachmentPrepared:true,deliveryConfirmed:false,receipt:{...frame.receipt,previousDescriptions:undefined},attachment:refs[0]}
 }catch{return {ok:false,reason:'host-attachment-unavailable'}}
}

export function lifeObservationShareSelection(frame){
 if(!frame?.ok||!Buffer.isBuffer(frame.bytes)||!frame.receipt)return null
 const {id,file}=frame.receipt
 if(!ID.test(id)||!IMAGE.test(file))return null
 const digest=createHash('sha256').update(frame.bytes).digest('hex')
 return {id,file,digest,marker:'[observation-image:'+digest+']'}
}
