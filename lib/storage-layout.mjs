/**
 * 2.8.3-dev.3: single, fail-closed owner of per-domain offline storage locations.
 * Root relocation (storage-location.mjs) is resolved first. No HTTP writer changes paths.
 * An absent layout means bit-for-bit legacy directory compatibility.
 */
import {assertColdRestoreClear,assertOfflineImageClear} from './cold-restore-fence.mjs'
import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,copyFileSync,chmodSync,writeFileSync,renameSync,rmSync,openSync,readSync,closeSync,readlinkSync,realpathSync} from 'node:fs'
import {join,resolve,dirname,relative,isAbsolute,sep,parse} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {validateLocalDataPath} from './storage-location.mjs'
import {probeVisionCacheAccess} from './storage-vision-cache-access.mjs'
import {largeDataStatus} from './storage-large-data-v2.mjs'

const FILE='storage-layout-v1.json'
const MARKER='.dafeiyu-storage-domain-v1.json'
const MODEL_PARTS=Object.freeze(['whisper','embedding','media'])
// One user-facing migration groups three pre-existing, independently routed domains.
// Keep the old layout keys to read installations that already split them in dev.3.
export const STORAGE_MIGRATION_GROUPS=Object.freeze({
 model:Object.freeze({label:'Whisper 模型、Embedding 模型与运行时、影音与视觉可再生缓存',directory:'modelData',domains:MODEL_PARTS,mode:'copy'}),
 python:Object.freeze({label:'Python 包管理缓存（uv / pip）',directory:'pythonData',domains:['python'],mode:'cache'}),
 memory:Object.freeze({label:'Life 记忆、深层详情、遗忘保护与向量索引',directory:'lifeData',domains:['memory'],mode:'copy'}),
})
export const STORAGE_DOMAINS=Object.freeze({
  whisper:Object.freeze({label:'Whisper 模型',items:['.hf-cache'],migration:'copy'}),
  embedding:Object.freeze({label:'Embedding 模型与运行时',items:['embedding-runtime'],migration:'copy'}),
  // Python migration is strictly cache-only. Runtime entries remain only for
  // reporting and reading existing dev.3 configuration without breaking upgrades.
  python:Object.freeze({label:'Python 包管理缓存（uv / pip）',
    cacheItems:['uv-cache','pip-cache'],
    runtimeItems:['.venv','.venv-asr','.vision-venv','uv-tools','uv-python'],
    items:['uv-cache','pip-cache','.venv','.venv-asr','.vision-venv','uv-tools','uv-python'],
    migration:'cache'}),
  media:Object.freeze({label:'影音与视觉可再生缓存',items:['tmp/asr','asr-transcript-cache','vision-cache'],migration:'copy'}),
  memory:Object.freeze({label:'Life 记忆、深层详情、遗忘保护与向量索引',items:['life-memory','long-term-memory','detail-protection','embedding-memory-index'],migration:'copy'}),
})
const within=(a,b)=>{const r=relative(a,b);return r===''||!!r&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r)}
const layoutPath=root=>join(root,FILE)
function loadRaw(root){
 const file=layoutPath(root)
 if(!existsSync(file))return {version:1,domains:{}}
 const s=lstatSync(file)
 if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('存储分区配置不安全；禁止以旧目录默默启动')
 let obj
 try{obj=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('存储分区配置损坏；请修复后再启动')}
 if(obj?.version!==1||!obj.domains||typeof obj.domains!=='object'||Array.isArray(obj.domains)||Object.keys(obj.domains).some(x=>!STORAGE_DOMAINS[x]))throw Error('存储分区版本或数据域无效')
 return obj
}
export function storageLayoutStatus(root){
 const base=validateLocalDataPath(root,{allowMissing:true}),raw=loadRaw(base),domains={}
 const v2=largeDataStatus(base)
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const entry=raw.domains[key]
  if(v2.configured&&['whisper','embedding','media','python'].includes(key)){
   // Retired V1 redirects must never overrule V2, nor break startup when an
   // old external drive is detached after the complete V2 copy was published.
   domains[key]={key,label:spec.label,configured:false,root:base,mode:'v2-retired',items:spec.items,
    legacyTarget:entry?.target||null,legacyPending:!!entry};
   continue
  }
  if(!entry){domains[key]={key,label:spec.label,configured:false,root:base,mode:'legacy',items:spec.items};continue}
  const validModes=key==='python'?['cache','rebuild']:[spec.migration]
  if(typeof entry.target!=='string'||typeof entry.nonce!=='string'||!entry.nonce||!validModes.includes(entry.mode))throw Error('存储分区配置字段不合法：'+key)
  const dest=validateLocalDataPath(entry.target)
  if(within(base,dest)||within(dest,base))throw Error('分区目录与数据根目录不能互相嵌套：'+key)
  const markerFile=join(dest,MARKER)
  if(!existsSync(markerFile)||lstatSync(markerFile).isSymbolicLink()||!lstatSync(markerFile).isFile()||lstatSync(markerFile).size>4096)throw Error('分区身份标记丢失，禁止生成空白数据：'+key)
  let marker
  try{marker=JSON.parse(readFileSync(markerFile,'utf8'))}catch{throw Error('分区身份标记损坏：'+key)}
  const sharedModel=marker?.domain==='model'&&MODEL_PARTS.includes(key)&&MODEL_PARTS.every(k=>{
   const e=raw.domains[k]
   return e?.target===dest&&e?.nonce===entry.nonce&&e?.mode==='copy'
  })
  if(marker?.version!==1||marker.base!==base||marker.target!==dest||!(marker.domain===key||sharedModel)||marker.nonce!==entry.nonce||marker.verified!==true||marker.mode!==entry.mode)throw Error('分区身份验证失败：'+key)
  // Previous dev.3 marked Python as "rebuild" but redirected every Python path
  // before any environment had been rebuilt. Keep that marker for audit/rollback,
  // but restore legacy runtime resolution instead of breaking existing plugins.
  const legacyPythonRebuild=key==='python'&&entry.mode==='rebuild'&&marker.pythonStrategy!=='safe-group-v2'
  if(legacyPythonRebuild){
   domains[key]={key,label:spec.label,configured:false,root:base,mode:'legacy-rebuild-pending',items:spec.items,legacyPending:true,legacyTarget:dest,verifiedAt:marker.verifiedAt}
   continue
  }
  for(const [other,row] of Object.entries(domains))if(row.configured&&(within(row.root,dest)||within(dest,row.root))&&!(sharedModel&&MODEL_PARTS.includes(other)&&row.root===dest))throw Error('分区目录互相嵌套：'+other+' / '+key)
  domains[key]={key,label:spec.label,configured:true,root:dest,mode:entry.mode,items:spec.items,verifiedAt:marker.verifiedAt}
 }
 return {version:1,root:base,configured:Object.values(domains).filter(x=>x.configured).length,domains}
}
const norm=x=>String(x||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')
export function storageDataPath(root,...segments){
 const base=resolve(root),parts=segments.map(String),rel=norm(parts.join('/'))
 if(!rel||rel.split('/').some(s=>s==='..'||s==='.'||!s))throw Error('无效的存储相对路径')
 const v2=largeDataStatus(base)
 if(v2.configured){
  // V2 is intentionally NOT a general-purpose path redirector. Python's
  // writable paths and executables always remain under the original MIC root.
  const local=['.hf-cache','embedding-runtime','uv-cache','pip-cache','uv-tools','uv-python','.venv','.venv-asr','.vision-venv','tmp/asr','vision-cache','asr-transcript-cache']
  if(local.some(x=>rel===x||rel.startsWith(x+'/'))){
   const media=['tmp/asr','vision-cache','asr-transcript-cache'].some(x=>rel===x||rel.startsWith(x+'/'))
   return join(media?v2.mediaRoot:base,...parts)
  }
 }
 const status=storageLayoutStatus(base)
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const item=spec.items.find(dir=>rel===dir||rel.startsWith(dir+'/'))
  if(!item)continue
  const current=status.domains[key]
  if(!current.configured)continue
  if(key==='python'){
   // Cache-only is the safe default: do not redirect a live interpreter or venv.
   if(spec.cacheItems.some(dir=>item===dir||item.startsWith(dir+'/')))return join(current.root,...rel.split('/'))
   if(current.mode==='rebuild'&&spec.runtimeItems.some(dir=>item===dir||item.startsWith(dir+'/')))return join(current.root,...rel.split('/'))
   continue
  }
  return join(current.root,...rel.split('/'))
 }
 return join(base,...parts)
}
export function storageDomainRoot(root,domain){
 if(!STORAGE_DOMAINS[domain])throw Error('未知存储域')
 const v2=largeDataStatus(root)
 if(v2.configured&&domain==='media')return v2.mediaRoot
 if(v2.configured&&domain==='python')return v2.pythonRoot
 if(v2.configured&&domain==='whisper')return v2.pythonRoot // Python's HF_HOME stays writable; external snapshots read separately
 if(v2.configured&&domain==='embedding')return v2.pythonRoot // binary/runtime stays in the core sandbox
 return storageLayoutStatus(root).domains[domain].root
}
export function storagePythonRuntimeRoot(root){
 const status=storageLayoutStatus(root),entry=status.domains.python
 return entry.configured&&entry.mode==='rebuild'?entry.root:status.root
}
function measureCopyable(src,domain,rel){
 let files=0,bytes=0,seen=0
 if(!existsSync(src))return {files,bytes}
 const stack=[src]
 while(stack.length){
  const path=stack.pop(),s=lstatSync(path)
  if(s.isSymbolicLink()){
   // Only Hugging Face snapshot links to files INSIDE their own repository are trusted.
   if(domain!=='whisper'||!within(src,realpathSync(path))||!lstatSync(realpathSync(path)).isFile())throw Error('发现非预期的目录链接，拒绝迁移：'+rel)
   files++;bytes+=lstatSync(realpathSync(path)).size
  }else if(s.isDirectory()){
   for(const name of readdirSync(path))stack.push(join(path,name))
  }else if(s.isFile()){files++;bytes+=s.size}
  else throw Error('源目录包含特殊文件，拒绝迁移：'+rel)
  if(++seen>120000||files>120000||bytes>120*1024**3)throw Error('分区超出安全迁移限额')
 }
 return {files,bytes}
}
export function storageMigrationGroups(root){
 const layout=storageLayoutStatus(root)
 return Object.entries(STORAGE_MIGRATION_GROUPS).map(([key,group])=>{
  let parts
  if(key==='python'){
   const d=layout.domains.python
   const cacheRoot=d.configured?d.root:layout.root
   const python=STORAGE_DOMAINS.python
   // Keep the non-migratable Python runtime visible as informational metadata,
   // not as an unfinished second migration target.
   parts=[{domain:'python',label:'包管理下载缓存（uv / pip）',root:cacheRoot,
     configured:d.configured,
     paths:python.cacheItems.map(rel=>join(cacheRoot,...rel.split('/')))}]
  }else parts=group.domains.map(domain=>{
   const d=layout.domains[domain]
   return {domain,label:STORAGE_DOMAINS[domain].label,root:d.root,configured:d.configured,paths:STORAGE_DOMAINS[domain].items.map(rel=>join(d.root,...rel.split('/')))}
  })
  const locations=[...new Set(parts.map(p=>p.root))]
  return {key,label:group.label,directory:group.directory,mode:key==='python'?(layout.domains.python.configured?layout.domains.python.mode:'cache'):group.mode,
   legacyPending:key==='python'&&layout.domains.python.legacyPending===true,
   currentRoot:locations.length===1?locations[0]:null,
   ...(key==='python'?{pythonRuntimeRoot:storagePythonRuntimeRoot(layout.root)}:{}),parts}
 })
}
/**
 * Read-only inspection of a historical Life partition.  This NEVER grants
 * migration permission: an occupied target always blocks a new migration.
 * The checksum is useful only as a cleanup proof when captured at return-home.
 */
export function inspectHistoricalLifeTarget(base,dest){
 const markerFile=join(dest,MARKER)
 if(!existsSync(markerFile))throw Error('旧 Life 分区缺少可信身份标记；禁止删除')
 const st=lstatSync(markerFile)
 if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('历史 Life 分区身份标记不安全')
 let marker
 try{marker=JSON.parse(readFileSync(markerFile,'utf8'))}catch{throw Error('历史 Life 分区身份标记无法解析')}
 if(marker?.version!==1||marker.base!==base||marker.target!==dest||marker.domain!=='memory'||
    marker.mode!=='copy'||marker.verified!==true||typeof marker.nonce!=='string'||!marker.nonce)
  throw Error('历史 Life 分区的实例身份不符；禁止覆盖')
 const allowed=new Set([MARKER,...STORAGE_DOMAINS.memory.items.map(x=>x.split('/')[0])])
 const names=readdirSync(dest).sort()
 if(names.some(name=>!allowed.has(name)))throw Error('历史 Life 目录包含其他文件；不能自动接管或覆盖')
 let files=0,bytes=0,visited=0
 const hash=createHash('sha256'),pending=[['',dest]]
 while(pending.length){
  const [relativePath,path]=pending.pop(),stat=lstatSync(path)
  if(stat.isSymbolicLink())throw Error('历史 Life 目录存在目录链接；禁止清理')
  if(stat.isDirectory()){
   hash.update('d:'+relativePath+'\0')
   for(const name of readdirSync(path).sort().reverse())pending.push([relativePath?relativePath+'/'+name:name,join(path,name)])
  }else if(stat.isFile()){
   if(++files>120000||(bytes+=stat.size)>120*1024**3)throw Error('历史 Life 资料超过安全清理限额')
   hash.update('f:'+relativePath+'\0'+stat.size+'\0'+sha(path))
  }else throw Error('历史 Life 分区包含特殊文件；禁止清理')
  if(++visited>120000)throw Error('历史 Life 资料条目过多')
 }
 return {kind:'retained-life',fingerprint:hash.digest('hex'),files,bytes,
  note:'这是同实例历史 Life 分区；必须独立确认删除，不得自动复用或覆盖'}
}
function migrationCopyItems(domain,mode){
 const spec=STORAGE_DOMAINS[domain]
 if(domain==='python')return spec.cacheItems
 if(mode==='copy')return spec.items
 return []
}
function effectiveDomainPaths(base,domain,current){
 const spec=STORAGE_DOMAINS[domain]
 if(domain!=='python')return spec.items.map(rel=>join(current.configured?current.root:base,...rel.split('/')))
 return spec.items.map(rel=>{
  const cache=spec.cacheItems.includes(rel),runtime=spec.runtimeItems.includes(rel)
  const useTarget=current.configured&&(cache||runtime&&current.mode==='rebuild')
  return join(useTarget?current.root:base,...rel.split('/'))
 })
}
export function inspectDomainMigration({root,domain,target,mode}={}){
 const base=validateLocalDataPath(root),group=STORAGE_MIGRATION_GROUPS[domain]
 const spec=STORAGE_DOMAINS[domain]
 if(!spec&&!group)throw Error('未知的数据分区')
 const migration=domain==='python'?(mode||'cache'):(group?.mode||spec.migration)
 if(domain==='python'&&migration!=='cache')throw Error('Python 分区仅支持 uv/pip 包缓存迁移；不再提供环境重建')
 if(domain!=='python'&&mode&&mode!==migration)throw Error('此分区不支持所选迁移方式')
 const layout=storageLayoutStatus(base),keys=group?.domains||[domain]
 if(domain==='python'&&layout.domains.python.configured)throw Error('Python 分区已经迁移；如需更换模式或目录，请先执行安全回退')
 if(!group&&MODEL_PARTS.includes(domain)&&MODEL_PARTS.every(key=>layout.domains[key].configured&&layout.domains[key].root===layout.domains[domain].root))
  throw Error('模型与影音缓存已经合并，请统一使用 --domain model 迁移')
 const dest=validateLocalDataPath(target,{allowMissing:true})
 if(within(base,dest)||within(dest,base))throw Error('存储域不能迁到当前数据根目录内或其父目录')
 if(domain==='python'&&layout.domains.python.legacyPending&&
   (within(layout.domains.python.legacyTarget,dest)||within(dest,layout.domains.python.legacyTarget)))
  throw Error('不能迁入旧版 Python 残留目录或其子目录')
 for(const key of keys){
  const old=layout.domains[key]
  if(old.configured&&(within(old.root,dest)||within(dest,old.root)))throw Error('不能迁到当前分区位置或其子目录')
 }
 for(const [key,row] of Object.entries(layout.domains))if(!keys.includes(key)&&row.configured&&(within(row.root,dest)||within(dest,row.root)))throw Error('与已有分区目录相同或嵌套：'+key)
 if(existsSync(dest)&&readdirSync(dest).length)
  throw Error('目标分区目录必须为空，避免覆盖现有数据；如是回迁后保留的旧 Life 分区，请先在管理页单独验证并明确清理，绝不自动复用')
 let files=0,bytes=0
 const copyItems=domain==='python'?migrationCopyItems(domain,migration):(migration==='copy'?keys.flatMap(key=>STORAGE_DOMAINS[key].items):[])
 for(const rel of copyItems){
  const sourceDomain=domain==='python'?'python':(keys.find(key=>STORAGE_DOMAINS[key].items.some(item=>rel===item||rel.startsWith(item+'/')))||domain)
  const sourceRoot=layout.domains[sourceDomain].root
  const src=join(sourceRoot,...rel.split('/'))
  const size=measureCopyable(src,sourceDomain,rel)
  files+=size.files;bytes+=size.bytes
  if(files>120000||bytes>120*1024**3)throw Error('分区超出安全迁移限额')
 }
 return {ok:true,root:base,sourceRoot:domain==='model'?null:layout.domains[domain].root,
  sources:group?keys.map(key=>({domain:key,root:layout.domains[key].root})):undefined,
  domain,label:group?.label||spec.label,target:dest,mode:migration,files,bytes,requiresStop:true,changesNow:false,sourcePreserved:true,
   rebuildRequired:false,pythonAction:domain==='python'?'cache-only':undefined,
  pythonRuntimeRemainsAt:domain==='python'&&migration==='cache'?base:undefined}
}
function sha(path){const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(256*1024);try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}finally{closeSync(fd)}}
function safeCopy(source,dest,domain,checkpoint=()=>{}){
 const stack=[[source,dest,source]];let files=0,bytes=0
 while(stack.length){
  checkpoint()
  const [from,to,component]=stack.pop(),s=lstatSync(from)
  if(s.isDirectory()&&!s.isSymbolicLink()){
   mkdirSync(to,{recursive:true,mode:0o700})
   for(const item of readdirSync(from))stack.push([join(from,item),join(to,item),component])
  }else{
   let actual=from
   if(s.isSymbolicLink()){
    if(domain!=='whisper'||!within(component,realpathSync(from))||!lstatSync(realpathSync(from)).isFile())throw Error('不可信的链接，迁移中止')
    // Materialize HF snapshot file links: Windows symlink creation needs elevated rights.
    actual=realpathSync(from)
   }else if(!s.isFile())throw Error('不支持的源文件类型')
   mkdirSync(dirname(to),{recursive:true,mode:0o700})
   copyFileSync(actual,to)
   // Old Windows cache files can carry a read-only attribute into a new
   // modelData directory. Change ONLY the private copy of regenerable visual
   // cache files, never model weights, Life memories or the retained source.
   if(domain==='media'&&parse(component).base==='vision-cache'&&!(lstatSync(to).mode&0o200))
    chmodSync(to,0o600)
   if(sha(actual)!==sha(to))throw Error('SHA-256 校验不符，迁移中止')
   files++;bytes+=lstatSync(actual).size
  }
 }
 return {files,bytes}
}
function treesEqual(left,right,domain,checkpoint=()=>{}){
 const queue=[[left,right,left]]
 while(queue.length){
  checkpoint()
  const [a,b,component]=queue.pop(),s=lstatSync(a)
  if(s.isDirectory()&&!s.isSymbolicLink()){
   if(!existsSync(b)||!lstatSync(b).isDirectory())return false
   const names=readdirSync(a).sort(),other=readdirSync(b).sort()
   if(JSON.stringify(names)!==JSON.stringify(other))return false
   for(const n of names)queue.push([join(a,n),join(b,n),component])
  }else{
   const actual=s.isSymbolicLink()&&domain==='whisper'?realpathSync(a):a
   if(!existsSync(b)||!lstatSync(b).isFile()||lstatSync(b).size!==lstatSync(actual).size||sha(actual)!==sha(b))return false
  }
 }
 return true
}
/** One atomic publication for the three model/cache paths, including legacy split layouts. */
function migrateModelOffline({root,target,confirmedStopped,ensureStopped=()=>{},checkpoint=()=>{},visionCacheProbe=probeVisionCacheAccess}){
 if(confirmedStopped!==true)throw Error('必须完全退出 DSH/Headless/Python 并显式确认停机')
 const plan=inspectDomainMigration({root,domain:'model',target}),base=plan.root
 const previous=loadRaw(base),scratch=join(dirname(plan.target),'.dafeiyu-storage-migrating-'+randomUUID())
 const nonce=randomUUID();let published=false
 try{
  mkdirSync(dirname(plan.target),{recursive:true,mode:0o700});validateLocalDataPath(dirname(plan.target))
  mkdirSync(scratch,{mode:0o700})
  let files=0,bytes=0
  const layout=storageLayoutStatus(base)
  for(const domain of MODEL_PARTS)for(const rel of STORAGE_DOMAINS[domain].items){
   const src=join(layout.domains[domain].root,...rel.split('/'))
   if(!existsSync(src))continue
   const copied=safeCopy(src,join(scratch,...rel.split('/')),domain,checkpoint)
   files+=copied.files;bytes+=copied.bytes
  }
  // No data from a running process can silently supersede the verified copy.
  for(const domain of MODEL_PARTS)for(const rel of STORAGE_DOMAINS[domain].items){
   const src=join(layout.domains[domain].root,...rel.split('/')),dst=join(scratch,...rel.split('/'))
   if(existsSync(src)&&!treesEqual(src,dst,domain,checkpoint))throw Error('源数据在复制期间发生变化，拒绝切换路径')
  }
  ensureStopped();assertColdRestoreClear(base);assertOfflineImageClear(plan.target)
  const previousEntries=Object.fromEntries(MODEL_PARTS.map(key=>[key,previous.domains[key]||null]))
  const marker={version:1,base,target:plan.target,domain:'model',nonce,verified:true,
   verifiedAt:new Date().toISOString(),files,bytes,mode:'copy',previousEntries}
  writeFileSync(join(scratch,MARKER),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  if(existsSync(plan.target)){
   validateLocalDataPath(plan.target)
   if(readdirSync(plan.target).length)throw Error('目标目录在迁移期间变成非空')
   rmSync(plan.target,{recursive:false})
  }
  renameSync(scratch,plan.target)
  // A SHA-matched copy is not proof that Windows can replace cached JSON.
  // Probe the actual renamed destination BEFORE making it authoritative.
  visionCacheProbe(join(plan.target,'vision-cache'))
  const next={version:1,domains:{...previous.domains}}
  for(const key of MODEL_PARTS)next.domains[key]={target:plan.target,nonce,mode:'copy'}
  const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,file);published=true}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  if(!MODEL_PARTS.every(key=>storageLayoutStatus(base).domains[key].root===plan.target))throw Error('模型分组迁移发布后身份复核失败')
  return {ok:true,domain:'model',target:plan.target,files,bytes,sourcePreserved:true,restartRequired:true,rebuildRequired:false}
 }catch(error){if(!published){try{rmSync(scratch,{recursive:true,force:true})}catch{}}throw error}
}
function rollbackModelOffline({root,confirmedStopped}){
 if(confirmedStopped!==true)throw Error('必须先完全退出所有 DSH / Python 进程')
 const base=validateLocalDataPath(root),layout=storageLayoutStatus(base)
 const roots=[...new Set(MODEL_PARTS.map(key=>layout.domains[key].root))]
 if(roots.length!==1||!MODEL_PARTS.every(key=>layout.domains[key].configured))throw Error('模型分组并非完整迁移状态')
 const target=roots[0],marker=JSON.parse(readFileSync(join(target,MARKER),'utf8'))
 if(marker.domain!=='model'||!marker.previousEntries||typeof marker.previousEntries!=='object')throw Error('没有可验证的分组回退记录')
 const entries=marker.previousEntries
 for(const domain of MODEL_PARTS){
  const prev=entries[domain]
  if(prev!==null&&(!prev||typeof prev.target!=='string'||typeof prev.nonce!=='string'||prev.mode!=='copy'))throw Error('回退来源配置非法')
  const oldRoot=prev?validateLocalDataPath(prev.target):base
  // Verify previous external markers have not been replaced or tampered with.
  if(prev){
   const oldMarker=JSON.parse(readFileSync(join(oldRoot,MARKER),'utf8'))
   if(oldMarker.nonce!==prev.nonce||oldMarker.base!==base||oldMarker.target!==oldRoot||
      !(oldMarker.domain===domain||oldMarker.domain==='model')||oldMarker.verified!==true)throw Error('旧分区身份验证失败，不允许回退')
  }
  for(const rel of STORAGE_DOMAINS[domain].items){
   const a=join(oldRoot,...rel.split('/')),b=join(target,...rel.split('/'))
   if(existsSync(a)!==existsSync(b)||existsSync(a)&&!treesEqual(a,b,domain))throw Error('迁移后数据已有变化；不允许自动回退覆盖已更新数据')
  }
 }
 const raw=loadRaw(base),next={version:1,domains:{...raw.domains}}
 for(const domain of MODEL_PARTS){
  if(entries[domain]===null)delete next.domains[domain]
  else next.domains[domain]=entries[domain]
 }
 const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,file)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
 storageLayoutStatus(base)
 return {ok:true,domain:'model',sourcePreserved:true,externalCopyPreserved:true,restartRequired:true}
}
/**
 * Return CURRENT authoritative data to the original bili-duty root.  This is
 * NOT a rollback: never replace the current data with stale root copies.
 * The optional old copies are moved to a separate, retained archive.  The
 * layout pointer switches only after all copies have passed SHA-256 checks.
 */
export function inspectDomainReturnHome({root,domain}={}){
 const base=validateLocalDataPath(root),group=STORAGE_MIGRATION_GROUPS[domain],spec=STORAGE_DOMAINS[domain]
 if(!group&&!spec)throw Error('未知的数据分区')
 const layout=storageLayoutStatus(base),keys=group?.domains||[domain]
 if(!group&&MODEL_PARTS.includes(domain)&&MODEL_PARTS.every(key=>layout.domains[key].configured&&layout.domains[key].root===layout.domains[domain].root))
  throw Error('模型与影音缓存为整组分盘；请统一选择 model 回迁')
 if(domain==='python'&&layout.domains.python.mode==='rebuild')throw Error('旧版 Python 重建环境不能按包缓存回迁处理')
 const moving=keys.filter(key=>layout.domains[key].configured)
 if(!moving.length)throw Error('当前所选数据仍在默认位置，无需回迁')
 let files=0,bytes=0;const sources=[]
 for(const key of moving){
  const sourceRoot=layout.domains[key].root
  for(const rel of migrationCopyItems(key,key==='python'?'cache':'copy')){
   const source=join(sourceRoot,...rel.split('/'))
   const old=join(base,...rel.split('/'))
   // A lost external source must never cause a stale old root copy to be
   // silently archived or elected as the new authoritative memory.
   if(!existsSync(source)&&(existsSync(old)||key==='memory'&&['life-memory','long-term-memory'].includes(rel)))
    throw Error('当前生效目录缺少关键数据或与旧副本不一致，禁止回迁：'+rel)
   const count=measureCopyable(source,key,rel)
   files+=count.files;bytes+=count.bytes
   if(existsSync(old)){
    const stat=lstatSync(old)
    if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())throw Error('默认位置含不安全的旧文件或目录：'+rel)
   }
   sources.push({domain:key,sourceRoot,relativePath:rel,current:source,defaultPath:old,oldCopyPresent:existsSync(old)})
  }
 }
 if(files>120000||bytes>120*1024**3)throw Error('回迁数据超出安全限额')
 return {ok:true,domain,target:base,root:base,files,bytes,sources,requiresStop:true,
  changesNow:false,returnHome:true,sourcePreserved:true,
  warning:'将当前生效分区复制回默认位置；旧 C 盘副本只会隔离保留，不用于覆盖当前数据。'}
}

export function returnDomainHomeOffline({root,domain,confirmedStopped=false,ensureStopped=()=>{},checkpoint=()=>{},visionCacheProbe=probeVisionCacheAccess}={}){
 assertColdRestoreClear(root)
 if(confirmedStopped!==true)throw Error('必须完全退出 DSH/Headless/Python 并确认停机')
 const plan=inspectDomainReturnHome({root,domain}),base=plan.root
 const raw=loadRaw(base),stage=join(base,'.dafeiyu-return-staged-'+randomUUID())
 const archive=join(dirname(base),'.dafeiyu-return-old-'+randomUUID())
 const moves=[];let published=false,archived=false
 try{
  mkdirSync(stage,{mode:0o700})
  for(const row of plan.sources){
   if(!existsSync(row.current))continue
   safeCopy(row.current,join(stage,...row.relativePath.split('/')),row.domain,checkpoint)
  }
  // Revalidate the current authoritative data while the plugin is stopped.
  for(const row of plan.sources){
   const staged=join(stage,...row.relativePath.split('/'))
   if(existsSync(row.current)!==existsSync(staged)||existsSync(row.current)&&!treesEqual(row.current,staged,row.domain,checkpoint))
    throw Error('回迁期间现役数据变化，取消切换：'+row.relativePath)
  }
  ensureStopped();assertColdRestoreClear(base)
  // No root copy is ever trusted as the newer version of Life memories.
  for(const row of plan.sources){
   const staged=join(stage,...row.relativePath.split('/')),old=row.defaultPath
   let parent=base
   for(const part of row.relativePath.split('/').slice(0,-1)){
    parent=join(parent,part)
    if(existsSync(parent)&&(!lstatSync(parent).isDirectory()||lstatSync(parent).isSymbolicLink()))
     throw Error('原位置父目录不安全：'+row.relativePath)
   }
   if(existsSync(old)){
    if(lstatSync(old).isSymbolicLink())throw Error('拒绝覆盖符号链接旧副本：'+row.relativePath)
    const backup=join(archive,...row.relativePath.split('/'))
    mkdirSync(dirname(backup),{recursive:true,mode:0o700})
    renameSync(old,backup);archived=true;moves.push({type:'archive',from:old,to:backup})
   }
   if(existsSync(staged)){
    mkdirSync(dirname(old),{recursive:true,mode:0o700})
    renameSync(staged,old);moves.push({type:'new',from:staged,to:old})
    if(!treesEqual(row.current,old,row.domain))throw Error('回迁完成前 SHA-256 复核失败：'+row.relativePath)
   }
  }
  ensureStopped()
  if(domain==='model'||domain==='media')visionCacheProbe(join(base,'vision-cache'))
  // Capture what the detached worker is leaving behind. Later cleanup is
  // allowed only if this exact historic snapshot remains unchanged.
  const externalSnapshot=domain==='memory'&&plan.sources.length
   ?inspectHistoricalLifeTarget(base,plan.sources[0].sourceRoot):null
  const next={version:1,domains:{...raw.domains}}
  const keys=STORAGE_MIGRATION_GROUPS[domain]?.domains||[domain]
  for(const key of keys)delete next.domains[key]
  const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,file);published=true}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  storageLayoutStatus(base)
  return {ok:true,domain,target:base,files:plan.files,bytes:plan.bytes,
   returnedHome:true,sourcePreserved:true,externalCopyPreserved:true,
   oldRootCopyArchive:archived?archive:null,
   externalSnapshot:externalSnapshot?{target:plan.sources[0].sourceRoot,
     fingerprint:externalSnapshot.fingerprint,files:externalSnapshot.files,bytes:externalSnapshot.bytes}:null,
   restartRequired:true}
 }catch(error){
  if(!published){
   let undoError=null
   for(const move of moves.reverse())try{
    if(existsSync(move.to)){mkdirSync(dirname(move.from),{recursive:true,mode:0o700});renameSync(move.to,move.from)}
   }catch(e){undoError=e}
   if(undoError)throw Error('回迁已中止；自动恢复旧目录失败，外置生效数据仍保留，请人工复核：'+String(undoError.message))
  }
  throw error
 }finally{
  // Staging contains only redundant copies. Never delete the retained archive.
  try{rmSync(stage,{recursive:true,force:true})}catch{}
 }
}

/** Immediate rollback ONLY if the old and new copies are still byte-identical. */
export function rollbackDomainOffline({root,domain,confirmedStopped=false}={}){
 assertColdRestoreClear(root)
 if(domain==='model')return rollbackModelOffline({root,confirmedStopped})
 if(confirmedStopped!==true)throw Error('必须先完全退出所有 DSH / Python 进程')
 const base=validateLocalDataPath(root),spec=STORAGE_DOMAINS[domain]
 if(!spec)throw Error('未知的数据分区')
 const status=storageLayoutStatus(base),entry=status.domains[domain]
 if(MODEL_PARTS.includes(domain)&&MODEL_PARTS.every(key=>status.domains[key].configured&&status.domains[key].root===entry.root))throw Error('模型与影音缓存已合并，请统一使用 --domain model 回退')
 if(domain==='python'){
  const raw=loadRaw(base)
  if(!raw.domains.python)throw Error('Python 分区尚无迁移指针')
  const markerTarget=entry.legacyPending?entry.legacyTarget:entry.root
  const marker=JSON.parse(readFileSync(join(markerTarget,MARKER),'utf8'))
  if(marker.domain!=='python'||marker.base!==base||marker.target!==markerTarget||marker.nonce!==raw.domains.python.nonce||marker.verified!==true)throw Error('Python 分区身份验证失败，不允许回退')
  const previousEntry=marker.previousEntry??null
  if(previousEntry!==null){
   if(typeof previousEntry.target!=='string'||typeof previousEntry.nonce!=='string'||!previousEntry.nonce||previousEntry.mode!=='rebuild')
    throw Error('旧版 Python 分区回退记录非法')
   const previousTarget=validateLocalDataPath(previousEntry.target)
   const previousMarker=JSON.parse(readFileSync(join(previousTarget,MARKER),'utf8'))
   if(previousMarker?.domain!=='python'||previousMarker.base!==base||previousMarker.target!==previousTarget||
      previousMarker.nonce!==previousEntry.nonce||previousMarker.verified!==true||previousMarker.mode!=='rebuild'||previousMarker.pythonStrategy==='safe-group-v2')
    throw Error('旧版 Python 分区身份验证失败，不允许回退')
  }
  const next={version:1,domains:{...raw.domains}}
  delete next.domains.python
  if(previousEntry)next.domains.python=previousEntry
  const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,file)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  storageLayoutStatus(base)
  return {ok:true,domain:'python',restoredLegacy:true,sourcePreserved:true,externalCopyPreserved:true,restartRequired:true,
   note:'旧 Python 环境始终保留；新目录中的缓存或重建环境也未删除。'}
 }
 if(!entry.configured)throw Error('此域尚未迁移')
 for(const rel of spec.items){
  const old=join(base,...rel.split('/')),current=join(entry.root,...rel.split('/'))
  if(existsSync(old)!==existsSync(current)||existsSync(old)&&!treesEqual(old,current,domain))throw Error('迁移后数据已有变化；为避免丢失记忆或更新，不允许自动回退')
 }
 const old=loadRaw(base),next={version:1,domains:{...old.domains}};delete next.domains[domain]
 const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,file)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
 return {ok:true,domain,restoredLegacy:true,externalCopyPreserved:true,restartRequired:true}
}
/** Must run while ALL DSH / Python processes are stopped. No source deletion. */
export function migrateDomainOffline({root,domain,target,mode,confirmedStopped=false,ensureStopped=()=>{},checkpoint=()=>{},visionCacheProbe=probeVisionCacheAccess}={}){
 assertColdRestoreClear(root)
 if(typeof target==='string'&&target.trim())assertOfflineImageClear(target)
 if(domain==='model')return migrateModelOffline({root,target,confirmedStopped,ensureStopped,checkpoint,visionCacheProbe})
 if(confirmedStopped!==true)throw Error('必须完全退出 DSH/Headless/Python 并显式确认停机')
 const plan=inspectDomainMigration({root,domain,target,mode}),base=plan.root,spec=STORAGE_DOMAINS[domain]
 const scratch=join(dirname(plan.target),'.dafeiyu-storage-migrating-'+randomUUID())
 const nonce=randomUUID(),destination=plan.target
 const previousRaw=loadRaw(base),previousEntry=previousRaw.domains[domain]||null
 let published=false
 try{
  // Parent must be a trusted local directory. The destination stays empty until verified.
  mkdirSync(dirname(destination),{recursive:true,mode:0o700})
  validateLocalDataPath(dirname(destination))
  mkdirSync(scratch,{mode:0o700})
  let files=0,bytes=0
  const copyItems=domain==='python'?migrationCopyItems(domain,plan.mode):(spec.migration==='copy'?spec.items:[])
  for(const rel of copyItems){
   const src=join(plan.sourceRoot,...rel.split('/'))
   if(!existsSync(src))continue
   const result=safeCopy(src,join(scratch,...rel.split('/')),domain,checkpoint)
   files+=result.files;bytes+=result.bytes
  }
  // A second pass catches changes from a mistakenly running producer before the pointer is published.
  for(const rel of copyItems){
   const src=join(plan.sourceRoot,...rel.split('/')),dst=join(scratch,...rel.split('/'))
   if(existsSync(src)&&!treesEqual(src,dst,domain,checkpoint))throw Error('源数据在复制期间发生变化，拒绝切换路径')
  }
  ensureStopped();assertColdRestoreClear(base);assertOfflineImageClear(destination)
  // Neither runtime environments nor their creation paths are changed by this migration.
  const marker={version:1,base,target:destination,domain,nonce,verified:true,verifiedAt:new Date().toISOString(),files,bytes,mode:plan.mode,
   ...(domain==='python'?{pythonStrategy:'safe-group-v2',previousEntry}:{} )}
  writeFileSync(join(scratch,MARKER),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  if(existsSync(destination)){
   validateLocalDataPath(destination)
   if(readdirSync(destination).length)throw Error('目标目录在迁移期间变成非空，绝不接管旧 Life 或未知用户文件')
   rmSync(destination,{recursive:false})
  }
  renameSync(scratch,destination)
  if(domain==='media')visionCacheProbe(join(destination,'vision-cache'))
  const next={version:1,domains:{...previousRaw.domains,[domain]:{target:destination,nonce,mode:plan.mode}}}
  const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,file);published=true}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  if(!storageLayoutStatus(base).domains[domain].configured)throw Error('迁移指针发布后的身份复核失败')
  return {ok:true,domain,target:destination,mode:plan.mode,files,bytes,sourcePreserved:true,restartRequired:true,
   rebuildRequired:false,pythonAction:domain==='python'?'cache-only':undefined}
 }catch(error){
  // Before publication, our private scratch copy can be dropped. If it was
  // already renamed into the destination, leave it untouched for recovery:
  // user files might now be present, and the old root remains authoritative.
  if(!published&&existsSync(scratch))try{rmSync(scratch,{recursive:true,force:true})}catch{}
  throw error
 }
}
export const storageLayoutFilename=()=>FILE
/** Read-only, bounded physical bytes. A link never counts its target twice. */
export function storageDomainsUsage(root){
 const status=storageLayoutStatus(root),rows=[]
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const current=status.domains[key]
  // The Python user-facing partition is cache-only. Live runtimes stay at the
  // original root by design and must never count as "partial migration".
  const paths=key==='python'
    ?spec.cacheItems.map(rel=>join(current.configured?current.root:status.root,...rel.split('/')))
    :effectiveDomainPaths(status.root,key,current)
  let files=0,bytes=0,incomplete=false
  const stack=[...paths]
  while(stack.length&&files<30000){
   const path=stack.pop()
   try{
    if(!existsSync(path))continue
    const st=lstatSync(path)
    if(st.isSymbolicLink()){incomplete=true;continue}
    if(st.isFile()){files++;bytes+=st.size}
    else if(st.isDirectory())for(const name of readdirSync(path))stack.push(join(path,name))
    else incomplete=true
   }catch{incomplete=true}
  }
  if(stack.length)incomplete=true
  rows.push({key,label:spec.label,configured:current.configured,partial:false,
   root:current.root,mode:current.mode,paths,sourceDefault:(key==='python'?spec.cacheItems:spec.items).map(rel=>join(status.root,...rel.split('/'))),files,bytes,incomplete,
   migration:spec.migration,requiresRestart:current.configured,legacyPending:current.legacyPending===true})
 }
 return rows
}
