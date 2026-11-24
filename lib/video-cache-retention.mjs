/** Only disposable video artifacts, never model weights, memory, ledgers or migration backups. */
import {lstatSync,readdirSync,readFileSync,rmSync} from 'node:fs'
import {join,resolve,parse,dirname} from 'node:path'
import {storageDomainRoot} from './storage-layout.mjs'
import {pruneAllLifeVideoGalleries} from './life-video-gallery.mjs'
const H=3600_000
export const VIDEO_CACHE_RETENTION=Object.freeze({asr:7*24*H,vision:24*H,capture:H/2,orphan:24*H,interval:15*60_000})
const BV='BV[0-9A-Za-z]{10}'
const asrFile=new RegExp('^'+BV+'-[A-Za-z0-9-]{1,24}-(auto|zh|en)-v[0-9]+\\.json$')
const visionFile=new RegExp('^'+BV+'(?:-[A-Za-z0-9-]+)?\\.json$')
const visionStage=new RegExp('^\\.'+BV+'(?:-[A-Za-z0-9-]+)?-[a-f0-9]{32}\\.tmp$')
const asrStage=new RegExp(asrFile.source.slice(0,-1)+'\\.\\d+\\.tmp$')
const audioFile=/^[A-Za-z0-9_-]{1,32}-[a-f0-9]{8}\.[A-Za-z0-9._-]{1,100}$/
const uuid=/^[a-f0-9]{32}$/
const scene=/^dafeiyu-scene-[A-Za-z0-9_-]{1,64}$/
function safeStat(path){try{return lstatSync(path)}catch(e){if(e.code==='ENOENT')return null;throw e}}
// Reject a symlink/junction at any level (including a migrated cache root).
function safeDirectory(path){
 const chain=[];let p=resolve(path)
 while(p!==parse(p).root){chain.push(p);p=dirname(p)}
 for(const item of chain.reverse()){
  const s=safeStat(item);if(!s)return false
  if(s.isSymbolicLink()||!s.isDirectory())throw Error('unsafe-cache-directory')
 }
 return true
}
function oldTree(path,cutoff){
 const s=safeStat(path)
 if(!s||s.isSymbolicLink()||s.mtimeMs>cutoff)return false
 if(s.isFile())return true
 if(!s.isDirectory())return false
 return readdirSync(path).every(name=>oldTree(join(path,name),cutoff))
}
function oldResult(path,s,ttl,now){
 if(s.mtimeMs<=now-ttl)return true
 // Keep expiry tied to generation time, not reads, copies or migration mtime.
 if(s.size>1024*1024)return false
 try{
  const row=JSON.parse(readFileSync(path,'utf8'))
  return typeof row.createdAt==='number'&&Number.isFinite(row.createdAt)&&row.createdAt>0&&row.createdAt*1000<=now-ttl
 }catch{return false}
}
/** Startup and recurring sweep. Failed/locked entries retry on the next pass. */
export function pruneVideoCaches(root,{now=Date.now(),resolveMedia=storageDomainRoot}={}){
 const result={removed:0,failed:0,skipped:0}
 const run=fn=>{try{fn()}catch{result.failed++}}
 const sweep=(folder,select)=>run(()=>{
  if(!safeDirectory(folder))return
  for(const name of readdirSync(folder))run(()=>{
   const rule=select(name);if(!rule)return
   const path=join(folder,name),s=safeStat(path)
   if(!s)return
   if(s.isSymbolicLink()||(rule.tree?!s.isDirectory():!s.isFile())){result.skipped++;return}
   const cutoff=now-rule.ttl
   const expired=rule.tree?oldTree(path,cutoff):rule.result?oldResult(path,s,rule.ttl,now):s.mtimeMs<=cutoff
   if(!expired)return
   // Do not remove an atomically replaced or newly modified entry.
   const latest=safeStat(path)
   if(!latest||latest.isSymbolicLink()||latest.mtimeMs!==s.mtimeMs||latest.ino!==s.ino||latest.size!==s.size)return
   rmSync(path,{force:true,recursive:!!rule.tree});result.removed++
  })
 })
 // Core-only artifacts can still be cleaned when an external disk is unavailable.
 run(()=>{if(safeDirectory(join(root,'life-video-gallery')))result.removed+=pruneAllLifeVideoGalleries(root,{now,onError:()=>result.failed++})})
 sweep(join(root,'vision-perception-captures'),name=>uuid.test(name)?{ttl:VIDEO_CACHE_RETENTION.capture,tree:true}:null)
 sweep(join(root,'tmp','vision'),name=>scene.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan,tree:true}:/^bili_cover2?_\d+\.png$/.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan}:null)
 sweep(join(root,'vision-proof'),name=>/^[a-f0-9]{32}\.(json|yml)$/.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan}:null)
 run(()=>{
  const media=resolveMedia(root,'media')
  sweep(join(media,'asr-transcript-cache'),name=>asrFile.test(name)?{ttl:VIDEO_CACHE_RETENTION.asr,result:true}:asrStage.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan}:null)
  sweep(join(media,'vision-cache'),name=>visionFile.test(name)?{ttl:VIDEO_CACHE_RETENTION.vision,result:true}:visionStage.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan}:null)
  sweep(join(media,'tmp','asr'),name=>audioFile.test(name)?{ttl:VIDEO_CACHE_RETENTION.orphan}:null)
 })
 return result
}
