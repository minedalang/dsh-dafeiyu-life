/** Diagnostic categories only: raw launch paths, executable names and account
 * identifiers never enter the life trace. Distinguish intent from execution. */
const STABLE=new Set(['video-busy','video-launch-cooldown','account-not-ready',
  'disabled','life-account-changed','video-technical-backoff','launcher-unavailable',
  'overlay-invalid','headless-preflight-failed','spawn-failed','adapter-error'])
export function videoLaunchFailureReason(outcome={}){
  if(outcome?.started===true)return ''
  if(STABLE.has(outcome?.reason))return outcome.reason
  if(outcome?.busy===true)return 'video-busy'
  if(outcome?.paused===true||outcome?.blocked===true)return 'disabled'
  const msg=String(outcome?.error||'')
  if(/找不到\s*dsh|dsh.*未找到|not found.*dsh/i.test(msg))return 'launcher-unavailable'
  if(/overlay|隔离配置|隔离补丁/i.test(msg))return 'overlay-invalid'
  if(/安全隔离校验|headless.*校验/i.test(msg))return 'headless-preflight-failed'
  if(/spawn|PID|子进程|ENOENT|EACCES/i.test(msg))return 'spawn-failed'
  return 'video-delegation-not-started'
}
