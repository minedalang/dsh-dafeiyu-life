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
try:
    home=Path(sys.argv[1]).resolve(strict=True)
    target=Path(sys.argv[2]).resolve(strict=True)
    active=Path(os.environ['DSH_MEDIA_CACHE_HOME']).resolve(strict=True)
    if os.path.normcase(str(active)) != os.path.normcase(str(target)):
        raise RuntimeError('route_mismatch')
    if os.path.normcase(str(Path(os.environ['BILI_DUTY_HOME']).resolve(strict=True))) != os.path.normcase(str(home)):
        raise RuntimeError('home_mismatch')
    sys.path.insert(0,str(home))
    from PIL import Image
    from preview_vision import _save_vision_cache
    cache_dir=target/'vision-cache'
    had_cache_dir=cache_dir.exists()
    filename=cache_dir/('.dafeiyu-runtime-route-'+uuid.uuid4().hex+'.json')
    try:
        payload={'version':1,'routeProbe':True}
        error=_save_vision_cache(filename,payload)
        if error is not None:
            raise RuntimeError('cache_write_failed')
        if json.loads(filename.read_text(encoding='utf8')) != payload:
            raise RuntimeError('cache_read_failed')
    finally:
        filename.unlink(missing_ok=True)
        if not had_cache_dir:
            try: cache_dir.rmdir()  # only if empty; never delete user files
            except OSError: pass
    print('VISION_ROUTE_PROBE:ok')
except Exception as exc:
    code=str(exc)
    if code not in ('route_mismatch','home_mismatch','cache_write_failed','cache_read_failed'):
        code='python_import_or_runtime_failed'
    print('VISION_ROUTE_PROBE:'+code)
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
})
const failed=code=>({ok:false,code,reason:FAILURE_REASONS[code]||FAILURE_REASONS.python_process_failed})
export function verifyVisionPythonCacheRoute({root,python,env=process.env,timeoutMs=12000,spawnImpl=spawn}={}){
 const status=storageLayoutStatus(root)
 const media=status.domains.media
 if(!media.configured)return Promise.resolve(failed('media_route_mismatch'))
 const target=storageDomainRoot(root,'media')
 if(!python||!existsSync(join(root,'preview_vision.py')))return Promise.resolve(failed('python_unavailable'))
 const samePath=(a,b)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b)
 if(typeof env.DSH_MEDIA_CACHE_HOME!=='string'||!samePath(env.DSH_MEDIA_CACHE_HOME,target)||
    typeof env.BILI_DUTY_HOME!=='string'||!samePath(env.BILI_DUTY_HOME,root))
  return Promise.resolve(failed('media_route_mismatch'))
 return new Promise(done=>{
  let child,finished=false,output='',timer
  const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);done(result)}
  try{
   child=spawnImpl(python,['-I','-c',VISION_CACHE_PYTHON_PROBE,root,target],{
    cwd:root,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'},
    shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']})
  }catch{return finish(failed('python_process_failed'))}
  timer=setTimeout(()=>{try{child.kill()}catch{}finish(failed('python_timeout'))},Math.min(30000,Math.max(1000,timeoutMs)))
  child.stdout?.on('data',chunk=>{output=(output+String(chunk)).slice(-400)})
  child.on('error',()=>finish(failed('python_process_failed')))
  child.on('close',code=>{
   if(code===0&&output.includes('VISION_ROUTE_PROBE:ok'))return finish({ok:true,code:'verified',reason:'真实 Python 预览模块已从迁移目标写入、回读并删除测试缓存（未访问视频或模型）'})
   const match=/VISION_ROUTE_PROBE:([a-z_]+)/.exec(output)
   return finish(failed(match&&FAILURE_REASONS[match[1]]?match[1]:'python_process_failed'))
  })
 })
}
