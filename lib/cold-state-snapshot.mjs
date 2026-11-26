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
import {assertColdRestoreClear,coldRestoreFencePath} from './cold-restore-fence.mjs'

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
export function createColdSnapshot({root,destination,stoppedConfirmed=false}={}){
  if(!stoppedConfirmed)throw Error('必须先停止 DSH 并明确确认停机')
  if(!root||!destination)throw Error('需要提供数据目录和独立备份目录')
  root=resolve(root);destination=resolve(destination)
  requireDirectory(root)
  assertColdRestoreClear(root)
  assertUnsplitRoot(root)
  if(within(root,destination)||within(destination,root))throw Error('备份目标不能与数据目录包含或重叠')
  if(existsSync(destination))throw Error('备份目标已存在，拒绝覆盖')
  mkdirSync(dirname(destination),{recursive:true})
  const manifest={format:FORMAT,createdAt:new Date().toISOString(),...walk(root)}
  const staged=destination+'.snapshot-'+randomUUID()
  try{
    mkdirSync(staged,{mode:0o700})
    copyTree(root,join(staged,'payload'),manifest)
    writeFileSync(join(staged,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'})
    verifyColdSnapshot(staged)
    renameSync(staged,destination)
    return verifyColdSnapshot(destination)
  }catch(e){rmSync(staged,{recursive:true,force:true});throw e}
}
export function restoreColdSnapshot({snapshot,root,stoppedConfirmed=false,confirm=''}={}){
  if(!stoppedConfirmed||confirm!=='RESTORE_FULL_DSH_STATE')throw Error('必须停机并输入完整恢复确认口令')
  if(!snapshot||!root)throw Error('需要提供快照与恢复目录')
  snapshot=resolve(snapshot);root=resolve(root)
  assertColdRestoreClear(root)
  if(within(snapshot,root)||within(root,snapshot))throw Error('不能恢复到快照自身或其内部')
  const verified=verifyColdSnapshot(snapshot)
  const payload=join(snapshot,'payload'),oldExists=existsSync(root)
  assertUnsplitRoot(payload)
  if(oldExists)assertUnsplitRoot(root)
  if(oldExists)requireDirectory(root)
  requireDirectory(dirname(root))
  // Never restore a different fish identity onto an existing installation.
  const incoming=identity(payload),prior=oldExists?identity(root):null
  if(oldExists&&((incoming||prior)&&incoming!==prior))throw Error('新旧角色身份不一致，禁止覆盖')
  const manifest=JSON.parse(readFileSync(join(snapshot,'manifest.json'),'utf8'))
  if(oldExists)assertLegacyProtectedState(root,manifest)
  const staged=root+'.stage-'+randomUUID(),safeguard=root+'.pre-restore-'+randomUUID()
  try{
    copyTree(payload,staged,manifest)
    // Re-verify the entire staging tree before replacing the active root.
    assertPayloadMatches(staged,manifest)
    // Preserve the original mode bits only after every file was copied and
    // checked; snapshot bytes themselves remain private 0600.
    for(const f of manifest.files)chmodSync(join(staged,...f.path.split('/')),f.mode)
    for(const d of [...manifest.dirs].reverse())chmodSync(join(staged,...d.path.split('/')),d.mode)
    // Restore is deliberately a rollback of private business data, but never
    // a rollback of permission review. The marker is checked by the existing
    // account-binding hard gate on the next launch and survives restarts.
    writeFileSync(join(staged,'restore-freeze.json'),JSON.stringify({version:1,reviewRequired:true,at:new Date().toISOString()})+'\n',{mode:0o600})
    if(oldExists)renameSync(root,safeguard)
    try{renameSync(staged,root)}catch(e){if(oldExists)renameSync(safeguard,root);throw e}
    return {...verified,restored:true,safeguardPath:oldExists?safeguard:null,restartRequired:true}
  }catch(e){rmSync(staged,{recursive:true,force:true});throw e}
}


// Active-partition snapshot, distinct from the legacy single-root format. The
// layout resolver (not a guessed disk list) remains the sole routing authority.
const SPLIT_FORMAT='dsh-cold-state-v2'
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
  if(JSON.stringify(names)!=='["manifest.json","partitions"]')throw Error('分盘快照存在未知目录')
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
export function inspectSplitColdSnapshot(root){
  root=splitLocalPath(root);assertColdRestoreClear(root)
  return {ok:true,requiresStop:true,parts:activeParts(root)}
}
export function createSplitColdSnapshot({root,destination,stoppedConfirmed=false,checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed)throw Error('必须先停止 DSH 并明确确认停机')
  root=splitLocalPath(root);destination=splitLocalPath(destination,{allowMissing:true})
  assertColdRestoreClear(root)
  const parts=activeParts(root),bootstrap=bootstrapOf(root)
  if(parts.some(p=>overlap(p.root,destination)))throw Error('备份目标不能与任何生效分区重叠')
  if(present(destination))throw Error('备份目标已存在，拒绝覆盖')
  assertStopped(checkStopped)
  mkdirSync(dirname(destination),{recursive:true});splitLocalPath(dirname(destination))
  const staged=destination+'.snapshot-'+randomUUID();let ownsStage=false
  try{
    mkdirSync(staged,{mode:0o700});ownsStage=true;mkdirSync(join(staged,'partitions'),{mode:0o700})
    const rows=parts.map(p=>({...p,...splitWalk(p.root,{links:true})}))
    if(rows.reduce((n,p)=>n+p.files.length+p.dirs.length,0)>MAX_ROWS)throw Error('分盘快照条目超限')
    requireSpace(rows.map(p=>({parent:dirname(destination),...partSize(p)})))
    for(const p of rows)copySplit(p.root,join(staged,'partitions',p.id),p,{links:true})
    const m={format:SPLIT_FORMAT,createdAt:new Date().toISOString(),bootstrap,parts:rows}
    writeFileSync(join(staged,'manifest.json'),JSON.stringify(m,null,2)+'\n',{mode:0o600,flag:'wx'})
    verifySplitColdSnapshot(staged)
    assertStopped(checkStopped)
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
function assertNoRollback(current,incoming){
  for(const p of current){
    const old=incoming.find(x=>x.id===p.id),protectedFiles=x=>sorted(x.files.filter(f=>!rebuildable(p,f.path))).map(({path,sha256,bytes,mode})=>[path,sha256,bytes,mode])
    const priorDirs=new Map(p.dirs.map(d=>[d.path,d.mode]))
    const changedDir=old.dirs.some(d=>priorDirs.has(d.path)&&!rebuildable(p,d.path)&&priorDirs.get(d.path)!==d.mode)
    if(changedDir||JSON.stringify(protectedFiles(p))!==JSON.stringify(protectedFiles(old)))throw Error('当前记忆、授权、运行账本或未知业务文件已变化；不能安全回退历史状态：'+p.id)
  }
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
function rollbackFence(root,j){
  // Validate all originals before any reversal. The old image is either at
  // its original path (not switched) or at the predeclared sibling safeguard.
  for(const p of j.parts){
    const saved=safeguardPath(p,j.id),staged=stagePath(p,j.id),hasSaved=present(saved)
    const original=hasSaved?saved:p.root
    if(stateDigest(splitWalk(original,{links:true}))!==p.prior)throw Error('恢复前原件不一致；保持冻结，禁止自动回退')
    if(hasSaved&&present(p.root)&&present(staged))throw Error('恢复目录状态不明确；保持冻结')
  }
  for(const p of [...j.parts].reverse()){
    const saved=safeguardPath(p,j.id),staged=stagePath(p,j.id)
    if(present(saved)){
      if(present(p.root))renameSync(p.root,staged)
      renameSync(saved,p.root)
    }
  }
  if(j.parts.some(p=>stateDigest(splitWalk(p.root,{links:true}))!==p.prior))throw Error('恢复前原件复核失败；保持冻结')
  // Preserve abandoned stages for diagnosis; don't recursively delete an
  // unknown tree during recovery. The live directories are now the originals.
  rmSync(coldRestoreFencePath(root));return {ok:true,rolledBack:true,restartRequired:true,retainedStages:j.parts.map(p=>stagePath(p,j.id)).filter(present)}
}
export function rollbackSplitColdRestore({root,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='ROLLBACK_FULL_DSH_STATE')throw Error('必须停机并明确确认恢复事务回退')
  root=splitLocalPath(root,{allowMissing:true});assertStopped(checkStopped)
  const raw=readIdentityJson(coldRestoreFencePath(root),32768)
  if(raw?.version===2&&raw.kind==='model-rebind')return rollbackModelRebind(root,raw)
  const j=readFence(root);return rollbackFence(root,j)
}
export function restoreSplitColdSnapshot({snapshot,root,stoppedConfirmed=false,confirm='',checkStopped=runtimeProcessesStopped}={}){
  if(!stoppedConfirmed||confirm!=='RESTORE_FULL_DSH_STATE')throw Error('必须停机并输入完整恢复确认口令')
  root=splitLocalPath(root);snapshot=splitLocalPath(snapshot);assertColdRestoreClear(root)
  assertStopped(checkStopped)
  const m=splitManifest(snapshot),parts=activeParts(root)
  if(JSON.stringify(bootstrapOf(root))!==JSON.stringify(m.bootstrap))throw Error('当前核心迁移引导与快照不同，拒绝恢复')
  if(JSON.stringify(parts)!==JSON.stringify(m.parts.map(({id,root,domains})=>({id,root,domains}))))throw Error('快照与当前生效分区拓扑不一致，禁止改盘或自动恢复缺盘')
  if(parts.some(p=>overlap(p.root,snapshot)))throw Error('快照与生效分区重叠')
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
    rmSync(coldRestoreFencePath(root))
    return {...summary(m),restored:true,restartRequired:true,safeguardPaths:parts.map(p=>safeguardPath(p,id))}
  }catch(e){
    try{rollbackFence(root,journal)}catch{throw Error('恢复失败且未能完整回退；启动保持冻结，请停机执行 rollback-full。'+e.message)}
    throw Error('恢复未完成，已回退至恢复前全部分区。'+e.message)
  }
}

// Old single-root snapshots remain readable; do not use legacy restore to
// bypass the most important existing memory and permission/receipt ledgers.
function assertLegacyProtectedState(root,manifest){
  const protectedPath=p=>/^(?:life-memory\/(?!interests\.json$)|long-term-memory(?:\/|$)|detail-protection(?:\/|$)|embedding-memory-index(?:\/|$)|accounts(?:\/|$)|account-binding\.json$|bili_credential\.json$|outbound-action-executions(?:\/|$)|life-agent-events(?:\/|$)|personality-evolution(?:\/|$))/.test(p)
  const signature=m=>sorted(m.files.filter(f=>protectedPath(f.path))).map(({path,sha256,bytes})=>[path,sha256,bytes])
  if(JSON.stringify(signature(walk(root)))!==JSON.stringify(signature(manifest)))throw Error('旧版冷快照包含已变化的记忆、授权或外发账本，禁止历史回退')
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
  assertColdRestoreClear(root)
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
function rollbackModelRebind(root,j){
  if(j.root!==root||!tokenOk(j.id)||typeof j.prior!=='string'||j.prior.length>12000||!/^[a-f0-9]{64}$/.test(j.nextSha256)||typeof j.target!=='string')throw Error('模型恢复事务标记不可信')
  const prior=Buffer.from(j.prior,'base64'),previous=JSON.parse(prior.toString('utf8'))
  if(previous.version!==2||previous.base!==root||typeof previous.nonce!=='string'||!previous.nonce||splitLocalPath(previous.target,{allowMissing:true})!==previous.target||overlap(root,previous.target)||splitLocalPath(j.target,{allowMissing:true})!==j.target||overlap(root,j.target)||overlap(previous.target,j.target))throw Error('模型恢复事务原路由非法')
  const config=join(root,LARGE_CONFIG);readIdentityJson(config,8192)
  const now=readFileSync(config),hash=bytesHash(now)
  if(hash!==bytesHash(prior)&&hash!==j.nextSha256)throw Error('模型路由在恢复期间被其他操作修改；保持冻结')
  if(hash===j.nextSha256){
    const next=JSON.parse(now.toString('utf8'))
    if(next.version!==2||next.base!==root||next.target!==j.target||next.nonce!==j.id)throw Error('模型恢复事务新路由身份不匹配；保持冻结')
    writeAtomicRoute(root,prior,randomUUID())
  }
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
    writeAtomicRoute(root,next,id)
    const resolved=largeDataStatus(root),layout=storageLayoutStatus(root)
    if(resolved.target!==target||layout.domains.memory.configured!==Boolean(p.current.layout.domains.memory)||inventoryDigest(splitWalk(target))!==expected)throw Error('模型恢复后的实际路由或内容复核失败')
    rmSync(coldRestoreFencePath(root))
    return {ok:true,restored:true,scope:'v2-models-only',target,previousTarget:p.current.route.target,files:p.inventory.files.length,bytes:partSize(p.inventory).bytes,omittedFiles:p.part.files.length-p.inventory.files.length,protectedBusinessUnchanged:true,restartRequired:true,modelHealthCheckRequired:true}
  }catch(e){
    try{rollbackModelRebind(root,j)}catch{throw Error('模型恢复失败且路由未能回退；启动保持冻结，请停机执行 rollback-full。'+e.message)}
    throw Error('模型恢复未完成，已保留原路由和暂存目录。'+e.message)
  }
}
