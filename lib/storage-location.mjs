/**
 * Bili-duty data home relocation. The DSH-provided path remains authoritative
 * until a separately verified, offline migration publishes a bootstrap pointer.
 * Never migrate active files from a management HTTP request.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,readdirSync,statSync,copyFileSync,openSync,closeSync,readSync} from 'node:fs'
import {dirname,join,resolve,relative,isAbsolute,parse,sep} from 'node:path'
import {homedir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'

const POINTER='.bili-duty-location-v1.json'
const MARKER='.bili-duty-migration-v1.json'
const MAX_ITEMS=120000
const MAX_TOTAL=120*1024**3

export function originalStateDir(ctx){
 let dir=''
 try {
  const p=ctx?.get?.('dshHomePath')
  if(typeof p==='function'){const v=p('bili-duty');if(v)dir=String(v)}
  else if(typeof p==='string'&&p)dir=join(p,'bili-duty')
 }catch{}
 return resolve(dir||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'bili-duty'))
}
function within(a,b){const diff=relative(a,b);return diff===''||diff!==''&&!diff.startsWith('..'+sep)&&diff!=='..'&&!isAbsolute(diff)}
export function validateLocalDataPath(raw,{allowMissing=false}={}){
 if(typeof raw!=='string'||!raw.trim()||raw.length>420||/[\x00-\x1f\x7f]/.test(raw))throw Error('请输入本机磁盘上的绝对目录')
 const input=raw.trim()
 if(!isAbsolute(input)||process.platform==='win32'&&/^(?:\\\\|\\\\\?|\\\\\.)/.test(input))throw Error('仅支持本机绝对路径，不支持网络共享或设备路径')
 const p=resolve(input)
 if(p===parse(p).root)throw Error('不能直接使用磁盘根目录')
 let cur=p
 while(cur!==parse(cur).root){
  if(existsSync(cur)){
   const s=lstatSync(cur)
   if(s.isSymbolicLink()||!s.isDirectory())throw Error('存储路径包含符号链接或非目录节点')
  }else if(!allowMissing)throw Error('存储目录不存在：'+cur)
  cur=dirname(cur)
 }
 return p
}
export function storageLocationStatus(defaultDir){
 const base=validateLocalDataPath(defaultDir,{allowMissing:true})
 const pointerPath=join(dirname(base),POINTER)
 let s=null
 try{s=lstatSync(pointerPath)}catch(error){if(error?.code!=='ENOENT')throw error}
 if(!s)return {ok:true,defaultDir:base,currentDir:base,relocated:false,pointerPath}
 if(s.isSymbolicLink()||!s.isFile()||s.size>4096)throw Error('存储引导配置不安全，已拒绝加载，避免创建空白角色')
 let row
 try{row=JSON.parse(readFileSync(pointerPath,'utf8'))}catch{throw Error('存储引导配置损坏；请先修复路径，不能自动重置记忆')}
 if(row?.version!==1||row.source!==base||typeof row.target!=='string')throw Error('存储引导配置与当前 DSH 家目录不匹配')
 const target=validateLocalDataPath(row.target)
 if(target===base||within(base,target)||within(target,base))throw Error('非法存储迁移目标')
 const markerPath=join(target,MARKER)
 if(!existsSync(markerPath)||lstatSync(markerPath).isSymbolicLink())throw Error('新数据目录缺少安全迁移凭据，禁止启动空白角色')
 let marker
 try{marker=JSON.parse(readFileSync(markerPath,'utf8'))}catch{throw Error('新数据目录迁移凭据不可读')}
 if(marker?.version!==1||marker.source!==base||marker.target!==target||marker.nonce!==row.nonce||marker.ok!==true)
  throw Error('新旧目录身份校验失败，拒绝使用未验证的记忆数据')
 return {ok:true,defaultDir:base,currentDir:target,relocated:true,pointerPath}
}
export function inspectStorageTarget({source,target}){
 const src=validateLocalDataPath(source)
 // A root move with external domain pointers would invalidate their source-root identity.
 if(existsSync(join(src,'storage-layout-v1.json')))throw Error('已存在分区存储配置；禁止整体迁移覆盖独立分区的身份指针')
 const dest=validateLocalDataPath(target,{allowMissing:true})
 if(src===dest||within(src,dest)||within(dest,src))throw Error('新目录不能与当前目录相同或互相嵌套')
 if(existsSync(dest)&&readdirSync(dest).length)throw Error('目标文件夹非空；请选择新的空文件夹，避免覆盖旧数据')
 const parent=dirname(dest)
 validateLocalDataPath(parent,{allowMissing:true})
 return {ok:true,source:src,target:dest,requiresStop:true,changesNow:false}
}
function entriesUnder(root){
 const items=[],walk=(rel='')=>{
  const base=join(root,rel)
  for(const entry of readdirSync(base,{withFileTypes:true})){
   const path=join(base,entry.name),r=join(rel,entry.name),s=lstatSync(path)
   if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error('目录内存在不支持的链接或特殊文件：'+r)
   if(items.length>=MAX_ITEMS)throw Error('数据目录包含过多文件，迁移中止')
   items.push({rel:r,type:s.isDirectory()?'dir':'file',size:s.isFile()?s.size:0})
   if(s.isDirectory())walk(r)
  }
 }
 walk()
 if(items.reduce((sum,x)=>sum+x.size,0)>MAX_TOTAL)throw Error('迁移体积超过安全上限')
 return items
}
function fileSha(file){const fd=openSync(file,'r'),hash=createHash('sha256'),buf=Buffer.allocUnsafe(256*1024);try{let n=0;while((n=readSync(fd,buf,0,buf.length,null))>0)hash.update(buf.subarray(0,n));return hash.digest('hex')}finally{closeSync(fd)}}
/** Offline only. Keep source intact; no reentrant use with a running DSH process. */
export function migrateStorageOffline({source,target,confirmedStopped=false}={}){
 if(confirmedStopped!==true)throw Error('必须先完全关闭 DSH/Headless，然后显式确认冷迁移')
 const {source:src,target:dest}=inspectStorageTarget({source,target})
 const current=storageLocationStatus(src)
 if(current.currentDir!==src)throw Error('当前已有其他迁移位置，请先检查原迁移配置')
 const items=entriesUnder(src).filter(e=>e.rel!==POINTER&&e.rel!==MARKER)
 const parent=dirname(dest)
 mkdirSync(parent,{recursive:true});validateLocalDataPath(parent)
 const scratch=join(parent,'.dafeiyu-migrating-'+randomUUID())
 const nonce=randomUUID()
 try{
  mkdirSync(scratch,{recursive:false,mode:0o700})
  let count=0,bytes=0
  for(const item of items){
   const from=join(src,item.rel),to=join(scratch,item.rel)
   if(item.type==='dir'){mkdirSync(to,{recursive:true});continue}
   // No links, no silent loss; compare source and destination contents.
   if(lstatSync(from).isSymbolicLink())throw Error('源文件在复制时发生变化')
   mkdirSync(dirname(to),{recursive:true})
   copyFileSync(from,to)
   if(statSync(from).size!==statSync(to).size||fileSha(from)!==fileSha(to))throw Error('复制校验失败：'+item.rel)
   count++;bytes+=item.size
  }
  const marker={version:1,source:src,target:dest,nonce,ok:true,files:count,bytes,verifiedAt:new Date().toISOString()}
  writeFileSync(join(scratch,MARKER),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  if(existsSync(dest)){
   validateLocalDataPath(dest)
   // An empty destination created by user is permitted; refuse if it changed.
   if(readdirSync(dest).length)throw Error('迁移过程中目标文件夹不再为空')
   rmSync(dest,{recursive:true})
  }
  renameSync(scratch,dest)
  const pointerPath=join(dirname(src),POINTER),tmp=pointerPath+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,source:src,target:dest,nonce})+'\n',{flag:'wx',mode:0o600})
  renameSync(tmp,pointerPath)
  const r=storageLocationStatus(src)
  if(r.currentDir!==dest)throw Error('数据已复制但引导复核失败；请勿删除源目录')
  return {ok:true,files:count,bytes,currentDir:r.currentDir,sourcePreserved:true,restartRequired:true}
 }catch(e){try{rmSync(scratch,{recursive:true,force:true})}catch{}throw e}
}

export function storageCategories(root){
 const safe=validateLocalDataPath(root)
 const categories=[['embedding-runtime','.hf-cache','uv-cache','pip-cache','.venv-asr','.venv','uv-python'],['life-memory','long-term-memory'],['tmp','vision-cache','asr-transcript-cache']]
 const visited=new Set();let truncated=false
 const measure=(dir)=>{
  let bytes=0,items=0
  const walk=p=>{
   if(items>30000){truncated=true;return}
   if(!existsSync(p))return
   const st=lstatSync(p);if(st.isSymbolicLink())return
   if(st.isFile()){bytes+=st.size;items++;return}
   if(!st.isDirectory())return
   for(const entry of readdirSync(p)){if(items>30000)break;walk(join(p,entry))}
  }
  walk(dir);return bytes
 }
 const buckets=categories.map((names,i)=>({key:['runtime','memory','cache'][i],bytes:names.reduce((sum,name)=>{visited.add(name);return sum+measure(join(safe,name))},0)}))
 const other=readdirSync(safe).filter(name=>!visited.has(name)&&name!==MARKER).reduce((sum,name)=>sum+measure(join(safe,name)),0)
 return {buckets:[...buckets,{key:'other',bytes:other}],truncated}
}
