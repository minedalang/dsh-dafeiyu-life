/**
 * dsh-dafeiyu-life —— 浏览器半端（**设置在「设置」里的一页**）
 * ============================================================================
 * ⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * ⭐ **怎么进「设置」**（抄第三方插件 `dsh-meme/client.js`，2026-10-14 使用者指出位置不对后才查到）：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'dafeiyu-life', order: 30, label: '大肥鱼' },   // label = 左侧导航那一项
 *       () => h(Panel),
 *     ))
 *
 *   ⇒ **别自己糊一个标题栏按钮 + 全屏 overlay** ✗（第一版就是这么干的，使用者一眼看出"跟别的插件不一样"）。
 *
 * 这一页要满足使用者 2026-10-14 说的形状：
 *   · **总开关 → 打开之后配置自定义自动刷时间段**（支持跨午夜和多时段）
 *   · **数字项要能自己填**（定量刷：每天几条）
 *   · **账号绑定必须在设置页里**（扫码登录 + 二维码直接显示在页里）
 *   · 会发东西出去的（自动评论）、要下大模型的（本地转写）**默认关**
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-dafeiyu-life',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/bili-duty'
    /* ⚠️ 原来 jget/jpost 直接 .json()、从不看 res.ok ⇒ HTTP 500 的 {ok:false,error}
     *    会被调用方当成「已保存 / 成功」，绿色提示把故障盖掉。（2026-10-16 审查修） */
    const asJson = async (res) => {
      // 服务端 403 可能来自“总开关已关”、本机同源校验，不能一概说成宿主拦截。
      // 只读取本插件返回的简短 error，不回显响应体或敏感信息。
      if (res.ok) return res.json()
      let reason = ''
      try {
        const detail = await res.json()
        if (detail && typeof detail.error === 'string') reason = detail.error.slice(0, 160)
      } catch { /* 不是 JSON 时保留明确 HTTP 状态 */ }
      throw new Error('HTTP ' + res.status + (reason ? '：' + reason : '（本地接口拒绝，原因未返回）'))
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-bd-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;}
    [data-bd-page][data-bd-wide]{max-width:none;width:100%;}
    [data-bd-page][data-bd-wide] [data-bd-list]{grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
[data-bd-sec]{display:flex;flex-direction:column;gap:8px;}
[data-bd-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-bd-grow]{flex:1;min-width:0;}
[data-bd-label]{font-size:13px;}
[data-bd-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-bd-sw][data-on]{background:#3b82f6;}
[data-bd-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-bd-sw][data-on] i{left:19px;}
[data-bd-sw][disabled]{opacity:.45;cursor:default;}
[data-bd-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.1));
  display:flex;flex-direction:column;gap:10px;}
[data-bd-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-bd-input]:focus{outline:none;border-color:#3b82f6;}
[data-bd-num]{width:88px;text-align:center;}
[data-bd-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:inherit;}
[data-bd-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-bd-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-bd-btn][disabled]{opacity:.5;cursor:default;}
[data-bd-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-msg][data-warn]{color:#f59e0b;}
[data-bd-msg][data-good]{color:#22c55e;}
[data-bd-qr]{display:flex;gap:14px;align-items:flex-start;}
[data-bd-qr] img{width:150px;height:150px;border-radius:8px;background:#fff;padding:6px;}
[data-bd-pre]{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:170px;overflow:auto;font-size:11px;
  line-height:15px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}
    /* ⭐ 2026-10-21 重做：卡片网格 + 颜色全部取「真实存在」的主题变量
       （之前用了 --dsw-alias-bg-layer-1 / --dsw-alias-bg-layer-3 —— 这两个在应用里根本不存在 ⇒
        fallback 落到硬编码深色，而文字用的 --dsw-alias-label-primary 是存在的 ⇒ 浅色主题下变近黑 ⇒ 黑底黑字看不见） */
    [data-bd-list]{margin:10px 0 0;max-height:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;}
    [data-bd-item]{display:flex;flex-direction:column;overflow:hidden;border-radius:12px;
      background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));
      border:1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));
      color:var(--dsw-alias-label-primary,inherit);}
    [data-bd-cover]{display:block;width:100%;aspect-ratio:16/9;height:auto;object-fit:cover;
      background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));}
    [data-bd-item-body]{display:flex;flex-direction:column;gap:4px;padding:9px 11px;min-width:0;}
    [data-bd-item-t]{font-size:13px;line-height:18px;font-weight:600;
      color:var(--dsw-alias-label-primary,inherit);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}
    [data-bd-item-t] a{color:inherit;text-decoration:none;}
    [data-bd-item-t] a:hover{text-decoration:underline;}
    [data-bd-item-n]{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,inherit);margin:0;}
    [data-bd-item-why]{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary,inherit);
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    [data-bd-clickable]{cursor:pointer;transition:border-color .12s,background .12s;}
    [data-bd-clickable]:hover{border-color:var(--dsw-alias-brand-primary,rgba(76,141,255,.5));
      background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-tabs]{display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));}
    [data-bd-tab]{flex:1;min-width:0;cursor:pointer;font:inherit;font-size:13px;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-tab]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-tab][aria-selected=true]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12);}
    [data-bd-away]{display:none !important;}
    [data-bd-chip]{cursor:pointer;white-space:nowrap;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;
      border:1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));background:transparent;
      color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-chip]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
    [data-bd-chip][aria-selected=true]{color:var(--dsw-alias-label-primary,inherit);
      border-color:var(--dsw-alias-brand-primary,rgba(76,141,255,.6));
      background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4c8dff) 16%,transparent);}
    [data-bd-tier]{font-weight:600;color:var(--dsw-alias-label-secondary,inherit);}
    [data-bd-tier='值得看']{color:#3fb950;}
    [data-bd-tier='可以看']{color:#d29922;}
    [data-bd-tier='不值当']{color:var(--dsw-alias-label-tertiary,inherit);}
[data-bd-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-bd-badge]{font-size:11px;padding:2px 7px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));color:var(--dsw-alias-label-secondary,#c9ccd1);}
/* v2.4.83 — DSH 原生设置页，保留主题变量并提升交互辨识度 */
[data-bd-page]{gap:19px;}
[data-bd-sec]{padding:15px 17px;border:1px solid var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));border-radius:15px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));}
[data-bd-sub]{padding:10px 0 10px 14px;border-left:3px solid #35a185;}
[data-bd-sw][data-on]{background:#18966f;box-shadow:0 0 0 3px rgba(24,150,111,.09);}
[data-bd-h]{font-size:12px;font-weight:750;letter-spacing:.02em;}
[data-bd-input]{border-radius:10px;padding:9px 11px;transition:border-color .15s,box-shadow .15s;}
[data-bd-input]:focus{border-color:#2d85c6;box-shadow:0 0 0 3px rgba(45,133,198,.13);}
[data-bd-btn]{border-radius:10px;font-weight:650;transition:filter .15s,transform .15s;}
[data-bd-btn]:not(:disabled):hover{transform:translateY(-1px);}
[data-bd-btn][data-primary]{background:#187c63;border-color:#187c63;color:#fff;}
[data-bd-tabs]{border-radius:12px;}
[data-bd-tab][aria-selected=true]{box-shadow:0 3px 10px rgba(40,88,160,.1);}
[data-bd-item]{box-shadow:0 5px 18px rgba(26,57,98,.07);border-radius:14px;}
[data-bd-author-link]{display:inline-flex;align-items:center;color:#168a65;font-size:15px;font-weight:750;text-decoration:none;border:1px solid rgba(34,161,116,.3);background:rgba(41,178,120,.1);border-radius:999px;padding:6px 13px;width:fit-content;}
[data-bd-author-link]:hover{text-decoration:underline;filter:brightness(1.1);}
@media(max-width:600px){[data-bd-sec]{padding:11px 12px;}}

`


    /* ────────────── 小组件 ────────────── */

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-bd-sw': '',
        'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        title: on ? '已开' : '已关',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      // ⭐ 2026-10-19（用户报"没有开关这一项，只能让 ai 帮我开"）：读不到配置时界面只显示"读设置中…"，
      //    用户会以为是开关坏了 ✗ ⇒ 数一下连续失败次数，交给界面把话说清楚（版本太旧 / 没重启 / 读不到）
      const [fails, setFails] = React.useState(0)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await jget('/status')
            if (!alive) return
            if (d && d.ok) { setSt(d); setFails(0) } else setFails((n) => n + 1)
          } catch { if (alive) setFails((n) => n + 1) }
        }
        tick()
        const t = setInterval(tick, intervalMs || 5000)
        return () => { alive = false; clearInterval(t) }
      }, [intervalMs])
      return [st, setSt, fails]
    }

    /* ────────────── 设置页正文 ────────────── */

/* ────────────── 会话头那个 tab：它刷过的视频（最小实验版）────────────── */
function WatchTab() {
  const PAGE = 30
  const onOpenUrl = (u) => { jpost('/open', { what: 'url', u }).catch(() => {}) }
  const [rows, setRows] = React.useState(null)
  const [st, setSt] = React.useState('')      // '' | picked | skipped | commented
  const [tier, setTier] = React.useState('')  // '' | 值得看 / 可以看 / 不值当
  const [offset, setOffset] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const load = (s, t, off) => {
    setRows(null)
    const q = `/watched?limit=${PAGE}&offset=${off}` + (s ? '&state=' + s : '') + (t ? '&tier=' + encodeURIComponent(t) : '')
    jget(q).then((r) => {
      if (!r || !r.ok) { setRows([]); return }
      setRows(r.rows || [])
      setTotal(Number(r.total) || 0)
    }).catch(() => setRows([]))
  }
  React.useEffect(() => { load("", "", 0) }, [])
  const pick = (kind, v) => {
    const next = (kind === 'state' ? st : tier) === v ? '' : v
    if (kind === 'state') setSt(next); else setTier(next)
    setOffset(0)
    load(kind === 'state' ? next : st, kind === 'tier' ? next : tier, 0)
  }
  const go = (d) => { const n = Math.max(0, Math.min(offset + d, Math.max(0, total - 1))); setOffset(n); load(st, tier, n) }
  const chip = (label, on, active) => h('button', { 'data-bd-chip': '', 'aria-selected': active ? 'true' : 'false', onClick: on }, label)
  return h('div', { 'data-bd-page': '', 'data-bd-wide': '' },
    h('div', { 'data-bd-row': '' },
      chip('全部', () => pick('state', ''), st === ''),
      chip('挑了', () => pick('state', 'picked'), st === 'picked'),
      chip('跳过', () => pick('state', 'skipped'), st === 'skipped'),
      chip('发给你了', () => pick('state', 'commented'), st === 'commented'),
      chip('刷新', () => { setOffset(0); load(st, tier, 0) }, false),
      h('div', { 'data-bd-note': '' }, rows === null ? '读取中…' : `共 ${total} 条`)),
    h('div', { 'data-bd-row': '' },
      chip('值得看', () => pick('tier', '值得看'), tier === '值得看'),
      chip('可以看', () => pick('tier', '可以看'), tier === '可以看'),
      chip('不值当', () => pick('tier', '不值当'), tier === '不值当')),
    rows && rows.length ? h('div', { 'data-bd-list': '' },
      rows.map((x, i) => h('div', { key: x.day + x.bvid, 'data-bd-item': '', 'data-bd-clickable': '', title: '在浏览器打开', onClick: () => onOpenUrl(x.url) },
        i < 30 ? h('img', { 'data-bd-cover': '', src: API + '/cover?bv=' + x.bvid, loading: 'lazy', alt: '' }) : null,
        h('div', { 'data-bd-item-body': '' },
          h('div', { 'data-bd-item-t': '' }, x.title),
          h('div', { 'data-bd-item-n': '' }, `${x.day} · ${x.up} · `, x.picked ? '挑中了' : (x.status && /跳过/.test(x.status) ? '跳过' : '看过'), (x.delivered || x.commented) ? ' · 已发给你' : '',
            x.tier ? h('span', { 'data-bd-tier': x.tier }, ' · ' + x.tier) : null),
          x.why ? h('div', { 'data-bd-item-why': '' }, x.why) : null))))
      : h('div', { 'data-bd-note': '' }, rows === null ? '' : '这一类还没有记录 —— 跑一轮之后就有了'),
    total > PAGE ? h('div', { 'data-bd-row': '' },
      h('button', { 'data-bd-btn': '', disabled: offset <= 0, onClick: () => go(-PAGE) }, '上一页'),
      h('div', { 'data-bd-note': '' }, `${offset + 1}–${Math.min(offset + PAGE, total)} / ${total}`),
      h('button', { 'data-bd-btn': '', disabled: offset + PAGE >= total, onClick: () => go(PAGE) }, '下一页')) : null)
}

    function Panel() {
      const [st, setSt, fails] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [manageError, setManageError] = React.useState('')
      const [msgTone, setMsgTone] = React.useState('')
      const [kws, setKws] = React.useState(null)
      const [favFolders, setFavFolders] = React.useState(null)   // 收藏夹列表（下拉用，null = 还没读）
      const [favId, setFavId] = React.useState(null)             // 选中的收藏夹 fid（字符串）
      const [persona, setPersona] = React.useState(null)   // 人设提示词草稿
      const [rl, setRl] = React.useState(null)
      const [newVer, setNewVer] = React.useState('')       // 发现的新版本号（空 = 没发现）          // 日报形态：full / brief / off
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [pickPerRound, setPickPerRound] = React.useState(null)
      const [peakIntervalDraft, setPeakIntervalDraft] = React.useState(null)
      const [peakWindowsDraft, setPeakWindowsDraft] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      const [dmUid, setDmUid] = React.useState(null)        // 私信收件人 UID（本地草稿）
      const [dmWatch, setDmWatch] = React.useState(null)          // 后台私信总开关
      const [dailyPublicCommentLimit, setDailyPublicCommentLimit] = React.useState(null)
      const [dynamicDailyLimitDraft, setDynamicDailyLimitDraft] = React.useState(null)
      const [commentQuota, setCommentQuota] = React.useState(null)
      const [memeMaxEntriesDraft, setMemeMaxEntriesDraft] = React.useState(null)
      const [commentMemeList,setCommentMemeList] = React.useState(null)
      const [memeImageDailyDraft,setMemeImageDailyDraft] = React.useState(null)
      const [memeImageRoundDraft,setMemeImageRoundDraft] = React.useState(null)
      const [memePromptExpanded,setMemePromptExpanded] = React.useState(false)
      const [memePromptDefault,setMemePromptDefault] = React.useState(null)
      const [memePromptDraft,setMemePromptDraft] = React.useState(null)
      const [memePromptLoading,setMemePromptLoading] = React.useState(false)
      const [visionPromptExpanded,setVisionPromptExpanded] = React.useState(false)
      const [visionPromptDefault,setVisionPromptDefault] = React.useState(null)
      const [visionPromptDraft,setVisionPromptDraft] = React.useState(null)
      const [visionPromptLoading,setVisionPromptLoading] = React.useState(false)
      const [visionBV,setVisionBV] = React.useState('')
      const [visionTest,setVisionTest] = React.useState(null)
      const [visionBusy,setVisionBusy] = React.useState(false)
      const [visionDraft,setVisionDraft] = React.useState(null)
      const [dmMode, setDmMode] = React.useState(null)      // 投递方式：off / only / both
      const [mentionTargets, setMentionTargets] = React.useState(null)
      const [mentionMode, setMentionMode] = React.useState(null)
      const [friendProfiles,setFriendProfiles] = React.useState(null)
      const [friendProfilesExpanded,setFriendProfilesExpanded] = React.useState(false)
      const [loreDraft,setLoreDraft] = React.useState(null)
      const [loreDefault,setLoreDefault] = React.useState(null)
      const [loreExpanded,setLoreExpanded] = React.useState(false)
      const [modelDraft,setModelDraft] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)
      const [watchedRows, setWatchedRows] = React.useState(null)   // null = 还没读；[] = 读到了但没记录
      const [watchedPicked, setWatchedPicked] = React.useState(false) // 只看挑中的
    const [watchedState, setWatchedState] = React.useState('')
    const [watchedTier, setWatchedTier] = React.useState('')
    const [watchedOffset, setWatchedOffset] = React.useState(0)
    const [watchedTotal, setWatchedTotal] = React.useState(0)
    const tab = 'daily' // v2.4.86: 原生设置只保留日常；详细配置集中到管理中心
      const [diag, setDiag] = React.useState(null)      // 诊断信息文本
      const [checks, setChecks] = React.useState(null)   // 环境自检结果 [{name, ok, detail, fix}]
      const [loginState, setLoginState] = React.useState('')
      const [loginTone, setLoginTone] = React.useState('')
      /* ⚠️ 扫码轮询的 timer 必须能停：切走设置页后还在跑的话会在已卸载的组件上 setState，
       *    重复点「扫码登录」还会叠出第二个 timer。（2026-10-16 审查修） */
      const loginTimer = React.useRef(null)
      const alive = React.useRef(true)
      React.useEffect(() => () => {
        alive.current = false
        if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }
      }, [])

      const cfg = st?.config
      React.useEffect(() => {
        if (cfg && kws === null) setKws((cfg.keywords || []).join('\n'))
        if (cfg && persona === null) setPersona(cfg.personaPrompt || '')
        if (cfg && rl === null) setRl(cfg.reportLevel || 'full')
        if (cfg && perDay === null) setPerDay(String(cfg.perDay ?? 50))
        if (cfg && pickPerRound === null) setPickPerRound(String(cfg.pickPerRound ?? 5))
        if (cfg && peakIntervalDraft === null) setPeakIntervalDraft(String(cfg.peakIntervalMinutes ?? 30))
        if (cfg && peakWindowsDraft === null) {
          try {
            const rows = JSON.parse(cfg.peakWindows || '[]')
            setPeakWindowsDraft(Array.isArray(rows) ? rows.map(w => ({start:String(w.start||''),end:String(w.end||'')})) : [])
          } catch { setPeakWindowsDraft([]) }
        }
        if (cfg && perRound === null) setPerRound(String(cfg.commentPerRound ?? 5))
        if (cfg && dailyPublicCommentLimit === null) setDailyPublicCommentLimit(String(cfg.commentDailyLimit ?? 10))
        if (cfg && dynamicDailyLimitDraft === null) setDynamicDailyLimitDraft(String(cfg.dynamicDailyLimit ?? 3))
        if (cfg && memeImageDailyDraft === null) setMemeImageDailyDraft(String(cfg.commentMemesPerDay ?? 2))
        if (cfg && memeImageRoundDraft === null) setMemeImageRoundDraft(String(cfg.commentMemesPerRound ?? 1))
        if (cfg && memeMaxEntriesDraft === null) setMemeMaxEntriesDraft(String(cfg.memeMemoryMaxEntries ?? 300))
        if (cfg && mentionTargets === null) setMentionTargets(cfg.mentionTargets || '')
        if (cfg && mentionMode === null) setMentionMode(cfg.mentionMode || 'ai')
        if (cfg && friendProfiles === null) {try {setFriendProfiles(JSON.parse(cfg.mentionProfiles||'{}'))} catch {setFriendProfiles({})}}
        if (cfg && loreDraft === null) setLoreDraft(cfg.characterLore || '')
        if (cfg && dmUid === null) setDmUid(cfg.dmUid ? String(cfg.dmUid) : '')
        if (cfg && dmMode === null) setDmMode(cfg.dmMode || 'only')
        if (cfg && dmWatch === null) setDmWatch(cfg.dmWatch !== false)
        if(cfg && visionDraft===null) setVisionDraft(Object.fromEntries(['visionModelProvider','visionModelId','visionReasoningEffort','visionFrames'].map(k=>[k,cfg[k]??''])))
        if(cfg && modelDraft===null) setModelDraft(Object.fromEntries(['videoModelProvider','videoModelId','videoReasoningEffort','interactionModelProvider','interactionModelId','interactionReasoningEffort'].map(k=>[k,cfg[k]||''])))
        if (cfg && favId === null) setFavId(String(cfg.favFolderId ?? 0))
      }, [cfg])

      // ⭐ 收藏夹列表：只读一次，读不到就空列表（别每 5 秒重拉）
      React.useEffect(() => {
        if (favFolders !== null) return
        jget('/fav-folders').then((r) => { if (alive.current) setFavFolders(r && r.ok ? (r.folders || []) : []) })
          .catch(() => { if (alive.current) setFavFolders([]) })
      }, [favFolders])

      // 10 秒刷新一次真实 SQLite 评论配额，0/每日上限来自 Python MCP 共用账本。
      React.useEffect(() => {
        let alive = true
        const fetchQuota = () => jget('/comment-quota').then(r => {if(alive) setCommentQuota(r)}).catch(() => {if(alive) setCommentQuota({ok:false})})
        fetchQuota()
        const timer = setInterval(fetchQuota, 10000)
        return () => {alive = false; clearInterval(timer)}
      }, [])

      const scheduleRows = peakWindowsDraft || []
      const updateSchedule = (idx, key, value) => setPeakWindowsDraft(rows => (rows || []).map((w, i) => i === idx ? {...w, [key]:value} : w))
      const saveSchedule = () => {
        const rows = peakWindowsDraft || []
        if (rows.some(w => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(w.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(w.end) || w.start === w.end)) {
          say('时间段格式无效：请填完整 HH:MM，开始和结束不能相同', 'warn'); return
        }
        patch({peakWindows:JSON.stringify(rows)}, '自定义时间段')
      }

      const say = (text, tone) => {
        setMsg(text); setMsgTone(tone || '')
        setRunNote(text ? { t: text, tone: tone || '' } : null)   // ⭐ 同时镜像到顶部，免得提示掉到页面最底下看不见
      }

      // DSH Mobile 是手机上运行的已配对 HTTPS WebView，实际业务仍在电脑端。
      // 后台调用系统浏览器只会在电脑上打开页面，不能作为手机的管理入口。
      // 始终使用当前 WebView 的同源路径；不要从 Host 推断、拼接或返回本机地址。
      const onOpenManage = async (tab = '') => {
        setManageError('')
        try {
          const safeTab = ['firststart', 'models', 'home'].includes(tab) ? tab : ''
          const ua = String(window.navigator?.userAgent || '')
          const smallTouch = Number(window.navigator?.maxTouchPoints || 0) > 0 &&
            Number(window.innerWidth || 1024) <= 900
          const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || smallTouch
          if (!isMobile) {
            const result = await jpost('/open', {what: 'manage', tab: safeTab})
            if (result?.ok !== true) throw new Error(result?.error || '宿主没有确认打开管理中心')
            return
          }

          // 通过 DSH Mobile 同源 HTTPS 入口时，配对、TLS 和代理 CSRF 校验由网关执行。
          // 非 HTTP(S)（例如不带已配对网关的私有 scheme）不可跳转 127.0.0.1。
          if (!/^https?:$/i.test(String(window.location?.protocol || '')))
            throw new Error('当前不是 DSH Mobile 的 HTTP(S) 配对页面；请在已配对设备内打开 DSH')
          const path = '/api/bili-duty/manage' + (safeTab ? '?tab=' + encodeURIComponent(safeTab) : '')
          const probe = await fetch(path, {credentials: 'same-origin', redirect: 'follow'})
          if (!probe.ok) {
            let reason = ''
            try {const json = await probe.json();if (typeof json?.error === 'string') reason = json.error.slice(0, 120)} catch {}
            throw new Error('HTTP ' + probe.status + (reason ? '：' + reason : '：管理页面被当前移动通道拒绝'))
          }
          if (!/text\/html/i.test(String(probe.headers?.get?.('content-type') || '')))
            throw new Error('移动网关未返回管理中心 HTML 页面')
          // 代理或认证层可能在返回 200 后显示通用登录页；必须确认响应来自本插件。
          let isManage = probe.headers?.get?.('x-dafeiyu-management') === '1'
          if (!isManage && typeof probe.text === 'function') {
            const html = await probe.text()
            isManage = html.includes('<meta name="dafeiyu-management" content="1">')
          }
          if (!isManage) throw new Error('移动访问通道返回的不是大肥鱼管理中心；请检查配对登录状态')
          // 同一个已配对 HTTPS Origin 打开，不触发电脑浏览器、不暴露独立管理端口。
          window.location.assign(path)
        } catch (e) {
          const detail = String(e?.message || e)
          const message = '打开管理中心失败：' + detail +
            '。请确认手机已通过 DSH Mobile 配对并连接到电脑；不要直接将电脑本机 DSH 端口暴露到公网。'
          setManageError(message)
          say(message, 'warn')
        }
      }


      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (!r || r.ok !== true) throw new Error((r && r.error) || '设置接口没有确认保存成功')
          // 收藏夹字段曾被服务端允许列表漏掉：必须核对服务端实际保存的 ID，杜绝假成功。
          if (Object.prototype.hasOwnProperty.call(p, 'favFolderId')) {
            const savedFid = Math.max(0, Math.floor(Number(r.config?.favFolderId) || 0))
            const wantedFid = Math.max(0, Math.floor(Number(p.favFolderId) || 0))
            if (savedFid !== wantedFid) {
              setFavId(String(savedFid))
              throw new Error('收藏夹没有保存成功：服务端返回 ' + savedFid + '，期望 ' + wantedFid + '。请确认插件文件已更新并重启 DSH')
            }
          }
          if (r.config) setSt((old) => ({ ...old, config: r.config }))
          // ⭐ DSH 原生设置页里显式设过的键由宿主说了算 ⇒ 我们这份也得写进去；写失败要说出来，别假装"已保存"
          if (r?.host && r.host.ok === false) say(`${what || '设置'}：插件自己那份存了，但 DSH 设置页那份没写进去（${r.host.error}）`, 'warn')
          else say(what ? `${what}：已保存` : '已保存', 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      // 「它刷过的视频」：点开才读，读一次就留着（不会每 5 秒重拉）
    const WATCH_PAGE = 30
    const onLoadWatched = async (st, tr, off) => {
      setBusy('watched')
      try {
        const q = `/watched?limit=${WATCH_PAGE}&offset=${off}` + (st ? '&state=' + st : '') + (tr ? '&tier=' + encodeURIComponent(tr) : '')
        const r = await jget(q)
        setWatchedRows(r && r.ok ? (r.rows || []) : [])
        setWatchedTotal(r && r.ok ? (Number(r.total) || 0) : 0)
        setWatchedState(st)
        setWatchedTier(tr)
        setWatchedOffset(off)
        if (!r || r.ok === false) say('读不到记录：' + ((r && r.error) || '未知原因'), 'warn')
      } catch (e) { say('读不到记录：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
    }
    const onWatchPick = (kind, v) => {
      const cur = kind === 'state' ? watchedState : watchedTier
      const next = cur === v ? '' : v
      return onLoadWatched(kind === 'state' ? next : watchedState, kind === 'tier' ? next : watchedTier, 0)
    }
    const onWatchPage = (d) => onLoadWatched(watchedState, watchedTier, Math.max(0, watchedOffset + d))


      // ⭐ 复核评论：接口回"发送成功"≠ 公开可见（新号/风控会进审核，那时候连 @ 都不会推）
      //    所以让宿主真去拉一次评论列表 / 楼中楼，确认那条到底在不在。
      const onVerify = async () => {
        setBusy('verify')
        try {
          const r = await jpost('/verify', {})
          if (!r || !r.ok) { say('复核没跑成：' + ((r && r.error) || '未知原因'), 'warn'); return }
          const n = (r.checked || []).length
          const vis = (r.checked || []).filter((c) => c.visible === true).length
          if (!n) say(r.text || '没有需要复核的记录', 'good')
          else say(`复核完 ${n} 条：公开可见 ${vis} 条，其余「没查到」（可能还在审核 —— 看不到不等于没发出去）。结果也追加到今天的报告末尾了。`, vis ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      // ⭐ 把"要日志"变成"点一下"（2026-10-21）
      const onDiagnose = async () => {
        setBusy('diag')
        try {
          const r = await jget('/diagnose')
          const text = String(r?.text || '（没拿到诊断信息）')
          setDiag(text)
          copyText(text).catch(() => {})
          say('诊断信息已生成并复制到剪贴板', 'good')
        } catch (e) { say('生成诊断信息失败：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }
      const onSelfCheck = async () => {
        setBusy('selfcheck')
        try {
          const r = await jget('/selfcheck')
          setChecks(Array.isArray(r?.items) ? r.items : [])
        } catch (e) { say('自检失败：' + String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const copyText = async (text) => {
        const v = String(text || '')
        try {
          await navigator.clipboard.writeText(v)
          say('已复制：' + v, 'good')
        } catch {
          say('复制失败 —— 路径是：' + v)       // 兜底：至少把路径显示出来，手动选中也能复制
        }
      }

      const onOpenFolder = async (what) => {
        try {
          const r = await jpost('/open', { what })
          if (r && r.ok) say('已请系统打开：' + (r.opened || '') + '（要是没看到窗口，用旁边的「复制报告路径」——那个一定成）', 'good')
          else say('打不开（' + ((r && r.error) || '未知原因') + '）—— 你可以手动打开这个路径：' + ((r && r.dir) || ''))
        } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      const onUpgrade = async () => {
        setBusy('upgrade')
        try {
          const r = await jpost('/upgrade', {})
          // 原来这两句分两次 say，第二句把服务端的 hint 冲掉了 —— 合成一句。（2026-10-16 审查修）
          say(((r && r.hint) || '正在升级') + ' —— 升级过程写在下面的「主依赖的日志」里；完了记得重启一次 dsh（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheckUpdate = async () => {
        setBusy('update')
        try {
          const r = await jget('/update')
          if (r && r.ok && r.latest) {
            const from = r.source === 'github' ? '（npm 上还没发上去，这个版本来自 GitHub）' : ''
            if (r.hasNew) {
              setNewVer(r.latest)
              say('有新版 v' + r.latest + '（你的是 v' + r.current + '）' + from + ' —— 点右边的「一键升级」，完了重启一次 dsh', 'warn')
            } else say('已经是最新版 v' + r.current + from, 'good')
          } else {
            say('查不到最新版（可能网络不通）—— 你现在的版本是 v' + ((r && r.current) || '?'))
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheck = async () => {
        setBusy('check')
        say('')
        try {
          const r = await jpost('/check', {})
          if (r && r.ok) say('能用！' + (r.steps || []).join('、'))
          else say('还不能用：' + (r && r.error ? r.error : '没拿到结果'))
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstallAsr = async () => {
        setBusy('asr')
        say('')
        try {
          const r = await jpost('/install-asr', {})
          say(r?.started ? '开始装转写依赖 —— 进度显示在下面（要下模型，慢一点正常）' : (r?.hint || '没起来'),
            r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        say('')
        try {
          const r = await jpost('/install', {})
          say(r?.hint || '已经在后台开始装了', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          say(r?.started ? '已经在后台跑一轮了，报告会写在 out/ 里' : '没起来，看 duty.log', r?.started ? 'good' : 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onLoginStart = async () => {
        setBusy('login')
        setLoginTone('')
        setLoginState('正在出码…')
        try {
          const r = await jpost('/login/start', {})
          if (!r?.ok) { setLoginTone('warn'); setLoginState(r?.error || '出码失败'); return }
          setLogin({ key: r.key, qr: r.qr })
          if (!r.qr) { setLoginTone('warn'); setLoginState('没画出二维码 —— 先点上面的「重装依赖」（venv 里要有 qrcode）') }
          else setLoginState('用手机 B站 扫这张码')
          if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }   // 重复点：先把上一轮停掉
          let n = 0
          const stop = () => { clearInterval(timer); if (loginTimer.current === timer) loginTimer.current = null }
          const timer = setInterval(async () => {
            if (!alive.current) { stop(); return }        // 已经切走设置页了：别再问、别再 setState
            n += 1
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (p?.state === 'ok') {
                stop(); setLogin(null)
                setLoginTone('good'); setLoginState('登录成功')
                setSt((old) => ({ ...old, loggedIn: true }))
              } else if (p?.state === 'scanned') { setLoginTone(''); setLoginState('扫到了，请在手机上确认') }
              else if (p?.state === 'expired') { stop(); setLogin(null); setLoginTone('warn'); setLoginState('二维码过期了，再点一次「扫码登录」') }
              // ⚠️ 扫码成功但响应里没有 SESSDATA 时服务端回 state='unknown'：原来没这个分支
              //    ⇒ 界面一直显示「等扫码…」，用户白等 3 分钟才超时。（2026-10-16 审查修）
              else if (p?.state === 'unknown') {
                stop(); setLogin(null); setLoginTone('warn')
                setLoginState('没登上：' + (p?.message || '响应里没有 SESSDATA —— 再点一次「扫码登录」'))
              }
              else { setLoginTone(''); setLoginState('等扫码…') }
            } catch { /* 抖动就下次再问 */ }
            if (n > 90) { stop(); setLogin(null); setLoginTone('warn'); setLoginState('超时了，再点一次「扫码登录」') }
          }, 2000)
          loginTimer.current = timer
        } catch (e) { setLoginTone('warn'); setLoginState(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      const onFavToday = async () => {
        setBusy('fav')
        try {
          const r = await jpost('/fav-today', {})
          if (!r || r.ok === false || (r.failures && r.failures.length)) {
            const summary = (r && r.error) || (r && r.failures && r.failures[0]) || '未知原因'
            say('收藏未全部成功：' + summary, 'warn')
          } else {
            say(`收藏 API 已接受：${r.added}/${r.total} 条（可到 B站收藏夹核对）`, 'good')
          }
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onSaveText = async () => {
        const list = String(kws || '').split('\n').map((s) => s.trim()).filter(Boolean)
        await patch({ keywords: list, clear: list.length ? [] : ['keywords'] }, '主人额外关注词')
      }

      if (!cfg) {
        return h('div', { 'data-bd-page': '' },
          h('div', { 'data-bd-note': '' }, fails >= 3
            ? '读不到插件配置（已经试了 ' + fails + ' 次）。常见原因有三个：装的还是 0.1.11 / 0.1.12（那两版有 bug，会卡在这里）；刚装完没重启 dsh；或者插件加载失败。'
            : '读设置中…'),
          fails >= 6 ? h('div', { 'data-bd-note': '' },
            '可以先试：升级到最新版（dsh plugin --profile web add github:minedalang/dsh-dafeiyu-life）→ 重启 dsh；还不行就把 ' +
            '%USERPROFILE%\\.dsh\\bili-duty\\duty.log 的最后几十行发给作者。') : null)
      }

      // A first-start welcome is required even for existing users. B站 login
      // and Headless verification take place only in the unified management UI.
      if(st?.onboarding && !(st.onboarding.welcomeCompleted??st.onboarding.completed)){
        const steps=st.onboarding;
        return h('div',{'data-bd-page':''},
          h('div',{'data-bd-sec':'',style:{padding:'20px',borderRadius:'16px',border:'2px solid #c74351',background:'rgba(218,61,73,.08)'}},
            h('div',{'data-bd-label':'',style:{fontSize:'19px',fontWeight:800,color:'#c74351'}},'🐟 欢迎来到大肥鱼 · 首次配置'),
            h('div',{'data-bd-note':''},'新用户和老用户都会看到一次这份向导；不会清除你的旧资料。B站账号与 Headless 模型是两项必需配置，未完成前所有业务功能锁定。'),
            h('div',{'data-bd-label':''},(steps.biliVerified?'✓':'○')+' B站账号登录并验证'+(steps.biliVerified?' · 已完成':'')),
            h('div',{'data-bd-label':''},(steps.headlessVerified?'✓':'○')+' Headless 模型同步并验证'+(steps.headlessVerified?' · 已完成':'')),
            h('div',{'data-bd-row':''},
              !st.venvReady?h('button',{'data-bd-btn':'',onClick:onInstall,disabled:busy==='install'},'安装 B站运行依赖'):null,
              h('button',{'data-bd-btn':'','data-primary':'',onClick:()=>onOpenManage('firststart')},'打开管理中心，开始配置 ↗')),
            h('div',{'data-bd-note':''},'主 Session、人生记忆、人格成长与社交偏好可以先跳过；设置以后都能在管理中心修改。'),
            manageError ? h('div',{'data-bd-msg':'','data-warn':''},manageError) : null))
      }

      const sw = (k) => Boolean(cfg[k])

      return h('div', { 'data-bd-page': '' },
        h('div',{ 'data-bd-sec':'',style:{padding:'12px',borderRadius:'12px',border:'1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.24))'}},
          h('div',{'data-bd-row':'',style:{justifyContent:'space-between',alignItems:'center'}},
            h('div',{'data-bd-grow':''},h('div',{'data-bd-label':''},'🐳 大肥鱼 · DSH 生活系统'),
              h('div',{'data-bd-note':''},'她会自己去 B站、把重要经历带回主 Session、长期记住主人和朋友；精确档案、长期记忆、梗、好友关系与互动状态都保存在本地。')),
            h('button',{type:'button','data-bd-btn':'',onClick:()=>onOpenManage()},'打开管理中心 ↗')),
          manageError ? h('div',{'data-bd-msg':'','data-warn':''},manageError) : null),

        /* ── 大肥鱼总开关：永久展示，不隐藏设置，不清除历史 ── */
        h('div', { 'data-bd-sec': '', style: {padding:'12px',border:'1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.24))',borderRadius:'12px'} },
          h(ToggleRow, {
            label: '🐳 大肥鱼总开关',
            note: cfg.masterEnabled === false
              ? '已暂停：不再刷视频、发私信、发评论、同步动态或收藏。设置和历史保留。'
              : '运行中：下面各项功能仍分别受自己的开关控制；关闭总开关可一键暂停全部自动行为。',
            on: cfg.masterEnabled !== false,
            onChange: async (v) => {
              const previous = cfg.masterEnabled !== false
              setSt(old => old ? {...old, config:{...old.config,masterEnabled:v}} : old)
              try {await patch({masterEnabled:v}, '大肥鱼总开关')}
              catch {setSt(old => old ? {...old,config:{...old.config,masterEnabled:previous}} : old)}
            },
          })
        ),

        /* ── 今天 ── */
        h('div', { 'data-bd-row': '' },
          h('span', { 'data-bd-badge': '' }, `今天已挑 ${st.pickedToday ?? st.ranToday ?? 0} / ${cfg.perDay} 条`),
          h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
          h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
            h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
          h('div', { 'data-bd-grow': '' }),
          h('button', { 'data-bd-btn': '', disabled: busy === 'run' || cfg.masterEnabled === false, onClick: onRun }, '现在跑一轮')),
          runNote ? h('div', { 'data-bd-msg': '', 'data-good': runNote.tone === 'good' ? '' : undefined,
            'data-warn': runNote.tone === 'warn' ? '' : undefined }, runNote.t) : null,


        h('div',{'data-bd-sec':'','data-bd-group':'daily'},
          h('div',{'data-bd-h':''},'账号与运行环境'),
          h('div',{'data-bd-row':''},
            h('button',{'data-bd-btn':'',disabled:busy==='install',onClick:onInstall},st.venvReady?'重装主依赖':'安装主依赖'),
            h('button',{'data-bd-btn':'',onClick:()=>onOpenManage('firststart')},'管理中心登录设置 ↗'),
            h('button',{'data-bd-btn':'',disabled:busy==='check',onClick:onCheck},'检查账号'),
            h('button',{'data-bd-btn':'',disabled:busy==='selfcheck',onClick:onSelfCheck},'环境自检')),
          h('div',{'data-bd-note':''},'扫码登录统一由管理中心 → 首次设置管理。'),
          st.installTail?h('pre',{'data-bd-pre':''},String(st.installTail).slice(-2500)):null),

        /* ── 定时 ── */
        /* v2.4.86: 偏好、互动、高级的配置统一搬到管理中心；不再显示原生设置多标签。 */
        h('div',{'data-bd-note':''},'日常页只负责启停、运行时间和立即运行；模型、选片、点赞、动态、记忆及额度都在管理中心统一设置。'),

        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': tab === 'daily' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '什么时候自己跑'),
          h(ToggleRow, {
            label: '定时自主刷视频（可选）',
            note: '这是可选的后台活动计划，不是人生记忆或情绪系统的前提。关闭后大肥鱼仍可在主 Session 按你的要求看视频、回忆经历并处理待办；只有开启后才会按下方时段自动刷视频。',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '自定义时段自动刷'),
          }),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-note': '' }, '记忆、反思、情绪与主 Session 工具独立运行，不需要开启定时刷视频。时段与间隔只控制后台自动浏览；关闭开关不会清除已保存时间段。跨午夜例如 23:00–02:00。'),
            ...scheduleRows.map((w, i) => h('div', { key:i, 'data-bd-row': '' },
              h('span', { 'data-bd-label': '' }, `时段 ${i + 1}`),
              h('input', { 'data-bd-input':'', type:'time', style:{width:120}, value:w.start,
                'aria-label':`时段 ${i + 1} 开始`, onChange:e=>updateSchedule(i,'start',e.target.value) }),
              h('span', null, '至'),
              h('input', { 'data-bd-input':'', type:'time', style:{width:120}, value:w.end,
                'aria-label':`时段 ${i + 1} 结束`, onChange:e=>updateSchedule(i,'end',e.target.value) }),
              h('button', { 'data-bd-btn':'', disabled:Boolean(busy), onClick:()=>setPeakWindowsDraft(rows=>(rows||[]).filter((_,j)=>j!==i)) }, '删除')
            )),
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn':'', disabled:Boolean(busy)||scheduleRows.length>=16,
                onClick:()=>setPeakWindowsDraft(rows=>[...(rows||[]),{start:'',end:''}]) }, '＋ 添加时间段'),
              h('button', { 'data-bd-btn':'', 'data-primary':'', disabled:Boolean(busy), onClick:saveSchedule }, '保存时间段')),
            scheduleRows.length===0 ? h('div', {'data-bd-msg':'','data-warn':''}, '尚未设置时段；开启自动刷后不会执行，先添加并保存一个时间段。') : null,
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '刷视频间隔（分钟）'),
                h('div', { 'data-bd-note': '' }, '1～720 分钟；跨时段共用此间隔，受每日额度及总开关约束。')),
              h('input', { 'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 720, step: 1,
                value: peakIntervalDraft ?? '',
                onChange: (e) => setPeakIntervalDraft(e.target.value),
                onBlur: () => { const raw = Number(peakIntervalDraft); const n = Number.isFinite(raw) && raw>=1 ? Math.max(1,Math.min(720,Math.floor(raw))) : 30; setPeakIntervalDraft(String(n)); patch({ peakIntervalMinutes: n }, '自动运行间隔') },
              })
            ))),


        /* 数量配额现在统一在管理中心，避免过期草稿覆盖编辑。 */
        h('div', { 'data-bd-sec':'', 'data-bd-group':'daily', 'data-bd-away':tab==='daily'?undefined:'' },
          h('div',{'data-bd-h':''},'选片数量'),
          h('div',{'data-bd-note':''},`每天最多 ${cfg.perDay} 条 · 每轮最多 ${cfg.pickPerRound} 条。本轮最多还可挑 ${st.canPickThisRound??0} 条。修改请前往管理中心 → 次数与额度。`)),

        /* ── 发言与转写 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'social', 'data-bd-away': tab === 'social' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它怎么把结果给你'),
          h('div', { 'data-bd-label': '' }, '投递方式'),
          h('select', {
            'data-bd-input': '', value: dmMode ?? 'only',
            onChange: (e) => { setDmMode(e.target.value); patch({ dmMode: e.target.value }, '投递方式') },
          },
            h('option', { value: 'only' }, '只发私信 —— 一条公开评论都不发（默认，最不打扰别人）'),
            h('option', { value: 'off' }, '只发评论 —— @ 可选（公开，别人能看见）'),
            h('option', { value: 'both' }, '私信 + 评论 —— 两边都发')),
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-label': '' }, '私信推荐收件人 UID（与评论 @ 名单独立）') : null,
          (dmMode && dmMode !== 'off') ? h('input', {
            'data-bd-input': '', value: dmUid ?? '', type: 'number', min: 0,
            placeholder: '输入用于接收刷视频报告的数字 UID',
            onChange: (e) => setDmUid(e.target.value),
            onBlur: () => patch({dmUid: Math.max(0, Math.floor(Number(dmUid)||0))}, '私信收件人 UID'),
          }) : null,
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-note': '' }, '这里的 UID 只控制刷视频报告发给谁，不是白名单，也不是公开评论 @ 对象。') : null,
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-note': '' }, '公开评论 @ 名单及每位好友的画像（关系、兴趣、邀请偏好），现统一在管理中心 → 人设与好友中编辑。'),
          h('div', { 'data-bd-note': '' }, '公开评论 @ 策略：'+({ai_select:'AI 选择部分好友',ai:'AI 判断是否 @ 全部好友',off:'永不 @',always:'每次 @ 全部好友'}[cfg.mentionMode]||'AI 决定')+'；在管理中心「人设与好友」里调整。'),
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-h': '' }, '详细诊断已移至管理中心'),
          h('div', { 'data-bd-note': '' }, '今日 @ 诊断、表情包选取原因、每日报告、后台私信记录和最近评论集中在管理中心展示，避免设置页过长。'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', onClick: () => onOpenManage() }, '打开管理中心 ↗')),
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-note': '' }, '私信内容 = 本轮每条的「标题 + 链接 + 一句话」，一轮合并成一条发。⚠️ 建议先让这个号和收件人互关：B站 对「陌生人私信」会限流，还可能不弹提醒。') : null,

          (dmMode === 'off' || dmMode === 'both') ? h('div', { 'data-bd-sep': '' }) : null,
          (dmMode === 'off' || dmMode === 'both') ? h(ToggleRow, {
            label: '自动发表评论（@ 可选）',
            note: '大肥鱼可根据视频内容决定是否 @；不需要每条 @',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }) : null,
          h('div', { 'data-bd-note': '' }, commentQuota?.ok
            ? `公开评论今日全局已占用 ${commentQuota.used} / ${commentQuota.limit} 次；次数请到管理中心 → 次数与额度编辑。`
            : '公开评论全局额度及每轮上限已移至管理中心 → 次数与额度。'),
          (dmMode === 'off' || dmMode === 'both') && sw('autoComment') ? h(ToggleRow, {
            label: 'AI 决定是否将评论同步到动态',
            note: '默认关闭。开启后 AI 会逐条认真判断：有鲜明笑点、反差、实用发现或共鸣点且单独发动态也自然时，应积极考虑同步；不是每条必发，也不是默认不发。动态正文=评论原文+视频链接，不增加模型调用。',
            on: sw('commentSyncDynamic'),
            onChange: (v) => patch({ commentSyncDynamic: v }, '评论同步动态'),
          }) : null,
          (dmMode === 'off' || dmMode === 'both') && sw('autoComment') && sw('commentSyncDynamic')
            ? h('div',{'data-bd-note':''},`动态今日已尝试 ${st?.dynamicSyncUsage?.used??0} 次；每日额度在管理中心调整。`):null,
          h('div', { 'data-bd-sep': '' }),
          h(ToggleRow, {label:'AI 自主给顶层评论附表情包（试验）',
            note:'默认关闭。仅使用你自己放入 comment-memes 文件夹的 PNG/JPG/GIF/WebP 图片（WebP 发送时转换为静态 PNG）。AI 在写评论时看情绪决定是否附图；真实上传和发送需要 B站接口许可。',
            on:sw('commentMemesEnabled'),onChange:v=>patch({commentMemesEnabled:v},'评论附表情包')}),
          h(ToggleRow, {label:'Debug：记录 AI 选择的表情包',
            note:'保存 BV号、表情包名、选择原因和发送状态到 comment-memes-debug/日期.jsonl；不保存评论正文或 Cookie。',
            on:sw('commentMemesDebug'),onChange:v=>patch({commentMemesDebug:v},'表情包 Debug')}),
          sw('commentMemesEnabled') ? h('div',{'data-bd-note':''},
            '表情包的每轮／每日次数、AI 选图提示词已移至管理中心；表情包素材继续保存在 comment-memes 文件夹。') : null,
          h('div', { 'data-bd-note': '' }, '「跑一轮」只负责挑视频和发布原创顶层评论；回复观众评论与热门评论互动的详细设置、状态和记录已移至管理中心。'),

          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-h': '' }, '后台互动（详细配置在管理中心）'),
          h(ToggleRow, {
            label: '后台自动检查并回复私信',
            note: '这里只保留总开关；白名单、陌生人规则、申请额度、最近私信和错误状态请到管理中心管理。',
            on: Boolean(dmWatch),
            onChange: (v) => { setDmWatch(v); patch({ dmWatch: v }, '后台私信监听') },
          }),
          h(ToggleRow, {
            label: '后台回复别人对我的评论',
            note: '详细限额在管理中心「次数与额度」，状态和记录在「最近评论」。',
            on: Boolean(cfg?.commentWatchReplies),
            onChange: v => patch({commentWatchReplies:v}, '后台回复评论通知'),
          }),
          h('div', { 'data-bd-note': '' }, '热评不再后台轮询：只有 AI 决定回复当前视频的评论后，才按需读取该视频其他热评。'),
          h('div', { 'data-bd-row': '' }, h('button', { 'data-bd-btn': '', onClick: () => onOpenManage() }, '管理后台互动 ↗')),
          h('div', { 'data-bd-sep': '' }),
          h(ToggleRow, {
            label: '本地转写没字幕的视频',
            note: '默认关；开了以后，没字幕的视频会在本机转写一遍（不花 API 钱）',
            on: sw('transcribe'),
            onChange: (v) => patch({ transcribe: v }, '本地转写'),
          }),
          sw('transcribe') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-row': '' },
              h('button', { 'data-bd-btn': '', disabled: busy === 'asr', onClick: onInstallAsr },
                st.asrReady ? '重装转写依赖' : '装转写依赖'),
              h('div', { 'data-bd-note': '' },
                !st.asrReady ? '还没装 —— 现在开着也没用：没字幕的视频会被跳过（报告里会写"因无字幕跳过 N 条"）'
                  : (st.asrModelReady ? '环境和模型都好了' : '环境好了；模型会在第一次转写时自动下（几百 MB）'))),
            h('div', { 'data-bd-note': '' },
              '点一下就好：建一个独立环境、装 faster-whisper + yt-dlp，并把 Whisper 模型也下好',
              h('br'),
              '（模型默认 small，几百 MB，走国内镜像；装一次就够了）'),
            st.asrTail ? h('div', null,
              h('div', { 'data-bd-note': '' }, st.asrInstalling ? '正在装转写依赖（进度）：' : '转写依赖的日志（末尾）—— 只有「没字幕的视频」用得到它：'),
              h('pre', { 'data-bd-pre': '' }, st.asrTail)) : null) : null),

        /* 复杂内容管理统一进入管理中心；原设置页只保留少量基础开关。 */
        h('div',{'data-bd-sec':'','data-bd-group':'taste','data-bd-away':tab==='taste'?undefined:''},
          h('div',{'data-bd-h':''},'🐳 大肥鱼 · 成长记忆'),
          h('div',{'data-bd-note':''},'添加反馈、审核行为与表达改进建议、撤销修改和预览提示词都集中在管理中心。兴趣趋势和长期经历请到「人生记忆」查看；核心人设仍由你控制。'),
          h('div',{'data-bd-row':''},h('button',{'data-bd-btn':'','data-primary':'',onClick:()=>onOpenManage()},'管理成长记忆 ↗'))),

        h('div',{'data-bd-sec':'','data-bd-group':'taste','data-bd-away':tab==='taste'?undefined:''},
          h('div',{'data-bd-h':''},'🧠 梗知识库 · 长期记忆'),
          h(ToggleRow,{
            label:'记住视频里的梗和角色',
            note:'关闭只暂停新记录和检索，不删除历史。梗的查询、释义修改、审核通过／拒绝和删除都在管理中心。',
            on:cfg.memeMemoryEnabled!==false,
            onChange:v=>patch({memeMemoryEnabled:v},'梗知识库'),
          }),
          h('div',{'data-bd-note':''},'知识库最多保存条数在管理中心 → 次数与额度中设置。'),
          h('div',{'data-bd-note':''},'新学到的梗先待审核；管理中心可搜索、修改名称／别名／释义、批准或拒绝，并查看来源证据。'),
          h('div',{'data-bd-row':''},h('button',{'data-bd-btn':'','data-primary':'',onClick:()=>onOpenManage()},'管理梗知识库 ↗'))),

        /* ── 关注什么 / 在哪儿刷 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'taste', 'data-bd-away': tab === 'taste' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '👀 视频预览快照识图（试验功能）'),
          h(ToggleRow, {label:'开启低清预览识图', note:'默认关闭；由视频 Agent 综合播放量、评论、弹幕及视觉梗价值自行决定要不要识图。冷门但有明确画面梗也可识图，绝不默认每条都分析；每轮最多 2 条。',
            on:sw('visionEnabled'),onChange:v=>patch({visionEnabled:v},'预览识图总开关')}),
          h(ToggleRow, {label:'Debug：保存实际预览图', note:'默认关闭；开启后把送去识图的 JPEG 保存到插件数据目录 vision-debug/BV号/，方便自己查看。',
            on:sw('visionDebug'),onChange:v=>patch({visionDebug:v},'预览图调试保存')}),
          h('div',{'data-bd-note':''},'视觉识图提示词已移至管理中心 → 人设与好友。'),
          (cfg.visionEnabled||cfg.visionDebug) ? h('div',{'data-bd-sub':''},
            h('div',{'data-bd-label':''},'识图方式'),
            h('div',{'data-bd-row':''},
              h('select',{'data-bd-input':'',value:['reuse_video_model','independent_dsh','auto'].includes(cfg.visionMode)?cfg.visionMode:'reuse_video_model',style:{width:'100%',maxWidth:'570px'},
                onChange:e=>patch({visionMode:e.target.value},'视觉处理模式')},
                h('option',{value:'reuse_video_model'},'复用刷视频 / 视频分析模型（推荐，不额外配置密钥）'),
                h('option',{value:'independent_dsh'},'独立 DSH 视觉模型（单独配置 Provider / 模型 / 思考深度）'),
                h('option',{value:'auto'},'自动优先复用视频模型（不暗中另调用其他付费模型）'))),
            h('div',{'data-bd-note':''},'复用模式：图片经 DSH MCP 直接交给当前视频 Agent，与已有字幕、弹幕一起判断。独立模式：通过 DSH 账号已有的模型路由另起一个只读视觉 Agent；不需要单独填写 API Key 或 API 地址。两种模式都要求所选模型支持图片输入。'),
            cfg.visionMode==='independent_dsh' ? h('div',{'data-bd-sub':''},
              h('div',{'data-bd-label':''},'独立视觉模型（与其他模型设置相同格式）'),
              ...[['visionModelProvider','模型提供方 Provider（可留空）','如 claude'],
                  ['visionModelId','模型 ID（可留空）','如 claude-haiku-5-5'],
                  ['visionReasoningEffort','思考深度（自由输入，可留空）','如 medium']].map(([key,label,placeholder])=>
                h('div',{key},h('div',{'data-bd-note':''},label),
                  h('input',{'data-bd-input':'',value:(visionDraft||{})[key]??'',placeholder,
                    onChange:e=>setVisionDraft(old=>({...old,[key]:e.target.value})),
                    onBlur:()=>patch({[key]:(visionDraft||{})[key]||''},label)}))),
              h('div',{'data-bd-note':''},'留空时优先继承刷视频模型的相应配置。独立视觉 Agent 与主视频 Agent 是两次 DSH 模型会话，但不走旧的 API Key/DPAPI 接口。')):null,
            h('div',{'data-bd-note':''},`每条取图 ${cfg.visionFrames??2} 张；额外独立视觉模型每日最多 ${cfg.visionDailyLimit??30} 次（复用视频模型看图不扣此额度）。两项分别在管理中心 → 次数与额度修改。`),
            h('div',{'data-bd-note':''},'不再需要视觉 API Key。旧版本本地可能保存过 DPAPI 加密文件，升级不会读取或上传它；如需清理，可删除 bili-duty 目录中的 .vision-api-key.dpapi。'),
            h('div',{'data-bd-row':''},
              h('input',{'data-bd-input':'',placeholder:'输入一个 BV 号，测试预览图片',style:{flex:1,minWidth:'180px'},value:visionBV,
                onChange:e=>setVisionBV(e.target.value)}),
              h('button',{'data-bd-btn':'','data-primary':'',disabled:visionBusy||!/^BV[0-9A-Za-z]{10}$/.test(visionBV.trim()),
                onClick:async()=>{setVisionBusy(true);setVisionTest(null);try{setVisionTest(await jpost('/vision-preview-test',{bvid:visionBV.trim()}))}catch(e){setVisionTest({ok:false,error:String(e?.message||e)})}finally{setVisionBusy(false)}}},visionBusy?'正在检查…':'测试预览')),
            visionTest ? h('div',{'data-bd-msg':'','data-warn':visionTest.error?'':undefined},
              `状态：${visionTest.status||'失败'} ${visionTest.error||''}`,
              visionTest.times?.length ? ` | 时间点：${visionTest.times.join('、')} 秒` : '',
              visionTest.description ? h('div',{'data-bd-pre':''},visionTest.description) : null,
              visionTest.debug_dir ? h('div',null,'预览图保存到：'+visionTest.debug_dir) : null) : null,
            h('div',{'data-bd-note':''},'Windows 默认目录：C:\\Users\\你的账号\\.dsh\\bili-duty\\vision-debug\\BV号。关闭 Debug 后不会自动删除旧图片。')):null,
          h('div',{'data-bd-sep':''})),
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'taste', 'data-bd-away': tab === 'taste' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '选片来源'),
          h(ToggleRow, {label:'加入首页推荐视频', note:'默认开启；与兴趣主导的主题搜索混合选片。每轮首页推荐最多读取一次、最多12个候选，过滤直播与广告。是否挑中仍由大肥鱼判断，共用原有额度。',
            on:sw('homeRecommendationsEnabled'),onChange:v=>patch({homeRecommendationsEnabled:v},'首页推荐选片来源')}),
          h('div', { 'data-bd-note':'' }, `当前入选门槛：播放 ${cfg.minVideoViews??1000}、点赞 ${cfg.minVideoLikes??10}、评论 ${cfg.minVideoReplies??3}。到管理中心 → 次数与额度修改。`),
          h('div', { 'data-bd-h': '' }, '主人额外指定的关注主题'),
          h('textarea', {
            'data-bd-input': '', rows: 5, placeholder: '可留空；一行一个额外关注主题（兴趣档案负责主要选片）',
            value: kws ?? '', onChange: (e) => setKws(e.target.value),
          }),
          h('div', { 'data-bd-note':'' }, '日常选片主要由「人生记忆 → 兴趣趋势」决定；这里写的词是主人额外希望关注的方向，不会覆盖兴趣档案或人设。'),
          h('div', { 'data-bd-label': '' }, '日报写多细'),
          h('select', {
            'data-bd-input': '', value: rl ?? 'full',
            onChange: (e) => { setRl(e.target.value); patch({ reportLevel: e.target.value }, '日报形态') },
          },
            h('option', { value: 'full' }, '完整 —— 每条：标题 / UP / 为什么值得（默认）'),
            h('option', { value: 'brief' }, '薄 —— 每条一两行，只留值不值得 + 链接'),
            h('option', { value: 'off' }, '不写 —— 只发评论，不生成日报文件')),
        h('div', { 'data-bd-h': '' }, '大肥鱼自主点赞与收藏'),
        h(ToggleRow, {label:'允许大肥鱼自己决定点赞', note:'看完并真心认可才点赞；每天最多 10 条，不为凑数自动点赞。初次升级默认关闭。',
          on:sw('autoVideoLike'),onChange:v=>patch({autoVideoLike:v},'自主点赞')}),
        h('div', { 'data-bd-note': '' }, '此开关只控制刷视频时由大肥鱼自主决定是否点赞。你在主 Session 明确要求给指定 BV 点赞时，可调用单条手动点赞工具；手动与自动点赞共用每日点赞上限，并受总开关、登录状态和防重复保护。'),
        h(ToggleRow, {label:'允许大肥鱼自己建夹、选择性收藏', note:'只有值得重看的视频才收藏；新建夹公开状态由鱼鱼选择（可在管理中心强制隐藏/公开）。初次升级自主收藏仍默认关闭。',
          on:sw('autoVideoCollect'),onChange:v=>patch({autoVideoCollect:v},'自主收藏')}),
        h(ToggleRow, {label:'允许鱼鱼删除自己创建的主题收藏夹（默认开）', note:'只限经本插件创建账本核对的收藏夹，最多每天一次；不会删除账号原有收藏夹。',
          on:cfg.autoFavoriteDelete!==false,onChange:v=>patch({autoFavoriteDelete:v},'自主整理收藏夹')}),
        h('div', { 'data-bd-note': '' }, '新建收藏夹的公开/隐藏策略可在管理中心 → 视频探索与自主行动设置；默认由鱼鱼自行决定。'),
        h('div', { 'data-bd-note': '' }, '旧版「全部挑中视频统一收藏」已停止执行。既有收藏夹和历史收藏不会被清空或移动。'),

          h('div', { 'data-bd-row': '' },
            msg ? h('div', { 'data-bd-msg': '', 'data-good': msgTone === 'good' ? '' : undefined, 'data-warn': msgTone === 'warn' ? '' : undefined }, msg) : null)),

        /* ── 环境与账号 ── */
        /* ── 它刷过的视频 ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': tab === 'daily' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它刷过的视频'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'watched', onClick: () => (watchedRows !== null ? setWatchedRows(null) : onLoadWatched(watchedState, watchedTier, watchedOffset)) },
              watchedRows !== null ? '收起' : '看它刷过什么'),
            watchedRows !== null ? h('button', { 'data-bd-btn': '', disabled: busy === 'watched', onClick: () => onLoadWatched(watchedState, watchedTier, 0) }, '刷新') : null,
            h('div', { 'data-bd-note': '' },
              watchedRows === null ? '（点一下读出来；数据来自 seen.md + 日报 + 视频归档）'
                : (watchedTotal ? `共 ${watchedTotal} 条` : '这一类还没有记录 —— 跑一轮之后就有了'))),
          watchedRows !== null ? h('div', { 'data-bd-row': '' },
            [['', '全部'], ['picked', '挑了'], ['skipped', '跳过'], ['commented', '发给你了']].map(([v, label]) =>
              h('button', { key: v || 'all', 'data-bd-chip': '', 'aria-selected': watchedState === v ? 'true' : 'false', onClick: () => onWatchPick('state', v) }, label)),
            ['值得看', '可以看', '不值当'].map((v) =>
              h('button', { key: v, 'data-bd-chip': '', 'aria-selected': watchedTier === v ? 'true' : 'false', onClick: () => onWatchPick('tier', v) }, v))) : null,
          watchedRows !== null && watchedRows.length ? h('div', { 'data-bd-list': '' },
            watchedRows.map((x, i) => h('div', { key: x.day + x.bvid, 'data-bd-item': '' },
              // 封面走宿主代理（直连 i0.hdslb.com 会被防盗链挡，也等于把使用者 IP 交出去）
              i < 40 ? h('img', { 'data-bd-cover': '', src: API + '/cover?bv=' + x.bvid, loading: 'lazy', alt: '' }) : null,
              h('div', { 'data-bd-item-body': '' },
                h('div', { 'data-bd-item-t': '' },
                  h('a', { href: x.url, target: '_blank', rel: 'noreferrer' }, x.title)),
                h('div', { 'data-bd-item-n': '' },
                  `${x.day} · ${x.up} · `, x.picked ? '挑中了' : (x.status && /跳过/.test(x.status) ? '跳过' : '看过'), (x.delivered || x.commented) ? ' · 已发给你' : '',
                  x.tier ? h('span', { 'data-bd-tier': x.tier }, ' · ' + x.tier) : null),
                x.why ? h('div', { 'data-bd-item-why': '' }, x.why) : null))))
            : null,
          watchedRows !== null && watchedTotal > WATCH_PAGE ? h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: watchedOffset <= 0, onClick: () => onWatchPage(-WATCH_PAGE) }, '上一页'),
            h('div', { 'data-bd-note': '' }, `${watchedOffset + 1}–${Math.min(watchedOffset + WATCH_PAGE, watchedTotal)} / ${watchedTotal}`),
            h('button', { 'data-bd-btn': '', disabled: watchedOffset + WATCH_PAGE >= watchedTotal, onClick: () => onWatchPage(WATCH_PAGE) }, '下一页')) : null),

        h('div', { 'data-bd-sec': '', 'data-bd-group': 'adv', 'data-bd-away': tab === 'adv' ? undefined : '' },
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'diag', onClick: onDiagnose }, '复制诊断信息'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'selfcheck', onClick: onSelfCheck }, '环境自检'),
            h('div', { 'data-bd-note': '' }, '出问题时先点这两个：第一个把环境+日志拼成一段（已自动复制），第二个逐项告诉你哪一步不通。')),
          checks && checks.length ? h('div', { 'data-bd-list': '', 'data-bd-checks': '' },
            checks.map((x) => h('div', { key: x.name, 'data-bd-item': '', 'data-bd-item-t': '' },
              h('div', { 'data-bd-item-t': '' }, (x.ok ? '正常 · ' : '有问题 · ') + x.name),
              h('div', { 'data-bd-item-n': '' }, x.detail || ''),
              x.ok ? null : h('div', { 'data-bd-item-why': '' }, '怎么办：' + (x.fix || '把诊断信息发给作者'))))) : null,
          diag ? h('pre', { 'data-bd-pre': '' }, diag) : null,
          h('div',{'data-bd-h':''},'模型路由：刷视频与后台互动独立配置'),
          h('div',{'data-bd-note':''},'提供方(provider)、模型 ID 为空时继承 DSH 当前配置；思考深度为自由文本，按模型支持的原始格式填写。保存后下次启动 Agent 生效。'),
          ...[
            ['video','刷视频 / 视频分析'],['interaction','后台私信 / 评论互动']
          ].map(([prefix,title])=>h('div',{'data-bd-sub':'',key:prefix},
            h('div',{'data-bd-label':''},title),
            ...[
              [prefix+'ModelProvider','模型提供方 Provider（可留空）','如 deepseek-account'],
              [prefix+'ModelId','模型 ID（可留空）','如 deepseek-chat'],
              [prefix+'ReasoningEffort','思考深度（自由输入，可留空）','填写该模型支持的原始值']
            ].map(([key,label,placeholder])=>h('div',{key},
              h('div',{'data-bd-note':''},label),
              h('input',{'data-bd-input':'',value:(modelDraft||{})[key]??'',placeholder,
                onChange:e=>setModelDraft(old=>({...old,[key]:e.target.value})),
                onBlur:()=>patch({[key]:(modelDraft||{})[key]||'',clear:[key]},'模型参数 '+key)}))))),
          h('div',{'data-bd-note':''},'后台互动沿用原有统一批量生成队列：私信与评论共享一个互动模型，节省重复人设提示词。'),
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-h': '' }, '环境与账号'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'install', onClick: onInstall },
              st.venvReady ? '重装主依赖' : '装主依赖（建 venv）'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'check', onClick: onCheck }, '测一下'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'update', onClick: onCheckUpdate }, '检查更新'),
            newVer ? h('button', { 'data-bd-btn': '', 'data-primary': '', disabled: busy === 'upgrade', onClick: onUpgrade }, '一键升级到 v' + newVer) : null,
            h('button', { 'data-bd-btn': '', onClick:()=>onOpenManage('firststart') }, '管理中心登录设置 ↗'),
            h('div', { 'data-bd-note': '' },
              !st.venvReady ? (st.installFailed ? '上次没装成 → 看下面日志' : '还没装 → 先点「装主依赖」')
                : (st.loggedIn ? '已有 B站凭据，可在管理中心重新验证' : '环境好了 → 去管理中心登录 B站'))),
          h('div', { 'data-bd-note': '' }, 'B站账号登录已统一到管理中心；本页只保留环境安装。'),
          st.installTail ? h('div', null,
            h('div', { 'data-bd-note': '' }, st.installing ? '正在装主依赖（进度）：' : '主依赖的日志（B站 搜索 / 字幕 / 评论 用得到，末尾）：'),
            h('pre', { 'data-bd-pre': '' }, st.installTail)) : null,
          h('div', { 'data-bd-note': '' }, '如需重新登录，请前往大肥鱼管理中心 → 首次设置。')),
          (Array.isArray(st.missingDeps) && st.missingDeps.length)
            ? h('div', { 'data-bd-note': '' }, '还缺这几项：' + st.missingDeps.join(' / ') + '（qrcode = 画登录二维码用的）—— 点一次「重装主依赖」就会补上')
            : null,

        /* ── 它是怎么干活的（给他看的） ── */
        h('div', { 'data-bd-sec': '', 'data-bd-group': 'adv', 'data-bd-away': tab === 'adv' ? undefined : '' },
          h('div', { 'data-bd-h': '' }, '它的地盘'),
          h('div', { 'data-bd-kv': '' },
            `家目录：${st.home}`,
            h('br'),
            `今天的报告：${st.report}`),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', onClick: () => onOpenManage() }, '查看日报与最近评论 ↗'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('out') }, '打开报告文件夹'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('home') }, '打开家目录'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'verify', onClick: onVerify }, '复核评论'),
            h('button', { 'data-bd-btn': '', onClick: () => copyText(st.report) }, '复制报告路径'))),

        h('div', { 'data-bd-sec': '', 'data-bd-group': 'daily', 'data-bd-away': undefined },
          h('div', { 'data-bd-h': '' }, '作者与开源致谢'),
          h('div', { 'data-bd-label': '' }, '这不是一个只会发评论的机器人，而是一套让“大肥鱼”在 DSH 里持续生活的系统：后台出去看 B站，主 Session 作为她的家，重要经历、主人相处、朋友关系、梗和互动结果都能长期留下。'),
          h('div', { 'data-bd-note': '' }, '项目包名：dsh-dafeiyu-life · 当前版本：v' + (st.version || '?') + '。B站只是她目前最完整的一块“生活场景”，不是整个项目的边界。'),
          h('div', { 'data-bd-row': '' },
            h('a', { 'data-bd-btn':'', href:'https://github.com/minedalang/dsh-dafeiyu-life', target:'_blank', rel:'noreferrer' }, '项目仓库 ↗'),
            h('a', { 'data-bd-btn':'', href:'https://github.com/minedalang/dsh-dafeiyu-life/blob/main/THIRD_PARTY_NOTICES.md', target:'_blank', rel:'noreferrer' }, '第三方声明 ↗')),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-h': '' }, '作者的 B站主页'),
            h('a', { href:'https://space.bilibili.com/210228238', target:'_blank', rel:'noopener noreferrer', 'data-bd-author-link': '' }, '长条动物')),
          h('div', { 'data-bd-sep': '' }),
          h('div', { 'data-bd-h': '' }, '开源来源与致谢'),
          h('div', { 'data-bd-note': '' }, '这个项目不是凭空出现的。下面这些开源项目提供了直接的代码基础、第三方能力或重要的架构启发；本项目保留相应许可证和署名，并明确区分“直接衍生 / 内置代码 / 架构启发”。'),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, 'c1overzz/dsh-bili-scroll'),
            h('div', { 'data-bd-note': '' }, '直接上游与代码血缘基础（MIT）。大肥鱼最初的 B站值班、报告与插件骨架来自这里。'),
            h('a', { href:'https://github.com/c1overzz/dsh-bili-scroll', target:'_blank', rel:'noreferrer' }, '打开上游仓库 ↗')),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, 'adoresever/bilibili-mcp · AGI_Ananas'),
            h('div', { 'data-bd-note': '' }, '内置 Python B站 MCP 的上游（MIT）。登录、视频、字幕、评论等底层能力在其基础上持续修改与加固。'),
            h('a', { href:'https://github.com/adoresever/bilibili-mcp', target:'_blank', rel:'noreferrer' }, '打开上游仓库 ↗')),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, 'Yuuyuko-uu/dsh-fish-memory'),
            h('div', { 'data-bd-note': '' }, '内置长期人格记忆的核心设计与部分实现来源（MIT）：按 Session 存储、淡忘、事实键、取代语义和相关召回。'),
            h('a', { href:'https://github.com/Yuuyuko-uu/dsh-fish-memory', target:'_blank', rel:'noreferrer' }, '打开上游仓库 ↗')),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, 'Yuuyuko-uu/dsh-bili-subagent'),
            h('div', { 'data-bd-note': '' }, '“AI 伙伴有一个长期的家，出去活动后再把经历带回来”的产品/架构思路给了重要启发；本项目没有把该仓库源码作为 vendor 代码打包。'),
            h('a', { href:'https://github.com/Yuuyuko-uu/dsh-bili-subagent', target:'_blank', rel:'noreferrer' }, '打开参考仓库 ↗')),
          h('div', { 'data-bd-note': '' }, '完整许可证、修改边界与第三方声明见仓库根目录 NOTICE.md、THIRD_PARTY_NOTICES.md、CONTRIBUTORS.md。感谢所有上游作者与社区贡献者。')),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-dafeiyu-life')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-dafeiyu-life: 设置页样式')

        // ⭐ 进「设置」：label 就是左侧导航里那一项（抄 dsh-meme 的写法）
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dafeiyu-life', order: 30, label: '大肥鱼' },
          () => h(Panel),
        ))

  // ⭐ 2026-10-20 实验：会话头第三个 tab（0.2.1 里这个槽位真实存在；老版本没有就静默跳过）
  try {
    slots.inject('conversation.view', () => slots.register({
      name: 'conversation.view',
      id: 'bili-watched',
      order: 20,
      label: '大肥鱼足迹',
      scope: 'session',
    }, () => h(WatchTab)))
  } catch (e) { /* 没有这个槽位就算了 */ }
      },
    }
  },
})
