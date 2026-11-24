/** 24-hour, account-bound display copies of actual video storyboards.
 * Never a Life memory source; images are neither model facts nor permanent audit.
 */
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
const ACCOUNT=/^[a-f0-9]{16}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const ID=/^[a-f0-9]{32}$/
const IMAGE=/^(?:storyboard|focus)-\d{2}\.jpg$/
const TTL=24*3600_000
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
 const s=checkNode(path);if(!s?.isFile()||s.size>16000)throw Error('视频回放清单损坏')
 return JSON.parse(readFileSync(path,'utf8'))
}
function readRecord(folder,id,now){
 if(!ID.test(id))return null
 const dir=join(folder,id)
 try{
  if(!checkNode(dir)?.isDirectory())return null
  const row=safeJson(join(dir,'manifest.json'))
  if(row.schema!==1||row.id!==id||row.verified!==true||!BV.test(row.bvid)||!Number.isSafeInteger(row.at)||row.at>now+60_000||now-row.at>=TTL||
   !['global','focus'].includes(row.phase)||(row.groupId!==undefined&&!ID.test(row.groupId))||!Array.isArray(row.images)||row.images.length>14)return null
  for(const item of row.images){if(!IMAGE.test(item.file)||!Array.isArray(item.times)||item.times.length>12||
   item.times.some(t=>!Number.isFinite(t)||t<0||t>86_400)||
   (item.gridCols!==undefined&&(!Number.isSafeInteger(item.gridCols)||item.gridCols<1||item.gridCols>4))||
   (item.gridRows!==undefined&&(!Number.isSafeInteger(item.gridRows)||item.gridRows<1||item.gridRows>4))||
   (item.gridCols!==undefined&&item.gridRows!==undefined&&item.gridCols*item.gridRows<item.times.length))return null}
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
export function pruneLifeVideoGallery(root,account,{now=Date.now()}={}){
 const folder=dirName(root,account)
 if(!existsSync(folder))return 0
 const valid=listLifeVideoGallery(root,account,{now})
 const retained=new Set();let bytes=0
 for(const row of valid){
  const folderPath=join(folder,row.id)
  let sum=0
  try{for(const item of row.images)sum+=checkNode(join(folderPath,item.file))?.size||0}catch{continue}
  if(retained.size>=MAX_RECORDS||bytes+sum>MAX_BYTES)continue
  retained.add(row.id);bytes+=sum
 }
 let removed=0
 for(const name of readdirSync(folder)){
  if(!ID.test(name)||retained.has(name))continue
  const target=join(folder,name)
  if(checkNode(target)?.isDirectory()){rmSync(target,{recursive:true,force:true});removed++}
 }
 return removed
}
/** Cleanup across past account folders without resolving or following unknown links. */
export function pruneAllLifeVideoGalleries(root,{now=Date.now()}={}){
 const top=join(root,'life-video-gallery')
 if(!checkNode(top))return 0
 if(!checkNode(top).isDirectory())throw Error('视觉回放根目录不安全')
 let removed=0
 for(const account of readdirSync(top)){
  if(!ACCOUNT.test(account))continue
  const folder=join(top,account)
  if(!checkNode(folder)?.isDirectory())throw Error('视觉回放账号目录不安全')
  removed+=pruneLifeVideoGallery(root,account,{now})
 }
 return removed
}
export function addLifeVideoGallery(root,{account,bvid,captures,verified=false,phase='global',groupId='',note='',at=Date.now()}={}){
 if(!ACCOUNT.test(account)||!BV.test(bvid)||verified!==true||!['global','focus'].includes(phase))return {ok:false,reason:'not-verified'}
 if(!Array.isArray(captures)||!captures.length)return {ok:false,reason:'no-captures'}
 ensureDirectory(root)
 const top=ensureDirectory(join(root,'life-video-gallery'))
 const folder=ensureDirectory(dirName(root,account))
 const id=randomUUID().replaceAll('-','')
 const staging=join(folder,id)
 let images=[],total=0,committed=false
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
    images.push({file,kind:capture.kind,times:image.times.slice(0,12),resolution:String(image.resolution||'').slice(0,50),
      ...(Number.isSafeInteger(cols)&&Number.isSafeInteger(rows)&&cols>=1&&cols<=4&&rows>=1&&rows<=4&&cols*rows>=image.times.length?
        {gridCols:cols,gridRows:rows}:{})})
   }
  }
  if(!images.length)return {ok:false,reason:'no-safe-images'}
  const record={schema:1,id,bvid,at,phase,verified:true,...(ID.test(groupId)?{groupId}:{}),note:String(note||'').slice(0,380),images}
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
