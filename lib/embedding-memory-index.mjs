import {createHash,randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile,rename,rm,lstat,chmod} from 'node:fs/promises'
import {join,basename} from 'node:path'

const clean=(v,n=1200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const hashText=text=>createHash('sha256').update(clean(text,5000)).digest('hex')
const safeId=id=>typeof id==='string'&&id.length>0&&id.length<=240&&!/[\u0000-\u001f\u007f]/.test(id)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const DIMENSION=1024,MAX_ENTRIES=10000,BATCH_SIZE=24
function normalizeRows(rows=[]){
 const map=new Map()
 for(const row of Array.isArray(rows)?rows:[]){
  const id=String(row?.id||''),text=clean(row?.text,5000)
  if(!safeId(id)||!text)continue
  map.set(id,{id,text,hash:hashText(text)})
  if(map.size>=MAX_ENTRIES)break
 }
 return [...map.values()]
}
function cosine(a,b){
 if(!a||!b||a.length!==b.length)return -1
 let dot=0,aa=0,bb=0
 for(let i=0;i<a.length;i++){const x=Number(a[i]),y=Number(b[i]);dot+=x*y;aa+=x*x;bb+=y*y}
 if(!aa||!bb)return -1
 return dot/Math.sqrt(aa*bb)
}

export function createEmbeddingMemoryIndex({dataDir,provider,modelId='Qwen/Qwen3-Embedding-0.6B-GGUF@370f27d7550e0def9b39c1f16d3fbaa13aa67728',dimension=DIMENSION,logger=console,now=Date.now}={}){
 if(!dataDir||!provider||typeof provider.embedDocuments!=='function'||typeof provider.embedQuery!=='function')throw TypeError('Embedding memory index dependencies are incomplete')
 const root=join(dataDir,'embedding-memory-index'),manifestPath=join(root,'manifest.json')
 let vectors=new Map(),ready=false,phase='missing',total=0,processed=0,lastIndexedAt='',lastError='',buildPromise=null,updatePromise=null,mutationQueue=Promise.resolve()
 const queryCache=new Map()
 const progress=()=>({ready,phase,indexed:vectors.size,total,processed,percent:total?Math.min(100,Math.floor(processed/total*100)):ready?100:0,lastIndexedAt,lastError,modelId,dimension})
 const enqueueMutation=fn=>{const task=mutationQueue.then(fn,fn);mutationQueue=task.catch(()=>{});return task}
 async function ensureDir(){await mkdir(root,{recursive:true,mode:0o700});const info=await lstat(root);if(info.isSymbolicLink()||!info.isDirectory())throw Error('语义索引目录不是安全的普通目录');try{await chmod(root,0o700)}catch{}}
 async function load(){
  try{
   await ensureDir();const manifestInfo=await lstat(manifestPath);if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink())throw Error('语义索引清单不是安全的普通文件');const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
   if(manifest?.schema!==1||manifest.modelId!==modelId||manifest.dimension!==dimension||!Array.isArray(manifest.entries)||manifest.entries.length>MAX_ENTRIES||!/^vectors-[a-f0-9-]{20,50}\.f32$/.test(String(manifest.vectorFile||'')))throw Error('语义索引清单不兼容')
   const vectorPath=join(root,manifest.vectorFile),info=await lstat(vectorPath)
   if(!info.isFile()||info.isSymbolicLink()||info.size!==manifest.entries.length*dimension*4)throw Error('语义索引向量文件大小不匹配')
   const buffer=await readFile(vectorPath),next=new Map(),seen=new Set()
   for(let i=0;i<manifest.entries.length;i++){
    const item=manifest.entries[i]
    if(!safeId(item?.id)||!/^[a-f0-9]{64}$/.test(String(item?.hash||''))||seen.has(item.id))throw Error('语义索引元数据无效')
    seen.add(item.id);const vector=new Float32Array(dimension),offset=i*dimension*4
    for(let j=0;j<dimension;j++){const value=buffer.readFloatLE(offset+j*4);if(!Number.isFinite(value))throw Error('语义索引包含无效向量');vector[j]=value}
    next.set(item.id,{hash:item.hash,vector})
   }
   vectors=next;ready=true;phase='ready';lastIndexedAt=String(manifest.updatedAt||'');lastError='';processed=total=vectors.size
   return true
  }catch(error){
   vectors=new Map();ready=false;phase='missing';lastError=String(error?.message||error).slice(0,180)
   return false
  }
 }
 async function save(next){
  await ensureDir()
  const generation=randomUUID(),vectorFile=`vectors-${generation}.f32`,vectorTemp=join(root,vectorFile+'.part'),vectorFinal=join(root,vectorFile)
  const entries=[...next.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
  const buffer=Buffer.allocUnsafe(entries.length*dimension*4)
  const meta=[]
  for(let i=0;i<entries.length;i++){
   const [id,item]=entries[i]
   if(item.vector.length!==dimension)throw Error('索引向量维度变化，拒绝保存')
   meta.push({id,hash:item.hash})
   for(let j=0;j<dimension;j++)buffer.writeFloatLE(Number(item.vector[j]),(i*dimension+j)*4)
  }
  await writeFile(vectorTemp,buffer,{mode:0o600});await rename(vectorTemp,vectorFinal)
  const previous=await readFile(manifestPath,'utf8').then(x=>JSON.parse(x).vectorFile).catch(()=> '')
  const manifestTemp=manifestPath+'.part'
  await writeFile(manifestTemp,JSON.stringify({schema:1,modelId,dimension,vectorFile,entries:meta,updatedAt:new Date(now()).toISOString()}),{mode:0o600})
  await rename(manifestTemp,manifestPath)
  if(typeof previous==='string'&&/^vectors-[a-f0-9-]{20,50}\.f32$/.test(previous)&&previous!==vectorFile)await rm(join(root,basename(previous)),{force:true}).catch(()=>{})
 }
 async function embedRows(rows,target){
  for(let offset=0;offset<rows.length;offset+=BATCH_SIZE){
   const batch=rows.slice(offset,offset+BATCH_SIZE),result=await provider.embedDocuments(batch.map(x=>x.text))
   if(!Array.isArray(result)||result.length!==batch.length)throw Error('Embedding 文档向量数量不匹配')
   for(let i=0;i<batch.length;i++){
    const vector=result[i]
    if(!vector||vector.length!==dimension||Array.from(vector).some(x=>!Number.isFinite(Number(x))))throw Error('Embedding 文档向量维度无效')
    target.set(batch[i].id,{hash:batch[i].hash,vector:Float32Array.from(vector,Number)})
   }
   processed=Math.min(total,processed+batch.length)
  }
 }
 async function sync(corpus=[]){
  return enqueueMutation(async()=>{
   const rows=normalizeRows(corpus),known=new Set(rows.map(x=>x.id)),retained=[...vectors.entries()].filter(([id])=>known.has(id)),removed=Math.max(0,vectors.size-retained.length),next=new Map(retained)
   const pending=rows.filter(row=>next.get(row.id)?.hash!==row.hash)
   total=rows.length;processed=rows.length-pending.length;phase='syncing';lastError=''
   try{
    await embedRows(pending,next);await save(next);vectors=next;ready=true;phase='ready';lastIndexedAt=new Date(now()).toISOString();lastError='';queryCache.clear()
    return {ok:true,indexed:vectors.size,embedded:pending.length,removed}
   }catch(error){phase='error';lastError=String(error?.message||error).slice(0,180);logger.warn?.('本地语义索引同步失败：'+lastError);return {ok:false,error:lastError,indexed:vectors.size}}
  })
 }
 async function rebuild(corpus=[]){
  if(buildPromise)return buildPromise
  buildPromise=enqueueMutation(async()=>{
   const rows=normalizeRows(corpus),next=new Map();ready=false;phase='indexing';total=rows.length;processed=0;lastError=''
   try{
    await embedRows(rows,next);await save(next);vectors=next;ready=true;phase='ready';lastIndexedAt=new Date(now()).toISOString();lastError='';queryCache.clear();return {ok:true,indexed:vectors.size}
   }catch(error){phase='error';lastError=String(error?.message||error).slice(0,180);logger.warn?.('本地语义索引建立失败：'+lastError);return {ok:false,error:lastError,indexed:vectors.size}}
   finally{buildPromise=null}
  })
  return buildPromise
 }
 async function upsert(rows=[]){
  return enqueueMutation(async()=>{
   const normalized=normalizeRows(rows),pending=normalized.filter(row=>vectors.get(row.id)?.hash!==row.hash)
   if(!pending.length)return {ok:true,updated:0}
   const next=new Map(vectors);total=pending.length;processed=0;phase='updating'
   try{await embedRows(pending,next);await save(next);vectors=next;ready=true;phase='ready';lastIndexedAt=new Date(now()).toISOString();lastError='';queryCache.clear();return {ok:true,updated:pending.length}}
   catch(error){phase='error';lastError=String(error?.message||error).slice(0,180);logger.warn?.('本地语义索引增量更新失败：'+lastError);return {ok:false,error:lastError}}
  })
 }
 function scheduleUpsert(rows){
  if(updatePromise)return
  updatePromise=Promise.resolve().then(()=>upsert(rows)).finally(()=>{updatePromise=null})
 }
 async function search(query,candidates=[],{limit=12,minScore=.30,readOnly=false}={}){
  const q=clean(query,1800),rows=normalizeRows(candidates)
  if(!ready||!q||!rows.length)return {ready:false,reason:!ready?'index-not-ready':'empty-query',items:[]}
  const missing=rows.filter(row=>vectors.get(row.id)?.hash!==row.hash)
  if(missing.length&&!readOnly){
   if(missing.length<=8){const result=await upsert(missing);if(!result.ok)return {ready:false,reason:'index-update-failed',items:[]}}
   else{scheduleUpsert(missing);return {ready:false,reason:'index-incomplete',items:[]}}
  }
  let queryVector=queryCache.get(q)
  if(!queryVector){queryVector=await provider.embedQuery(q);if(!queryVector||queryVector.length!==dimension)throw Error('Embedding 查询向量维度无效');queryVector=Float32Array.from(queryVector,Number);queryCache.set(q,queryVector);if(queryCache.size>80)queryCache.delete(queryCache.keys().next().value)}
  const scores=[]
  for(const row of rows){const item=vectors.get(row.id);if(!item||item.hash!==row.hash)continue;const score=cosine(queryVector,item.vector);if(score>=minScore)scores.push({id:row.id,score})}
  scores.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
  return {ready:true,items:scores.slice(0,Math.max(1,Math.min(10000,Number(limit)||12))),indexed:vectors.size}
 }
 /**
  * Owner-only graph layout. Reuse ONLY current indexed vectors, verified with
  * the same text hash. No embedding or raw corpus ID is sent to the browser.
  * Centered PCA in 3D approximately preserves local semantic neighborhoods.
  * Never generates embeddings, syncs index or performs network requests.
  */
 function projectPoints(rows=[]){
  if(!ready||!Array.isArray(rows))return {mode:'structured',coordinates:{},matched:0}
  const matched=[],seen=new Set()
  for(const row of rows.slice(0,10000)){
   const opaque=String(row?.nodeId||''),key=String(row?.corpusId||'')
   if(!/^[a-f0-9]{16}$/.test(opaque)||seen.has(opaque))continue
   const entry=vectors.get(key)
   if(!entry||entry.hash!==hashText(row?.text||''))continue
   seen.add(opaque)
   const norm=Math.sqrt(entry.vector.reduce((sum,v)=>sum+v*v,0))
   if(norm<1e-8)continue
   matched.push({id:opaque,v:entry.vector,norm})
  }
  if(matched.length<3)return {mode:'structured',coordinates:{},matched:matched.length}
  // Fit the three PCA axes on an evenly sampled, bounded subset; project ALL
  // verified indexed nodes through the same axes. Complexity O(N*D) for
  // projection, not O(N^2) and not 10k full covariance matrices.
  const take=Math.min(120,matched.length),sample=Array.from({length:take},(_,i)=>matched[Math.min(matched.length-1,Math.floor((i+.5)*matched.length/take))])
  const d=dimension,mean=new Float64Array(d)
  for(const p of sample)for(let k=0;k<d;k++)mean[k]+=p.v[k]/p.norm/take
  const dot=(a,b)=>{let result=0;for(let k=0;k<d;k++)result+=a[k]*b[k];return result}
  const centered=sample.map(p=>Float64Array.from(p.v,(v,k)=>v/p.norm-mean[k]))
  const axes=[]
  for(let axis=0;axis<3;axis++){
   let direction=Float64Array.from({length:d},(_,k)=>Math.sin((k+1)*(axis+1)*.618)+Math.cos((k+3)*(axis+2)*.414))
   let valid=false
   for(let iter=0;iter<12;iter++){
    const next=new Float64Array(d)
    for(const p of centered){const score=dot(p,direction);for(let k=0;k<d;k++)next[k]+=score*p[k]}
    for(const previous of axes){const corr=dot(next,previous);for(let k=0;k<d;k++)next[k]-=corr*previous[k]}
    const norm=Math.sqrt(dot(next,next));if(norm<1e-9)break
    for(let k=0;k<d;k++)next[k]/=norm
    direction=next;valid=true
   }
   if(!valid)break
   axes.push(direction)
  }
  if(axes.length<2)return {mode:'structured',coordinates:{},matched:matched.length}
  const raw=matched.map(p=>axes.map(axis=>{let value=0;for(let k=0;k<d;k++)value+=(p.v[k]/p.norm-mean[k])*axis[k];return value}))
  // Robust scaling: a handful of semantic outliers should not collapse the
  // entire cloud into a tiny bright dot.
  const radii=raw.map(row=>Math.hypot(...row)).sort((a,b)=>a-b)
  const scale=Math.max(1e-8,radii[Math.min(radii.length-1,Math.floor(radii.length*.95))]/1.7)
  const coordinates={}
  matched.forEach((p,i)=>{coordinates[p.id]={x:Number(Math.max(-2.4,Math.min(2.4,raw[i][0]/scale)).toFixed(5)),y:Number(Math.max(-2.4,Math.min(2.4,(raw[i][1]||0)/scale)).toFixed(5)),z:Number(Math.max(-2.4,Math.min(2.4,(raw[i][2]||0)/scale)).toFixed(5))}})
  return {mode:'embedding-pca-3d',coordinates,matched:matched.length}
 }
 async function remove(ids=[]){
  const targets=new Set((Array.isArray(ids)?ids:[]).filter(safeId))
  if(!targets.size)return {ok:true,removed:0}
  return enqueueMutation(async()=>{
   const next=new Map(vectors);let removed=0
   for(const id of targets)if(next.delete(id))removed++
   if(removed){await save(next);vectors=next;lastIndexedAt=new Date(now()).toISOString();queryCache.clear()}
   return {ok:true,removed}
  })
 }
 async function clear(){
  return enqueueMutation(async()=>{
   await ensureDir();vectors=new Map();ready=false;phase='missing';total=processed=0;lastIndexedAt='';lastError='';queryCache.clear()
   for(const name of await import('node:fs/promises').then(x=>x.readdir(root)).catch(()=>[]))if(name==='manifest.json'||/^vectors-[a-f0-9-]{20,50}\.f32(?:\.part)?$/.test(name)||name==='manifest.json.part')await rm(join(root,name),{force:true})
   return true
  })
 }
 async function initialize(){return load()}
 return {initialize,sync,rebuild,upsert,search,projectPoints,remove,clear,status:progress}
}
export const __test={clean,hashText,normalizeRows,cosine,DIMENSION,MAX_ENTRIES,BATCH_SIZE}
