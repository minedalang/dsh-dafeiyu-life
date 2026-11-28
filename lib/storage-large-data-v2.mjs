/**
 * 2.8.3-dev.3: V2 large-data-only migration. All mutable Python runtime data
 * stays in the plugin's existing MIC-compatible sandbox. Only known model
 * artifacts are copied to the optional user-owned external data volume.
 *
 * The v1 layout and all existing copies remain intact for compatibility and
 * recovery. Never migrate executables, venvs, uv/pip caches, video work files,
 * or Life/forgetting stores without a proven complete writer boundary.
 */
import {assertColdRestoreClear,assertOfflineImageClear} from './cold-restore-fence.mjs'
import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,writeFileSync,renameSync,rmSync,copyFileSync,realpathSync,openSync,readSync,closeSync} from 'node:fs'
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {validateLocalDataPath} from './storage-location.mjs'

const MANIFEST='storage-large-data-v2.json'
const MARKER='.dafeiyu-large-data-v2.json'
const EMBEDDING_FILE='Qwen3-Embedding-0.6B-Q8_0.gguf'
const MEDIA_DIR='runtime-media-v2'
const LIMIT_BYTES=120*1024**3, LIMIT_FILES=120000
const within=(parent,child)=>{const rel=relative(parent,child);return rel===''||!!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)}
const readJson=(p,limit)=>{
 const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)throw Error('存储 V2 身份文件不安全')
 try{return JSON.parse(readFileSync(p,'utf8'))}catch{throw Error('存储 V2 身份文件损坏，不能回退到旧数据')}
}
function pathOf(root){return join(root,MANIFEST)}
function historicalV2(base,target){
 if(!existsSync(target)||!readdirSync(target).length)return null
 const markerFile=join(target,MARKER)
 if(!existsSync(markerFile))throw Error('目标非空且不是 V2 历史分区，拒绝覆盖')
 const marker=readJson(markerFile,4096)
 if(marker.version!==2||marker.base!==base||marker.target!==target||marker.verified!==true||typeof marker.nonce!=='string'||!marker.nonce)
  throw Error('历史 V2 目标身份不匹配，拒绝覆盖')
 const permitted=new Set([MARKER,'whisper','embedding-model'])
 if(readdirSync(target).some(name=>!permitted.has(name)))throw Error('历史 V2 目录出现未知数据，不允许自动复用')
 return marker
}

export function largeDataStatus(root){
 const base=validateLocalDataPath(root),p=pathOf(base)
 const local={version:2,configured:false,root:base,target:null,whisperHome:null,embeddingModelDir:null,
  mediaRoot:base,pythonRoot:base,excluded:[
   {key:'python',reason:'Python、uv/pip、虚拟环境及运行缓存必须保持在可写沙箱'},
   {key:'media',reason:'Python 的音视频与视觉临时文件保持在可写沙箱'},
   {key:'memory',reason:'Life、遗忘保护和向量索引尚未完成全部写入者的外迁认证，不参与 V2 自动迁移'}]}
 if(!existsSync(p))return local
 const obj=readJson(p,8192)
 if(obj?.version!==2||obj.base!==base||typeof obj.target!=='string'||typeof obj.nonce!=='string'||!obj.nonce)
  throw Error('大型数据 V2 配置字段不合法，拒绝默默改用旧数据')
 const target=validateLocalDataPath(obj.target)
 if(within(base,target)||within(target,base))throw Error('大型数据 V2 与核心目录不能嵌套')
 const m=join(target,MARKER)
 if(!existsSync(m))throw Error('大型数据 V2 身份标记丢失，拒绝生成空白模型目录')
 const marker=readJson(m,4096)
 if(marker.version!==2||marker.base!==base||marker.target!==target||marker.nonce!==obj.nonce||marker.verified!==true)
  throw Error('大型数据 V2 目标身份不一致，不能自动回退旧模型')
 return {...local,configured:true,target,whisperHome:join(target,'whisper','.hf-cache'),
  embeddingModelDir:join(target,'embedding-model'),mediaRoot:join(base,MEDIA_DIR),verifiedAt:marker.verifiedAt}
}
function hash(path){const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(262144);try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}finally{closeSync(fd)}}
function checkedFile(path,sourceRoot,allowHFLinks){
 const s=lstatSync(path)
 if(s.isSymbolicLink()){
  if(!allowHFLinks)throw Error('模型文件包含不允许的符号链接')
  const real=realpathSync(path)
  if(!within(sourceRoot,real)||!lstatSync(real).isFile())throw Error('Whisper 模型链接指向源目录外')
  return real
 }
 if(!s.isFile())throw Error('模型包含非普通文件')
 return path
}
function walk(source,sourceRoot,allowHFLinks,visit,checkpoint){
 if(!existsSync(source))return
 const queue=[[source,'']];let seen=0
 while(queue.length){
  checkpoint();const [p,rel]=queue.pop(),s=lstatSync(p)
  if(s.isDirectory()&&!s.isSymbolicLink()){
   for(const name of readdirSync(p))queue.push([join(p,name),rel?rel+'/'+name:name])
  }else{
   const original=checkedFile(p,sourceRoot,allowHFLinks)
   visit(original,rel)
  }
  if(++seen>LIMIT_FILES)throw Error('大型模型文件条目数量超过限额')
 }
}
// Sources may include retained local models and currently authoritative V1/V2
// models. A duplicate name must match byte-for-byte; stale data never wins.
function modelSources(base,{legacy=null}={}){
 const v2=largeDataStatus(base)
 const whisperRoots=[v2.configured?v2.whisperHome:null,
  legacy?.domains?.whisper?.root?join(legacy.domains.whisper.root,'.hf-cache'):null,
  join(base,'.hf-cache')].filter(Boolean)
 const embeddingRoots=[v2.configured?join(v2.embeddingModelDir,EMBEDDING_FILE):null,
  legacy?.domains?.embedding?.root?join(legacy.domains.embedding.root,'embedding-runtime',EMBEDDING_FILE):null,
  join(base,'embedding-runtime',EMBEDDING_FILE)].filter(Boolean)
 return {whisper:[...new Set(whisperRoots)],embedding:[...new Set(embeddingRoots)]}
}
function scanSources(sources,checkpoint=()=>{}){
 let files=0,bytes=0
 const consider=(p)=>{const s=lstatSync(p);files++;bytes+=s.size;if(files>LIMIT_FILES||bytes>LIMIT_BYTES)throw Error('大型数据超出安全迁移上限')}
 for(const root of sources.whisper)walk(root,root,true,consider,checkpoint)
 for(const file of sources.embedding)if(existsSync(file))consider(checkedFile(file,dirname(file),false))
 return {files,bytes}
}
export function inspectLargeDataMigration({root,target,legacy=null}={}){
 const base=validateLocalDataPath(root),current=largeDataStatus(base)
 const dest=validateLocalDataPath(target,{allowMissing:true})
 if(within(base,dest)||within(dest,base))throw Error('大型数据目录不得与核心运行目录互相嵌套')
 if(current.configured&&(within(current.target,dest)||within(dest,current.target)))throw Error('新大型数据位置不得覆盖当前生效位置')
 const historical=historicalV2(base,dest)
 if(legacy?.domains)for(const row of Object.values(legacy.domains))if(row.configured&&(within(row.root,dest)||within(dest,row.root)))
  throw Error('目标目录与旧版生效分区冲突，请使用独立的空目录')
 // A legacy external Life store stays under its original V1 identity and routing.
 // Do not merge, copy, roll back or repoint this irreplaceable memory.
 const sources=modelSources(base,{legacy}),counts=scanSources(sources)
 return {ok:true,domain:'large',mode:'copy',root:base,target:dest,files:counts.files,bytes:counts.bytes,
  requiresStop:true,changesNow:false,sourcePreserved:true,restartRequired:true,
  reuseHistorical:Boolean(historical),
  includes:['Whisper 已下载模型','Embedding GGUF 模型'],
  excluded:current.excluded,sourceRoots:sources,
  note:'只迁移全部已发现且安全的模型文件；Python 与媒体缓存保留核心运行区，Life 保持原生效位置不移动。旧副本不会自动删除。'}
}
function copyModels(sources,stage,checkpoint){
 let files=0,bytes=0
 const copy=(from,to)=>{
  checkpoint();mkdirSync(dirname(to),{recursive:true,mode:0o700})
  if(existsSync(to)){
   if(!lstatSync(to).isFile()||lstatSync(from).size!==lstatSync(to).size||hash(from)!==hash(to))
    throw Error('模型来源存在同名但不同内容的文件，禁止默默覆盖：'+to.slice(-110))
  }else{copyFileSync(from,to);if(lstatSync(from).size!==lstatSync(to).size||hash(from)!==hash(to))throw Error('模型复制 SHA-256 不一致')}
  files++;bytes+=lstatSync(from).size
 }
 for(const root of sources.whisper)walk(root,root,true,(file,rel)=>copy(file,join(stage,'whisper','.hf-cache',...rel.split('/'))),checkpoint)
 for(const file of sources.embedding)if(existsSync(file))copy(checkedFile(file,dirname(file),false),join(stage,'embedding-model',EMBEDDING_FILE))
 return {files,bytes}
}
function verifyCopies(sources,stage,checkpoint){
 const verify=(from,to)=>{
  checkpoint()
  if(!existsSync(to)||lstatSync(from).size!==lstatSync(to).size||hash(from)!==hash(to))
   throw Error('复制后源数据发生变化或目标校验失败，不发布 V2 位置')
 }
 for(const root of sources.whisper)walk(root,root,true,(file,rel)=>verify(file,join(stage,'whisper','.hf-cache',...rel.split('/'))),checkpoint)
 for(const file of sources.embedding)if(existsSync(file))verify(checkedFile(file,dirname(file),false),join(stage,'embedding-model',EMBEDDING_FILE))
}
/** Test the configured real video Python against a core Low-writable directory. */
export function probeCoreMediaPython({root,python,timeoutMs=5000,spawn=spawnSync}={}){
 const roots=[MEDIA_DIR,'tmp/vision','.hf-cache','uv-cache','pip-cache'].map(rel=>join(root,...rel.split('/')))
 for(const dir of roots){mkdirSync(dir,{recursive:true,mode:0o700});validateLocalDataPath(dir)}
 if(!python||!existsSync(python))throw Error('实际视频 Python 不存在；不能确认核心可写目录')
 const code=`import os,sys,uuid
for d in sys.argv[1:]:
    p=os.path.join(d,'.dsh-v2-'+uuid.uuid4().hex)
    try:
        fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        try: os.write(fd,b'ok')
        finally: os.close(fd)
        with open(p,'rb') as r:
            if r.read()!=b'ok': sys.exit(2)
    finally:
        if os.path.exists(p): os.unlink(p)
`
 const r=spawn(python,['-I','-c',code,...roots],{encoding:'utf8',timeout:timeoutMs,windowsHide:true,maxBuffer:4096})
 if(r.error||r.status!==0)throw Error('生产 Python 无法写入核心运行缓存区：'+String(r.error?.code||r.stderr||r.status).slice(0,90))
 return true
}
export function migrateLargeDataOffline({root,target,legacy=null,confirmedStopped=false,ensureStopped=()=>{},checkpoint=()=>{},python='',extraPythons=[],runtimeProbe=probeCoreMediaPython}={}){
 assertColdRestoreClear(root)
 if(typeof target==='string'&&target.trim())assertOfflineImageClear(target)
 if(confirmedStopped!==true)throw Error('大型数据迁移必须在 DSH 与 Python 完全退出后执行')
 const plan=inspectLargeDataMigration({root,target,legacy}),base=plan.root
 const stage=join(dirname(plan.target),'.dafeiyu-large-v2-staging-'+randomUUID()),nonce=randomUUID()
 let published=false,archived=null,ownedStage=null
 try{
  // Validate the actual Python writer before switching routes or touching data.
  if(!python)throw Error('未识别实际主 MCP Python；禁止未验证情况下迁移')
  for(const interpreter of [...new Set([python,...extraPythons].filter(Boolean))])runtimeProbe({root:base,python:interpreter})
  mkdirSync(dirname(plan.target),{recursive:true,mode:0o700})
  validateLocalDataPath(dirname(plan.target))
  mkdirSync(stage,{mode:0o700});ownedStage=lstatSync(stage)
  const copied=copyModels(plan.sourceRoots,stage,checkpoint)
  // Re-scan while paused; file changes or races cancel publication.
  const after=scanSources(plan.sourceRoots,checkpoint)
  verifyCopies(plan.sourceRoots,stage,checkpoint)
  if(after.files!==plan.files||after.bytes!==plan.bytes||copied.files!==plan.files||copied.bytes!==plan.bytes)
   throw Error('复制期间模型源发生变化，拒绝切换')
  ensureStopped();checkpoint();assertColdRestoreClear(base);assertOfflineImageClear(plan.target)
  const marker={version:2,base,target:plan.target,nonce,verified:true,verifiedAt:new Date().toISOString()}
  writeFileSync(join(stage,MARKER),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  if(existsSync(plan.target)){
   if(plan.reuseHistorical){
    if(!historicalV2(base,plan.target))throw Error('历史 V2 目录已被更改，拒绝复用')
    archived=join(dirname(plan.target),'.dafeiyu-large-v2-retained-'+randomUUID())
    renameSync(plan.target,archived)
   }else{
    if(readdirSync(plan.target).length)throw Error('目标迁移过程中被占用')
    rmSync(plan.target,{recursive:false})
   }
  }
  try{renameSync(stage,plan.target)}catch(error){
   if(archived&&!existsSync(plan.target))renameSync(archived,plan.target)
   throw error
  }
  // Publish only after the complete tree was checked. Old copies stay untouched.
  const p=pathOf(base),tmp=p+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:2,base,target:plan.target,nonce})+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,p);published=true}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  largeDataStatus(base)
  return {ok:true,domain:'large',target:plan.target,files:copied.files,bytes:copied.bytes,
   sourcePreserved:true,externalCopyPreserved:true,restartRequired:true,
   priorHistoricalArchive:archived,
   note:'全部安全大型模型已切换；Python 与媒体缓存保留核心沙箱，Life 保持原生效位置不变。'}
 }finally{if(!published&&ownedStage&&existsSync(stage))try{const st=lstatSync(stage);if(st.isDirectory()&&!st.isSymbolicLink()&&st.dev===ownedStage.dev&&st.ino===ownedStage.ino&&realpathSync(stage)===join(realpathSync(dirname(stage)),stage.split(sep).at(-1)))rmSync(stage,{recursive:true,force:true})}catch{}}
}
export const largeDataManifestName=()=>MANIFEST
export const largeDataMediaDir=()=>MEDIA_DIR
export const largeDataEmbeddingFile=()=>EMBEDDING_FILE
