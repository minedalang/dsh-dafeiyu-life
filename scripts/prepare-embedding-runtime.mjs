import {createHash} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm,mkdir,chmod,lstat,realpath,readdir,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,relative,sep,basename} from 'node:path'
import {execFile as nodeExecFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {getEmbeddingRuntimeAsset,__test} from '../lib/embedding-runtime-manager.mjs'

const execFile=promisify(nodeExecFile)
const repoRoot=join(dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2)
const option=name=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)
const target=option('target')||process.env.DSH_EMBEDDING_RUNTIME_TARGET||`${process.platform}-${process.arch}`
const match=/^(win32|darwin|linux)-(x64|arm64)$/.exec(target)
if(!match)throw Error(`无效 Runtime 目标平台：${target}`)
const [,platform,arch]=match
const asset=getEmbeddingRuntimeAsset(platform,arch)
const bundleRoot=join(repoRoot,'vendor','embedding-runtime')
const targetDir=join(bundleRoot,target)
const tempRoot=await mkdtemp(join(tmpdir(),'dsh-runtime-package-'))
const archive=join(tempRoot,asset.file),staging=join(tempRoot,'extract')
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex')
const safeNames=output=>__test.validateArchiveNames(output)

async function fetchAsset(){
  const mirror=String(process.env.DSH_EMBEDDING_RUNTIME_MIRROR_BASE||'').trim().replace(/\/$/,'')
  const urls=[...(mirror?[`${mirror}/${asset.file}`]:[]),asset.url]
  let lastError
  for(const url of urls){
    try{
      const parsed=new URL(url)
      if(parsed.protocol!=='https:')throw Error('Runtime 下载地址必须使用 HTTPS')
      const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(180_000)})
      if(!response.ok)throw Error(`HTTP ${response.status}`)
      const buffer=Buffer.from(await response.arrayBuffer())
      if(!buffer.length||buffer.length>asset.maxBytes)throw Error('Runtime 压缩包大小超出限制')
      const digest=sha256(buffer)
      if(digest!==asset.sha256)throw Error(`SHA-256 不匹配：${digest}`)
      await writeFile(archive,buffer,{mode:0o600})
      process.stdout.write(`已验证 ${asset.file} · ${(buffer.length/1048576).toFixed(1)} MB\n`)
      return
    }catch(error){lastError=error;process.stderr.write(`Runtime 源失败：${url} · ${String(error?.message||error).slice(0,160)}\n`)}
  }
  throw lastError||Error('Runtime 下载失败')
}
async function extract(){
  await mkdir(staging,{recursive:true,mode:0o700})
  let listed
  const zip=asset.file.endsWith('.zip'),useTarForZip=zip&&process.platform==='win32'
  if(zip&&!useTarForZip)listed=(await execFile('unzip',['-Z1',archive],{maxBuffer:6*1024*1024,windowsHide:true})).stdout
  else listed=(await execFile('tar',['-tf',archive],{maxBuffer:6*1024*1024,windowsHide:true})).stdout
  safeNames(listed)
  if(zip&&!useTarForZip)await execFile('unzip',['-q',archive,'-d',staging],{maxBuffer:2*1024*1024,windowsHide:true})
  else await execFile('tar',['-xf',archive,'-C',staging],{maxBuffer:2*1024*1024,windowsHide:true})
}
async function findBinary(folder){
  const matches=[]
  async function walk(dir,depth=0){
    if(depth>8)return
    for(const row of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,row.name)
      if(row.isSymbolicLink()){
        const targetPath=await realpath(path).catch(()=>''),base=await realpath(folder)
        if(!targetPath||!(targetPath===base||targetPath.startsWith(base+sep)))throw Error('Runtime 包含越界符号链接')
      }else if(row.isDirectory())await walk(path,depth+1)
      else if(row.isFile()&&(row.name==='llama-server'||row.name==='llama-server.exe'))matches.push(path)
    }
  }
  await walk(folder)
  if(!matches.length)throw Error('Runtime 压缩包没有 llama-server 可执行文件')
  matches.sort((a,b)=>a.length-b.length)
  return matches[0]
}

try{
  await mkdir(bundleRoot,{recursive:true})
  for(const name of await readdir(bundleRoot))if(name!=='.gitignore')await rm(join(bundleRoot,name),{recursive:true,force:true})
  await fetchAsset();await extract()
  const binary=await findBinary(staging),relativeBinary=relative(staging,binary)
  if(relativeBinary.startsWith('..')||relativeBinary.split(/[\\/]/).includes('..'))throw Error('Runtime 二进制路径越界')
  const packageStage=join(tempRoot,'package');await mkdir(packageStage,{recursive:true});await rename(staging,join(packageStage,'runtime'))
  const finalBinary=join(packageStage,'runtime',relativeBinary)
  if(platform!=='win32')await chmod(finalBinary,0o755)
  const manifest={schema:1,version:__test.RUNTIME.version,platform:target,asset:asset.file,sha256:asset.sha256,binary:`runtime/${relativeBinary.split(/[\\/]/).join('/')}`,preparedAt:new Date().toISOString(),license:'MIT'}
  await writeFile(join(packageStage,'dsh-runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o644})
  await mkdir(dirname(targetDir),{recursive:true});await rm(targetDir,{recursive:true,force:true});await rename(packageStage,targetDir)
  process.stdout.write(`已准备 ${target} Runtime：${manifest.binary}\n`)
}finally{
  await rm(tempRoot,{recursive:true,force:true})
}
