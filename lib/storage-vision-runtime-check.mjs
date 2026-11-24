/**
 * Offline, bounded check of the *same Python image/cache writer* used by the
 * video MCP after moving modelData. No Bilibili or Ollama request is issued.
 * Only a random probe-owned JSON file in the effective cache is modified.
 */
import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {storageDomainRoot,storageLayoutStatus} from './storage-layout.mjs'

// A fixed script, never constructed from user paths or model output. `-I`
// ignores ambient PYTHONPATH; only the verified plugin runtime is importable.
export const VISION_CACHE_PYTHON_PROBE = String.raw`
import json, os, sys, uuid
from pathlib import Path
def stage(name):
    print('VISION_ROUTE_STAGE:'+name, flush=True)
stage('python_started')
try:
    home=Path(sys.argv[1]).resolve(strict=True)
    target=Path(sys.argv[2]).resolve(strict=True)
    active=Path(os.environ['DSH_MEDIA_CACHE_HOME']).resolve(strict=True)
    if os.path.normcase(str(active)) != os.path.normcase(str(target)):
        raise RuntimeError('route_mismatch')
    if os.path.normcase(str(Path(os.environ['BILI_DUTY_HOME']).resolve(strict=True))) != os.path.normcase(str(home)):
        raise RuntimeError('home_mismatch')
    stage('routes_validated')
    sys.path.insert(0,str(home))
    from PIL import Image
    stage('pillow_imported')
    from preview_vision import _save_vision_cache
    stage('preview_imported')
    cache_dir=target/'vision-cache'
    stage('cache_dir_stat')
    had_cache_dir=cache_dir.exists()
    stage('cache_dir_checked')
    filename=cache_dir/('.dafeiyu-runtime-route-'+uuid.uuid4().hex+'.json')
    stage('cache_name_ready')
    try:
        payload={'version':1,'routeProbe':True}
        stage('cache_write_start')
        error=_save_vision_cache(filename,payload,progress=stage)
        if error is not None:
            raise RuntimeError(error)
        stage('cache_written')
        if json.loads(filename.read_text(encoding='utf8')) != payload:
            raise RuntimeError('cache_read_failed')
        stage('cache_read')
    finally:
        stage('probe_cleanup_start')
        try: filename.unlink(missing_ok=True)
        except OSError: raise RuntimeError('cache_cleanup_failed')
        if not had_cache_dir:
            try: cache_dir.rmdir()  # only if empty; never delete user files
            except OSError: pass
    stage('cleanup_done')
    print('VISION_ROUTE_PROBE:ok', flush=True)
except Exception as exc:
    code=str(exc)
    if code not in ('route_mismatch','home_mismatch','cache_write_failed','cache_read_failed',
                    'cache_cleanup_failed','vision_cache_permission_denied',
                    'vision_cache_disk_full','vision_cache_write_failed'):
        code='python_import_or_runtime_failed'
    print('VISION_ROUTE_PROBE:'+code, flush=True)
    sys.exit(3)
`
const FAILURE_REASONS=Object.freeze({
 python_unavailable:'视频识图 Python 未就绪，无法验证迁移后运行链路',
 media_route_mismatch:'视频 Python 子进程使用的缓存位置与生效存储分区不一致',
 python_timeout:'视频 Python 缓存实际运行探针超时',
 python_process_failed:'视频 Python 子进程启动或执行失败',
 python_import_or_runtime_failed:'视频 Python 无法导入真实预览识图模块或图片依赖',
 route_mismatch:'视频 Python 收到的缓存位置与分区配置不一致',
 home_mismatch:'视频 Python 收到的数据根目录不一致',
 cache_write_failed:'视频 Python 实际缓存写入失败',
 cache_read_failed:'视频 Python 实际缓存回读不一致',
 cache_cleanup_failed:'视频 Python 测试缓存无法安全清理',
 vision_cache_permission_denied:'视频 Python 缓存写入遭到权限拒绝',
 vision_cache_disk_full:'视频 Python 缓存写入遇到磁盘空间不足',
 vision_cache_write_failed:'视频 Python 缓存写入或原子替换失败',
})
const PROBE_STAGES=Object.freeze({
 python_launch:'Python 进程启动',python_started:'Python 已启动，准备解析路径',
 routes_validated:'路径校验已完成，准备加载 Pillow',
 pillow_imported:'图片依赖已加载，准备导入预览模块',
 preview_imported:'预览模块已导入，准备检查缓存目录',
 cache_dir_stat:'正在检查目标缓存目录是否存在',
 cache_dir_checked:'目标缓存目录状态已读取，准备生成测试文件名',
 cache_name_ready:'测试文件名已生成，准备调用缓存写入函数',
 cache_write_start:'已调用缓存写入函数，准备创建目录',
 writer_dir_create:'正在创建或确认缓存目录',
 writer_dir_ready:'缓存目录已就绪，准备打开临时文件',
 writer_temp_open:'正在创建 Python 临时文件',
 writer_temp_opened:'Python 临时文件已打开，准备写入 JSON',
 writer_json_written:'JSON 已写入，准备关闭临时文件',
 writer_temp_closed:'临时文件已关闭，准备检查目标文件类型',
 writer_target_stat:'正在检查目标文件类型与链接状态',
 writer_replace_start:'准备执行 Python 原子替换',
 writer_replace_retry:'原子替换遇到权限错误，检查是否可安全重试',
 writer_replace_done:'Python 原子替换已完成，准备清理暂存文件',
 writer_cleanup_start:'正在清理 Python 临时文件',
 writer_cleanup_done:'Python 临时文件已清理',
 probe_cleanup_start:'正在清理专用测试缓存文件',
 cache_written:'缓存已写入，准备回读',cache_read:'缓存已回读，准备清理',
 cleanup_done:'缓存清理已完成',
})
// Only fixed stage identifiers and elapsed time are exposed; no file paths,
// Python tracebacks, model text or environment contents reach the UI.
const failed=(code,{stage='',elapsedMs=0}={})=>({
 ok:false,code,
 reason:(FAILURE_REASONS[code]||FAILURE_REASONS.python_process_failed)+
  (code==='python_timeout'?'（最后阶段：'+(PROBE_STAGES[stage]||'未知')+'；约 '+Math.round(elapsedMs/1000)+' 秒；不代表迁移目录错误）':''),
 ...(code==='python_timeout'?{stage:PROBE_STAGES[stage]?stage:'unknown',elapsedMs:Math.max(0,Math.round(elapsedMs))}:{})
})
export function verifyVisionPythonCacheRoute({root,python,env=process.env,timeoutMs=45000,spawnImpl=spawn}={}){
 const status=storageLayoutStatus(root)
 const media=status.domains.media
 // V1 required a relocated media partition. V2 intentionally RETIRES that
 // partition and keeps Python-writable media in its MIC-compatible core root.
 // Do not reject the valid V2 core route before the actual Python probe runs.
 if(!media.configured&&media.mode!=='v2-retired')return Promise.resolve(failed('media_route_mismatch'))
 const target=storageDomainRoot(root,'media')
 if(!python||!existsSync(join(root,'preview_vision.py')))return Promise.resolve(failed('python_unavailable'))
 const samePath=(a,b)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b)
 if(typeof env.DSH_MEDIA_CACHE_HOME!=='string'||!samePath(env.DSH_MEDIA_CACHE_HOME,target)||
    typeof env.BILI_DUTY_HOME!=='string'||!samePath(env.BILI_DUTY_HOME,root))
  return Promise.resolve(failed('media_route_mismatch'))
 return new Promise(done=>{
  let child,finished=false,output='',lastStage='python_launch',timer
  const started=Date.now()
  const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);done(result)}
  try{
   child=spawnImpl(python,['-I','-c',VISION_CACHE_PYTHON_PROBE,root,target],{
    cwd:root,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},
    shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']})
  }catch{return finish(failed('python_process_failed'))}
  timer=setTimeout(()=>{
   try{child.kill()}catch{}
   finish(failed('python_timeout',{stage:lastStage,elapsedMs:Date.now()-started}))
  },Math.min(60000,Math.max(1000,timeoutMs)))
  // Streaming progress distinguishes slow Python startup/import from a broken
  // relocated cache writer; output is bounded and consists of fixed tokens.
  let pending=''
  child.stdout?.on('data',chunk=>{
   const parts=(pending+String(chunk)).split(/\r?\n/)
   pending=parts.pop().slice(-80)
   for(const line of parts){
    const match=/^VISION_ROUTE_STAGE:([a-z_]+)$/.exec(line)
    if(match&&PROBE_STAGES[match[1]])lastStage=match[1]
    if(line.startsWith('VISION_ROUTE_PROBE:'))output=line.slice(0,100)
   }
  })
  child.on('error',()=>finish(failed('python_process_failed')))
  child.on('close',code=>{
   if(code===0&&(output.includes('VISION_ROUTE_PROBE:ok')||pending==='VISION_ROUTE_PROBE:ok'))return finish({ok:true,code:'verified',reason:'真实 Python 预览模块已在当前生效缓存目录写入、回读并删除测试缓存（未访问视频或模型）'})
   const match=/VISION_ROUTE_PROBE:([a-z_]+)/.exec(output||pending)
   return finish(failed(match&&FAILURE_REASONS[match[1]]?match[1]:'python_process_failed'))
  })
 })
}
