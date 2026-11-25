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
  let automatic = p.searchParams.get('auto') === '1';
  function stopWait() {clearInterval(timer);timer=null;automatic=false;}
  function wait(ms) {clearInterval(timer);until=Date.now()+ms;timer=setInterval(()=>{if(Date.now()>=until){stopWait();status.textContent='等待登录已结束；请核对登录状态或手动配对。';login.hidden=false;return;}void check();},ms===300000?5000:2000);}
  async function check() {
    if (busy) return; busy = true;
    try {
      const r = await fetch(path, {credentials:'same-origin', cache:'no-store', redirect:'manual', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(5000)});
      const valid = r.ok && r.headers.get('x-dafeiyu-management') === '1' && /text\\/html/i.test(r.headers.get('content-type') || '');
      if (r.body) await r.body.cancel().catch(()=>{});
      if (valid) { stopWait(); location.replace(target); return; }
      login.hidden = r.status !== 401;
      status.textContent = r.status === 401 ? (automatic ? '正在等待官方登录完成。若浏览器打开了 DSH 首页，保留当前管理中心标签页；未成功时可手动配对。' : '首次登录：点击下方按钮，在新标签页选择「配对此设备」。回到同一台电脑的 DSH → 设置 → 大肥鱼，展开「浏览器授权与故障恢复」，输入八位码并批准。然后回到本标签页。') : '管理中心尚未通过宿主验证（HTTP ' + r.status + '）。请检查主人权限、宿主状态或使用 DSH 内打开。';
      if (r.status !== 401) stopWait();
    } catch { status.textContent = '无法确认宿主状态，请重试或在 DSH 内打开。'; stopWait(); }
    finally { busy = false; }
  }
  login.addEventListener('click', () => {automatic=false;wait(300000);});
  retry.addEventListener('click', () => { void check(); });
  if(automatic)wait(30000);
  void check();
})()`
const browserStyle=':root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:Canvas;color:CanvasText;line-height:1.65}main{max-width:560px;margin:8vh auto;padding:24px;border:1px solid GrayText;border-radius:16px}h1{font-size:24px}p{margin:16px 0}a,button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid #305fd1}a{display:inline-block;background:#305fd1;color:white;text-decoration:none}a[hidden]{display:none}button{cursor:pointer;background:Canvas;color:CanvasText}@media(max-width:620px){main{margin:16px;padding:18px}}'
export function managementBrowserLanding(req, res) {
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405, {'allow':'GET, HEAD','cache-control':'no-store'});return res.end()}
  const hash = createHash('sha256').update(browserScript).digest('base64')
  const styleHash = createHash('sha256').update(browserStyle).digest('base64')
  res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'sha256-"+hash+"'; style-src 'sha256-"+styleHash+"'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"})
  return res.end(req.method==='HEAD'?undefined:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大肥鱼 · 管理中心登录</title><style>'+browserStyle+'</style><main><h1>🐟 大肥鱼管理中心</h1><p id="status">正在检查浏览器的 DSH 登录状态…</p><p><a id="login" href="/" target="_blank" rel="noopener noreferrer" hidden>第 1 步：打开 DSH 登录页，申请配对 ↗</a></p><p><button id="retry" type="button">重新检查登录状态</button></p><p><strong>无需另一台设备，也无需寻找「远程连接」设置。</strong> 在当前 DSH 客户端的设置中选择大肥鱼即可批准。首次配对会授予此浏览器 DSH 主人权限，请只授权自己发起的申请。本页面不签发凭证，也不包含管理数据。</p></main><script>'+browserScript+'</script></html>')
}
