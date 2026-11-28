/**
 * Real, bounded, read-only runtime probes for a relocated model group.
 * No download, installation, video browsing, account access or deletion.
 * A returned image answer always requires owner review before cleanup approval.
 */
import {existsSync,lstatSync,readdirSync,realpathSync} from 'node:fs'
import {join,resolve,relative,sep,isAbsolute} from 'node:path'
import {spawn} from 'node:child_process'
import {storageDataPath,storageLayoutStatus} from './storage-layout.mjs'
import {largeDataStatus} from './storage-large-data-v2.mjs'
import {probeVisionCacheAccess} from './storage-vision-cache-access.mjs'
import {verifyVisionPythonCacheRoute} from './storage-vision-runtime-check.mjs'

const within=(parent,child)=>{const r=relative(parent,child);return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)}
const safeError=e=>String(e?.message||e||'未知错误').replace(/[\x00-\x1f]/g,' ').slice(0,210)
const PYTHON_CHECK=`import json,os,sys\nfrom faster_whisper import WhisperModel\nimport numpy as np\nm=WhisperModel(sys.argv[1],device='cpu',compute_type='int8',local_files_only=True)\ns,i=m.transcribe(np.zeros(16000,dtype=np.float32),language='zh',beam_size=1,vad_filter=False)\nlist(s)\nprint(json.dumps({'loaded':True,'inferred':True}))\n`
export function findLocalWhisperModel({root,model,customPath=''}){
 const v2=largeDataStatus(root),layout=storageLayoutStatus(root),whisper=layout.domains.whisper
 if(!v2.configured&&!whisper.configured)throw Error('Whisper 分区尚未迁移')
 const chosen=String(customPath||'').trim()
 if(chosen){
  const p=resolve(chosen)
  if(!within(v2.configured?v2.whisperHome:whisper.root,p))throw Error('当前 Whisper 自定义路径不在已迁移目标盘；无法证明运行时使用了迁移模型')
  if(!existsSync(join(p,'model.bin'))||!existsSync(join(p,'config.json')))throw Error('自定义 Whisper 模型文件缺失')
  return p
 }
 if(!/^(tiny|base|small|medium|large-v3)$/.test(String(model)))throw Error('Whisper 模型配置不在允许范围')
 const snapshots=join(v2.configured?v2.whisperHome:storageDataPath(root,'.hf-cache'),'hub',`models--Systran--faster-whisper-${model}`,'snapshots')
 if(!existsSync(snapshots)||lstatSync(snapshots).isSymbolicLink())throw Error('迁移目标缺少选定 Whisper 模型快照')
 for(const name of readdirSync(snapshots).slice(0,32)){
  const dir=join(snapshots,name)
  if(!lstatSync(dir).isDirectory()||lstatSync(dir).isSymbolicLink()||!within(v2.configured?v2.whisperHome:whisper.root,realpathSync(dir)))continue
  if(existsSync(join(dir,'model.bin'))&&existsSync(join(dir,'config.json')))return dir
 }
 throw Error('未找到完整的 Whisper 本地模型；不会联网重新下载')
}
export function spawnPythonProbe({python,modelDir,env=process.env,timeoutMs=150000,spawnImpl=spawn}={}){
 return new Promise(resolve=>{
  if(!python||!existsSync(python))return resolve({ok:false,reason:'Whisper Python 环境不存在；本次不重建依赖'})
  let child,done=false,output='',errors=''
  const finish=r=>{if(!done){done=true;clearTimeout(timer);resolve(r)}}
  let timer
  try{child=spawnImpl(python,['-I','-c',PYTHON_CHECK,modelDir],{
    shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TRANSFORMERS_OFFLINE:'1'},
  })}catch(e){return finish({ok:false,reason:safeError(e)})}
  timer=setTimeout(()=>{try{child.kill()}catch{}finish({ok:false,reason:'Whisper 本地加载与推理超时'})},timeoutMs)
  child.stdout?.on('data',b=>{output=(output+String(b)).slice(-1000)})
  child.stderr?.on('data',b=>{errors=(errors+String(b)).slice(-1000)})
  child.on('error',e=>finish({ok:false,reason:safeError(e)}))
  child.on('close',code=>finish(code===0&&output.includes('"inferred": true')
    ?{ok:true,reason:'本地模型已实际加载，并完成 1 秒无语音样本推理（不联网）'}
    :{ok:false,reason:'Whisper 本地推理失败（退出码 '+String(code)+'）：'+safeError(errors)}))
 })
}
export async function verifyRelocatedModelRuntime({root,asrPython,asrModel='small',asrModelPath='',embeddingRuntime,
 visionEnabled=false,visionMode='independent_dsh',visionDshReview,visionLocalModels,visionLocalModel='',visionThinking='off',
 pythonProbe=spawnPythonProbe,visionCacheProbe=probeVisionCacheAccess,
 visionPython='',visionPythonEnv=process.env,visionPipelineProbe=verifyVisionPythonCacheRoute}={}){
 const status=storageLayoutStatus(root)
 const v2=largeDataStatus(root),paths=['whisper','embedding','media'].map(x=>status.domains[x])
 if(!v2.configured&&(paths.some(x=>!x.configured)||new Set(paths.map(x=>x.root)).size!==1))
  throw Error('三个模型分区未统一生效在同一个迁移目标，拒绝验证')
 const checks={whisper:{ok:false},embedding:{ok:false},vision:{ok:false},visionCache:{ok:false},visionPipeline:{ok:false}}
 try{visionCacheProbe(storageDataPath(root,'vision-cache'));checks.visionCache={ok:true,reason:'生效视觉缓存已通过创建、原子替换和清理检查'}}
 catch(e){checks.visionCache={ok:false,reason:'视觉缓存写入检查失败，禁止清理旧副本（'+(e.reason||'WRITE_FAILED')+'）'}}
 // The JS file probe alone is insufficient: the production video reader is a
 // different Python process with its own environment and cache writer.
 if(!visionEnabled){
  checks.visionPipeline={ok:true,notApplicable:true,reason:'视觉识别未开启；视频 Python 运行链路无需验收'}
 }else{
  try{checks.visionPipeline=await visionPipelineProbe({root,python:visionPython,env:visionPythonEnv})}
  catch{checks.visionPipeline={ok:false,code:'python_process_failed',reason:'视频 Python 路径实测无法完成'}}
 }
 try{
  const modelDir=findLocalWhisperModel({root,model:asrModel,customPath:asrModelPath})
  checks.whisper=await pythonProbe({python:asrPython,modelDir,
    env:{...process.env,HF_HOME:storageDataPath(root,'.hf-cache')}})
 }catch(e){checks.whisper={ok:false,reason:safeError(e)}}
 let embeddingStarted=false
 try{
  if(!embeddingRuntime)throw Error('Embedding 运行时未接入')
  // A healthy vector from an old cached process is not proof of the new disk.
  const expectedEmbeddingRoot=storageDataPath(root,'embedding-runtime')
  const expectedModelRoot=v2.configured?v2.embeddingModelDir:expectedEmbeddingRoot
  if(!embeddingRuntime.paths?.root||resolve(embeddingRuntime.paths.root)!==resolve(expectedEmbeddingRoot)||
   resolve(embeddingRuntime.paths.modelRoot||embeddingRuntime.paths.root)!==resolve(expectedModelRoot))
   throw Error('Embedding 运行时仍指向旧位置；请重启 DSH 后再验证')
  const previouslyReady=embeddingRuntime.status().server.ready===true
  if(!previouslyReady){await embeddingRuntime.start();embeddingStarted=true}
  const vector=await embeddingRuntime.embedQuery('DSH 数据迁移后的语义检索自检')
  if(vector?.length!==1024||Array.from(vector).some(n=>!Number.isFinite(n)))throw Error('Embedding 推理向量无效')
  checks.embedding={ok:true,reason:'已从迁移目标实际启动或复用 Embedding，并得到 1024 维有效向量'}
 }catch(e){checks.embedding={ok:false,reason:safeError(e)}}
 finally{if(embeddingStarted)await embeddingRuntime.stopAndWait().catch(()=>{})}
 if(!checks.visionPipeline.ok){
  checks.vision={ok:false,reason:'视频 Python 迁移路径未通过实测，不将单独的模型识图视为整条视频观察链路正常'}
 }else if(!visionEnabled){
  checks.vision={ok:true,notApplicable:true,reason:'视觉识别未开启；仅校验迁移后的视觉缓存文件，不冒充图片识别成功'}
 }else if(visionMode==='independent_dsh'){
  try{const r=await visionDshReview.verify();checks.vision={ok:false,pendingReview:r.awaitingReview===true,reviewId:r.reviewId,
    mode:'independent_dsh',reason:'已完成真实图片识别；需本人检查识别内容后确认'} }
  catch(e){checks.vision={ok:false,reason:safeError(e)}}
 }else if(visionMode==='independent_local'){
  try{const r=await visionLocalModels.verifyId(visionLocalModel,{thinkingMode:visionThinking});checks.vision={ok:false,
    pendingReview:r.awaitingReview===true,reviewId:r.reviewId,mode:'independent_local',model:visionLocalModel,
    reason:'已完成 Ollama 图片识别；需本人检查识别内容后确认'} }
  catch(e){checks.vision={ok:false,reason:safeError(e)}}
 }else if(visionMode==='independent_native'){checks.vision={ok:false,mode:'independent_native',reason:'内置视觉迁移后专项验收尚未接线；保留旧副本，请在 AI 模型页实测'}
 }else checks.vision={ok:false,reason:'未知视觉运行模式；拒绝以未验证状态清理旧副本'}
 return {ok:true,checks,ready:Object.values(checks).every(x=>x.ok===true),target:v2.configured?v2.target:paths[0].root}
}
