/** Effective tool contract always comes from the installed release.
 * Keep a user's old duty.md on disk; import only explicitly marked personal
 * preferences. An old whole-document charter cannot revive retired tooling. */
const START=/^##\s*(?:自定义偏好|个人偏好|我的选片偏好)\s*$/m
const STOP=/^##\s+/m
const UNSAFE=/(?:bili_[a-z_]+|status\s*=|挑中[·:：]|档位|每日.{0,6}上限|强制.{0,6}评论|权限|配额|shell|Python|[\/][^\s]+\.json)/i
export function effectiveVideoCharter(shipped,local){
  if(typeof shipped!=='string'||!shipped.includes('status="挑中"'))throw Error('video-charter-contract-unavailable')
  if(typeof local!=='string'||!local.trim()||local===shipped)return {text:shipped,customized:false,ignoredLegacy:false}
  const match=START.exec(local),lines=[]
  if(match){
    const tail=local.slice(match.index+match[0].length).split(/\r?\n/)
    for(const line of tail){if(STOP.test(line))break
      if(line.length>200||UNSAFE.test(line))continue
      lines.push(line)}
  }
  const custom=lines.join('\n').trim().slice(0,900)
  return {text:shipped+(custom?'\n\n## 用户自定义阅读口味（非权限）\n'+custom:''),
    customized:!!custom,ignoredLegacy:true}
}
