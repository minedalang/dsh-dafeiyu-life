import {createHash, randomBytes} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {mkdir, open, readFile, readdir, lstat, realpath, rename, rm, stat, chmod, writeFile} from 'node:fs/promises'
import {join, dirname, relative, sep, basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn as nodeSpawn, execFile as nodeExecFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {availableParallelism} from 'node:os'

const execFile=promisify(nodeExecFile)
const PACKAGE_ROOT=join(dirname(fileURLToPath(import.meta.url)),'..')
const MODEL=Object.freeze({
  id:'Qwen/Qwen3-Embedding-0.6B-GGUF',
  revision:'370f27d7550e0def9b39c1f16d3fbaa13aa67728',
  file:'Qwen3-Embedding-0.6B-Q8_0.gguf',
  bytes:639150592,
  sha256:'06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
  dimension:1024,
  license:'Apache-2.0',
  url:'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/370f27d7550e0def9b39c1f16d3fbaa13aa67728/Qwen3-Embedding-0.6B-Q8_0.gguf',
})
const RUNTIME=Object.freeze({
  version:'b12110',
  release:'0.9.0',
  assets:Object.freeze({
    'win32-x64':{file:'llama-b12110-bin-win-cpu-x64.zip',sha256:'98901e327c252875accaf2d1bf364e10e868843b0b63468baad1aa945cdc5da2',maxBytes:100_000_000},
    'win32-arm64':{file:'llama-b12110-bin-win-cpu-arm64.zip',sha256:'f8d20fb07d0b499988ced8963afcd5ded2d2cdd9983b757fbc7e51c4abd722e8',maxBytes:100_000_000},
    'darwin-arm64':{file:'llama-b12110-bin-macos-arm64.tar.gz',sha256:'4f5b8de12e0b9516658ca6a5764c6ffb3d7c659c3dd538556b1413c7b4050662',maxBytes:100_000_000},
    'darwin-x64':{file:'llama-b12110-bin-macos-x64.tar.gz',sha256:'c8094268b6bf62f4998f0e45656fd9f5e2d4afb6b1cd0044d761db64be1dd47d',maxBytes:100_000_000},
    'linux-x64':{file:'llama-b12110-bin-ubuntu-x64.tar.gz',sha256:'368227edcc229be5f9bed16a2223d79b5e41d0ac2e19bcf5825e82291c060e55',maxBytes:100_000_000},
    'linux-arm64':{file:'llama-b12110-bin-ubuntu-arm64.tar.gz',sha256:'4758b51335e37b4346251f2687d64841ff1c07ecb27fc46323945bb2ec9c44d2',maxBytes:100_000_000},
  }),
})
const QUERY_INSTRUCTION='Given a user query, retrieve relevant personal memories, past experiences, and stable facts that answer the query.'
const clean=(value,max=2000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const isSha=value=>/^[a-f0-9]{64}$/.test(String(value||''))

async function hashFile(path){
  const hash=createHash('sha256')
  for await(const chunk of createReadStream(path))hash.update(chunk)
  return hash.digest('hex')
}
async function writeChunk(handle,buffer){
  let offset=0
  while(offset<buffer.length){const result=await handle.write(buffer,offset,buffer.length-offset,null);if(!result.bytesWritten)throw Error('下载文件写入中断');offset+=result.bytesWritten}
}
function platformKey(platform=process.platform,arch=process.arch){return `${platform}-${arch}`}
function runtimeAsset(platform=process.platform,arch=process.arch){
  const key=platformKey(platform,arch),asset=RUNTIME.assets[key]
  if(!asset)throw Error(`当前平台暂不支持自动安装本地 Embedding Runtime：${key}`)
  return {...asset,url:`https://github.com/ggml-org/llama.cpp/releases/download/${RUNTIME.version}/${asset.file}`}
}
export function getEmbeddingRuntimeAsset(platform=process.platform,arch=process.arch){return runtimeAsset(platform,arch)}
function validateArchiveNames(output){
  const names=String(output||'').split(/\r?\n/).filter(Boolean)
  if(!names.length||names.length>20000)throw Error('Runtime 压缩包目录数量异常')
  for(const raw of names){
    const name=raw.replace(/\\/g,'/').replace(/^\.\//,'')
    if(!name||name.startsWith('/')||/^[a-z]:/i.test(name)||name.split('/').some(part=>part==='..'))
      throw Error('Runtime 压缩包包含不安全路径，已拒绝解压')
  }
  return names.length
}

export function createEmbeddingRuntimeManager({dataDir,logger=console,fetchImpl=globalThis.fetch,spawnImpl=nodeSpawn,platform=process.platform,arch=process.arch,packageRoot=PACKAGE_ROOT}={}){
  if(!dataDir)throw TypeError('Embedding runtime dataDir is required')
  if(typeof fetchImpl!=='function')throw TypeError('fetch is unavailable; Node.js 22 or newer is required')
  const root=join(dataDir,'embedding-runtime')
  const modelPath=join(root,MODEL.file)
  const runtimeDir=join(root,`llama-${RUNTIME.version}-${platformKey(platform,arch)}`)
  const bundledRuntimeDir=join(packageRoot,'vendor','embedding-runtime',platformKey(platform,arch))
  const initialAsset=RUNTIME.assets[platformKey(platform,arch)]
  const runtimeArchive=join(root,`runtime-${initialAsset?.file||'unsupported-runtime.archive'}`)
  const progress={phase:'missing',asset:'',downloadedBytes:0,totalBytes:0,percent:0,updatedAt:Date.now(),lastError:''}
  let child=null,port=0,apiKey='',baseUrl='',installPromise=null,installAbort=null,expectedStop=false,lastStderr='',runtimeBinary='',runtimeSource='',ready=false
  const touch=(patch={})=>Object.assign(progress,patch,{updatedAt:Date.now()})
  const safeRoot=async()=>{
    await mkdir(root,{recursive:true,mode:0o700})
    const info=await lstat(root)
    if(info.isSymbolicLink()||!info.isDirectory())throw Error('Embedding 数据目录不是安全的普通目录')
    try{await chmod(root,0o700)}catch{}
  }
  const existingFile=async(path,size=0)=>{
    try{const info=await lstat(path);return info.isFile()&&!info.isSymbolicLink()&&(size<=0||info.size===size)}catch{return false}
  }
  async function download(url,target,{sha256,expectedBytes=0,maxBytes=100_000_000,label,signal}={}){
    await safeRoot()
    const part=target+'.part'
    let start=0
    try{const info=await lstat(part);if(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<maxBytes)start=info.size;else await rm(part,{force:true})}catch{}
    const headers={};if(start)headers.Range=`bytes=${start}-`
    touch({phase:'downloading',asset:label,downloadedBytes:start,totalBytes:expectedBytes||0,percent:expectedBytes?Math.floor(start/expectedBytes*100):0,lastError:''})
    const response=await fetchImpl(url,{method:'GET',headers,redirect:'follow',signal})
    if(start&&response.status===416){
      const size=(await stat(part).catch(()=>({size:0}))).size
      if(expectedBytes&&size===expectedBytes&&(!sha256||await hashFile(part)===sha256)){await rename(part,target);return {bytes:size,sha256:sha256||await hashFile(target)}}
      await rm(part,{force:true});throw Error(`${label} 下载续传位置无效，请重新尝试`)
    }
    if(!response.ok&&response.status!==206)throw Error(`${label} 下载失败：HTTP ${response.status}`)
    let append=false
    if(start&&response.status===206){
      const range=String(response.headers.get('content-range')||'')
      if(!range.startsWith(`bytes ${start}-`))throw Error(`${label} 断点续传响应范围不匹配`)
      append=true
    }else start=0
    const responseLength=Number(response.headers.get('content-length'))||0
    const total=expectedBytes||((responseLength&&append)?start+responseLength:responseLength)
    if(total>maxBytes)throw Error(`${label} 文件超过安全大小上限`)
    const handle=await open(part,append?'a':'w',0o600)
    let downloaded=start
    try{
      if(!response.body)throw Error(`${label} 下载响应没有内容`)
      const reader=response.body.getReader()
      while(true){
        if(signal?.aborted)throw Object.assign(new Error('下载已取消'),{name:'AbortError'})
        const {done,value}=await reader.read();if(done)break
        const chunk=Buffer.from(value);downloaded+=chunk.length
        if(downloaded>maxBytes||expectedBytes&&downloaded>expectedBytes)throw Error(`${label} 下载内容超过预期大小`)
        await writeChunk(handle,chunk)
        touch({downloadedBytes:downloaded,totalBytes:total||expectedBytes||0,percent:(total||expectedBytes)?Math.min(99,Math.floor(downloaded/(total||expectedBytes)*100)):0})
      }
      await handle.sync()
    }finally{await handle.close()}
    if(expectedBytes&&downloaded!==expectedBytes)throw Error(`${label} 文件大小不匹配：${downloaded}/${expectedBytes}`)
    const actual=await hashFile(part)
    if(sha256&&actual!==sha256){await rm(part,{force:true});throw Error(`${label} SHA-256 校验失败，文件已删除`)}
    await rm(target,{force:true});await rename(part,target)
    touch({downloadedBytes:downloaded,totalBytes:downloaded,percent:100})
    return {bytes:downloaded,sha256:actual}
  }
  async function downloadFromSources(urls,target,options={}){
    let lastError=null
    for(const url of [...new Set((Array.isArray(urls)?urls:[urls]).filter(Boolean))]){
      try{
        if(new URL(url).protocol!=='https:')throw Error('下载地址必须使用 HTTPS')
        return await download(url,target,options)
      }catch(error){
        if(error?.name==='AbortError')throw error
        lastError=error
        logger.warn?.(`${options.label||'Embedding 资源'}下载源失败，尝试下一个来源：${clean(url,180)} · ${clean(error?.message||error,120)}`)
      }
    }
    throw lastError||Error(`${options.label||'Embedding 资源'}没有可用下载源`)
  }
  function modelDownloadUrls(){
    const custom=String(process.env.DSH_EMBEDDING_MODEL_MIRROR_URL||'').trim()
    const base=String(process.env.DSH_EMBEDDING_MODEL_MIRROR_BASE||'https://hf-mirror.com').trim().replace(/\/$/,'')
    const mirror=custom||`${base}/${MODEL.id}/resolve/${MODEL.revision}/${MODEL.file}`
    return [mirror,MODEL.url]
  }
  function runtimeDownloadUrls(asset){
    const base=String(process.env.DSH_EMBEDDING_RUNTIME_MIRROR_BASE||'').trim().replace(/\/$/,'')
    return [base?`${base}/${asset.file}`:'',asset.url].filter(Boolean)
  }
  async function findServerBinary(folder){
    const matches=[]
    async function walk(dir,depth=0){
      if(depth>6)return
      const rows=await readdir(dir,{withFileTypes:true})
      for(const row of rows){
        const path=join(dir,row.name)
        if(row.isSymbolicLink()){
          const target=await realpath(path).catch(()=> '')
          const base=await realpath(folder)
          if(!target||!(target===base||target.startsWith(base+sep)))throw Error('Runtime 包含指向目录外的符号链接')
          continue
        }
        if(row.isDirectory())await walk(path,depth+1)
        else if(row.isFile()&&(row.name==='llama-server'||row.name==='llama-server.exe'))matches.push(path)
      }
    }
    await walk(folder)
    if(!matches.length)throw Error('Runtime 压缩包中没有找到 llama-server 可执行文件')
    matches.sort((a,b)=>a.length-b.length)
    return matches[0]
  }
  async function extractRuntime(archive){
    const staging=join(root,`.runtime-staging-${Date.now()}-${randomBytes(4).toString('hex')}`)
    await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true,mode:0o700})
    try{
      const listed=await execFile('tar',['-tf',archive],{maxBuffer:6*1024*1024,windowsHide:true})
      validateArchiveNames(listed.stdout)
      await execFile('tar',['-xf',archive,'-C',staging],{maxBuffer:2*1024*1024,windowsHide:true})
      const binary=await findServerBinary(staging)
      const relativeBinary=relative(staging,binary)
      if(relativeBinary.startsWith('..')||relativeBinary.split(/[\\/]/).includes('..'))throw Error('Runtime 可执行文件路径越界')
      await rm(runtimeDir,{recursive:true,force:true});await rename(staging,runtimeDir)
      const finalBinary=join(runtimeDir,relativeBinary)
      if(platform!=='win32')await chmod(finalBinary,0o700)
      runtimeBinary=finalBinary;runtimeSource='state'
      await writeFile(join(runtimeDir,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:RUNTIME.version,platform:platformKey(platform,arch),file:basename(runtimeAsset(platform,arch).file),binary:relativeBinary.split(/[\\/]/).join('/'),sha256:runtimeAsset(platform,arch).sha256,installedAt:new Date().toISOString()}),{mode:0o600})
    }catch(error){await rm(staging,{recursive:true,force:true});throw error}
  }
  async function loadRuntimeFrom(folder,source){
    const asset=runtimeAsset(platform,arch),manifestPath=join(folder,'dsh-runtime-manifest.json')
    try{
      const dirInfo=await lstat(folder),manifestInfo=await lstat(manifestPath)
      if(!dirInfo.isDirectory()||dirInfo.isSymbolicLink()||!manifestInfo.isFile()||manifestInfo.isSymbolicLink())return false
      const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
      const relativeBinary=String(manifest?.binary||'').replace(/\\/g,'/'),parts=relativeBinary.split('/')
      if(manifest?.schema===1&&manifest.version===RUNTIME.version&&manifest.sha256===asset.sha256&&manifest.platform===platformKey(platform,arch)&&/^llama-server(?:\.exe)?$/.test(basename(relativeBinary))&&relativeBinary&&!relativeBinary.startsWith('/')&&!/^[a-z]:/i.test(relativeBinary)&&parts.every(part=>part&&part!=='.'&&part!=='..'&&!part.includes(':'))){
        const candidate=join(folder,...parts)
        if(await existingFile(candidate)){runtimeBinary=candidate;runtimeSource=source;return true}
      }
    }catch{}
    return false
  }
  async function loadInstalledRuntime(){
    runtimeBinary='';runtimeSource=''
    if(await loadRuntimeFrom(runtimeDir,'state'))return true
    if(await loadRuntimeFrom(bundledRuntimeDir,'bundled'))return true
    return false
  }
  async function ensureRuntime({signal}={}){
    const asset=runtimeAsset(platform,arch)
    if(await loadInstalledRuntime())return
    if(!(await existingFile(runtimeArchive))){
      await downloadFromSources(runtimeDownloadUrls(asset),runtimeArchive,{sha256:asset.sha256,maxBytes:asset.maxBytes,label:'llama.cpp Runtime',signal})
    }else if(await hashFile(runtimeArchive)!==asset.sha256){await rm(runtimeArchive,{force:true});await downloadFromSources(runtimeDownloadUrls(asset),runtimeArchive,{sha256:asset.sha256,maxBytes:asset.maxBytes,label:'llama.cpp Runtime',signal})}
    touch({phase:'extracting-runtime',asset:asset.file,percent:100})
    await extractRuntime(runtimeArchive)
    await rm(runtimeArchive,{force:true})
  }
  async function ensureModel({signal}={}){
    if(await existingFile(modelPath,MODEL.bytes)){
      const actual=await hashFile(modelPath)
      if(actual===MODEL.sha256)return
      await rm(modelPath,{force:true})
    }
    await downloadFromSources(modelDownloadUrls(),modelPath,{sha256:MODEL.sha256,expectedBytes:MODEL.bytes,maxBytes:700_000_000,label:'Qwen3 Embedding 模型',signal})
  }
  async function reservePort(){
    return new Promise((resolve,reject)=>{
      const server=createServer()
      server.once('error',reject)
      server.listen(0,'127.0.0.1',()=>{const address=server.address();const chosen=address?.port;server.close(error=>error?reject(error):resolve(chosen))})
    })
  }
  async function requestJson(path,body=null,{timeoutMs=30_000}={}){
    if(!baseUrl||!apiKey)throw Error('本地 Embedding Runtime 尚未启动')
    const response=await fetchImpl(baseUrl+path,{method:body===null?'GET':'POST',headers:{...(body===null?{}:{'content-type':'application/json'}),'authorization':'Bearer '+apiKey},...(body===null?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)})
    const text=await response.text()
    let data;try{data=JSON.parse(text)}catch{throw Error(`本地 Embedding Runtime 返回无效 JSON（HTTP ${response.status}）`)}
    if(!response.ok)throw Error(String(data?.error?.message||data?.error||`本地 Embedding Runtime HTTP ${response.status}`).slice(0,180))
    return data
  }
  async function embedBatch(texts){
    const input=(Array.isArray(texts)?texts:[texts]).map(x=>clean(x,5000))
    if(!input.length)return []
    if(input.length>32)throw Error('单次 Embedding 最多处理 32 条文本')
    if(input.some(x=>!x))throw Error('Embedding 文本不能为空')
    const result=await requestJson('/v1/embeddings',{model:'dsh-qwen3-embedding',input},{timeoutMs:120_000})
    if(!Array.isArray(result?.data)||result.data.length!==input.length)throw Error('Embedding 返回数量与输入不一致')
    const rows=result.data.slice().sort((a,b)=>Number(a.index)-Number(b.index))
    return rows.map(row=>{
      const vector=row?.embedding
      if(!Array.isArray(vector)||vector.length!==MODEL.dimension||vector.some(x=>!Number.isFinite(Number(x))))throw Error('Embedding 向量维度或数值无效')
      return Float32Array.from(vector,Number)
    })
  }
  async function waitForServer(signal){
    const until=Date.now()+120_000
    let last=''
    while(Date.now()<until){
      if(signal?.aborted)throw Object.assign(new Error('安装已取消'),{name:'AbortError'})
      if(!child||child.exitCode!==null)throw Error('llama-server 在初始化期间退出：'+(lastStderr||last||'未提供错误输出').slice(-240))
      try{
        const response=await fetchImpl(baseUrl+'/health',{signal:AbortSignal.timeout(2500)})
        if(response.ok){const data=await response.json();if(data?.status==='ok')return}
        else last=`health HTTP ${response.status}`
      }catch(e){last=String(e?.message||e)}
      await delay(500)
    }
    throw Error('本地 Embedding 模型初始化超时：'+last.slice(0,140))
  }
  async function start({signal}={}){
    if(signal?.aborted)throw Object.assign(new Error('安装已取消'),{name:'AbortError'})
    if(child&&child.exitCode===null&&ready)return status()
    await safeRoot()
    if(!runtimeBinary&&!await loadInstalledRuntime())throw Error('llama.cpp Runtime 尚未安装，请先点击“启用并下载模型”')
    if(!(await existingFile(modelPath,MODEL.bytes)))throw Error('Embedding 模型尚未安装，请先点击“启用并下载模型”或导入模型文件')
    if(await hashFile(modelPath)!==MODEL.sha256)throw Error('Embedding 模型校验失败，拒绝启动')
    port=await reservePort();apiKey=randomBytes(32).toString('hex');baseUrl=`http://127.0.0.1:${port}`;lastStderr='';expectedStop=false;ready=false
    const cpu=Math.max(1,Math.min(8,Number(availableParallelism?.())||4))
    const args=['--model',modelPath,'--alias','dsh-qwen3-embedding','--embedding','--pooling','last','--host','127.0.0.1','--port',String(port),'--ctx-size','8192','--threads',String(cpu),'--embd-normalize','2','--parallel','1','--no-webui','--cors-origins','localhost','--api-key',apiKey]
    touch({phase:'starting-runtime',asset:'',percent:100,lastError:''})
    const spawned=spawnImpl(runtimeBinary,args,{cwd:dirname(runtimeBinary),windowsHide:true,stdio:['ignore','ignore','pipe']})
    child=spawned
    spawned.stderr?.on('data',chunk=>{lastStderr=(lastStderr+chunk.toString()).slice(-2400)})
    spawned.on('error',error=>{if(child!==spawned)return;ready=false;touch({phase:'error',lastError:'llama-server 启动失败：'+clean(error?.message,180)});logger.warn?.('本地 Embedding Runtime 启动失败：'+clean(error?.message,180))})
    spawned.on('exit',(code,signal)=>{
      if(child!==spawned)return
      const wasExpected=expectedStop;ready=false;child=null;port=0;apiKey='';baseUrl=''
      if(!wasExpected)touch({phase:'error',lastError:`llama-server 已退出（${code??signal??'unknown'}）：${clean(lastStderr,180)}`})
    })
    try{
      await waitForServer(signal)
      if(signal?.aborted)throw Object.assign(new Error('安装已取消'),{name:'AbortError'})
      const check=await embedBatch(['DSH 本地语义记忆运行时自检'])
      if(check[0]?.length!==MODEL.dimension)throw Error('模型自检向量维度不正确')
      ready=true;touch({phase:'ready',asset:'',downloadedBytes:MODEL.bytes,totalBytes:MODEL.bytes,percent:100,lastError:''})
      return status()
    }catch(error){await stopAndWait().catch(()=>{});throw error}
  }
  async function install(){
    if(installPromise)return installPromise
    installAbort=new AbortController()
    installPromise=(async()=>{
      try{
        touch({phase:'preparing',asset:'',downloadedBytes:0,totalBytes:0,percent:0,lastError:''})
        await safeRoot();await ensureRuntime({signal:installAbort.signal});if(installAbort.signal.aborted)throw Object.assign(new Error('安装已取消'),{name:'AbortError'});await ensureModel({signal:installAbort.signal})
        if(installAbort.signal.aborted)throw Object.assign(new Error('安装已取消'),{name:'AbortError'})
        touch({phase:'starting-runtime',asset:'',percent:100})
        await start({signal:installAbort.signal});return status()
      }catch(error){
        const cancelled=error?.name==='AbortError'||installAbort?.signal.aborted
        touch({phase:cancelled?'cancelled':'error',lastError:cancelled?'安装已取消；已下载部分文件会保留以便下次续传':clean(error?.message||error,220)})
        throw error
      }finally{installPromise=null;installAbort=null}
    })()
    return installPromise
  }
  function cancelInstall(){if(!installAbort)return false;installAbort.abort();return true}
  function stop(){
    expectedStop=true;ready=false
    const current=child;child=null;port=0;apiKey='';baseUrl=''
    try{current?.kill('SIGTERM')}catch{}
    touch({phase:'stopped'})
    return true
  }
  async function stopAndWait({timeoutMs=8000}={}){
    const current=child
    if(!current){stop();return true}
    const exited=new Promise(resolve=>{
      if(current.exitCode!==null||current.signalCode!==null)return resolve(true)
      current.once('exit',()=>resolve(true));current.once('error',()=>resolve(true))
    })
    stop()
    await Promise.race([exited,delay(timeoutMs)])
    if(current.exitCode===null&&current.signalCode===null){try{current.kill('SIGKILL')}catch{};await Promise.race([exited,delay(2000)])}
    if(current.exitCode===null&&current.signalCode===null)throw Error('llama-server 未能停止；为避免删除正在使用的模型文件，本次删除已中止')
    return true
  }
  async function importModel(stream,{contentLength=0}={}){
    if(installPromise)throw Error('模型安装或下载正在进行，请等待完成')
    await safeRoot();await stopAndWait()
    const temp=modelPath+'.import.part';await rm(temp,{force:true})
    const handle=await open(temp,'w',0o600);let size=0;const hash=createHash('sha256')
    try{
      for await(const chunk of stream){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>MODEL.bytes)throw Error('导入模型超过预期大小');hash.update(buffer);await writeChunk(handle,buffer);touch({phase:'importing-model',asset:MODEL.file,downloadedBytes:size,totalBytes:MODEL.bytes,percent:Math.min(99,Math.floor(size/MODEL.bytes*100))})}
      await handle.sync()
    }catch(error){await handle.close().catch(()=>{});await rm(temp,{force:true});throw error}
    await handle.close()
    const digest=hash.digest('hex')
    if(size!==MODEL.bytes||contentLength&&Number(contentLength)!==size||digest!==MODEL.sha256){await rm(temp,{force:true});touch({phase:'error',lastError:'导入模型大小或 SHA-256 不匹配，文件已拒绝'});throw Error('模型文件校验失败：必须是官方 Qwen3-Embedding-0.6B Q8_0 文件')}
    await rm(modelPath,{force:true});await rename(temp,modelPath)
    touch({phase:'model-imported',asset:MODEL.file,downloadedBytes:size,totalBytes:size,percent:100,lastError:''})
    return {ok:true,bytes:size,sha256:digest}
  }
  async function removeAssets(){
    await safeRoot();await stopAndWait();cancelInstall();if(installPromise)await installPromise.catch(()=>{});await rm(modelPath,{force:true});await rm(modelPath+'.part',{force:true});await rm(modelPath+'.import.part',{force:true});await rm(runtimeDir,{recursive:true,force:true});await rm(runtimeArchive,{force:true});runtimeBinary='';runtimeSource='';touch({phase:'missing',asset:'',downloadedBytes:0,totalBytes:0,percent:0,lastError:''});return true
  }
  async function embedDocuments(texts){if(!ready)throw Error('本地 Embedding 模型未就绪');return embedBatch(texts)}
  async function embedQuery(text){
    const query=`Instruct: ${QUERY_INSTRUCTION}\nQuery:${clean(text,1800)}`
    const rows=await embedDocuments([query]);return rows[0]
  }
  function status(){
    return {ok:true,model:{id:MODEL.id,file:MODEL.file,bytes:MODEL.bytes,dimension:MODEL.dimension,license:MODEL.license,installed:false},runtime:{name:'llama.cpp',version:RUNTIME.version,release:RUNTIME.release,platform:platformKey(platform,arch),installed:Boolean(runtimeBinary),source:runtimeSource||'missing'},server:{running:Boolean(child&&child.exitCode===null),ready,host:ready?'127.0.0.1':'',port:ready?port:0},progress:{...progress},supported:Boolean(RUNTIME.assets[platformKey(platform,arch)])}
  }
  async function inspect(){
    if(!runtimeBinary)await loadInstalledRuntime()
    const value=status()
    value.model.installed=await existingFile(modelPath,MODEL.bytes)
    value.runtime.installed=Boolean(runtimeBinary)
    return value
  }
  return {install,start,stop,stopAndWait,cancelInstall,importModel,removeAssets,embedDocuments,embedQuery,status,inspect,paths:{root,modelPath,runtimeDir,bundledRuntimeDir},model:MODEL,runtime:RUNTIME}
}

export const __test={MODEL,RUNTIME,QUERY_INSTRUCTION,platformKey,runtimeAsset,validateArchiveNames,clean}
