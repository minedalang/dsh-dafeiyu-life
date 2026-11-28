/** Local, non-activatable rescue of the *supplied portable data*, not a cold
 * snapshot or a second Life subject. No read/write to the live state directory.
 * Objects are stored by content hash, never by a runtime path from a backup. */
import {createHash,randomUUID} from 'node:crypto'
import {lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs'
import {dirname,resolve,relative,isAbsolute,sep,join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {validateLocalDataPath} from './storage-location.mjs'
import {OFFLINE_RESCUE_MARKER} from './cold-restore-fence.mjs'
import {FORMAT,SCHEMA,validateBackup,inspectLifeMemoryBackup} from './data-backup.mjs'

const RESCUE='dafeiyu-portable-rescue/v1',MEMORY='dafeiyu-life-memory-backup'
const MAX_SOURCE=320*1024*1024,MAX_JSON=300*1024*1024,MAX_MANIFEST=16*1024*1024,MAX_OBJECTS=15008
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const sha256=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s)
const jsonBytes=value=>Buffer.from(JSON.stringify(value),'utf8')
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes)
const within=(a,b)=>{const r=relative(a,b);return r===''||(!isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep))}
const overlap=(a,b)=>within(a,b)||within(b,a)
function safeFile(file,limit,{singleLink=false}={}){
 const st=lstatSync(file)
 if(!st.isFile()||st.isSymbolicLink()||singleLink&&st.nlink!==1||st.size>limit)throw Error('救援文件不安全或超过上限')
 const bytes=readFileSync(file);if(bytes.length!==st.size||bytes.length>limit)throw Error('救援文件读取期间发生变化')
 return bytes
}
function loadSource(source){
 if(typeof source!=='string'||!isAbsolute(source))throw Error('请提供本机备份文件的绝对路径')
 const file=resolve(source);validateLocalDataPath(dirname(file))
 const bytes=safeFile(file,MAX_SOURCE)
 const raw=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:MAX_JSON}):bytes
 if(raw.length>MAX_JSON)throw Error('备份解压后超过安全上限')
 const backup=JSON.parse(decode(raw))
 if(backup?.schema!==SCHEMA)throw Error('救援仅接受含原始完整性清单的 schema 2 便携备份；旧文件请保留原件')
 const memory=backup.format===MEMORY
 const summary=memory?inspectLifeMemoryBackup(backup):validateBackup(backup)
 const header={format:backup.format,schema:backup.schema,createdAt:backup.createdAt,
  ...(memory?{hashes:backup.hashes}:{version:backup.version,manifest:backup.manifest})}
 return {file,backup,memory,header,sourceSha256:hash(bytes),summary:{files:summary.count,databases:memory?0:summary.databases,characterBound:memory?summary.characterBound:!summary.legacyUnscoped}}
}
function rescueReport(source){return {ok:true,mode:'offline-rescue-only',sourceFormat:source.header.format,sourceCreatedAt:source.header.createdAt||null,sourceSha256:source.sourceSha256,...source.summary,liveChanges:false,activationAllowed:false,historyProven:false}}
export function inspectPortableRescueSource(source){return rescueReport(loadSource(source))}

export function createPortableRescue({source,destination,liveRoot,confirm}={}){
 if(confirm!=='EXTRACT_PORTABLE_BACKUP_OFFLINE_ONLY')throw Error('须明确确认仅隔离救援，不恢复或激活现役角色')
 const captured=loadSource(source),root=validateLocalDataPath(liveRoot,{allowMissing:true}),dest=validateLocalDataPath(destination,{allowMissing:true})
 validateLocalDataPath(dirname(dest))
 if(overlap(root,dest)||within(dest,captured.file))throw Error('隔离救援目录不能与现役目录或原备份文件重叠')
 // Exclusive new directory. Never overwrite or remove a user directory; even
 // a crash leaves a non-runtime object layout, not a partially active profile.
 mkdirSync(dest,{mode:0o700})
 const marker=join(dest,OFFLINE_RESCUE_MARKER),objects=join(dest,'objects')
 writeFileSync(marker,jsonBytes({version:1,format:RESCUE,status:'preparing',activationAllowed:false}),{flag:'wx',mode:0o600})
 mkdirSync(objects,{mode:0o700})
 const entries=[],known=new Set(),add=(kind,name,bytes)=>{
  const digest=hash(bytes),file=join(objects,digest)
  if(!known.has(digest)){
   writeFileSync(file,bytes,{flag:'wx',mode:0o600})
   if(!safeFile(file,MAX_JSON,{singleLink:true}).equals(bytes))throw Error('救援对象落盘校验失败')
   known.add(digest)
  }
  entries.push({kind,name,sha256:digest,bytes:bytes.length})
 }
 for(const [name,content] of Object.entries(captured.backup.files))add('file',name,Buffer.from(content,'utf8'))
 if(!captured.memory){
  add('settings','config',jsonBytes(captured.backup.config))
  // Keep exact portable base64; it is not a live SQLite database or a grant.
  for(const [name,content] of Object.entries(captured.backup.sqlite))add('sqlite-base64',name,Buffer.from(content,'utf8'))
 }
 const manifest={format:RESCUE,sourceSha256:captured.sourceSha256,source:captured.header,entries}
 const manifestBytes=jsonBytes(manifest)
 if(manifestBytes.length>MAX_MANIFEST)throw Error('救援清单过大；保留隔离原件，不允许激活')
 writeFileSync(join(dest,'manifest.json'),manifestBytes,{flag:'wx',mode:0o600})
 // Verify the original portable integrity contract reconstructed from objects,
 // before marking the rescue complete. The marker remains during publication.
 verifyObjects(dest,manifest)
 const temp=join(dest,'.rescue-'+randomUUID()+'.tmp')
 writeFileSync(temp,jsonBytes({version:1,format:RESCUE,status:'verified',activationAllowed:false,manifestSha256:hash(manifestBytes)}),{flag:'wx',mode:0o600})
 renameSync(temp,marker)
 return verifyPortableRescue(dest)
}
function verifyObjects(root,manifest){
 if(manifest?.format!==RESCUE||!sha256(manifest.sourceSha256)||!Array.isArray(manifest.entries)||manifest.entries.length>MAX_OBJECTS||manifest.source?.schema!==SCHEMA||![FORMAT,MEMORY].includes(manifest.source.format))throw Error('救援清单无效')
 const objects=validateLocalDataPath(join(root,'objects')),seen=new Set(),keys=new Set(),files=Object.create(null),sqlite=Object.create(null)
 let total=0,config=null
 for(const row of manifest.entries){
  if(!row||!['file','settings','sqlite-base64'].includes(row.kind)||typeof row.name!=='string'||row.name.length>180||!sha256(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>MAX_JSON)throw Error('救援对象清单无效')
  const key=row.kind+':'+row.name
  if(keys.has(key)||(total+=row.bytes)>MAX_SOURCE)throw Error('救援对象重复或超出总量上限')
  keys.add(key);seen.add(row.sha256)
  const bytes=safeFile(join(objects,row.sha256),row.bytes,{singleLink:true})
  if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('救援对象内容校验失败')
  const content=decode(bytes)
  if(row.kind==='file')files[row.name]=content
  else if(row.kind==='sqlite-base64')sqlite[row.name]=content
  else{if(row.name!=='config'||config!==null)throw Error('救援设置清单无效');config=JSON.parse(content)}
 }
 const names=readdirSync(objects)
 if(names.length!==seen.size||names.some(name=>!seen.has(name)))throw Error('救援对象目录存在额外或缺失内容')
 const memory=manifest.source.format===MEMORY
 if(memory&&(config!==null||Object.keys(sqlite).length))throw Error('专项记忆救援包含非法业务字段')
 const backup={...manifest.source,files,...(memory?{}:{config,sqlite})}
 const summary=memory?inspectLifeMemoryBackup(backup):validateBackup(backup)
 return {files:summary.count,databases:memory?0:summary.databases,characterBound:memory?summary.characterBound:!summary.legacyUnscoped,objects:seen.size,logicalBytes:total}
}
export function verifyPortableRescue(destination){
 const root=validateLocalDataPath(destination)
 const marker=JSON.parse(decode(safeFile(join(root,OFFLINE_RESCUE_MARKER),4096,{singleLink:true})))
 const bytes=safeFile(join(root,'manifest.json'),MAX_MANIFEST,{singleLink:true})
 if(marker?.version!==1||marker.format!==RESCUE||marker.status!=='verified'||marker.activationAllowed!==false||marker.manifestSha256!==hash(bytes))throw Error('隔离救援未完成或清单校验失败；禁止激活')
 const names=readdirSync(root)
 if(names.length!==3||names.some(name=>![OFFLINE_RESCUE_MARKER,'manifest.json','objects'].includes(name)))throw Error('隔离救援目录存在额外内容')
 const manifest=JSON.parse(decode(bytes)),summary=verifyObjects(root,manifest)
 return {ok:true,mode:'offline-rescue-only',sourceFormat:manifest.source.format,sourceCreatedAt:manifest.source.createdAt||null,sourceSha256:manifest.sourceSha256,...summary,liveChanges:false,activationAllowed:false,historyProven:false}
}
