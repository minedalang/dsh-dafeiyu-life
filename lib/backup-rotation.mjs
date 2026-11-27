/** Bounded, local-only daily portable backups. Manual and memory backups are never pruned. */
import {readdirSync,lstatSync,readFileSync,rmSync} from 'node:fs'
import {basename,join,resolve} from 'node:path'
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
 return results.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.name.localeCompare(a.name)).slice(0,Math.max(1,Math.min(200,limit)))
}
const automaticNames=dir=>readdirSync(dir).filter(name=>NAME.test(name)&&name.startsWith(AUTO_PREFIX+'-'))
// A filename is not proof of a successful backup. Keep a small in-process
// cache of verified file identities; re-read changed files, never trust a
// failed validation or another character sharing this destination.
const verifiedAutomatic=new Map()
const statKey=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':')
const backupCharacter=backup=>backup.files?.['character-identity.json']?JSON.parse(backup.files['character-identity.json']).id:''
function verifiedAutomaticFile(dir,name,characterId){
 try{
  const file=resolve(dir,name),stat=lstatSync(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)return null
  const key=statKey(stat),cached=verifiedAutomatic.get(file)
  if(cached?.key===key)return cached.characterId===characterId?key:null
  const raw=readFileSync(file),bytes=name.endsWith('.json.gz')?gunzipSync(raw,{maxOutputLength:300*1024*1024}):raw
  const backup=JSON.parse(bytes.toString('utf8'))
  if(validateBackup(backup).integrity!=='sha256-verified')return null
  const id=backupCharacter(backup),fresh=lstatSync(file)
  if(!fresh.isFile()||fresh.isSymbolicLink()||statKey(fresh)!==key)return null
  verifiedAutomatic.delete(file);verifiedAutomatic.set(file,{key,characterId:id})
  if(verifiedAutomatic.size>64)verifiedAutomatic.delete(verifiedAutomatic.keys().next().value)
  return id===characterId?key:null
 }catch{return null}
}
export const hasTodaysAutomatic=(dir,date=new Date(),{characterId=''}={})=>automaticNames(dir).some(name=>parsed(name)?.[2]===localDay(date)&&verifiedAutomaticFile(dir,name,characterId)!==null)
export function pruneAutomaticBackups(dir,{now=new Date(),keepDays=2,characterId=''}={}){
 // Never age out the last good copy after an interrupted or corrupt export.
 // Unverified/foreign files are not ours to delete; users can inspect them.
 if(!hasTodaysAutomatic(dir,now,{characterId}))return 0
 const cutoff=new Date(now.getFullYear(),now.getMonth(),now.getDate()-Math.max(1,Math.min(30,keepDays))+1)
 let removed=0
 for(const name of automaticNames(dir)){
  const day=parsed(name)?.[2]||''
  const [y,m,d]=day.split('-').map(Number)
  const date=new Date(y,m-1,d)
  if(!Number.isNaN(date.getTime())&&localDay(date)===day&&date<cutoff){
   const file=resolve(dir,name),key=verifiedAutomaticFile(dir,name,characterId)
   if(key===null)continue
   try{const stat=lstatSync(file);if(stat.isFile()&&!stat.isSymbolicLink()&&statKey(stat)===key){rmSync(file);verifiedAutomatic.delete(file);removed++}}catch{}
  }
 }
 return removed
}
export function saveAutomaticBackup(dir,backup,{now=new Date(),characterId=backupCharacter(backup)}={}){
 if(validateBackup(backup).integrity!=='sha256-verified')throw Error('自动备份必须使用完整校验格式')
 if(backupCharacter(backup)!==characterId)throw Error('自动备份角色身份已变化')
 if(hasTodaysAutomatic(dir,now,{characterId}))return {created:false,reason:'already-backed-up'}
 const filePath=saveBackupJson(dir,backup,AUTO_PREFIX,{now,localDayStamp:localDay(now)})
 if(!verifiedAutomaticFile(dir,basename(filePath),characterId))throw Error('自动备份落盘完整性核验未通过；保留旧备份')
 const removed=pruneAutomaticBackups(dir,{now,characterId})
 return {created:true,filePath,removed}
}
const textOnly=(x,limit=240)=>typeof x==='string'?x.replace(/[\r\n\t]+/g,' ').slice(0,limit):''
const memoryTime=row=>{for(const value of [row.at,row.createdAt,row.time,row.day]){const n=typeof value==='number'?value:Date.parse(value);if(Number.isFinite(n)&&n>0&&n<=8640000000000000)return n}return 0}
// Deletion is limited to recognized regular files in the chosen local directory.
// A changed list entry must be refreshed; never recursively remove a directory.
export function deleteBackupInDirectory(dir,name,{size,createdAt}={}){
 if(typeof name!=='string'||basename(name)!==name||!parsed(name))throw Error('请选择有效的本地备份文件')
 const file=join(dir,name),stat=lstatSync(file)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)throw Error('备份文件不安全')
 if(stat.size!==size||new Date(stat.mtimeMs).toISOString()!==createdAt)throw Error('备份文件已变化，请刷新后重新确认')
 rmSync(file);return true
}
function sampleMemory(backup){
 const result=[]
 const entries=[['life-memory/episodic.json','人生经历','episodes'],['long-term-memory/dafeiyu.json','长期认识','memories'],['life-memory/candidates.json','待整理的经历','candidates']]
 for(const [filename,title,key] of entries){
  const content=backup.files?.[filename];if(!content)continue
  try{const data=JSON.parse(content),rows=Array.isArray(data[key])?data[key]:[]
   result.push({title,filename,count:rows.length,entries:[...rows].sort((a,b)=>memoryTime(b)-memoryTime(a)).slice(0,35).map(row=>({
    text:textOnly(row.text||row.summary||row.title||row.content),kind:textOnly(row.kind||row.stage||'',28),at:memoryTime(row)?new Date(memoryTime(row)).toISOString():''
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
