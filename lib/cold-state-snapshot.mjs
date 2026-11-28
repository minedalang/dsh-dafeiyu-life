/**
 * Full LOCAL, OFFLINE state-directory snapshot for a stopped DSH instance.
 * Unlike the portable JSON business export this includes credentials, account
 * ledgers, private data, unknown future state and embedded runtime files.
 * It is NOT encrypted and must never be uploaded or shared.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readdirSync,openSync,readSync,closeSync,readFileSync,writeFileSync,
  copyFileSync,chmodSync,renameSync,rmSync,realpathSync,readlinkSync,fsyncSync,statfsSync,statSync} from 'node:fs'
import {dirname,join,relative,resolve,sep,isAbsolute,parse} from 'node:path'
import {validateLocalDataPath,storageLocationStatus} from './storage-location.mjs'
import {storageLayoutStatus,STORAGE_DOMAINS} from './storage-layout.mjs'
import {largeDataStatus} from './storage-large-data-v2.mjs'
import {assertMigrationStartupSafe} from './storage-migration-queue.mjs'
import {readCleanupJob, runtimeProcessesStopped} from './storage-cleanup-queue.mjs'
import {assertColdRestoreClear,assertCheckpointClear,coldRestoreFencePath,coldCheckpointPath,OFFLINE_RESCUE_MARKER,assertOfflineImageClear} from './cold-restore-fence.mjs'

const FORMAT='dsh-cold-state-v1'
// A root-only image would silently omit external memory/model stores after
// 2.8.3-dev.3 split storage. Refuse rather than advertise an incomplete backup.
const assertUnsplitRoot=root=>{
  if(existsSync(join(root,'storage-layout-v1.json'))||existsSync(join(root,'storage-large-data-v2.json')))throw Error('当前使用分层存储：旧版整根目录冷备份无法包含大型数据区；禁止制作或恢复不完整快照')
}

const within=(parent,child)=>{const rel=relative(resolve(parent),resolve(child));return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel))}
const requireDirectory=path=>{
  if(!existsSync(path))throw Error('目录不存在：'+path)
  const st=lstatSync(path)
  if(st.isSymbolicLink()||!st.isDirectory())throw Error('拒绝非目录或符号链接路径：'+path)
}
const shaFile=path=>{
  const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(1024*1024)
  try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n))}finally{closeSync(fd)}
  return h.digest('hex')
}
const safeRelative=name=>typeof name==='string'&&name.length<=1000&&name.length>0&&!name.includes('\\')&&
  !name.startsWith('/')&&!name.includes('\0')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!x.includes(':'))
const walk=(root,folder='',records=[],directories=[])=>{
  const here=folder?join(root,...folder.split('/')):root
  for(const entry of readdirSync(here,{withFileTypes:true})){
    const rel=folder?folder+'/'+entry.name:entry.name
    if(!safeRelative(rel))throw Error('不安全的文件名，停止完整快照')
    const st=lstatSync(join(root,...rel.split('/')))
    if(st.isSymbolicLink()||(!st.isFile()&&!st.isDirectory()))throw Error('数据目录含符号链接或特殊文件：'+rel)
    if(st.isDirectory()){directories.push({path:rel,mode:st.mode&0o777});walk(root,rel,records,directories)}
    else records.push({path:rel,bytes:st.size,mode:st.mode&0o777,sha256:shaFile(join(root,...rel.split('/')))})
  }
  return {files:records,dirs:directories}
}
const copyTree=(source,target,manifest)=>{
  mkdirSync(target,{recursive:true,mode:0o700})
  for(const d of manifest.dirs){const path=join(target,...d.path.split('/'));mkdirSync(path,{recursive:true,mode:0o700})}
  for(const f of manifest.files){const from=join(source,...f.path.split('/')),to=join(target,...f.path.split('/'))
    copyFileSync(from,to);chmodSync(to,0o600)
    if(shaFile(to)!==f.sha256)throw Error('快照复制后校验失败：'+f.path)
  }
  // Preserve executable bits and directory permissions for restored Python
  // runtimes, while snapshot files always remain owner-readable only.
}
const identity=root=>{
  const f=join(root,'character-identity.json')
  if(!existsSync(f))return null
  if(!lstatSync(f).isFile()||lstatSync(f).isSymbolicLink())throw Error('角色身份文件不安全')
  try{const id=JSON.parse(readFileSync(f,'utf8')).id
    if(typeof id!=='string'||id.length<8||id.length>128)throw Error('invalid id')
    return id
  }catch{throw Error('角色身份文件损坏，拒绝恢复')}
}
const safeManifest=manifest=>{
  if(manifest?.format!==FORMAT||!Array.isArray(manifest.files)||!Array.isArray(manifest.dirs)||manifest.files.length>300000)
    throw Error('完整快照清单格式不兼容')
  const seen=new Set()
  for(const row of [...manifest.dirs,...manifest.files]){
    if(!safeRelative(row.path)||seen.has(row.path)||!Number.isSafeInteger(row.mode)||row.mode<0||row.mode>0o777)
      throw Error('完整快照路径或权限不安全')
    seen.add(row.path)
  }
  for(const f of manifest.files)if(!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))
    throw Error('完整快照哈希格式不安全')
  const dirSet=new Set(manifest.dirs.map(x=>x.path))
  for(const path of seen){let i=path.lastIndexOf('/');while(i>0){const parent=path.slice(0,i);if(!dirSet.has(parent))throw Error('快照缺少父目录');i=parent.lastIndexOf('/')}}
}
const assertPayloadMatches=(payload,manifest)=>{
  const found=walk(payload),map=new Map(manifest.files.map(f=>[f.path,f]))
  if(found.files.length!==map.size||found.dirs.length!==manifest.dirs.length)throw Error('完整快照文件数量不一致')
  const dirNames=new Set(manifest.dirs.map(x=>x.path))
  for(const d of found.dirs)if(!dirNames.has(d.path))throw Error('完整快照目录不一致')
  for(const f of found.files){const original=map.get(f.path)
    if(!original||f.bytes!==original.bytes||f.sha256!==original.sha256)throw Error('完整快照校验失败：'+f.path)
  }
  return found
}
export function verifyColdSnapshot(snapshot){
  const dir=resolve(snapshot);requireDirectory(dir)
  const mf=join(dir,'manifest.json'),payload=join(dir,'payload')
  if(!existsSync(mf)||lstatSync(mf).isSymbolicLink()||!lstatSync(mf).isFile())throw Error('完整快照清单不存在')
  requireDirectory(payload)
  const manifest=JSON.parse(readFileSync(mf,'utf8'))
  safeManifest(manifest)
  const found=assertPayloadMatches(payload,manifest)
  return {ok:true,format:FORMAT,files:found.files.length,dirs:found.dirs.length,
    bytes:found.files.reduce((n,f)=>n+f.bytes,0),createdAt:manifest.createdAt||''}
}
export function createColdSnapshot({root,destination,stoppedConfirmed=false,checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed)throw Error('必须先停止 DSH 并明确确认停机')
  if(!root||!destination)throw Error('需要提供数据目录和独立备份目录')
  root=resolve(root);destination=resolve(destination)
  requireDirectory(root)
  assertColdRestoreClear(root)
  assertUnsplitRoot(root)
  if(within(root,destination)||within(destination,root))throw Error('备份目标不能与数据目录包含或重叠')
  if(existsSync(destination))throw Error('备份目标已存在，拒绝覆盖')
  assertStopped(checkStopped);activeParts(root)
  mkdirSync(dirname(destination),{recursive:true})
  const manifest={format:FORMAT,createdAt:new Date().toISOString(),...walk(root)}
  const staged=destination+'.snapshot-'+randomUUID()
  try{
    mkdirSync(staged,{mode:0o700})
    copyTree(root,join(staged,'payload'),manifest)
    writeFileSync(join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'})
    verifyColdSnapshot(staged)
    assertStopped(checkStopped);assertColdRestoreClear(root);activeParts(root)
    if(stateDigest(walk(root))!==stateDigest(manifest)||present(destination))throw Error('旧格式备份期间原目录或目标变化')
    renameSync(staged,destination)
    return verifyColdSnapshot(destination)
  }catch(e){rmSync(staged,{recursive:true,force:true});throw e}
}
export function restoreColdSnapshot({snapshot,root,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RESTORE_FULL_DSH_STATE')throw Error('必须停机并输入完整恢复确认口令')
  if(!snapshot||!root)throw Error('需要提供快照与恢复目录')
  snapshot=splitLocalPath(snapshot);root=splitLocalPath(root,{allowMissing:true});assertColdRestoreClear(root)
  if(overlap(snapshot,root))throw Error('不能恢复到快照自身或其内部')
  const verified=verifyColdSnapshot(snapshot),payload=join(snapshot,'payload')
  assertUnsplitRoot(payload)
  if(!present(root))throw Error('原业务目录不存在；不能证明历史遗忘、授权及外发账本完整，请使用隔离救援 rescue-disaster')
  assertUnsplitRoot(root);assertStopped(checkStopped);activeParts(root)
  const bootstrap=bootstrapOf(root)
  if(bootstrap&&overlap(bootstrap.source,snapshot))throw Error('快照与原核心引导路径重叠')
  if(identity(payload)!==identity(root))throw Error('新旧角色身份不一致，禁止覆盖')
  const manifest=JSON.parse(readFileSync(join(snapshot,'manifest.json'),'utf8'));safeSplitInventory(manifest)
  const part={id:'core',root,domains:['core']},current={...part,...splitWalk(root)}
  const incoming={...manifest,...part}
  // Legacy compatibility is about the format, never permission to roll back
  // todos, receipts, forgetting or an opaque future business file.
  assertNoRollback([current],[incoming]);requireSpace([{parent:dirname(root),...partSize(incoming)}])
  const id=randomUUID(),journal={version:1,id,parts:[{...part,prior:stateDigest(current)}]},stage=stagePath(part,id),saved=safeguardPath(part,id)
  writeFence(root,journal)
  try{
    if(present(stage)||present(saved))throw Error('恢复临时目录冲突')
    copySplit(payload,stage,incoming,{restore:true})
    writeFileSync(join(stage,'restore-freeze.json'),JSON.stringify({version:1,reviewRequired:true,at:new Date().toISOString()})+'\n',{mode:0o600})
    assertStopped(checkStopped)
    if(JSON.stringify(bootstrapOf(root))!==JSON.stringify(bootstrap)||stateDigest(splitWalk(root))!==stateDigest(current))throw Error('旧格式恢复期间现役状态变化')
    renameSync(root,saved);renameSync(stage,root)
    activeParts(root)
    const omit=x=>({...x,files:x.files.filter(f=>f.path!=='restore-freeze.json')})
    if(inventoryDigest(omit(splitWalk(root)))!==inventoryDigest(omit(incoming))||JSON.stringify(bootstrapOf(root))!==JSON.stringify(bootstrap)||readIdentityJson(join(root,'restore-freeze.json')).reviewRequired!==true)throw Error('旧格式恢复复核失败')
    assertStopped(checkStopped)
    rmSync(coldRestoreFencePath(root))
    return {...verified,restored:true,safeguardPath:saved,restartRequired:true}
  }catch(e){
    try{rollbackFence(root,journal,checkStopped)}catch{throw Error('旧格式恢复失败且未能完整回退；保持启动冻结，请执行 rollback-full。'+e.message)}
    throw Error('旧格式恢复未完成，已回退。'+e.message)
  }
}


// Active-partition snapshot, distinct from the legacy single-root format. The
// layout resolver (not a guessed disk list) remains the sole routing authority.
const SPLIT_FORMAT='dsh-cold-state-v2'
const COLD_IMAGE_KIND='dsh-cold-snapshot-only-v1'
const coldImageMarker=()=>({version:1,kind:COLD_IMAGE_KIND,activationAllowed:false})
const MAX_PARTS=6, MAX_ROWS=300000, MAX_MANIFEST=160*1024*1024
const winName=name=>safeRelative(name)&&name.split('/').every(x=>!/[<>:"|?*\x00-\x1f]/.test(x)&&!/[. ]$/.test(x)&&! /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(x))
const folded=s=>s.normalize('NFC').toLowerCase()
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const present=p=>{try{lstatSync(p);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
function splitLocalPath(raw,{allowMissing=false}={}){
  const path=validateLocalDataPath(raw,{allowMissing})
  for(let p=path;p!==parse(p).root;p=dirname(p))if(present(p)){
    const s=lstatSync(p)
    if(s.isSymbolicLink()||!s.isDirectory())throw Error('分盘路径包含链接或非目录节点')
  }
  return path
}
function requireSpace(rows){
  // Group partitions on the same filesystem; individually checking each
  // target would double-count the free space. This is an estimate, not a
  // reservation; copy failures still leave the old directories untouched.
  const disks=new Map()
  for(const {parent,bytes,entries} of rows){
    splitLocalPath(parent)
    const st=statSync(parent),key=process.platform==='win32'?parse(parent).root.toLowerCase():String(st.dev)
    const space=statfsSync(parent,{bigint:true}),free=space.bavail*space.bsize
    const need=BigInt(bytes)+BigInt(entries)*4096n
    const prior=disks.get(key)||{free,need:0n}
    disks.set(key,{free:free<prior.free?free:prior.free,need:prior.need+need})
  }
  for(const {free,need} of disks.values())if(free<need+16n*1024n*1024n)throw Error('目标磁盘可用空间不足；需要保留旧数据和完整临时副本')
}
const partSize=p=>({bytes:p.files.reduce((n,f)=>n+f.bytes,0),entries:p.files.length+p.dirs.length})
const overlap=(a,b)=>within(a,b)||within(b,a)
const sorted=rows=>[...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
const inventoryDigest=m=>digest([sorted(m.files).map(({path,bytes,sha256})=>[path,bytes,sha256]),sorted(m.dirs).map(x=>x.path)])
const stateDigest=m=>digest([sorted(m.files).map(({path,bytes,sha256,mode})=>[path,bytes,sha256,mode]),sorted(m.dirs).map(({path,mode})=>[path,mode])])
function safeSplitInventory(m){
  safeManifest({...m,format:FORMAT})
  if(m.files.length+m.dirs.length>MAX_ROWS)throw Error('完整快照文件条目过多')
  const names=new Set()
  for(const row of [...m.files,...m.dirs]){
    const key=folded(row.path)
    if(!winName(row.path)||names.has(key))throw Error('不安全或大小写冲突的快照路径')
    names.add(key)
  }
}
// Only HF snapshot file links pointing into the same model's blobs directory
// are materialised. No directory link, external target, runtime link or generic
// data link is followed. The live link is never altered.
function hfLink(root,rel,path){
  const m=/^((?:.*\/)?\.hf-cache\/hub\/models--[^/]+)\/snapshots\/[^/]+\/[^/]+$/.exec(rel)
  if(!m)throw Error('数据目录含不支持的链接；完整快照未生成')
  const link=readlinkSync(path)
  if(isAbsolute(link))throw Error('Whisper 绝对链接不能安全随完整快照回退')
  const target=resolve(dirname(path),link),blobs=join(root,...m[1].split('/'),'blobs')
  if(!within(blobs,target)||dirname(target)!==blobs||realpathSync(target)!==target||!lstatSync(target).isFile())throw Error('Whisper 链接未指向同模型的普通 blob 文件')
  return target
}
function splitWalk(root,{links=false}={}){
  splitLocalPath(root)
  const files=[],dirs=[]
  function scan(folder=''){
    for(const entry of readdirSync(join(root,folder))){
      const rel=folder?folder+'/'+entry:entry
      if(!winName(rel)||files.length+dirs.length>=MAX_ROWS)throw Error('不安全的快照路径或超出条目上限')
      const p=join(root,...rel.split('/')),s=lstatSync(p)
      if(s.isDirectory()&&!s.isSymbolicLink()){dirs.push({path:rel,mode:s.mode&0o777});scan(rel);continue}
      const source=s.isSymbolicLink()&&links?hfLink(root,rel,p):p,st=lstatSync(source)
      if(!st.isFile()||st.isSymbolicLink())throw Error('数据目录含链接或特殊文件；完整快照未生成')
      files.push({path:rel,bytes:st.size,mode:st.mode&0o777,sha256:shaFile(source)})
    }
  }
  scan();const result={files:sorted(files),dirs:sorted(dirs)};safeSplitInventory(result);return result
}
function copySplit(source,target,m,{links=false,restore=false}={}){
  mkdirSync(target,{mode:0o700})
  for(const d of m.dirs)mkdirSync(join(target,...d.path.split('/')),{mode:0o700})
  for(const f of m.files){
    let from=join(source,...f.path.split('/'));const to=join(target,...f.path.split('/'))
    splitLocalPath(dirname(from))
    if(lstatSync(from).isSymbolicLink()&&links)from=hfLink(source,f.path,from)
    if(!lstatSync(from).isFile()||lstatSync(from).isSymbolicLink())throw Error('复制期间来源文件变化')
    copyFileSync(from,to);chmodSync(to,restore?f.mode:0o600)
    if(shaFile(to)!==f.sha256)throw Error('完整快照复制后校验失败')
  }
  if(restore)for(const d of [...m.dirs].reverse())chmodSync(join(target,...d.path.split('/')),d.mode)
  if(inventoryDigest(splitWalk(target))!==inventoryDigest(m))throw Error('完整快照复制树不一致')
}
function readIdentityJson(file,limit=16384){
  const stat=lstatSync(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('存储身份文件不安全')
  return JSON.parse(readFileSync(file,'utf8'))
}
function bootstrapOf(root){
  const migrationMarker=join(root,'.bili-duty-migration-v1.json')
  if(present(migrationMarker)){
    const marker=readIdentityJson(migrationMarker)
    const location=storageLocationStatus(marker.source)
    if(location.currentDir!==root||!location.relocated)throw Error('不能备份非生效的历史核心目录')
    const pointer=readIdentityJson(location.pointerPath,4096)
    return {source:marker.source,pointer}
  }
  if(storageLocationStatus(root).currentDir!==root)throw Error('请使用实际生效的核心目录，不要备份旧位置')
  return null
}
function activeParts(root){
  root=splitLocalPath(root)
  bootstrapOf(root)
  assertMigrationStartupSafe(root)
  if(readCleanupJob(root).status==='waiting')throw Error('存在未完成的旧模型清理任务')
  const layout=storageLayoutStatus(root),large=largeDataStatus(root),parts=[{id:'core',root,domains:['core']}]
  for(const [key,row] of Object.entries(layout.domains))if(row.configured||row.mode==='legacy-rebuild-pending'){
    // Pending legacy Python rebuild still requires its external identity marker
    // at startup, even though Python's live paths remain in the core directory.
    const target=row.configured?row.root:splitLocalPath(row.legacyTarget)
    const existing=parts.find(p=>p.root===target)
    if(existing)existing.domains.push(key)
    else parts.push({id:'v1-'+key,root:target,domains:[key]})
  }
  if(large.configured)parts.push({id:'v2-large',root:large.target,domains:['large']})
  validateParts(parts)
  for(const p of parts)assertOfflineImageClear(p.root)
  return parts
}
function validateParts(parts){
  if(!Array.isArray(parts)||!parts.length||parts.length>MAX_PARTS||parts[0].id!=='core'||JSON.stringify(parts[0].domains)!=='["core"]')throw Error('分区清单格式非法')
  const ids=new Set(),domains=new Set()
  for(const p of parts){
    if(typeof p.root!=='string'||!isAbsolute(p.root)||resolve(p.root)!==p.root||p.root===parse(p.root).root||!/^(?:core|v1-(?:whisper|embedding|python|media|memory)|v2-large)$/.test(p.id)||ids.has(p.id)||!Array.isArray(p.domains)||!p.domains.length)throw Error('分区身份清单非法')
    if(p.id==='v2-large'?JSON.stringify(p.domains)!=='["large"]':p.id!=='core'&&p.id!=='v1-'+p.domains[0])throw Error('分区类型与身份不一致')
    for(const d of p.domains){if(!['core','whisper','embedding','python','media','memory','large'].includes(d)||domains.has(d))throw Error('分区重复或非法');domains.add(d)}
    ids.add(p.id)
  }
  for(let i=0;i<parts.length;i++)for(let j=0;j<i;j++)if(overlap(parts[i].root,parts[j].root))throw Error('生效分区相互重叠')
}
// Verification is independent of the live disks. Reconstruct the active
// partition list from the captured core layout and each captured identity
// marker; removing a partition AND its manifest row must still fail.
function assertCapturedTopology(m,payload){
  const core=join(payload,'core'),base=m.parts[0].root
  const optional=(p,limit)=>present(p)?readIdentityJson(p,limit):null
  const relocation=optional(join(core,'.bili-duty-migration-v1.json'))
  if(relocation){
    const b=m.bootstrap,p=b?.pointer
    if(relocation.version!==1||relocation.ok!==true||relocation.target!==base||b?.source!==relocation.source||p?.version!==1||p.source!==b.source||p.target!==base||p.nonce!==relocation.nonce)throw Error('快照核心迁移引导身份不匹配')
  }else if(m.bootstrap!==null)throw Error('快照包含未知核心迁移引导')
  const large=optional(join(core,'storage-large-data-v2.json'),8192)
  const layout=optional(join(core,'storage-layout-v1.json'))||{version:1,domains:{}}
  const expected=[{id:'core',root:base,domains:['core']}]
  if(layout.version!==1||!layout.domains||typeof layout.domains!=='object'||Array.isArray(layout.domains)||Object.keys(layout.domains).some(k=>!Object.hasOwn(STORAGE_DOMAINS,k)))throw Error('快照 V1 分区配置非法')
  if(large&&(large.version!==2||large.base!==base||typeof large.target!=='string'||typeof large.nonce!=='string'||!large.nonce))throw Error('快照 V2 分区配置非法')
  for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
    if(large&&['whisper','embedding','python','media'].includes(key))continue
    const entry=layout.domains[key];if(!entry)continue
    const validModes=key==='python'?['cache','rebuild']:[spec.migration]
    if(typeof entry.target!=='string'||typeof entry.nonce!=='string'||!entry.nonce||!validModes.includes(entry.mode))throw Error('快照 V1 分区字段非法')
    const part=m.parts.find(p=>p.root===entry.target&&p.domains.includes(key))
    if(!part)throw Error('快照缺少生效 V1 分区：'+key)
    const marker=readIdentityJson(join(payload,part.id,'.dafeiyu-storage-domain-v1.json'),4096)
    const group=['whisper','embedding','media']
    const shared=marker.domain==='model'&&group.includes(key)&&group.every(k=>{
      const e=layout.domains[k];return e?.target===entry.target&&e?.nonce===entry.nonce&&e?.mode==='copy'
    })
    if(marker.version!==1||marker.base!==base||marker.target!==entry.target||marker.nonce!==entry.nonce||marker.verified!==true||marker.mode!==entry.mode||!(marker.domain===key||shared))throw Error('快照 V1 分区身份不匹配：'+key)
    const row=expected.find(p=>p.root===entry.target)
    if(row)row.domains.push(key);else expected.push({id:'v1-'+key,root:entry.target,domains:[key]})
  }
  if(large){
    const part=m.parts.find(p=>p.id==='v2-large'&&p.root===large.target)
    if(!part)throw Error('快照缺少生效 V2 大型数据分区')
    const marker=readIdentityJson(join(payload,part.id,'.dafeiyu-large-data-v2.json'),4096)
    if(marker.version!==2||marker.base!==base||marker.target!==large.target||marker.nonce!==large.nonce||marker.verified!==true)throw Error('快照 V2 分区身份不匹配')
    expected.push({id:'v2-large',root:large.target,domains:['large']})
  }
  if(JSON.stringify(expected)!==JSON.stringify(m.parts.map(({id,root,domains})=>({id,root,domains}))))throw Error('快照分区清单与捕获的生效配置不一致')
}
function splitManifest(snapshot){
  const root=splitLocalPath(snapshot),file=join(root,'manifest.json'),s=lstatSync(file)
  if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_MANIFEST)throw Error('完整快照清单不安全')
  const m=JSON.parse(readFileSync(file,'utf8'))
  if(m.format!==SPLIT_FORMAT)throw Error('不是 V2 分盘完整快照')
  validateParts(m.parts)
  let count=0
  for(const p of m.parts){safeSplitInventory(p);count+=p.files.length+p.dirs.length}
  if(count>MAX_ROWS)throw Error('分盘快照条目超限')
  const names=readdirSync(root).sort()
  const marker=join(root,OFFLINE_RESCUE_MARKER)
  if(present(marker)){
    if(JSON.stringify(readIdentityJson(marker,4096))!==JSON.stringify(coldImageMarker()))throw Error('冷快照隔离标记非法')
    if(JSON.stringify(names)!==JSON.stringify(['manifest.json',OFFLINE_RESCUE_MARKER,'partitions']))throw Error('分盘快照存在未知目录')
  }else if(JSON.stringify(names)!=='["manifest.json","partitions"]')throw Error('分盘快照存在未知目录')
  const payload=splitLocalPath(join(root,'partitions'))
  if(JSON.stringify(readdirSync(payload).sort())!==JSON.stringify(m.parts.map(p=>p.id).sort()))throw Error('分盘快照缺失或存在多余分区')
  for(const p of m.parts){
    const found=splitWalk(join(payload,p.id))
    if(inventoryDigest(found)!==inventoryDigest(p))throw Error('分盘快照校验失败：'+p.id)
  }
  assertCapturedTopology(m,payload)
  return m
}
const summary=m=>({ok:true,format:SPLIT_FORMAT,createdAt:m.createdAt,partitions:m.parts.length,
  files:m.parts.reduce((n,p)=>n+p.files.length,0),dirs:m.parts.reduce((n,p)=>n+p.dirs.length,0),bytes:m.parts.reduce((n,p)=>n+p.files.reduce((a,f)=>a+f.bytes,0),0)})
export function verifySplitColdSnapshot(snapshot){return summary(splitManifest(snapshot))}
// The reintroduced maintenance entry accepts only deliberately isolated images
// with a real established role. Legacy formats remain source-only compatibility.
export function assertMaintenanceSnapshot(snapshot){
  const dir=splitLocalPath(snapshot),marker=join(dir,OFFLINE_RESCUE_MARKER)
  if(!present(marker)||JSON.stringify(readIdentityJson(marker,4096))!==JSON.stringify(coldImageMarker()))throw Error('需要新版隔离停机快照；旧便携包或无标记历史快照不能使用此入口')
  assertMaintenanceRole(join(dir,'partitions','core'))
}
export function assertMaintenanceRole(root){
  const row=readIdentityJson(join(splitLocalPath(root),'character-identity.json'))
  if(row?.version!==1||typeof row.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)||!Number.isFinite(row.createdAt)||row.createdAt<=0)throw Error('缺少可信的现役角色身份；禁止维护激活')
}
export function inspectSplitColdSnapshot(root){
  root=splitLocalPath(root);assertColdRestoreClear(root)
  return {ok:true,requiresStop:true,parts:activeParts(root)}
}
export function createSplitColdSnapshot({root,destination,stoppedConfirmed=false,checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed)throw Error('必须先停止 DSH 并明确确认停机')
  root=splitLocalPath(root);destination=splitLocalPath(destination,{allowMissing:true})
  assertColdRestoreClear(root);assertOfflineImageClear(destination)
  const parts=activeParts(root),bootstrap=bootstrapOf(root)
  if(parts.some(p=>overlap(p.root,destination))||bootstrap&&overlap(bootstrap.source,destination))throw Error('备份目标不能与任何生效分区重叠')
  if(present(destination))throw Error('备份目标已存在，拒绝覆盖')
  assertStopped(checkStopped)
  mkdirSync(dirname(destination),{recursive:true});splitLocalPath(dirname(destination))
  const staged=destination+'.snapshot-'+randomUUID();let ownsStage=false
  try{
    mkdirSync(staged,{mode:0o700});ownsStage=true
    writeFileSync(join(staged,OFFLINE_RESCUE_MARKER),JSON.stringify(coldImageMarker())+'\n',{mode:0o600,flag:'wx'})
    mkdirSync(join(staged,'partitions'),{mode:0o700})
    const rows=parts.map(p=>({...p,...splitWalk(p.root,{links:true})}))
    if(rows.reduce((n,p)=>n+p.files.length+p.dirs.length,0)>MAX_ROWS)throw Error('分盘快照条目超限')
    requireSpace(rows.map(p=>({parent:dirname(destination),...partSize(p)})))
    for(const p of rows)copySplit(p.root,join(staged,'partitions',p.id),p,{links:true})
    const m={format:SPLIT_FORMAT,createdAt:new Date().toISOString(),bootstrap,parts:rows}
    writeFileSync(join(staged,'manifest.json'),JSON.stringify(m,null,2)+'\n',{mode:0o600,flag:'wx'})
    verifySplitColdSnapshot(staged)
    assertStopped(checkStopped);assertColdRestoreClear(root)
    if(JSON.stringify(activeParts(root))!==JSON.stringify(parts)||JSON.stringify(bootstrapOf(root))!==JSON.stringify(bootstrap)||rows.some(p=>stateDigest(splitWalk(p.root,{links:true}))!==stateDigest(p)))throw Error('备份期间生效分区或文件变化；禁止发布不一致快照')
    if(present(destination))throw Error('备份目标已存在，拒绝覆盖')
    renameSync(staged,destination)
    return summary(m)
  }catch(e){if(ownsStage)rmSync(staged,{recursive:true,force:true});throw e}
}
function assertStopped(checkStopped){if(checkStopped()?.ok!==true)throw Error('仍有 DSH、Node、Python 或模型进程；请完全退出后重试')}
// Until all durable deletion/permission/outbound ledgers have monotonic merge
// contracts, don't roll them back. Unknown files are protected by default.
// A cold copy is exact; restoring it is allowed only when non-rebuildable
// state is still identical. This deliberately refuses historical state rollback.
function rebuildable(p,path){
  if(path==='restore-freeze.json'&&p.id==='core')return true
  const prefix=(...names)=>names.some(n=>path===n||path.startsWith(n+'/'))
  const hf=rel=>/^\.hf-cache\/hub\/models--[^/]+\/(?:blobs|snapshots|refs)\//.test(rel)
  const embedding=rel=>/^Qwen3-Embedding-0\.6B-Q8_0\.gguf(?:\.part)?$/.test(rel)
  if(p.id==='v2-large')return path.startsWith('whisper/')&&hf(path.slice('whisper/'.length))||path.startsWith('embedding-model/')&&embedding(path.slice('embedding-model/'.length))
  if(p.id==='core'||p.domains.includes('whisper'))if(hf(path))return true
  if(p.id==='core'||p.domains.includes('embedding'))if(path.startsWith('embedding-runtime/')&&embedding(path.slice('embedding-runtime/'.length)))return true
  if(p.id==='core'||p.domains.includes('python'))if(prefix('uv-cache','pip-cache'))return true
  return false
}
function protectedStateDiff(current,incoming){
  return current.map(p=>{
    const old=incoming.find(x=>x.id===p.id),protectedFiles=x=>sorted(x.files.filter(f=>!rebuildable(p,f.path))).map(({path,sha256,bytes,mode})=>[path,sha256,bytes,mode])
    const cacheDir=path=>{
      const hfDir=x=>/^\.hf-cache(?:\/hub(?:\/models--[^/]+(?:\/(?:blobs|snapshots|refs)(?:\/[^/]+)*)?)?)?$/.test(x)
      if(p.id==='v2-large')return path==='whisper'||path==='embedding-model'||path.startsWith('whisper/')&&hfDir(path.slice(8))
      if((p.id==='core'||p.domains.includes('whisper'))&&hfDir(path))return true
      if((p.id==='core'||p.domains.includes('embedding'))&&path==='embedding-runtime')return true
      return rebuildable(p,path)
    }
    const protectedDirs=x=>sorted(x.dirs.filter(d=>!cacheDir(d.path))).map(({path,mode})=>[path,mode])
    const compare=(a,b)=>{
      const live=new Map(a.map(row=>[row[0],JSON.stringify(row)])),backup=new Map(b.map(row=>[row[0],JSON.stringify(row)]))
      const counts={identical:0,currentOnly:0,snapshotOnly:0,changed:0}
      for(const [key,value] of live){if(!backup.has(key))counts.currentOnly++;else if(backup.get(key)===value)counts.identical++;else counts.changed++}
      for(const key of backup.keys())if(!live.has(key))counts.snapshotOnly++
      return counts
    }
    const files=compare(protectedFiles(p),protectedFiles(old)),directories=compare(protectedDirs(p),protectedDirs(old))
    const identical=[files,directories].every(x=>x.currentOnly===0&&x.snapshotOnly===0&&x.changed===0)
    return {id:p.id,identical,files,directories}
  })
}
function assertNoRollback(current,incoming){
  const changed=protectedStateDiff(current,incoming).find(p=>!p.identical)
  if(changed)throw Error('当前记忆、授权、运行账本或未知业务文件已变化；不能安全回退历史状态：'+changed.id)
}
const tokenOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)
const stagePath=(p,id)=>p.root+'.cold-stage-'+id
const safeguardPath=(p,id)=>p.root+'.pre-restore-'+id
function readFence(root){
  const f=coldRestoreFencePath(root),s=lstatSync(f)
  if(s.isSymbolicLink()||!s.isFile()||s.size>32768)throw Error('恢复事务标记不安全')
  const j=JSON.parse(readFileSync(f,'utf8'));validateParts(j.parts)
  if(j.version!==1||!tokenOk(j.id)||j.parts[0].root!==root||j.parts.some(p=>!/^[a-f0-9]{64}$/.test(p.prior)))throw Error('恢复事务身份不匹配')
  return j
}
function writeFence(root,j){
  const fd=openSync(coldRestoreFencePath(root),'wx',0o600)
  try{writeFileSync(fd,JSON.stringify(j)+'\n');fsyncSync(fd)}finally{closeSync(fd)}
}
function rollbackFence(root,j,checkStopped){
  assertStopped(checkStopped)
  // Validate all originals before any reversal. The old image is either at
  // its original path (not switched) or at the predeclared sibling safeguard.
  for(const p of j.parts){
    const saved=safeguardPath(p,j.id),staged=stagePath(p,j.id),hasSaved=present(saved)
    const original=hasSaved?saved:p.root
    if(stateDigest(splitWalk(original,{links:true}))!==p.prior)throw Error('恢复前原件不一致；保持冻结，禁止自动回退')
    if(hasSaved&&present(p.root)&&present(staged))throw Error('恢复目录状态不明确；保持冻结')
  }
  for(const p of [...j.parts].reverse()){
    assertStopped(checkStopped)
    const saved=safeguardPath(p,j.id),staged=stagePath(p,j.id)
    if(present(saved)){
      if(present(p.root))renameSync(p.root,staged)
      renameSync(saved,p.root)
    }
  }
  if(j.parts.some(p=>stateDigest(splitWalk(p.root,{links:true}))!==p.prior))throw Error('恢复前原件复核失败；保持冻结')
  // Preserve abandoned stages for diagnosis; don't recursively delete an
  // unknown tree during recovery. The live directories are now the originals.
  assertStopped(checkStopped)
  rmSync(coldRestoreFencePath(root));return {ok:true,rolledBack:true,restartRequired:true,retainedStages:j.parts.map(p=>stagePath(p,j.id)).filter(present)}
}
export function rollbackSplitColdRestore({root,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='ROLLBACK_FULL_DSH_STATE')throw Error('必须停机并明确确认恢复事务回退')
  root=splitLocalPath(root,{allowMissing:true});assertStopped(checkStopped);assertCheckpointClear(root)
  const raw=readIdentityJson(coldRestoreFencePath(root),32768)
  if(raw?.version===2&&raw.kind==='model-rebind')return rollbackModelRebind(root,raw,checkStopped)
  const j=readFence(root);return rollbackFence(root,j,checkStopped)
}
export function restoreSplitColdSnapshot({snapshot,root,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RESTORE_FULL_DSH_STATE')throw Error('必须停机并输入完整恢复确认口令')
  root=splitLocalPath(root);snapshot=splitLocalPath(snapshot);assertColdRestoreClear(root)
  assertStopped(checkStopped)
  const m=splitManifest(snapshot),parts=activeParts(root)
  if(JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap))throw Error('当前核心迁移引导与快照不同，拒绝恢复')
  if(JSON.stringify(parts)!==JSON.stringify(m.parts.map(({id,root,domains})=>({id,root,domains}))))throw Error('快照与当前生效分区拓扑不一致，禁止改盘或自动恢复缺盘')
  if(parts.some(p=>overlap(p.root,snapshot))||m.bootstrap&&overlap(m.bootstrap.source,snapshot))throw Error('快照与生效分区或核心引导重叠')
  const incoming=identity(join(snapshot,'partitions','core')),prior=identity(root)
  if(incoming!==prior)throw Error('新旧角色身份不一致，禁止覆盖')
  const current=parts.map(p=>({...p,...splitWalk(p.root,{links:true})}))
  assertNoRollback(current,m.parts)
  requireSpace(m.parts.map(p=>({parent:dirname(p.root),...partSize(p)})))
  const id=randomUUID(),journal={version:1,id,parts:current.map(({id,root,domains,files,dirs})=>({id,root,domains,prior:stateDigest({files,dirs})}))}
  // Predeclare every path on its own volume. No active directory is changed
  // before all stages have been copied and verified, and the durable fence exists.
  writeFence(root,journal)
  try{
    for(const p of m.parts){
      if(present(stagePath(p,id))||present(safeguardPath(p,id)))throw Error('恢复临时目录冲突')
      copySplit(join(snapshot,'partitions',p.id),stagePath(p,id),p,{restore:true})
    }
    const freeze=join(stagePath(parts[0],id),'restore-freeze.json')
    writeFileSync(freeze,JSON.stringify({version:1,reviewRequired:true,at:new Date().toISOString()})+'\n',{mode:0o600})
    assertStopped(checkStopped)
    if(JSON.stringify(activeParts(root))!==JSON.stringify(parts)||JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap)||current.some(p=>stateDigest(splitWalk(p.root,{links:true}))!==stateDigest(p)))throw Error('恢复期间生效状态变化')
    for(const p of [...parts.slice(1),parts[0]]){
      assertStopped(checkStopped)
      renameSync(p.root,safeguardPath(p,id))
      renameSync(stagePath(p,id),p.root)
    }
    if(JSON.stringify(activeParts(root))!==JSON.stringify(parts)||JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap))throw Error('恢复后的实际存储拓扑复核失败')
    for(const p of m.parts){
      const actual=splitWalk(p.root)
      // The only intentionally changed payload is the existing permission fence.
      const omit=x=>({...x,files:x.files.filter(f=>p.id!=='core'||f.path!=='restore-freeze.json')})
      if(inventoryDigest(omit(actual))!==inventoryDigest(omit(p)))throw Error('恢复后的完整分区校验失败')
    }
    if(JSON.parse(readFileSync(join(root,'restore-freeze.json'),'utf8')).reviewRequired!==true)throw Error('权限复核门禁未建立')
    assertStopped(checkStopped)
    rmSync(coldRestoreFencePath(root))
    return {...summary(m),restored:true,restartRequired:true,safeguardPaths:parts.map(p=>safeguardPath(p,id))}
  }catch(e){
    try{rollbackFence(root,journal,checkStopped)}catch{throw Error('恢复失败且未能完整回退；启动保持冻结，请停机执行 rollback-full。'+e.message)}
    throw Error('恢复未完成，已回退至恢复前全部分区。'+e.message)
  }
}

// Model-only disaster recovery. The current core remains authoritative even
// when its V2 disk is absent. No historical business byte, runtime executable,
// credential or cache outside the explicit model allowlist is imported.
const LARGE_CONFIG='storage-large-data-v2.json',LARGE_MARKER='.dafeiyu-large-data-v2.json'
const bytesHash=b=>createHash('sha256').update(b).digest('hex')
const jsonBytes=x=>Buffer.from(JSON.stringify(x)+'\n')
const modelFile=f=>!/\.(?:part|incomplete|lock|tmp)$/i.test(f.path)&&rebuildable({id:'v2-large'},f.path)
function selectModelInventory(part){
  const files=part.files.filter(modelFile),parents=new Set()
  for(const f of files){const names=f.path.split('/');for(let i=1;i<names.length;i++)parents.add(names.slice(0,i).join('/'))}
  if(!files.some(f=>/\/(?:blobs|snapshots)\//.test(f.path)||f.path==='embedding-model/Qwen3-Embedding-0.6B-Q8_0.gguf'))throw Error('快照没有可恢复的已知模型文件')
  return {files,dirs:part.dirs.filter(d=>parents.has(d.path))}
}
function currentModelRoute(root){
  bootstrapOf(root);assertMigrationStartupSafe(root)
  if(readCleanupJob(root).status==='waiting')throw Error('存在未完成的旧模型清理任务')
  const config=join(root,LARGE_CONFIG),route=readIdentityJson(config,8192)
  if(route?.version!==2||Object.keys(route).some(k=>!['version','base','target','nonce'].includes(k))||route.base!==root||typeof route.nonce!=='string'||!route.nonce||splitLocalPath(route.target,{allowMissing:true})!==route.target||overlap(root,route.target))throw Error('当前 V2 模型位置身份不可信')
  const file=join(root,'storage-layout-v1.json'),layout=present(file)?readIdentityJson(file):{version:1,domains:{}}
  if(layout.version!==1||!layout.domains||typeof layout.domains!=='object'||Array.isArray(layout.domains)||Object.keys(layout.domains).some(k=>!Object.hasOwn(STORAGE_DOMAINS,k)))throw Error('当前 V1 分区配置不可信')
  // V2 retires all other V1 domains. A surviving active Life partition is
  // checked independently without trying to resolve the missing model disk.
  const memory=layout.domains.memory
  if(memory){
    const loc=splitLocalPath(memory.target),marker=readIdentityJson(join(loc,'.dafeiyu-storage-domain-v1.json'),4096)
    if(overlap(root,loc)||overlap(route.target,loc)||memory.mode!=='copy'||typeof memory.nonce!=='string'||!memory.nonce||marker.version!==1||marker.base!==root||marker.target!==loc||marker.nonce!==memory.nonce||marker.domain!=='memory'||marker.mode!=='copy'||marker.verified!==true)throw Error('现役 Life 分区身份不匹配；禁止模型恢复掩盖记忆缺盘')
  }
  return {route,layout,config,prior:readFileSync(config),layoutHash:present(file)?shaFile(file):null}
}
function prepareModelRecovery({root,snapshot,destination}={}){
  root=splitLocalPath(root);snapshot=splitLocalPath(snapshot);destination=splitLocalPath(destination,{allowMissing:true})
  assertColdRestoreClear(root);assertOfflineImageClear(destination)
  const m=splitManifest(snapshot),part=m.parts.find(p=>p.id==='v2-large'),core=join(snapshot,'partitions','core')
  if(!part)throw Error('快照没有 V2 大型模型分区')
  const current=currentModelRoute(root),{route,layout}=current,character=identity(root)
  if(!character||character!==identity(core))throw Error('当前与快照角色身份不一致或尚未建立')
  const historical=readIdentityJson(join(core,LARGE_CONFIG),8192)
  if(historical.base!==root||historical.target!==route.target||historical.nonce!==route.nonce||JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap))throw Error('当前模型路由或核心引导与快照不同；请使用同一存储世代的备份')
  const protectedRoots=[root,route.target,...m.parts.map(p=>p.root),...Object.values(layout.domains).map(e=>splitLocalPath(e.target,{allowMissing:true})),...(m.bootstrap?[m.bootstrap.source]:[])]
  if(protectedRoots.some(p=>overlap(p,destination)||overlap(p,snapshot))||overlap(snapshot,destination))throw Error('恢复目标或快照与现役、历史数据路径重叠')
  if(present(destination))throw Error('请选择不存在的新模型目录；不覆盖现有目录')
  splitLocalPath(dirname(destination))
  const inventory=selectModelInventory(part)
  requireSpace([{parent:dirname(destination),...partSize(inventory)}])
  return {root,snapshot,destination,m,part,current,character,inventory}
}
export function inspectModelRecovery(args){
  const p=prepareModelRecovery(args)
  return {ok:true,changesNow:false,requiresStop:true,scope:'v2-models-only',sourceSnapshot:p.snapshot,currentTarget:p.current.route.target,newTarget:p.destination,oldTargetPresent:present(p.current.route.target),files:p.inventory.files.length,bytes:partSize(p.inventory).bytes,omittedFiles:p.part.files.length-p.inventory.files.length,protectedBusinessUnchanged:true}
}
function writeAtomicRoute(root,bytes,id){
  const path=join(root,LARGE_CONFIG),tmp=path+'.cold-rebind-'+id+'.tmp'
  // Exclusive sibling temp; retain it on unexpected process exit. A rollback
  // uses its own unique temp and never removes unknown local files.
  const fd=openSync(tmp,'wx',0o600)
  try{writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}
  try{renameSync(tmp,path)}finally{if(present(tmp))rmSync(tmp)}
}
function assertModelJournalCurrent(root,j){
  if(JSON.stringify(readIdentityJson(coldRestoreFencePath(root),32768))!==JSON.stringify(j))throw Error('模型恢复事务在操作期间变化；保持冻结')
}
function rollbackModelRebind(root,j,checkStopped){
  assertStopped(checkStopped)
  if(j.root!==root||!tokenOk(j.id)||typeof j.prior!=='string'||j.prior.length>12000||!/^[a-f0-9]{64}$/.test(j.nextSha256)||typeof j.target!=='string')throw Error('模型恢复事务标记不可信')
  const prior=Buffer.from(j.prior,'base64'),previous=JSON.parse(prior.toString('utf8'))
  if(previous.version!==2||previous.base!==root||typeof previous.nonce!=='string'||!previous.nonce||splitLocalPath(previous.target,{allowMissing:true})!==previous.target||overlap(root,previous.target)||splitLocalPath(j.target,{allowMissing:true})!==j.target||overlap(root,j.target)||overlap(previous.target,j.target))throw Error('模型恢复事务原路由非法')
  const config=join(root,LARGE_CONFIG);readIdentityJson(config,8192)
  const now=readFileSync(config),hash=bytesHash(now)
  if(hash!==bytesHash(prior)&&hash!==j.nextSha256)throw Error('模型路由在恢复期间被其他操作修改；保持冻结')
  if(hash===j.nextSha256){
    const next=JSON.parse(now.toString('utf8'))
    if(next.version!==2||next.base!==root||next.target!==j.target||next.nonce!==j.id)throw Error('模型恢复事务新路由身份不匹配；保持冻结')
    assertStopped(checkStopped);assertModelJournalCurrent(root,j)
    if(bytesHash(readFileSync(config))!==hash)throw Error('模型路由在回退期间变化；保持冻结')
    writeAtomicRoute(root,prior,randomUUID())
  }
  assertStopped(checkStopped);assertModelJournalCurrent(root,j)
  if(bytesHash(readFileSync(config))!==bytesHash(prior))throw Error('原模型路由复核失败；保持冻结')
  rmSync(coldRestoreFencePath(root))
  return {ok:true,rolledBack:true,scope:'v2-models-only',restartRequired:true,priorTarget:previous.target,priorTargetPresent:present(previous.target),retainedPaths:[j.target,j.target+'.cold-stage-'+j.id].filter(present)}
}
export function recoverSnapshotModels({root,snapshot,destination,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RECOVER_DSH_MODELS_ONLY')throw Error('必须停机并明确确认仅恢复模型')
  assertStopped(checkStopped)
  const p=prepareModelRecovery({root,snapshot,destination});root=p.root
  const id=randomUUID(),target=p.destination,stage=target+'.cold-stage-'+id
  const next=jsonBytes({version:2,base:root,target,nonce:id}),j={version:2,kind:'model-rebind',root,id,target,prior:p.current.prior.toString('base64'),nextSha256:bytesHash(next)}
  if(present(stage))throw Error('模型恢复暂存目录冲突')
  writeFence(root,j)
  try{
    copySplit(join(p.snapshot,'partitions',p.part.id),stage,p.inventory,{restore:true})
    const marker=jsonBytes({version:2,base:root,target,nonce:id,verified:true,verifiedAt:new Date().toISOString()})
    writeFileSync(join(stage,LARGE_MARKER),marker,{flag:'wx',mode:0o600})
    assertStopped(checkStopped)
    const current=currentModelRoute(root)
    if(bytesHash(current.prior)!==bytesHash(p.current.prior)||current.layoutHash!==p.current.layoutHash||identity(root)!==p.character||present(target))throw Error('恢复期间现役路由、身份或目标发生变化')
    const expected=inventoryDigest({...p.inventory,files:[...p.inventory.files,{path:LARGE_MARKER,bytes:marker.length,sha256:bytesHash(marker)}]})
    if(inventoryDigest(splitWalk(stage))!==expected)throw Error('新模型目录最终校验失败')
    renameSync(stage,target)
    assertStopped(checkStopped);assertModelJournalCurrent(root,j)
    if(bytesHash(readFileSync(join(root,LARGE_CONFIG)))!==bytesHash(p.current.prior))throw Error('模型路由在发布前变化')
    writeAtomicRoute(root,next,id)
    const resolved=largeDataStatus(root),layout=storageLayoutStatus(root)
    if(resolved.target!==target||layout.domains.memory.configured!==Boolean(p.current.layout.domains.memory)||inventoryDigest(splitWalk(target))!==expected)throw Error('模型恢复后的实际路由或内容复核失败')
    assertStopped(checkStopped);assertModelJournalCurrent(root,j)
    if(bytesHash(readFileSync(join(root,LARGE_CONFIG)))!==j.nextSha256)throw Error('模型路由在结算前变化；保持冻结')
    rmSync(coldRestoreFencePath(root))
    return {ok:true,restored:true,scope:'v2-models-only',target,previousTarget:p.current.route.target,files:p.inventory.files.length,bytes:partSize(p.inventory).bytes,omittedFiles:p.part.files.length-p.inventory.files.length,protectedBusinessUnchanged:true,restartRequired:true,modelHealthCheckRequired:true}
  }catch(e){
    try{rollbackModelRebind(root,j,checkStopped)}catch{throw Error('模型恢复失败且路由未能回退；启动保持冻结，请停机执行 rollback-full。'+e.message)}
    throw Error('模型恢复未完成，已保留原路由和暂存目录。'+e.message)
  }
}

// A disaster rescue is deliberately NOT a restore. Content-addressed objects
// preserve historical and surviving bytes separately, without generating a
// runnable data tree or rewriting a live route. No claim of freshness follows
// from an identity match: missing deletion/permission/receipt history remains
// an activation blocker until an authoritative merge is available.
const RESCUE_FORMAT='dsh-offline-disaster-rescue-v1', RESCUE_MARKER=OFFLINE_RESCUE_MARKER
const rescueKey=p=>p.id==='core'||p.domains.includes('memory')
function rescueObjects(rows){
  const objects=new Map()
  for(const r of rows)for(const f of r.files){
    if(objects.has(f.sha256)&&objects.get(f.sha256)!==f.bytes)throw Error('救援对象长度冲突')
    objects.set(f.sha256,f.bytes)
  }
  return objects
}
function sameCapturedFile(source,historical,name){
  const a=join(source,name),b=join(historical,name)
  if(present(a)!==present(b))return false
  if(!present(a))return true
  const s=lstatSync(a)
  return s.isFile()&&!s.isSymbolicLink()&&shaFile(a)===shaFile(b)
}
function rescueSurvivor(p,historical){
  try{
    if(!present(p.root))return {status:'missing'}
    splitLocalPath(p.root)
    if(p.id==='core'){
      const id=identity(historical)
      if(!id||identity(p.root)!==id||!['storage-layout-v1.json','storage-large-data-v2.json','.bili-duty-migration-v1.json'].every(n=>sameCapturedFile(p.root,historical,n)))return {status:'identity-or-route-mismatch'}
    }else if(!sameCapturedFile(p.root,historical,'.dafeiyu-storage-domain-v1.json'))return {status:'identity-or-route-mismatch'}
    return {status:'same-identity-unconfirmed-freshness',...splitWalk(p.root,{links:true})}
  }catch{return {status:'unreadable'}}
}
function prepareDisasterRescue({snapshot,destination}={},checkSpace=true){
  snapshot=splitLocalPath(snapshot);destination=splitLocalPath(destination,{allowMissing:true})
  if(present(destination))throw Error('救援目标必须是尚不存在的新目录')
  splitLocalPath(dirname(destination))
  const raw=readIdentityJson(join(snapshot,'manifest.json'),MAX_MANIFEST)
  let parts,format,omitted,protectedRoots,createdAt
  if(raw.format===SPLIT_FORMAT){
    const m=splitManifest(snapshot);format=m.format;createdAt=m.createdAt
    parts=m.parts.filter(rescueKey).map(p=>({...p,source:join(snapshot,'partitions',p.id)}))
    omitted=m.parts.filter(p=>!rescueKey(p)).map(p=>p.id)
    protectedRoots=[...m.parts.map(p=>p.root),...(m.bootstrap?[m.bootstrap.source]:[])]
  }else if(raw.format===FORMAT){
    verifyColdSnapshot(snapshot);assertUnsplitRoot(join(snapshot,'payload'));safeSplitInventory(raw);format=raw.format;createdAt=raw.createdAt||''
    parts=[{id:'core',domains:['core'],root:null,source:join(snapshot,'payload'),files:raw.files,dirs:raw.dirs}]
    omitted=[];protectedRoots=[]
  }else throw Error('不支持的救援快照格式')
  if([snapshot,...protectedRoots].some(p=>overlap(p,destination)))throw Error('救援目标与快照或原分区重叠')
  // Never read from a historical path that now overlaps the snapshot itself.
  if(protectedRoots.some(p=>overlap(p,snapshot)))throw Error('快照与原分区路径重叠，无法安全救援')
  const rows=[],statuses=[]
  for(const p of parts){
    rows.push({id:p.id,kind:'historical',source:p.source,files:p.files,dirs:p.dirs})
    const s=p.root?rescueSurvivor(p,p.source):{status:'original-path-not-recorded'}
    statuses.push({id:p.id,status:s.status})
    if(s.files)rows.push({id:p.id,kind:'surviving-candidate',source:p.root,files:s.files,dirs:s.dirs})
  }
  if(rows.reduce((n,r)=>n+r.files.length+r.dirs.length,0)>MAX_ROWS)throw Error('救援总条目超限')
  const objects=rescueObjects(rows),bytes=[...objects.values()].reduce((a,b)=>a+b,0)
  if(!Number.isSafeInteger(bytes))throw Error('救援容量超限')
  if(checkSpace)requireSpace([{parent:dirname(destination),bytes,entries:objects.size+2}])
  return {snapshot,destination,format,createdAt:typeof createdAt==='string'?createdAt:'',omitted,rows,statuses,bytes,objects}
}
const rescueReport=p=>({ok:true,scope:'offline-disaster-rescue',activationAllowed:false,requiresStop:true,
  sourceFormat:p.format,sourceCreatedAt:p.createdAt,partitions:p.statuses,omittedModelAndRuntimePartitions:p.omitted,
  uniqueFiles:p.objects.size,bytes:p.bytes,historyMergeRequired:true})
export function inspectDisasterRescue(args){return {...rescueReport(prepareDisasterRescue(args)),changesNow:false}}
function readVerifiedDisasterRescue(destination){
  const root=splitLocalPath(destination),m=readIdentityJson(join(root,RESCUE_MARKER),MAX_MANIFEST)
  if(m.format!==RESCUE_FORMAT||m.activationAllowed!==false||!Array.isArray(m.rows)||!Array.isArray(m.statuses)||!Array.isArray(m.omitted)||![FORMAT,SPLIT_FORMAT].includes(m.sourceFormat)||m.rows.length<1||m.rows.length>4)throw Error('隔离救援清单格式非法')
  const keys=new Set(),ids=new Set(['core','v1-memory']),historical=new Set()
  for(const r of m.rows){
    if(!ids.has(r.id)||!['historical','surviving-candidate'].includes(r.kind)||keys.has(r.id+':'+r.kind)||Object.keys(r).some(k=>!['id','kind','files','dirs'].includes(k)))throw Error('隔离救援分区非法')
    keys.add(r.id+':'+r.kind);safeSplitInventory(r)
    if(r.kind==='historical')historical.add(r.id)
  }
  if(!historical.has('core')||m.rows.some(r=>!historical.has(r.id))||m.rows.reduce((n,r)=>n+r.files.length+r.dirs.length,0)>MAX_ROWS)throw Error('隔离救援缺少历史业务分区或超限')
  const validStatus=['missing','identity-or-route-mismatch','unreadable','same-identity-unconfirmed-freshness','original-path-not-recorded']
  if(m.statuses.length!==historical.size||new Set(m.statuses.map(s=>s.id)).size!==historical.size||m.statuses.some(s=>!historical.has(s.id)||!validStatus.includes(s.status)||(s.status==='same-identity-unconfirmed-freshness')!==keys.has(s.id+':surviving-candidate')))throw Error('隔离救援来源状态不匹配')
  if(JSON.stringify(readdirSync(root).sort())!==JSON.stringify([RESCUE_MARKER,'objects'].sort()))throw Error('隔离救援存在未知文件')
  const objects=rescueObjects(m.rows),folder=splitLocalPath(join(root,'objects'))
  if(JSON.stringify(readdirSync(folder).sort())!==JSON.stringify([...objects.keys()].sort()))throw Error('隔离救援对象缺失或多余')
  for(const [sha,bytes] of objects){const f=join(folder,sha),s=lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||s.size!==bytes||shaFile(f)!==sha)throw Error('隔离救援对象校验失败')}
  // Independently derive the need for external Life data from the captured
  // historical core layout, not the rescue manifest's own partition list.
  const row=(id,kind='historical')=>m.rows.find(r=>r.id===id&&r.kind===kind)
  const file=(r,name)=>r?.files.find(f=>f.path===name)
  const read=(r,name)=>{const f=file(r,name);return f?readIdentityJson(join(folder,f.sha256)):null}
  const core=row('core'),layout=read(core,'storage-layout-v1.json'),large=read(core,'storage-large-data-v2.json')
  if(m.sourceFormat===FORMAT&&(layout||large||historical.size!==1||keys.size!==1))throw Error('旧单根救援不可包含分盘或现役候选')
  if(layout&&(layout.version!==1||!layout.domains||typeof layout.domains!=='object'||Array.isArray(layout.domains)))throw Error('救援核心分区配置非法')
  const entry=layout?.domains.memory
  if(Boolean(entry)!==historical.has('v1-memory'))throw Error('救援缺少历史 Life 分区或包含额外 Life 分区')
  if(entry){
    const marker=read(row('v1-memory'),'.dafeiyu-storage-domain-v1.json')
    if(!marker||marker.version!==1||marker.domain!=='memory'||marker.mode!=='copy'||entry.mode!=='copy'||marker.verified!==true||marker.target!==entry.target||marker.nonce!==entry.nonce)throw Error('救援 Life 分区身份不一致')
  }
  const same=(a,b,name)=>file(a,name)?.sha256===file(b,name)?.sha256
  const currentCore=row('core','surviving-candidate'),currentLife=row('v1-memory','surviving-candidate')
  if(currentCore){
    const old=read(core,'character-identity.json'),now=read(currentCore,'character-identity.json')
    if(typeof old?.id!=='string'||!old.id||now?.id!==old.id||!['storage-layout-v1.json','storage-large-data-v2.json','.bili-duty-migration-v1.json'].every(n=>same(core,currentCore,n)))throw Error('救援核心候选身份不一致')
  }
  if(currentLife&&!same(row('v1-memory'),currentLife,'.dafeiyu-storage-domain-v1.json'))throw Error('救援 Life 候选身份不一致')
  const bytes=[...objects.values()].reduce((a,b)=>a+b,0)
  if(!Number.isSafeInteger(bytes))throw Error('救援容量超限')
  return {manifest:m,folder,report:{...rescueReport({format:m.sourceFormat,createdAt:m.sourceCreatedAt,statuses:m.statuses,omitted:m.omitted,objects,bytes}),verified:true}}
}
export function verifyDisasterRescue(destination){return readVerifiedDisasterRescue(destination).report}

// Read-only reconciliation review: identity equality is not proof of freshness.
// Compare exact paths including type and mode. Do not emit any paths, object
// hashes, credentials, memory text or account identifiers in the report.
function rescueDiff(historical,candidate){
  const entries=r=>new Map([...r.dirs.map(d=>[folded(d.path),{...d,type:'directory'}]),...r.files.map(f=>[folded(f.path),{...f,type:'file'}])])
  const old=entries(historical),now=candidate?entries(candidate):null
  const counts={identical:0,different:0,typeOrNameConflict:0,historicalOnly:0,candidateOnly:0,uncomparedHistorical:0}
  if(!now){counts.uncomparedHistorical=old.size;return counts}
  for(const [key,a] of old){const b=now.get(key)
    if(!b)counts.historicalOnly++
    else if(a.type!==b.type||a.path!==b.path)counts.typeOrNameConflict++
    else if(a.mode===b.mode&&a.bytes===b.bytes&&a.sha256===b.sha256)counts.identical++
    else counts.different++
  }
  for(const key of now.keys())if(!old.has(key))counts.candidateOnly++
  return counts
}
function inspectRescueRevocations(m,folder){
  // The captured historical layout determines the authoritative memory domain.
  // A retained pre-migration copy in core is never a second source of truth.
  const id=m.rows.some(r=>r.id==='v1-memory'&&r.kind==='historical')?'v1-memory':'core'
  const inspect=kind=>{
    const row=m.rows.find(r=>r.id===id&&r.kind===kind)
    if(!row)return {status:'source-unavailable',ids:null}
    const name='detail-protection/revocations-v1.json',f=row.files.find(f=>f.path===name)
    if(!f)return {status:row.dirs.some(d=>d.path===name)?'invalid':'not-recorded',ids:null}
    // The same on-disk limits and ID format as the existing detail store and
    // portable backup. A malformed or over-limit ledger cannot be merged.
    try{
      if(f.bytes>8*1024*1024)throw Error('limit')
      const file=join(folder,f.sha256),st=lstatSync(file)
      if(!st.isFile()||st.isSymbolicLink()||st.size!==f.bytes)throw Error('object')
      const bytes=readFileSync(file)
      if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('object changed')
      const doc=JSON.parse(bytes.toString('utf8'))
      if(doc?.version!==1||!Array.isArray(doc.ids)||doc.ids.length>200000||doc.ids.some(x=>typeof x!=='string'||!/^e-[a-f0-9]{18}$/.test(x)))throw Error('format')
      return {status:'verified-format',ids:new Set(doc.ids)}
    }catch{return {status:'invalid',ids:null}}
  }
  const historical=inspect('historical'),candidate=inspect('surviving-candidate')
  const known=new Set([...(historical.ids||[]),...(candidate.ids||[])])
  return {partition:id,historical:{status:historical.status,known:historical.ids?.size??null},candidate:{status:candidate.status,known:candidate.ids?.size??null},knownUnionCount:known.size,withinLedgerLimit:known.size<=200000,complete:false}
}
export function planDisasterReconciliation(destination){
  const {manifest:m,folder,report}=readVerifiedDisasterRescue(destination)
  const comparisons=m.rows.filter(r=>r.kind==='historical').map(h=>{
    const c=m.rows.find(r=>r.id===h.id&&r.kind==='surviving-candidate')
    return {id:h.id,candidateAvailable:!!c,counts:rescueDiff(h,c)}
  })
  return {ok:true,verified:true,sourceFormat:report.sourceFormat,scope:'offline-disaster-reconciliation-review',
    activationAllowed:false,historyMergeRequired:true,changesNow:false,comparisons,
    deepRevocations:inspectRescueRevocations(m,folder),freshnessProven:false,mergeAllowed:false,
    unresolved:['latest-forgetting','latest-authorization','outbound-receipts','task-state','unknown-business-state']}
}
export function createDisasterRescue({snapshot,destination,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RESCUE_DSH_OFFLINE_ONLY')throw Error('必须停机并明确确认仅制作隔离救援资料')
  assertStopped(checkStopped)
  const p=prepareDisasterRescue({snapshot,destination}),stage=p.destination+'.rescue-'+randomUUID()
  let owned=false
  try{
    mkdirSync(stage,{mode:0o700});owned=true
    // Write the non-activation marker before any payload. Even an interrupted
    // stage cannot be passed to the normal startup path as a restored role.
    const m={format:RESCUE_FORMAT,activationAllowed:false,sourceFormat:p.format,sourceCreatedAt:p.createdAt,statuses:p.statuses,omitted:p.omitted,rows:p.rows.map(({source,...r})=>r)}
    const manifest=JSON.stringify(m)+'\n'
    if(Buffer.byteLength(manifest)>MAX_MANIFEST)throw Error('救援清单超限')
    writeFileSync(join(stage,RESCUE_MARKER),manifest,{flag:'wx',mode:0o600})
    mkdirSync(join(stage,'objects'),{mode:0o700})
    const copied=new Set()
    for(const r of p.rows)for(const f of r.files){
      if(copied.has(f.sha256))continue
      let from=join(r.source,...f.path.split('/'));splitLocalPath(dirname(from))
      if(lstatSync(from).isSymbolicLink()&&r.kind==='surviving-candidate')from=hfLink(r.source,f.path,from)
      const st=lstatSync(from)
      if(!st.isFile()||st.isSymbolicLink()||st.size!==f.bytes)throw Error('救援来源在复制期间变化')
      const to=join(stage,'objects',f.sha256);copyFileSync(from,to);chmodSync(to,0o600)
      if(shaFile(to)!==f.sha256)throw Error('救援复制校验失败')
      copied.add(f.sha256)
    }
    const verified=verifyDisasterRescue(stage)
    assertStopped(checkStopped)
    const again=prepareDisasterRescue({snapshot,destination},false)
    const signatures=x=>JSON.stringify([x.statuses,x.omitted,x.rows.map(r=>[r.id,r.kind,stateDigest(r)])])
    if(signatures(p)!==signatures(again))throw Error('救援期间来源或分区状态变化；未发布救援资料')
    if(present(p.destination))throw Error('救援目标已存在，拒绝覆盖')
    renameSync(stage,p.destination)
    return {...verified,created:true,destination:p.destination}
  }catch(e){if(owned)rmSync(stage,{recursive:true,force:true});throw e}
}


// Sealed shutdown checkpoint: the original host bootstrap parent is an
// independent continuity witness, outside the mutable core tree.  This is
// intentionally NOT a historical merge or a rolling snapshot guarantee.
// No normal startup or supported offline mutation while sealed.  No write
// to a surviving partition; recreate only absent paths from the exact image.
const CHECKPOINT_KIND='sealed-cold-checkpoint-v1', FREEZE_NAME='restore-freeze.json'
function checkpointContext({root,snapshot}){
  root=splitLocalPath(root,{allowMissing:true});snapshot=splitLocalPath(snapshot)
  const mf=join(snapshot,'manifest.json'),st=lstatSync(mf)
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_MANIFEST)throw Error('封存清单不安全')
  const manifestHash=shaFile(mf),m=splitManifest(snapshot)
  if(shaFile(mf)!==manifestHash||m.parts[0].root!==root)throw Error('封存快照核心位置或清单不一致')
  if(!identity(join(snapshot,'partitions','core')))throw Error('封存快照缺少已建立的角色身份')
  const base=splitLocalPath(m.bootstrap?.source||root,{allowMissing:true}),pointer=join(dirname(base),'.bili-duty-location-v1.json')
  splitLocalPath(dirname(base))
  if(m.parts.some(p=>overlap(p.root,snapshot))||overlap(base,snapshot)||m.parts.slice(1).some(p=>overlap(p.root,base)))throw Error('封存快照或引导位置与数据分区重叠')
  if(m.bootstrap){
    if(JSON.stringify(readIdentityJson(pointer,4096))!==JSON.stringify(m.bootstrap.pointer))throw Error('宿主核心引导与封存快照不一致')
  }else if(present(pointer))throw Error('宿主核心引导已变化')
  if([base,root].some(p=>present(coldRestoreFencePath(p))||present(join(p,OFFLINE_RESCUE_MARKER))))throw Error('已有冷恢复事务或隔离救援目录；先核查')
  if(m.parts[0].dirs.some(d=>d.path===FREEZE_NAME))throw Error('权限复核标记路径不安全')
  return {root,snapshot,m,base,manifestHash,file:coldCheckpointPath(base)}
}
function checkpointRecord(p){
  const j=readIdentityJson(p.file,8192)
  if(j?.version!==1||j.kind!==CHECKPOINT_KIND||!tokenOk(j.id)||!['preparing','sealed','recovering'].includes(j.status)||j.base!==p.base||j.root!==p.root||j.snapshot!==p.snapshot||j.manifestHash!==p.manifestHash||typeof j.at!=='string'||!Number.isFinite(Date.parse(j.at)))throw Error('封存检查点凭据不匹配；禁止历史激活')
  return j
}
function checkpointWrite(file,value,{exclusive=false}={}){
  const tmp=exclusive?file:file+'.tmp-'+randomUUID()
  const fd=openSync(tmp,'wx',0o600)
  try{writeFileSync(fd,jsonBytes(value));fsyncSync(fd)}finally{closeSync(fd)}
  if(!exclusive){try{renameSync(tmp,file)}finally{if(present(tmp))rmSync(tmp)}}
}
const checkpointFreeze=j=>jsonBytes({version:1,reviewRequired:true,at:j.at})
function checkpointPartState(p,j,{allowReview=false}={}){
  if(!present(p.root))return 'missing'
  const current=splitWalk(p.root,{links:true})
  if(stateDigest(current)===stateDigest(p))return 'identical'
  if(allowReview&&j.status==='recovering'&&p.id==='core'){
    const marker=current.files.find(f=>f.path===FREEZE_NAME),expected=checkpointFreeze(j)
    const omit=x=>({...x,files:x.files.filter(f=>f.path!==FREEZE_NAME)})
    if(marker?.sha256===bytesHash(expected)&&marker.bytes===expected.length&&stateDigest(omit(current))===stateDigest(omit(p)))return 'review-ready'
  }
  return 'different'
}
function checkpointStates(p,j,opts={}){
  return p.m.parts.map(part=>({id:part.id,status:checkpointPartState(part,j,opts)}))
}
function checkpointTopology(p){
  if(JSON.stringify(activeParts(p.root))!==JSON.stringify(p.m.parts.map(({id,root,domains})=>({id,root,domains})))||JSON.stringify(bootstrapOf(p.root))!==JSON.stringify(p.m.bootstrap))throw Error('封存数据生效路由复核失败')
}
function checkpointStable(p,j){
  if(JSON.stringify(checkpointRecord(p))!==JSON.stringify(j)||shaFile(join(p.snapshot,'manifest.json'))!==p.manifestHash)throw Error('封存凭据或快照在操作期间变化')
}
export function sealSplitColdSnapshot({root,snapshot,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='SEAL_DSH_COLD_CHECKPOINT')throw Error('必须停机并明确确认封存检查点')
  assertStopped(checkStopped)
  const p=checkpointContext({root,snapshot});assertColdRestoreClear(p.base);assertColdRestoreClear(p.root);checkpointTopology(p)
  const j={version:1,kind:CHECKPOINT_KIND,status:'preparing',id:randomUUID(),base:p.base,root:p.root,snapshot:p.snapshot,manifestHash:p.manifestHash,at:new Date().toISOString()}
  if(checkpointStates(p,j).some(x=>x.status!=='identical'))throw Error('只能封存与当前全部现役文件完全一致的快照，禁止追认历史快照')
  checkpointWrite(p.file,j,{exclusive:true})
  // An interruption before the second scan is never a usable seal. It may
  // only be cancelled using release-seal (preparing), not used for recovery.
  try{
    assertStopped(checkStopped);checkpointStable(p,j);checkpointTopology(p)
    if(checkpointStates(p,j).some(x=>x.status!=='identical'))throw Error('封存期间原分区发生变化')
    checkpointWrite(p.file,{...j,status:'sealed'})
  }catch(e){throw Error('未完成封存；保持启动冻结，请核查后执行 release-seal。'+e.message)}
  return {...summary(p.m),sealed:true,activationAllowed:false,requiresStop:true}
}
export function inspectSealedRecovery({root,snapshot}={}){
  const p=checkpointContext({root,snapshot}),j=checkpointRecord(p),parts=checkpointStates(p,j,{allowReview:true})
  const different=parts.some(x=>x.status==='different'),missing=parts.some(x=>x.status==='missing')
  const recoverAllowed=j.status!=='preparing'&&!different
  let topologyReady=false
  if(!missing){try{checkpointTopology(p);topologyReady=true}catch{}}
  return {ok:true,scope:'sealed-checkpoint',sealed:j.status!=='preparing',recovering:j.status==='recovering',changesNow:false,activationAllowed:false,parts,recoverAllowed,releaseAllowed:topologyReady&&(j.status==='preparing'||j.status==='sealed'&&!different),missing,requiresStop:true}
}
export function recoverSealedSnapshot({root,snapshot,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RECOVER_SEALED_DSH_STATE')throw Error('必须停机并明确确认封存恢复')
  assertStopped(checkStopped)
  const p=checkpointContext({root,snapshot});let j=checkpointRecord(p)
  if(j.status==='preparing')throw Error('检查点尚未完成封存，禁止恢复')
  const states=checkpointStates(p,j,{allowReview:true})
  if(states.some(x=>x.status==='different'))throw Error('现存分区与封存状态不同；保留原件，禁止覆盖或合并历史')
  const missing=p.m.parts.filter(x=>states.some(s=>s.id===x.id&&s.status==='missing'))
  requireSpace(missing.map(x=>({parent:dirname(x.root),...partSize(x)})))
  // Once recovery starts, release-seal can never bypass the final account
  // review marker, even if every target was published before an interruption.
  if(j.status!=='recovering'){checkpointStable(p,j);j={...j,status:'recovering'};checkpointWrite(p.file,j)}
  // No live directory is renamed or replaced. A completed target remains
  // available for a subsequent verified retry after interruption; uncommitted
  // staging directories are retained outside the recorded roots.
  for(const part of [...missing.filter(x=>x.id!=='core'),...missing.filter(x=>x.id==='core')]){
    const stage=part.root+'.sealed-stage-'+randomUUID()
    copySplit(join(p.snapshot,'partitions',part.id),stage,part,{restore:true})
    if(stateDigest(splitWalk(stage))!==stateDigest(part))throw Error('封存恢复暂存校验失败')
    assertStopped(checkStopped);checkpointStable(p,j)
    if(present(part.root))throw Error('恢复目标在操作期间出现；保留暂存，不覆盖')
    renameSync(stage,part.root)
  }
  assertStopped(checkStopped);checkpointStable(p,j);checkpointTopology(p)
  if(checkpointStates(p,j,{allowReview:true}).some(x=>!['identical','review-ready'].includes(x.status)))throw Error('封存恢复最终复核失败，保持冻结')
  // Install the existing account review gate before releasing the outer seal.
  // Temp is a sibling outside core so a killed process does not pollute its
  // inventory and can be resumed safely.
  const marker=join(p.root,FREEZE_NAME),bytes=checkpointFreeze(j)
  if(checkpointPartState(p.m.parts[0],j,{allowReview:true})!=='review-ready'){
    const tmp=p.root+'.sealed-review-'+randomUUID(),fd=openSync(tmp,'wx',0o600)
    try{writeFileSync(fd,bytes);fsyncSync(fd)}finally{closeSync(fd)}
    renameSync(tmp,marker)
  }
  assertStopped(checkStopped);checkpointStable(p,j);checkpointTopology(p)
  if(checkpointStates(p,j,{allowReview:true}).some(x=>!['identical','review-ready'].includes(x.status))||shaFile(marker)!==bytesHash(bytes))throw Error('权限复核保护或全分区校验失败，保持冻结')
  rmSync(p.file)
  return {...summary(p.m),restored:true,restoredPartitions:missing.map(x=>x.id),restartRequired:true,accountReviewRequired:true}
}
export function releaseSealedSnapshot({root,snapshot,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RELEASE_DSH_COLD_CHECKPOINT')throw Error('必须停机并明确确认解除封存')
  assertStopped(checkStopped)
  const p=checkpointContext({root,snapshot}),j=checkpointRecord(p)
  if(j.status==='recovering')throw Error('封存恢复已开始；请继续 recover-sealed 完成全部复核，不能直接解除封存')
  // Release without restoring only after the original whole image is intact.
  // A failed preparing seal is not a freshness witness; cancel only with a
  // currently usable topology, never while a disk is missing.
  checkpointTopology(p)
  if(j.status==='sealed'&&checkpointStates(p,j,{allowReview:true}).some(x=>!['identical','review-ready'].includes(x.status)))throw Error('现役分区缺失或变化；禁止直接解除封存')
  assertStopped(checkStopped);checkpointStable(p,j);checkpointTopology(p)
  if(j.status==='sealed'&&checkpointStates(p,j,{allowReview:true}).some(x=>!['identical','review-ready'].includes(x.status)))throw Error('解除封存期间分区变化')
  rmSync(p.file)
  return {ok:true,released:true,restartRequired:true,checkpointReusable:false}
}


// Unified recovery triage. Never execute a recovery from the planner. Each
// subsequent mutating command independently reruns its full preflight.
export function planColdRecovery({root,snapshot,destination=null}={}){
  root=splitLocalPath(root,{allowMissing:true});snapshot=splitLocalPath(snapshot)
  const raw=readIdentityJson(join(snapshot,'manifest.json'),MAX_MANIFEST)
  const m=raw.format===SPLIT_FORMAT?splitManifest(snapshot):null
  if(!m){if(raw.format!==FORMAT)throw Error('未知冷备份格式');verifyColdSnapshot(snapshot);assertUnsplitRoot(join(snapshot,'payload'));safeSplitInventory(raw)}
  const base=m?.bootstrap?.source||root
  const response=(action,reason,extra={})=>({ok:true,verified:true,format:raw.format,changesNow:false,requiresStop:true,nextAction:action,reason,...extra})
  if(m&&m.parts[0].root!==root)return response('none','core-path-mismatch')
  if(present(coldCheckpointPath(base))){
    try{
      const plan=inspectSealedRecovery({root,snapshot})
      if(plan.sealed&&plan.recoverAllowed&&(plan.missing||plan.recovering))return response('recover-sealed','sealed-missing-partitions',{plan})
      if(plan.releaseAllowed)return response('release-seal','sealed-or-preparing-intact',{plan})
      return response('none','sealed-state-conflict',{plan})
    }catch{return response('none','seal-invalid-or-wrong-snapshot')}
  }
  if(present(coldRestoreFencePath(root)))return response('rollback-full','unfinished-restore')
  if(base!==root&&present(coldRestoreFencePath(base)))return response('none','unfinished-bootstrap-restore')
  if(present(join(root,OFFLINE_RESCUE_MARKER)))return response('none','offline-rescue-not-runnable')
  // Prefer an explicit model replacement target when current identity and
  // actual business routes still validate. Don't interpret other failures as
  // permission to restore business files from an older backup.
  if(m&&destination){
    try{const plan=inspectModelRecovery({root,snapshot,destination});if(!plan.oldTargetPresent)return response('recover-models','verified-model-only-target',{plan})}catch{}
  }
  let reason='business-or-topology-different',protectedComparisons=null
  try{
    assertColdRestoreClear(root)
    const parts=activeParts(root)
    if(m){
      if(JSON.stringify(parts)!==JSON.stringify(m.parts.map(({id,root,domains})=>({id,root,domains})))||JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap))throw Error('topology')
      if(parts.some(p=>overlap(p.root,snapshot))||overlap(base,snapshot))throw Error('overlap')
      if(identity(root)!==identity(join(snapshot,'partitions','core')))throw Error('identity')
      const current=parts.map(p=>({...p,...splitWalk(p.root,{links:true})}))
      protectedComparisons=protectedStateDiff(current,m.parts)
      if(protectedComparisons.some(p=>!p.identical)){reason='protected-business-different';throw Error(reason)}
      requireSpace(m.parts.map(p=>({parent:dirname(p.root),...partSize(p)})))
      return response('restore-full','protected-business-identical',{protectedComparisons})
    }
    assertUnsplitRoot(root)
    if(parts.length!==1||overlap(root,snapshot)||bootstrapOf(root)&&overlap(bootstrapOf(root).source,snapshot)||identity(root)!==identity(join(snapshot,'payload')))throw Error('legacy identity or topology')
    assertNoRollback([{...parts[0],...splitWalk(root)}],[{...raw,...parts[0]}])
    requireSpace([{parent:dirname(root),...partSize(raw)}])
    return response('restore','legacy-protected-business-identical')
  }catch{if(!present(root))reason='core-missing-no-seal'}
  if(destination){
    if(overlap(root,splitLocalPath(destination,{allowMissing:true})))return response('none','rescue-target-overlaps-core',{historicalActivationAllowed:false})
    try{return response('rescue-disaster',reason,{plan:inspectDisasterRescue({snapshot,destination}),...(protectedComparisons?{protectedComparisons}:{})})}
    catch{return response('none','rescue-target-or-source-unusable',{historicalActivationAllowed:false})}
  }
  return response('plan-disaster-rescue',reason,{destinationRequired:true,historicalActivationAllowed:false,...(protectedComparisons?{protectedComparisons}:{})})
}
