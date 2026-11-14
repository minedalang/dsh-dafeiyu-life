/**
 * Full LOCAL, OFFLINE state-directory snapshot for a stopped DSH instance.
 * Unlike the portable JSON business export this includes credentials, account
 * ledgers, private data, unknown future state and embedded runtime files.
 * It is NOT encrypted and must never be uploaded or shared.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readdirSync,openSync,readSync,closeSync,readFileSync,writeFileSync,
  copyFileSync,chmodSync,renameSync,rmSync} from 'node:fs'
import {dirname,join,relative,resolve,sep} from 'node:path'

const FORMAT='dsh-cold-state-v1'
const within=(parent,child)=>{const rel=relative(resolve(parent),resolve(child));return rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith(sep))}
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
  if(within(snapshot,root)||within(root,snapshot))throw Error('不能恢复到快照自身或其内部')
  const verified=verifyColdSnapshot(snapshot)
  const payload=join(snapshot,'payload'),oldExists=existsSync(root)
  if(oldExists)requireDirectory(root)
  requireDirectory(dirname(root))
  // Never restore a different fish identity onto an existing installation.
  const incoming=identity(payload),prior=oldExists?identity(root):null
  if(oldExists&&((incoming||prior)&&incoming!==prior))throw Error('新旧角色身份不一致，禁止覆盖')
  const manifest=JSON.parse(readFileSync(join(snapshot,'manifest.json'),'utf8'))
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
