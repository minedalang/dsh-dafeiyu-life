/** HTTP management identity is supplied by the DSH Host, never by headers or B站 login. */
export async function managementOwnerStatus(ctx, req, peer) {
  try {
    if (peer !== undefined) return peer?.principal?.kind === 'owner' ? 200 : 403
    // rc.5 has requestRejection + admit. alpha removed requestRejection and
    // passes a verified Peer to required routes. Never invoke alpha admit here:
    // it needs an additional injected service and missing Peer must fail closed.
    const connection = ctx.connection
    if (typeof connection?.requestRejection !== 'function' || typeof connection?.admit !== 'function') return 503
    const admission = await connection.admit(req)
    if (admission?.rejection === 401 || admission?.rejection === 403) return admission.rejection
    if (admission?.peer) return admission.peer.principal?.kind === 'owner' ? 200 : 403
    return 503
  } catch { return 503 }
}
export function managementAuthError(status) {
  return {ok:false,code:status===401?'host-auth-required':status===403?'host-owner-required':'host-auth-unavailable',
    error:status===401?'DSH 宿主尚未登录，请从已登录的 DSH 内打开管理中心；无需重扫 B站二维码。':status===403?'需要 DSH 主人权限。':'DSH 宿主认证暂不可用，请返回 DSH 检查登录或重启。'}
}
// The Desktop bridge may strip Origin. A non-simple explicit header is a
// CSRF intent marker, NOT identity. Only call AFTER authenticated owner and
// the existing local/same-origin fence; never accept a contradictory Origin.
export function explicitManagementIntent(req) {
  const headers=req.headers||{}, host=String(headers.host||''), origin=String(headers.origin||'')
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host) || String(headers['sec-fetch-site']||'').toLowerCase()==='cross-site') return false
  if (origin) return ['http://'+host,'https://'+host].includes(origin)
  return headers['x-dafeiyu-management-intent']==='1'
}
export function managementPath(tab, anchor) {
  const safeTab=['firststart','models','home','life','life-agent'].includes(tab)?tab:''
  return '/api/bili-duty/manage'+(safeTab?'?tab='+encodeURIComponent(safeTab):'')+(safeTab==='firststart'&&anchor==='fs-deps-card'?'#fs-deps-card':'')
}
