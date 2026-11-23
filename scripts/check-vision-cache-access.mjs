/** On-demand, zero-network verification of the CURRENT vision cache write path. */
import {storageDataPath} from '../lib/storage-layout.mjs'
import {validateLocalDataPath} from '../lib/storage-location.mjs'
import {probeVisionCacheAccess} from '../lib/storage-vision-cache-access.mjs'
const idx=process.argv.indexOf('--root')
if(idx<0||!process.argv[idx+1]){
 console.error('用法：node scripts/check-vision-cache-access.mjs --root <当前 bili-duty 根目录>')
 process.exitCode=2
}else{
 try{
  // Never create an arbitrary new bili-duty root due to a mistyped argument.
  const root=validateLocalDataPath(process.argv[idx+1])
  const dir=storageDataPath(root,'vision-cache')
  const result=probeVisionCacheAccess(dir)
  console.log(JSON.stringify({ok:true,cacheDirectory:dir,checks:result,
   note:'只操作独立的随机探针文件，不修改原有缓存、文件权限或模型数据'},null,2))
 }catch(error){
  console.error(JSON.stringify({ok:false,code:error.code||'VISION_CACHE_CHECK_FAILED',
   reason:error.reason||'UNVERIFIED',note:'未修改原有缓存；请停止清理旧副本，并检查目标目录权限与占用'},null,2))
  process.exitCode=1
 }
}
