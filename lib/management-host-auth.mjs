import {createHash} from 'node:crypto'
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

// Browser receives only a clean loopback URL. No Host header, token, or cookie
// participates in address construction. The only public route is static UI.
export function managementBrowserUrl(webServer, tab, anchor) {
  const origin = new URL(webServer.getOrigin())
  if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('宿主未提供可信本机浏览器地址')
  return new URL(managementPath(tab, anchor).replace('/manage','/browser'), origin).href
}
const browserScript = `(() => {
  const p = new URL(location.href), tab = p.searchParams.get('tab');
  const allowed = ['firststart','models','home','life','life-agent'];
  const path = '/api/bili-duty/manage' + (allowed.includes(tab) ? '?tab=' + encodeURIComponent(tab) : '');
  const target = path + (tab === 'firststart' && p.hash === '#fs-deps-card' ? '#fs-deps-card' : '');
  const status = document.getElementById('status'), login = document.getElementById('login'), retry = document.getElementById('retry');
  let busy = false, timer = null, until = 0;
  async function check() {
    if (busy) return; busy = true;
    try {
      const r = await fetch(path, {credentials:'same-origin', cache:'no-store', redirect:'manual', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(5000)});
      const valid = r.ok && r.headers.get('x-dafeiyu-management') === '1' && /text\\/html/i.test(r.headers.get('content-type') || '');
      if (r.body) await r.body.cancel().catch(()=>{});
      if (valid) { clearInterval(timer); location.replace(target); return; }
      login.hidden = r.status !== 401;
      status.textContent = r.status === 401 ? '请通过 DSH 官方登录页申请配对，再返回 DSH 大肥鱼设置输入浏览器显示的配对码。授权后本页自动进入管理中心。' : '管理中心尚未通过宿主验证（HTTP ' + r.status + '）。请检查主人权限、宿主状态或使用 DSH 内打开。';
      if (r.status !== 401) clearInterval(timer);
    } catch { status.textContent = '无法确认宿主状态，请重试或在 DSH 内打开。'; clearInterval(timer); }
    finally { busy = false; }
  }
  login.addEventListener('click', () => { clearInterval(timer); until = Date.now()+300000; timer = setInterval(() => { if(Date.now() >= until) {clearInterval(timer);status.textContent='等待授权已结束；确认配对后点击重试。';return;} void check(); }, 5000); });
  retry.addEventListener('click', () => { void check(); });
  void check();
})()`
export function managementBrowserLanding(req, res) {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405, {'allow':'GET, HEAD','cache-control':'no-store'});return res.end()}
  const hash = createHash('sha256').update(browserScript).digest('base64')
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'sha256-"+hash+"'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"})
  return res.end(req.method==='HEAD'?undefined:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大肥鱼 · 管理中心登录</title><main><h1>🐟 大肥鱼管理中心</h1><p id="status">正在检查浏览器的 DSH 登录状态…</p><p><a id="login" href="/" target="_blank" rel="noopener noreferrer" hidden>打开 DSH 官方登录页 ↗</a></p><p><button id="retry" type="button">重试</button></p><p>此页面不包含任何管理数据，也不签发凭证。首次配对将授予浏览器 DSH 主人权限，请只授权自己的浏览器。</p></main><script>'+browserScript+'</script></html>')
}
