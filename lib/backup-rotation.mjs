/** Bounded, local-only daily portable backups. Manual and memory backups are never pruned. */
import {readdirSync,lstatSync,readFileSync,rmSync} from 'node:fs'
import {basename,join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {saveBackupJson} from './backup-directory.mjs'
import {validateBackup,inspectLifeMemoryBackup} from './data-backup.mjs'

export const AUTO_PREFIX='dafeiyu-auto'
const NAME=/^(dafeiyu-auto|dafeiyu-backup|dafeiyu-memory|pre-restore|pre-memory-restore)-(\d{4}-\d\d-\d\d)T[\d-]+Z-[a-f0-9]{8}\.json(?:\.gz)?$/
const MAX_BYTES=320*1024*1024
const DAY=86400_000
export const localDay=(date=new Date())=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')
const parsed=(name)=>NAME.exec(name)
export function listBackupFiles(dir,{limit=120}={}){
 const results=[]
 for(const name of readdirSync(dir)){
  const match=parsed(name);if(!match)continue
  const file=join(dir,name)
  try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)continue
   results.push({name,type:match[1]==='dafeiyu-auto'?'automatic':match[1]==='dafeiyu-memory'?'memory':match[1].startsWith('pre-')?'recovery':'manual',
    contentType:['dafeiyu-memory','pre-memory-restore'].includes(match[1])?'memory':'business',
    origin:match[1]==='dafeiyu-auto'?'automatic':match[1].startsWith('pre-')?'recovery':'manual',
    day:match[2],size:stat.size,createdAt:new Date(stat.mtimeMs).toISOString()})
  }catch{/* removed concurrently */}
 }
 return results.sort((a,b)=>b.name.localeCompare(a.name)).slice(0,Math.max(1,Math.min(200,limit)))
}
const automaticNames=dir=>readdirSync(dir).filter(name=>NAME.test(name)&&name.startsWith(AUTO_PREFIX+'-'))
export const hasTodaysAutomatic=(dir,date=new Date())=>automaticNames(dir).some(name=>parsed(name)?.[2]===localDay(date))
export function pruneAutomaticBackups(dir,{now=new Date(),keepDays=5}={}){
 const cutoff=new Date(now.getFullYear(),now.getMonth(),now.getDate()-Math.max(1,Math.min(30,keepDays))+1)
 let removed=0
 for(const name of automaticNames(dir)){
  const day=parsed(name)?.[2]||''
  const [y,m,d]=day.split('-').map(Number)
  const date=new Date(y,m-1,d)
  if(Number.isNaN(date.getTime())||localDay(date)!==day||date<cutoff){
   const file=join(dir,name)
   try{const stat=lstatSync(file);if(stat.isFile()&&!stat.isSymbolicLink()){rmSync(file);removed++}}catch{}
  }
 }
 return removed
}
export function saveAutomaticBackup(dir,backup,{now=new Date()}={}){
 if(hasTodaysAutomatic(dir,now))return {created:false,reason:'already-backed-up'}
 validateBackup(backup)
 const filePath=saveBackupJson(dir,backup,AUTO_PREFIX,{now,localDayStamp:localDay(now)})
 const removed=pruneAutomaticBackups(dir,{now})
 return {created:true,filePath,removed}
}
const textOnly=(x,limit=240)=>typeof x==='string'?x.replace(/[\r\n\t]+/g,' ').slice(0,limit):''
function sampleMemory(backup){
 const result=[]
 const entries=[['life-memory/episodic.json','人生经历','episodes'],['long-term-memory/dafeiyu.json','长期认识','memories'],['life-memory/candidates.json','待整理的经历','candidates']]
 for(const [filename,title,key] of entries){
  const content=backup.files?.[filename];if(!content)continue
  try{const data=JSON.parse(content),rows=Array.isArray(data[key])?data[key]:[]
   result.push({title,filename,count:rows.length,entries:rows.slice(-35).reverse().map(row=>({
    text:textOnly(row.text||row.summary||row.title||row.content),kind:textOnly(row.kind||row.stage||'',28),at:typeof row.at==='number'?new Date(row.at).toISOString():''
   }))})
  }catch{result.push({title,filename,count:0,entries:[],unavailable:true})}
 }
 return result
}
export function inspectBackupInDirectory(dir,name){
 if(typeof name!=='string'||basename(name)!==name||!parsed(name))throw Error('请选择有效的本地备份文件')
 const file=join(dir,name),stat=lstatSync(file)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw Error('备份文件不安全或超过读取上限')
 const raw=readFileSync(file)
 const bytes=name.endsWith('.json.gz')?gunzipSync(raw,{maxOutputLength:300*1024*1024}):raw
 const backup=JSON.parse(bytes.toString('utf8'))
 const summary=backup.format==='dafeiyu-life-memory-backup'?inspectLifeMemoryBackup(backup):validateBackup(backup)
 return {name,summary,memories:sampleMemory(backup),fileTypes:Object.keys(backup.files||{}).map(x=>x.split('/')[0]).reduce((acc,k)=>(acc[k]=(acc[k]||0)+1,acc),{})}
}
