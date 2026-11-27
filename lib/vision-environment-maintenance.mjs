/** Owner maintenance only. Preview is read-only. Offline quarantine renames
 * exact, verified generated directories; it never recursively deletes data.
 * The user can restore the original name before deciding to delete manually. */
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync,renameSync} from 'node:fs'
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {validateLocalDataPath} from './storage-location.mjs'
import {storagePythonRuntimeRoot} from './storage-layout.mjs'
import {runtimeProcessesStopped} from './storage-cleanup-queue.mjs'
import {readMigrationJob} from './storage-migration-queue.mjs'
const GENERATED=/^\.vision-env-\d{13}-[a-f0-9]{8}(?:-\d{1,2})?$/
const RETIRED=/^\.vision-retired-\d{13}-[a-f0-9]{8}(?:-\d{1,2})?$/
const MAX=100, TTL=30*60_000
const hash=s=>createHash('sha256').update(s).digest('hex')
const same=(a,b)=>resolve(a).toLowerCase()===resolve(b).toLowerCase()
const inside=(root,p)=>{const r=relative(resolve(root).toLowerCase(),resolve(p).toLowerCase());return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)}
const safeFile=(p,max)=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('文件身份不可信');return readFileSync(p)}
const configSnapshot=root=>{const bytes=safeFile(join(root,'config.json'),2*1024*1024),cfg=JSON.parse(bytes.toString('utf8'));return {cfg,digest:hash(bytes)}}
const canonicalPath=p=>{if(typeof p!=='string'||!isAbsolute(p)||!existsSync(p))throw Error('当前 Python 路径未明确或不可读；请先核验并保存主 Python 与视觉 Python');return realpathSync(p)}
function rootsFor(root){return [...new Set([validateLocalDataPath(root),validateLocalDataPath(storagePythonRuntimeRoot(root))])]}
function protectedPaths({cfg,configured,preferred,selected,env}){
 // Require persisted and effective explicit interpreter paths. An unset or
 // relative interpreter cannot establish that a generated directory is unused.
 const paths=[cfg.pythonPath,cfg.visionPythonPath,configured,preferred,selected].filter(Boolean)
 if(!cfg.pythonPath||!cfg.visionPythonPath||!configured||!preferred||!selected)throw Error('主 Python、视觉 Python 或实际选用解释器尚未核验；不提供清理命令')
 const out=[]
 for(const p of paths){const real=canonicalPath(p);if(!lstatSync(real).isFile())throw Error('当前 Python 不是有效文件');out.push(resolve(p),real)
  const venv=join(dirname(dirname(real)),'pyvenv.cfg');if(existsSync(venv)){const text=safeFile(venv,65536).toString('utf8');for(const line of text.split(/\r?\n/)){const m=/^(?:home|executable|base-executable|base-prefix)\s*=\s*(.+)$/i.exec(line.trim());if(m&&isAbsolute(m[1].trim()))out.push(m[1].trim())}}
 }
 for(const p of [env.BILI_DUTY_VISION_PYTHON,env.VIRTUAL_ENV,env.CONDA_PREFIX,...String(env.Path||env.PATH||'').split(process.platform==='win32'?';':':')])if(p&&isAbsolute(p)){out.push(resolve(p));try{out.push(realpathSync(p))}catch{}}
 return out
}
function inventory(root,options){
 const {cfg,digest}=configSnapshot(root),roots=rootsFor(root),protectedList=protectedPaths({...options,cfg})
 const entries=[]
 // Protect bases referenced by another managed virtual environment as well.
 for(const base of roots)for(const name of readdirSync(base)){
  if(name!=='.venv'&&!GENERATED.test(name)&&!RETIRED.test(name))continue
  const dir=join(base,name),st=lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink())continue
  const marker=join(dir,'pyvenv.cfg');if(!existsSync(marker))continue
  try{const text=safeFile(marker,65536).toString('utf8');for(const line of text.split(/\r?\n/)){const m=/^(?:home|executable|base-executable|base-prefix)\s*=\s*(.+)$/i.exec(line.trim());if(m&&isAbsolute(m[1].trim())&&!inside(dir,m[1].trim()))protectedList.push(m[1].trim())}}catch{throw Error('某个受管 Python 环境的配置无法核验，安全停止')}
 }
 for(const base of roots)for(const name of readdirSync(base)){
  if(!GENERATED.test(name)&&!RETIRED.test(name))continue
  if(entries.length>=MAX)throw Error('环境数量超出安全扫描上限')
  const dir=join(base,name),st=lstatSync(dir);let status='candidate',stamp=''
  if(!st.isDirectory()||st.isSymbolicLink()||!same(realpathSync(dir),dir))status='unsafe'
  else if(protectedList.some(p=>inside(dir,p)))status='protected'
  else if(RETIRED.test(name))status='retired'
  else try{const marker=safeFile(join(dir,'pyvenv.cfg'),65536);stamp=hash(JSON.stringify([st.dev,st.ino,st.mtimeMs,hash(marker)]));if(existsSync(join(base,name.replace('.vision-env-','.vision-retired-'))))status='conflict'}catch{status='unverified'}
  entries.push({root:base,name,status,...(status==='candidate'?{stamp}:{})})
 }
 return {digest,entries:entries.sort((a,b)=>(a.root+'/'+a.name).localeCompare(b.root+'/'+b.name))}
}
export function inspectVisionEnvironments({root,configured='',preferred='',selected='',env=process.env,repairBusy=false,platform=process.platform,now=Date.now()}={}){
 if(platform!=='win32')return {ok:true,available:false,reason:'仅支持 Windows 视觉虚拟环境维护',entries:[]}
 if(repairBusy)return {ok:true,available:false,reason:'视觉环境正在修复，结束后再检查',entries:[]}
 try{
  const base=validateLocalDataPath(root);if(['waiting','running'].includes(readMigrationJob(base).status))throw Error('存储迁移尚未结束')
  const {digest,entries}=inventory(base,{configured,preferred,selected,env})
  const candidates=entries.filter(x=>x.status==='candidate')
  const plan={version:1,createdAt:now,root:base,configured,preferred,selected,digest,candidates}
  return {ok:true,available:true,entries:entries.map(({stamp,...row})=>row),token:candidates.length?Buffer.from(JSON.stringify(plan)).toString('base64url'):'',count:candidates.length}
 }catch(e){return {ok:true,available:false,reason:String(e?.message||e).slice(0,180),entries:[]}}
}
export function quarantineVisionEnvironments({token,env=process.env,platform=process.platform,now=Date.now(),checkStopped=()=>runtimeProcessesStopped({platform}),move=renameSync}={}){
 if(platform!=='win32'||typeof token!=='string'||token.length>100000)throw Error('无效的 Windows 离线维护凭据')
 const plan=JSON.parse(Buffer.from(token,'base64url').toString('utf8'))
 if(plan.version!==1||!Number.isSafeInteger(plan.createdAt)||now<plan.createdAt||now-plan.createdAt>TTL||!Array.isArray(plan.candidates)||!plan.candidates.length||plan.candidates.length>MAX)throw Error('维护预检已失效，请回管理中心重新检查')
 const root=validateLocalDataPath(plan.root)
 const assertStopped=()=>{if(!checkStopped()?.ok)throw Error('仍有 DSH、Node、Python 或模型进程运行；请完整退出后再执行')}
 assertStopped()
 if(['waiting','running'].includes(readMigrationJob(root).status))throw Error('存储迁移尚未结束')
 const current=()=>inventory(root,{configured:plan.configured,preferred:plan.preferred,selected:plan.selected,env})
 const fresh=current();if(fresh.digest!==plan.digest||JSON.stringify(fresh.entries.filter(x=>x.status==='candidate'))!==JSON.stringify(plan.candidates))throw Error('配置或候选目录已变化，未隔离任何环境，请重新检查')
 const moved=[]
 for(const row of plan.candidates){
  try{
   assertStopped();const state=current(),match=state.entries.find(x=>x.root===row.root&&x.name===row.name)
   if(state.digest!==plan.digest||match?.status!=='candidate'||match.stamp!==row.stamp||!GENERATED.test(row.name))throw Error('环境身份已改变')
   const dest=row.name.replace('.vision-env-','.vision-retired-');if(existsSync(join(row.root,dest)))throw Error('隔离名称已存在')
   move(join(row.root,row.name),join(row.root,dest));moved.push({root:row.root,from:row.name,to:dest})
  }catch(e){return {ok:false,moved,error:String(e?.message||e).slice(0,180)}}
 }
 return {ok:true,moved}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==4||process.argv[2]!=='--quarantine')throw Error('请使用管理中心生成的离线隔离命令')
  const result=quarantineVisionEnvironments({token:process.argv[3]});for(const row of result.moved)console.log(`${join(row.root,row.from)} -> ${join(row.root,row.to)}`)
  if(!result.ok)throw Error(result.error+'；以上已隔离目录可手动恢复原名。')
  console.log('已隔离，未删除文件。重启 DSH 并验证视觉功能；正常后可手动删除上述 .vision-retired-* 目录。')
 }catch(error){console.error(String(error?.message||error));process.exitCode=1}
}
