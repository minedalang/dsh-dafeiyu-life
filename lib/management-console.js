'use strict';
// No eval/innerHTML for user-supplied strings. Same-origin local console only.
(() => {
  const API='/api/bili-duty';
  // DSH Mobile's Android WebView is a remote companion, not a privileged local
  // management session. Do not send state-changing requests that the gateway
  // may reject; let the user inspect data and finish setup on the host PC.
  const mobileViewOnly=typeof navigator!=='undefined'&&/Android/i.test(String(navigator.userAgent||''));
  const mobileDesktopHint='此项需要在运行 DSH 的电脑端管理中心完成；DSH Mobile 手机端目前仅供查看。';
  const mobileReadOnlySelector='[data-tab],[data-open-tab],[data-open-settings],[data-nav-tab],[data-memory-kind],#refresh,#headless-sync-refresh,#models-refresh';
  const mobileButtonAllowed=button=>button.matches(mobileReadOnlySelector);
  const lockMobileControls=()=>{
    if(!mobileViewOnly)return;
    document.querySelectorAll('button').forEach(button=>{
      if(mobileButtonAllowed(button))return;
      if(!button.disabled)button.disabled=true;button.classList.add('mobile-locked');button.title=mobileDesktopHint;
      button.setAttribute('aria-label',(button.textContent||'操作').trim()+'（仅限电脑端）');
    });
    document.querySelectorAll('input,select,textarea').forEach(input=>{
      if(input.disabled)return;
      // Preserve text search and local-only filters where possible.
      if(input.matches('input[type="search"]'))return;
      input.disabled=true;input.classList.add('mobile-locked');input.title=mobileDesktopHint;
    });
  };

  const $=id=>document.getElementById(id);
  const node=(tag,text='',className='')=>{const e=document.createElement(tag);if(className)e.className=className;e.textContent=String(text??'');return e};
  const pill=(status)=>node('span',({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[status]||status,'pill '+status);
  const add=(e,...items)=>{for(const x of items)if(x)e.appendChild(x);return e};
  const info=(x)=>node('p',x,'muted');
  // Persisted ISO timestamps are UTC instants. Render them consistently in
  // the viewer's local timezone; never display the UTC prefix as local time.
  // Date-only evidence has no verified time of day and must not become midnight.
  const formatLocalTime=value=>{
    const raw=String(value??'').trim();
    if(!raw)return '时间未记录';
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw+' · 具体时刻未记录';
    const date=new Date(value);
    return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):'时间未记录';
  };
  const btn=(text,fn,kind='')=>{const b=node('button',text,kind);b.type='button';b.addEventListener('click',()=>run(fn));return b};
  let toastTimer=null,pendingRequests=0;
  const message=(m,bad=false)=>{
    const value=String(m||''),e=$('message'),toast=$('action-toast');
    e.textContent=value;e.style.color=bad?'var(--bad)':'var(--action)';
    clearTimeout(toastTimer);
    if(!value){toast.hidden=true;return}
    toast.textContent=value;toast.dataset.tone=bad?'error':'success';toast.hidden=false;
    toastTimer=setTimeout(()=>{toast.hidden=true},bad?12000:5500);
  };
  // 统一为管理中心中的异步操作提供即时反馈；不掩盖具体模型/配额错误。
  const run=async(fn)=>{
    const focused=document.activeElement;
    const button=focused?.tagName==='BUTTON'&&!focused.disabled?focused:null;
    const before=$('message').textContent;
    if(button){button.disabled=true;button.classList.add('is-busy');button.setAttribute('aria-busy','true')}
    message('正在处理，请稍候…');
    try{await fn();if($('message').textContent==='正在处理，请稍候…'||$('message').textContent===before)message('操作已完成')}
    catch(e){message(e?.message||'操作失败',true)}
    finally{if(button){button.disabled=mobileViewOnly&&!mobileButtonAllowed(button);button.classList.remove('is-busy');button.removeAttribute('aria-busy')}}
  };
  const request=async(path,body)=>{
    // Security boundary is also server-side; this is a UX guard, not auth.
    if(mobileViewOnly&&body!==undefined)throw Error(mobileDesktopHint);
    const indicator=$('request-indicator');pendingRequests++;indicator.hidden=false;
    const controller=typeof AbortController==='function'?new AbortController():null;const timeout=controller?setTimeout(()=>controller.abort(),120000):null;
    try{
      const res=await fetch(API+path,body===undefined?{credentials:'same-origin',...(controller?{signal:controller.signal}:{})}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(controller?{signal:controller.signal}:{})});
      let data;try{data=await res.json()}catch{
        if(res.status===401||res.status===403)
          throw Error(mobileViewOnly?'此页的数据在手机端受到网关访问限制，请在电脑端查看或设置。':'管理接口 HTTP '+res.status+'：请检查当前管理页面的登录、同源校验和网关授权。');
        throw Error('服务器未返回 JSON（HTTP '+res.status+'）')
      }
      // These are structured Life decision outcomes, not transport failures.
      // Preserve their diagnosticCode even when the API deliberately uses HTTP 409.
      if(res.status===409&&data?.ok===false&&
        ['/life-agent/wake','/life-opportunities/reconsider'].includes(path)&&
        ['metadata-read-failed','invalid-decision','model-or-execution-error','failed'].includes(data.result))return data;
      if(!res.ok||data?.ok===false){
        if(mobileViewOnly&&(res.status===401||res.status===403))
          throw Error('此项在手机端不可用，请在电脑端管理中心查看或操作。');
        const raw=String(data?.error||'请求失败');
        if(path==='/daily-dynamic/delete'&&res.status===404&&/^unknown POST \/api\/bili-duty\/daily-dynamic\/delete$/.test(raw))
          throw Error('运行中的 DSH 插件后端仍是旧版，不支持草稿删除。请确认加载的是当前 dev 源码，重启 DSH 后强制刷新管理页面（Ctrl+F5）。');
        throw Error(raw.slice(0,220));
      }
      return data;
    }catch(e){if(e?.name==='AbortError')throw Error('请求超过120秒仍未完成。请查看诊断或模型配置；若涉及对外发送，请先核实结果，避免重复操作。');throw e}
    finally{clearTimeout(timeout);pendingRequests=Math.max(0,pendingRequests-1);indicator.hidden=pendingRequests===0}
  };
  // 统一样式的异步弹窗：不使用 window.confirm/prompt/alert。
  // 降级路径也使用自有遮罩，不调用系统默认对话框。
  const showStyledDialog=(dialog,close)=>{
    if(typeof dialog.showModal==='function'){dialog.showModal();return}
    const overlay=node('div','','action-dialog-backdrop');overlay.setAttribute('aria-hidden','true');
    document.body.appendChild(overlay);dialog.setAttribute('open','');
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();close('cancel')}};
    document.addEventListener('keydown',escape);
    dialog._styledFallbackCleanup=()=>{dialog.removeAttribute('open');overlay.remove();document.removeEventListener('keydown',escape)};
  };
  const confirmAction=({title='请确认操作',description='',confirmLabel='确认继续',danger=false})=>new Promise(resolve=>{
    const dialog=$('action-confirm-dialog');if(dialog.open){resolve(false);return}dialog.returnValue='';
    $('action-confirm-title').textContent=title;
    $('action-confirm-description').textContent=String(description);
    $('action-confirm-accept').textContent=confirmLabel;
    dialog.classList.toggle('danger',danger);
    const cancel=$('action-confirm-cancel'),accept=$('action-confirm-accept');let settled=false;
    const finish=value=>{if(settled)return;settled=true;cancel.removeEventListener('click',dismiss);accept.removeEventListener('click',proceed);dialog.removeEventListener('close',closed);dialog._styledFallbackCleanup?.();dialog._styledFallbackCleanup=null;resolve(value==='confirm')};
    const dismiss=()=>{if(dialog._styledFallbackCleanup)finish('cancel');else dialog.close('cancel')};
    const proceed=()=>{if(dialog._styledFallbackCleanup)finish('confirm');else dialog.close('confirm')};
    const closed=()=>finish(dialog.returnValue);
    cancel.addEventListener('click',dismiss);accept.addEventListener('click',proceed);dialog.addEventListener('close',closed);
    showStyledDialog(dialog,dismiss);cancel.focus();
  });
  const inputAction=({title='请输入内容',description='',initial='',readOnly=false})=>new Promise(resolve=>{
    const dialog=$('action-input-dialog');if(dialog.open){resolve(null);return}dialog.returnValue='';
    const field=$('action-input-value');$('action-input-title').textContent=title;
    $('action-input-label').textContent=description||'内容';field.value=String(initial);field.readOnly=readOnly;
    $('action-input-accept').textContent=readOnly?'完成':'确认';let settled=false;
    const cancel=$('action-input-cancel'),accept=$('action-input-accept');
    const finish=value=>{if(settled)return;settled=true;cancel.removeEventListener('click',dismiss);accept.removeEventListener('click',proceed);dialog.removeEventListener('close',closed);dialog._styledFallbackCleanup?.();dialog._styledFallbackCleanup=null;resolve(value==='confirm'?field.value:null)};
    const dismiss=()=>{if(dialog._styledFallbackCleanup)finish('cancel');else dialog.close('cancel')};
    const proceed=()=>{if(dialog._styledFallbackCleanup)finish('confirm');else dialog.close('confirm')};
    const closed=()=>finish(dialog.returnValue);
    cancel.addEventListener('click',dismiss);accept.addEventListener('click',proceed);dialog.addEventListener('close',closed);
    showStyledDialog(dialog,dismiss);field.focus();field.select();
  });
  const badge=(id,n)=>{const e=$(id);e.hidden=!n;e.textContent=String(n)};
  const setLearningState=(id,enabled,onText,offText)=>{const el=$(id);if(!el)return;el.textContent=enabled?'● 大肥鱼'+onText:'● '+offText;el.classList.toggle('paused',!enabled)};
  // 沙盒只保留 UI 播放游标；不持久化任何模拟经历或人格数据。
  const sandboxStorageKey='dafeiyu-personality-sandbox-ui-v1';
  let sandboxActive=false,sandboxPlaying=false,sandboxStep=0,sandboxSpeed=1400,sandboxBusy=false,sandboxTimer=null,sandboxRenderEpoch=0;
  try{const saved=JSON.parse(sessionStorage.getItem(sandboxStorageKey)||'null');if(saved&&saved.active===true){sandboxActive=true;sandboxPlaying=saved.playing===true;sandboxStep=Math.max(0,Math.min(100000,Number(saved.step)||0));sandboxSpeed=[600,1400,2600].includes(saved.speed)?saved.speed:1400}}catch{}
  const rememberSandbox=()=>{try{if(sandboxActive)sessionStorage.setItem(sandboxStorageKey,JSON.stringify({active:true,playing:sandboxPlaying,step:sandboxStep,speed:sandboxSpeed}));else sessionStorage.removeItem(sandboxStorageKey)}catch{}};
  const aiDebugStorageKey='dafeiyu-personality-ai-debug-session-v1';
  let aiDebugActive=false,aiDebugHistory=[],aiDebugPreview=null,aiDebugRaw='',aiDebugResult=null;
  try{const saved=JSON.parse(sessionStorage.getItem(aiDebugStorageKey)||'null');if(saved&&Array.isArray(saved.history)&&saved.history.length<=24&&saved.preview?.aiJudged===true){aiDebugHistory=saved.history;aiDebugPreview=saved.preview;aiDebugActive=saved.active===true}}catch{}
  const rememberAiDebug=()=>{try{if(aiDebugHistory.length)sessionStorage.setItem(aiDebugStorageKey,JSON.stringify({history:aiDebugHistory,preview:aiDebugPreview,active:aiDebugActive}));else sessionStorage.removeItem(aiDebugStorageKey)}catch{}};

  const haltSandboxTimer=()=>{if(sandboxTimer!==null){clearInterval(sandboxTimer);sandboxTimer=null}};
  let active='persona',firstNavigation=true;
  const refresh=()=>loaders[active]();
  const refreshActivityTicker=async()=>{
    const target=$('activity-ticker-text');if(!target)return;
    try{
      let data=null;
      try{
        const result=await fetch(API+'/activity-feed?limit=8',{credentials:'same-origin'});
        if(result.ok)data=await result.json();
      }catch{ /* 网关未代理新的路径时，从现有状态接口读取同一份经过鉴权的数据 */ }
      if(!data?.ok){const status=await request('/status');data=status?.activityFeed}
      if(!data?.ok)throw Error('活动状态暂不可用');
      const rows=Array.isArray(data.items)?data.items:[];
      target.textContent=rows.length?rows.slice(-6).reverse().map(x=>{
        const time=new Date(x.at);const hh=Number.isFinite(time.getTime())?time.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'';
        return hh+'  '+String(x.text||'生活事件')+(x.count?' · '+x.count+' 条':'');
      }).join('   ✦   '):'鱼鱼暂时没有新的活动记录；只展示真实处理结果，不编造正在做的事';
      const clock=$('activity-ticker-clock');if(clock)clock.textContent='约 12 秒刷新';
    }catch{target.textContent='暂未取得活动播报；可以刷新状态或在电脑端查看详细日志'}
  };
  void refreshActivityTicker();const activityTickerTimer=typeof setInterval==='function'?setInterval(()=>{if(!document.hidden)void refreshActivityTicker()},12000):null;
  if(activityTickerTimer!==null)window.addEventListener('pagehide',()=>clearInterval(activityTickerTimer),{once:true});
  const tabNames=['firststart','persona','social','home','models','bili','dynamic','life-agent','life','todos','relationships','personality','comments','dm','growth','stickers','meme','quotas','polling','reports','diagnostics','backup'];
  let onboarding=null;
  const skipFirstStart=new Set();
  const switchTab=tab=>{
    if(!tabNames.includes(tab))return;
    if(onboarding && !(onboarding.welcomeCompleted??onboarding.completed) && !['firststart','models','home'].includes(tab))tab='firststart';
    if(tab!=='personality')haltSandboxTimer();
    active=tab;
    for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    try{const url=new URL(location.href);url.searchParams.set('tab',tab);history.replaceState(history.state,'',url)}catch{}
    message('');
    if(firstNavigation){
      firstNavigation=false;
      const loading=refresh();void loading.catch(e=>message(e?.message||'读取页面失败',true));
      return loading;
    }
    return run(refresh);
  };
  // Cross-page deep links must reveal all enclosing disclosure groups before scrolling.
  // Each real config lives in one place; shortcuts only navigate and never clone controls.
  const revealTarget=(element)=>{
    const groups=[];
    for(let parent=element?.parentElement;parent;parent=parent.parentElement){
      if(parent.tagName==='DETAILS')groups.unshift(parent);
    }
    for(const group of groups)group.open=true;
    if(element?.tagName==='DETAILS')element.open=true;
    element?.scrollIntoView({behavior:'auto',block:'start'});
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-nav-tab]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();switchTab(link.dataset.navTab);try{const url=new URL(location.href);url.hash='unified-friends';history.replaceState(history.state,'',url)}catch{}const target=document.getElementById('unified-friends');target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
  document.querySelectorAll('[data-open-tab]').forEach(control=>control.addEventListener('click',event=>{
    event.preventDefault();
    const destination=control.dataset.openTab,loading=switchTab(destination);
    if(active!==destination)return; // First Start may have blocked the destination.
    const anchor=control.dataset.openAnchor;
    if(!anchor){window.scrollTo({top:0,behavior:'auto'});return}
    const navigate=()=>{if(active===destination){const element=$(anchor);if(element)revealTarget(element)}};
    navigate(); // Immediate feedback; repeat after async lists finish and adjust layout.
    void Promise.resolve(loading).then(navigate,()=>{});
  }));
  // 就地设置入口：切到所属生活页面后只展开对应的配置，不重复创建字段。
  document.querySelectorAll('[data-open-settings]').forEach(control=>control.addEventListener('click',event=>{
    event.preventDefault();
    const target=$(control.dataset.openSettings),tab=control.dataset.targetTab;
    if(!target||!tabNames.includes(tab))return;
    const loading=switchTab(tab);
    if(active!==tab)return; // Respect First Start restrictions.
    revealTarget(target);
    void Promise.resolve(loading).then(()=>{if(active===tab)revealTarget(target)},()=>{});
  }));
  // On-page section links remain usable when their owner group starts collapsed.
  document.querySelectorAll('.context-jump a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
    const target=$(link.getAttribute('href').slice(1));if(!target)return;
    event.preventDefault();revealTarget(target);
  }));
  document.querySelectorAll('[data-social-anchor]').forEach(link=>link.addEventListener('click',event=>{
    const element=$(link.dataset.socialAnchor);
    if(!element)return;
    event.preventDefault();
    revealTarget(element);
  }));
  $('refresh').addEventListener('click',()=>run(refresh));
  if(mobileViewOnly){
    $('mobile-view-banner').hidden=false;
    document.documentElement.classList.add('mobile-view-only');
    // Some lists create buttons dynamically. Keep the UI consistent and prevent
    // delegated clicks even if a loader mistakenly re-enables a control.
    document.addEventListener('click',event=>{
      const button=event.target?.closest?.('button');
      if(!button||mobileButtonAllowed(button))return;
      event.preventDefault();event.stopImmediatePropagation();
      message(mobileDesktopHint);
    },true);
    lockMobileControls();
    if(typeof MutationObserver==='function'){
      const observer=new MutationObserver(()=>lockMobileControls());
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    }
  }

  // First Start: versioned welcome gate. Showing is required for existing users
  // too, but the B站 credential and the historical settings are never reset.
  let firstStartTimer=null;
  const renderFirstStart = state=>{
    onboarding=state;
    const ready=state?.requiredReady===true;
    const unlocked=(state?.welcomeCompleted??state?.completed)===true;
    const b=$('fs-bili-state'),h=$('fs-headless-state');
    b.textContent=state?.biliVerified?'✓ B站登录有效':state?.hasCredential?'已有凭据，请点击检测已有登录':'未登录，请扫码登录 B站';
    h.textContent=state?.headlessVerified?'✓ 已完成至少一个 Headless 模型验证':'未通过真实连接验证（仅同步不算完成）';
    $('fs-headless-next').textContent=state?.headlessVerified?'✓ 首次设置的模型验证已达标。其他模型不要求逐个验证，只有使用该独立 Headless 模型时才需要验证。':'⚠ 首次设置只需任选一个模型完成真实连接验证；仅同步不算完成。';
    b.className='fs-state '+(state?.biliVerified?'good':'bad');h.className='fs-state '+(state?.headlessVerified?'good':'bad');
    $('fs-summary').textContent=ready?'必需设置已完成，可进入管理中心；可选设置可以跳过。':'尚缺少：'+(state?.missing||['配置状态未读取']).join('、');
    $('fs-complete').disabled=!ready;$('fs-complete-skip').disabled=!ready;
    $('fs-warning').hidden=unlocked;
    $('fs-warning-text').textContent=unlocked?'':(ready?'两项必需配置已经通过；可先设置主 Session，点击「完成首次设置」后解锁业务运行。':'首次设置未完成：'+(state?.missing||[]).join('、')+'。全部业务功能暂时锁定。');
    // The wizard may open the existing main Session settings while the
    // business gate remains closed; never present a button that leads back to
    // First Start without permitting its safe configuration endpoint.
    for(const t of tabNames)if(!['firststart','models','home'].includes(t)){
      const item=document.querySelector(`[data-tab="${t}"]`);
      if(item)item.hidden=!unlocked;
    }
    $('panel-home').dataset.setupOnly=String(!unlocked);
    $('fs-main-session-return').hidden=unlocked;
    $('main-session-test').disabled=!unlocked;
    $('main-session-sync').disabled=!unlocked;
    $('main-session-backfill').disabled=!unlocked;
    for (const [id,label] of [['fs-life-settings','查看记忆设置'],['fs-personality-settings','查看人格成长']]) {
      const btn=$(id);btn.disabled=!unlocked;
      btn.textContent=unlocked?label:'完成引导后设置';
      btn.title=unlocked?'可随时调整设置':'这是可选步骤，可以先跳过；完成首次设置后再进入完整设置页面';
    }
  };
  const loadFirstStart=async()=>{const state=await request('/onboarding/status');renderFirstStart(state);return state};
  const verifyBili=async()=>{
    const status=await request('/onboarding/bili/verify',{});
    await loadFirstStart();message('B站账号验证成功'+(status.username?'：'+status.username:''));
  };
  // Account switch is never inferred from a successful QR poll. User must
  // review the exact UID and explicitly confirm a live credential check.
  const loadBiliAccount=async()=>{
    const a=await request('/account/status');
    const el=$('bili-account-state');
    if(el)el.textContent='鱼鱼身份：'+String(a.characterId||'').slice(0,8)+'…  · 当前绑定 UID：'+(a.activeUid||'未绑定')+
      ' · 凭证 UID：'+(a.credentialUid||'无')+' · 状态：'+({ready:'正常', 'credential-missing':'无凭证','uid-mismatch':'身份不匹配',
      'login-staged':'扫码待确认','restart-required':'切换后需重启','review-required':'需人工复核授权'}[a.reason]||a.reason);
    if($('bili-account-confirm'))$('bili-account-confirm').hidden=!a.pendingUid;
    if($('bili-account-cancel'))$('bili-account-cancel').hidden=!a.pendingUid;
    if($('bili-account-resume'))$('bili-account-resume').hidden=!a.reviewRequired||a.restartRequired;
    // First Start keeps the B站视频探索 tab hidden. QR verification and
    // post-restart review must also be possible from the onboarding panel.
    if($('fs-account-state'))$('fs-account-state').textContent='当前 UID：'+(a.activeUid||'未绑定')+' · 待确认 UID：'+(a.pendingUid||'无')+' · 状态：'+a.reason;
    if($('fs-account-confirm'))$('fs-account-confirm').hidden=!a.pendingUid;
    if($('fs-account-cancel'))$('fs-account-cancel').hidden=!a.pendingUid;
    if($('fs-account-resume'))$('fs-account-resume').hidden=!a.reviewRequired||a.restartRequired;
    return a;
  };
  $('bili-account-refresh')?.addEventListener('click',()=>run(loadBiliAccount));
  const confirmPendingAccount=async()=>{
    const a=await loadBiliAccount();
    if(!a.pendingUid)throw Error('没有待确认的新账号');
    if(!await confirmAction({title:'请确认操作',description:'请确认要在线核验并绑定 B站 UID '+a.pendingUid+'。原账号平台任务不会在新号自动重发；绑定后必须重启 DSH。继续吗？'}))return;
    const result=await request('/account/confirm',{uid:a.pendingUid});await loadBiliAccount();
    message(result.changed?'已核实绑定到 UID '+result.verifiedUid+'。请重启 DSH，随后在当前页面复核并恢复账号。':'同账号重新登录成功');
  };
  $('bili-account-confirm')?.addEventListener('click',()=>run(confirmPendingAccount));
  $('fs-account-confirm')?.addEventListener('click',()=>run(confirmPendingAccount));
  const cancelPendingAccount=async()=>{await request('/account/cancel',{});await loadBiliAccount();message('待确认扫码已取消，原账号保持不变。')};
  $('bili-account-cancel')?.addEventListener('click',()=>run(cancelPendingAccount));
  $('fs-account-cancel')?.addEventListener('click',()=>run(cancelPendingAccount));
  const resumeAccount=async()=>{
    const a=await loadBiliAccount();
    if(!a.activeUid||a.restartRequired)throw Error('请先完成换号并重启 DSH');
    if(!await confirmAction({title:'请确认操作',description:'已经复核 UID '+a.activeUid+' 的私信/评论/发布权限设置，并理解旧号待办不会自动转移？恢复账号活动吗？'}))return;
    await request('/account/resume',{uid:a.activeUid});await loadBiliAccount();message('账号权限已复核，后台活动已解冻。');
  };
  $('bili-account-resume')?.addEventListener('click',()=>run(resumeAccount));
  $('fs-account-resume')?.addEventListener('click',()=>run(resumeAccount));
  // Identity status does not contain any raw cookie or private message.
  void loadBiliAccount().catch(()=>{});
  $('fs-bili-verify').addEventListener('click',()=>run(verifyBili));
  $('fs-bili-start').addEventListener('click',()=>run(async()=>{
    if(firstStartTimer){clearInterval(firstStartTimer);firstStartTimer=null}
    const r=await request('/login/start',{});
    if(!r.qr)throw Error('登录二维码生成失败：请先在插件设置中安装主依赖');
    $('fs-qr-image').src=r.qr;$('fs-qr').hidden=false;
    $('fs-qr-status').textContent='请使用手机 B站扫码并确认登录';
    let attempts=0,busy=false;
    firstStartTimer=setInterval(async()=>{
      if(busy)return;busy=true;
      try{
        if(++attempts>90){clearInterval(firstStartTimer);firstStartTimer=null;$('fs-qr-status').textContent='二维码超时，请重新生成';return}
        const result=await request('/login/poll',{key:r.key});
        if(result.state==='scanned')$('fs-qr-status').textContent='已扫码，请在手机上确认';
        if(result.state==='staged'){
          clearInterval(firstStartTimer);firstStartTimer=null;$('fs-qr').hidden=true;
          await loadBiliAccount();
          message('扫码凭证已暂存，请直接在「首次设置 → B站登录」确认 UID 并在线核验；随后重启 DSH 复核授权。');
        }else if(result.state==='expired'||result.state==='unknown'){
          clearInterval(firstStartTimer);firstStartTimer=null;$('fs-qr-status').textContent=result.message||'请重新扫码登录';
        }
      }catch(e){$('fs-qr-status').textContent='等待登录遇到问题：'+String(e?.message||e).slice(0,90)}
      finally{busy=false}
    },2000);
  }));
  window.addEventListener('beforeunload',()=>{if(firstStartTimer)clearInterval(firstStartTimer)});
  document.querySelectorAll('[data-firststart-skip]').forEach(b=>b.addEventListener('click',()=>{skipFirstStart.add(b.dataset.firststartSkip);b.textContent='已标记跳过'}));
  const completeFirstStart=async(skipAll)=>{
    const skipped=skipAll?['main-session','life-memory','personality','social-preferences']:[...skipFirstStart];
    await request('/onboarding/complete',{skipped});await loadFirstStart();switchTab('home');
    message('首次设置已完成。所有配置以后仍可在管理中心修改。');
  };
  $('fs-complete').addEventListener('click',()=>run(()=>completeFirstStart(false)));
  $('fs-complete-skip').addEventListener('click',()=>run(()=>completeFirstStart(true)));

  // v2.4.86: 保留所有配置键与数据格式。Provider / 模型 ID 改为来自 DSH
  // 实际注册目录的下拉框，不能根据官方名称猜可用模型。
  const modelDefs=[
    ['video','videoModelProvider','videoModelId','videoReasoningEffort'],
    ['interaction','interactionModelProvider','interactionModelId','interactionReasoningEffort'],
    ['dailyDynamic','dailyDynamicModelProvider','dailyDynamicModelId','dailyDynamicReasoningEffort'],
    ['ownerDmAgent','ownerDmAgentModelProvider','ownerDmAgentModelId','ownerDmAgentReasoningEffort'],
    ['reflection','mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort'],
    ['vision','visionModelProvider','visionModelId','visionReasoningEffort','visionEndpoint'],
    ['memeRules','memeRulesModelProvider','memeRulesModelId','memeRulesReasoningEffort'],
  ];
  for(const [group,...keys] of modelDefs){
    const target=$('models-'+group);
    for(let i=0;i<keys.length;i++){
      const wrap=node('div'),lab=node('label',['Provider（下拉选择）','模型（下拉选择）','思考深度（可留空）','旧版独立视觉 Endpoint（高级兼容）'][i]);
      const input=node(i<2?'select':'input');input.id='model-'+keys[i];
      if(i>=2){input.maxLength=i===3?250:160;input.placeholder=i===2?'如 low / medium / high':'https://...'}
      lab.htmlFor=input.id;add(wrap,lab,input);
      if(i===3){const details=document.createElement('details');details.className='contextual-subdetails';
        const summary=node('summary','旧版 Endpoint（仅兼容历史配置，不建议新用户填写）');details.appendChild(summary);details.appendChild(wrap);target.appendChild(details)}
      else target.appendChild(wrap);
    }
    const actual=node('small','正在检测 DSH 默认模型…','setting-note');actual.id='models-'+group+'-effective';target.appendChild(actual);
  }
  // 沿用唯一的记忆设置节点，不产生第二份可编辑配置。
  for(const id of ['main-memory-model-provider','main-memory-model-id','main-memory-model-effort']){
    const field=$(id)?.parentElement;if(field)$('models-memory').appendChild(field);
  }
  const memoryNote=node('small','正在检测 DSH 默认模型…','setting-note');memoryNote.id='models-memory-effective';$('models-memory').appendChild(memoryNote);
  const modelFields=modelDefs.flatMap(x=>x.slice(1));
  const memoryModelFields=[['main-memory-model-provider','mainSessionMemoryModelProvider'],['main-memory-model-id','mainSessionMemoryModelId'],['main-memory-model-effort','mainSessionMemoryReasoningEffort']];
  const modelTaskIds=['video','interaction','dailyDynamic','ownerDmAgent','reflection','vision','memory','memeRules'];
  // Headless model setup is a privileged, explicit user action. No raw YAML,
  // file path or credentials are ever sent to or accepted from the page.
  let headlessPlan=null;
  let headlessProviders=[];
  let headlessGlobalVerified=false;
  let headlessDefaultModel=null;
  let headlessCurrentCatalog=[];
  const headlessProfile=()=>$('headless-source-profile').value;
  const syncMessage=(value,bad=false)=>{
    const el=$('headless-sync-status');el.textContent=value;el.style.color=bad?'var(--bad)':'';
  };
  // Always expose the NEXT required operation. A config sync does not grant
  // Headless access until a real model probe produces a verification receipt.
  let headlessNextButton=null,headlessNextSyncCheckbox=null;
  const renderHeadlessJourney=providers=>{
    const configured=providers.some(p=>(p.models||[]).length);
    const synced=providers.some(p=>p.synced&&(p.models||[]).length);
    const verified=(typeof headlessGlobalVerified!=='undefined'&&headlessGlobalVerified)||providers.some(p=>p.synced&&(p.verifiedModels||[]).length);
    const stage=verified?'verified':synced?'verify':configured?'sync':'source';
    $('headless-journey').dataset.stage=stage;
    for(const [name,done,current] of [
      ['source',configured,stage==='source'],['sync',synced,stage==='sync'],['verify',verified,stage==='verify']]){
      $('headless-stage-'+name).dataset.state=done?'done':current?'current':'pending';
    }
    const title=$('headless-next-title'),desc=$('headless-next-description'),button=$('headless-next-action');
    button.hidden=true;
    if(stage==='verified'){
      title.textContent='✓ 验证成功，可以继续首次设置';
      desc.textContent='首次设置只要求至少一个模型通过真实验证；已经达标。其他模型不必逐个验证，只有实际用于独立 Headless Agent 时才需要验证对应模型。';
    }else if(stage==='verify'){
      title.textContent='⚠ 尚无模型通过 Headless 真实验证';
      desc.textContent='首次设置只需任选一个实际要用的模型验证一次，不用逐个验证所有官方模型。真实测试可能产生少量费用。';
      button.hidden=false;button.textContent='③ 下一步：立即验证一个模型 ↗';
    }else if(stage==='sync'){
      title.textContent='② 检测到模型，下一步同步配置';
      desc.textContent='自定义 Provider 如果未同步，先勾选并确认；DSH 官方内置模型无需同步。首次设置只需任选一个模型通过真实验证。';
      button.hidden=false;button.textContent='② 选择模型并查看待同步配置 ↗';
    }else{
      title.textContent='① 先在 DSH Desktop 设置模型';
      desc.textContent='尚未检测到可用模型。请在 DSH → Models 配置官方或自定义模型后重新检测。';
    }
    if(mobileViewOnly){
      desc.textContent+=' 手机端可查看进度，同步与验证请在运行 DSH 的电脑端操作。';
      button.hidden=true;
    }
  };
  $('headless-next-action').addEventListener('click',()=>{
    if($('headless-journey').dataset.stage==='verify'&&headlessNextButton){
      headlessNextButton.scrollIntoView({behavior:'smooth',block:'center'});
      headlessNextButton.click();
    }else if($('headless-journey').dataset.stage==='sync'){
      if(headlessNextSyncCheckbox){headlessNextSyncCheckbox.checked=true;headlessNextSyncCheckbox.focus()}
      $('headless-sync-preview').scrollIntoView({behavior:'smooth',block:'center'});
    }
  });
  const loadHeadlessModels=async()=>{
    headlessPlan=null;$('headless-sync-commit').hidden=true;$('headless-sync-plan').textContent='';
    headlessNextButton=null;headlessNextSyncCheckbox=null;
    const list=$('headless-provider-list');list.replaceChildren();
    try{
      const r=await request('/headless-model/status?profile='+encodeURIComponent(headlessProfile()));
      headlessProviders=r.providers||[];
      headlessCurrentCatalog=headlessProviders.filter(p=>Array.isArray(p.models)&&p.models.length);
      headlessGlobalVerified=r.anyVerified===true||headlessProviders.some(p=>(p.verifiedModels||[]).length>0);
      headlessDefaultModel=r.defaultModel&&r.defaultModel.provider&&r.defaultModel.model?r.defaultModel:null;
      renderHeadlessJourney(headlessProviders);
      if(!headlessProviders.length){syncMessage('没有找到可用的 DSH 模型。请先在 DSH → Models 中配置官方模型或自定义 Provider，再重新检测。',true);return r}
      syncMessage((headlessGlobalVerified?'✓ 首次设置所需的模型验证已达标；其他 Provider 可按需验证。':'首次设置还需任选一个模型做真实连接验证。')+' 已检测到 '+headlessProviders.length+' 个 Provider。官方已注册模型无需同步。'+(r.globalOverride?' 当前采用 DSH 全局共享 Provider。':''));
      for(const p of headlessProviders){
        const card=node('div','','settings-section');
        const header=node('label','','checkline');
        const check=document.createElement('input');check.type='checkbox';check.value=p.id;check.className='headless-provider-check';check.disabled=p.kind==='registered';
        add(header,check,node('strong',p.id+' · '+(p.kind==='registered'?'DSH 官方/已注册模型':(p.api||'自定义 Provider'))));
        if(!headlessNextSyncCheckbox&&!p.synced)headlessNextSyncCheckbox=check;
        add(card,header,node('p',(p.kind==='registered'?'由 DSH 直接提供，无需同步':p.synced?(r.globalOverride?'已通过 DSH 全局配置共享':'配置已同步'):'尚未同步或配置不同')+' · 已验证 '+(p.verifiedModels?.length||0)+' / '+p.models.length+' 个模型','muted'));
        const details=document.createElement('details');details.className='contextual-subdetails';
        const summary=document.createElement('summary');
        const pendingModel=(p.models||[]).find(m=>!(p.verifiedModels||[]).includes(m));
        summary.textContent=p.synced&&pendingModel&&!headlessGlobalVerified?'③ 任选一个模型验证（'+p.models.length+' 个）':'按需展开验证模型（'+p.models.length+' 个）';
        if(p.synced&&pendingModel&&!headlessNextButton&&!headlessGlobalVerified)details.open=true;
        details.appendChild(summary);
        for(const model of p.models){
          const row=node('div','','model-activity');
          add(row,node('span',model,'muted'));
          row.firstChild.textContent=model+((p.verifiedModels||[]).includes(model)?' · ✓ 后台已验证':' · 未验证');
          const isVerified=(p.verifiedModels||[]).includes(model);
          const needsFirstVerification=p.synced&&!isVerified&&!headlessGlobalVerified&&!headlessNextButton;
          const btn=node('button',(isVerified?'重新验证 · ':needsFirstVerification?'③ 验证模型 · ':'按需验证 · ')+model,needsFirstVerification?'model-test-button primary headless-verify-button':'model-test-button');btn.type='button';
          if(needsFirstVerification){
            headlessNextButton=btn;
            row.appendChild(node('span','首次设置任选一个模型验证即可，不必逐个操作','headless-verify-hint'));
          }
          btn.disabled=!p.synced;
          btn.title=p.synced?'实际启动无工具 Headless 请求':'请先同步该自定义 Provider';
          btn.addEventListener('click',()=>run(async()=>{
            const accepted=await confirmAction({title:'验证后台模型',description:'即将用 '+p.id+' / '+model+' 执行一次真实 Headless 测试请求，可能产生模型费用。',confirmLabel:'确认测试'});
            if(!accepted)return;
            syncMessage('正在调用 '+p.id+' / '+model+'，验证后台模型…');
            const r=await request('/headless-model/verify',{profile:headlessProfile(),provider:p.id,model});
            await loadHeadlessModels();await loadFirstStart();
            syncMessage('✓ '+r.provider+' / '+r.model+' 已通过真实后台验证，可以继续首次设置。');
          }));
          row.appendChild(btn);details.appendChild(row);
        }
        card.appendChild(details);list.appendChild(card);
      }
      return r;
    }catch(e){headlessProviders=[];headlessCurrentCatalog=[];headlessDefaultModel=null;headlessGlobalVerified=false;renderHeadlessJourney([]);syncMessage('后台模型检测失败：'+String(e.message||e),true);return null}
  };
  $('headless-source-profile').addEventListener('change',()=>run(loadHeadlessModels));
  $('headless-sync-refresh').addEventListener('click',()=>run(loadHeadlessModels));
  $('headless-sync-preview').addEventListener('click',()=>run(async()=>{
    const selected=[...document.querySelectorAll('.headless-provider-check:checked')].map(x=>x.value);
    if(!selected.length)throw Error('请先勾选至少一个需要同步的 Provider');
    const p=await request('/headless-model/preview',{profile:headlessProfile(),selected});
    headlessPlan=p;
    $('headless-sync-plan').textContent='将同步：'+p.selected.map(x=>x.id+' ('+x.models.length+' 个模型，'+(x.overwrite?'将更新原配置':'新增')+')').join('、')+'。只同步模型定义；不复制密钥。配置写入后仍需验证。';
    $('headless-sync-commit').hidden=false;
  }));
  $('headless-sync-commit').addEventListener('click',()=>run(async()=>{
    if(!headlessPlan)throw Error('请先点击「查看待同步配置」，确认将更新的模型');
    const approved=await confirmAction({title:'确认同步后台模型',description:$('headless-sync-plan').textContent+' 目标是 DSH Headless Profile，原文件会先备份。',confirmLabel:'确认写入 Headless'});
    if(!approved)return;
    const r=await request('/headless-model/sync',{profile:headlessPlan.sourceProfile,selected:headlessPlan.selected.map(x=>x.id),previewToken:headlessPlan.previewToken});
    await loadHeadlessModels();
    if(onboarding)await loadFirstStart();
    syncMessage('✓ 已同步 '+r.synced.join('、')+'。'+(headlessGlobalVerified?'首次设置模型验证已达标，无需验证其他模型。':'首次设置还需任选一个模型点击「③ 验证模型」做真实连接验证。'));
    if(headlessNextButton&&!mobileViewOnly)headlessNextButton.scrollIntoView({behavior:'smooth',block:'center'});
  }));

  const loadModelUsage=async()=>{
    try {
      const r=await request('/model-usage');
      for(const task of modelTaskIds){
        const v=r.tasks?.[task]||{today:0,lastAt:null};
        const when=v.lastAt?new Date(v.lastAt).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
        $('models-'+task+'-usage').textContent='今日调用次数：'+Number(v.today||0)+' 次 · 上次调用时间：'+when;
      }
    } catch(e) {
      for(const task of modelTaskIds)$('models-'+task+'-usage').textContent='调用统计读取失败';
    }
  };
  for(const task of modelTaskIds){
    $('models-'+task+'-test').addEventListener('click',async()=>{
      const button=$('models-'+task+'-test'),result=$('models-'+task+'-test-result');
      button.disabled=true;result.textContent='正在验证已保存的模型配置…';
      try {
        const r=await request('/model-test',{task});
        result.textContent='✓ 连接正常（'+r.elapsedMs+'ms）· '+r.note;
        result.style.color='var(--action)';
      } catch(e) {
        result.textContent='✗ '+String(e?.message||'测试失败').slice(0,200);
        result.style.color='var(--bad)';
      } finally {button.disabled=false;}
    });
  }
  // 只列出 DSH 实际发现的模型：官方注册目录 + 已同步的自定义 Provider。
  // 选项值仍保持原来的 provider/model 字符串，后端运行逻辑不被改写。
  const modelRouteControls=[...modelDefs.map(([group,provider,model])=>({group,provider,model})),
    {group:'memory',provider:'mainSessionMemoryModelProvider',model:'mainSessionMemoryModelId',memory:true}];
  const option=(value,label)=>{const el=document.createElement('option');el.value=value;el.textContent=label;return el};
  const hostDefaultLabel=()=>headlessDefaultModel?headlessDefaultModel.provider+' / '+headlessDefaultModel.model:'尚未检测到 DSH 默认模型';
  const getGroupProvider=group=>group==='memory'?'main-memory-model-provider':
    'model-'+modelRouteControls.find(x=>x.group===group).provider;
  const getGroupModel=group=>group==='memory'?'main-memory-model-id':
    'model-'+modelRouteControls.find(x=>x.group===group).model;
  const inheritedRoute=(group,c)=>{
    const upstream=group==='dailyDynamic'||group==='ownerDmAgent'?'interaction':group==='vision'?'video':'';
    if(upstream){const entry=modelRouteControls.find(x=>x.group===upstream);
      if(c[entry.provider]&&c[entry.model])return {provider:c[entry.provider],model:c[entry.model],source:upstream==='interaction'?'后台互动模型':'视频模型'}}
    return headlessDefaultModel?{...headlessDefaultModel,source:'DSH 当前默认'}:null;
  };
  const setSelect=(el,values,value)=>{
    el.replaceChildren(...values);
    // 旧配置未出现在当前目录时只供保留、显示，不冒充已注册。
    if(value&&!values.some(x=>x.value===value))el.appendChild(option(value,'⚠ 旧配置（当前未检测到）：'+value));
    el.value=value||'';
  };
  const renderRouteModelSelect=(entry,chosenModel='',pickFirst=false)=>{
    const provider=$(getGroupProvider(entry.group)).value;
    const modelEl=$(getGroupModel(entry.group));
    const inherited=inheritedRoute(entry.group,modelConfigForDropdowns||{});
    const effectiveProvider=provider||(entry.memory?'':inherited?.provider||'');
    const catalog=headlessCurrentCatalog.find(p=>p.id===effectiveProvider);
    const models=Array.isArray(catalog?.models)?catalog.models:[];
    const opts=[option('',entry.memory?'选择用于检索的模型':
      '自动继承'+(inherited?'（'+inherited.provider+' / '+inherited.model+'）':'（DSH 默认）')),
      ...models.map(name=>option(name,name+((catalog.verifiedModels||[]).includes(name)?' ✓ 已验证':'')))];
    const value=pickFirst&&provider&&models.length&&!models.includes(chosenModel)?models[0]:chosenModel;
    setSelect(modelEl,opts,value);
  };
  let modelConfigForDropdowns=null,savedModelConfig=null;
  const renderModelDropdowns=c=>{
    modelConfigForDropdowns={...c};savedModelConfig={...c};
    const providers=headlessCurrentCatalog;
    const summary=$('models-default-summary');
    summary.textContent='DSH 当前默认模型：'+hostDefaultLabel()+'。未单独指定时将沿用默认或上游任务模型；Headless 验证记录不会改动默认模型。';
    $('models-recommendation-note').textContent='需要指定已验证模型时，请在各任务下拉框手动选择；本页修改需保存，连接测试只使用已保存配置。';
    for(const entry of modelRouteControls){
      const providerEl=$(getGroupProvider(entry.group));
      const existing=String(c[entry.provider]||'');
      const opts=[option('',entry.memory?'使用 DSH 默认模型（保存时填写）':'自动继承'),...providers.map(p=>option(p.id,p.id+(p.kind==='registered'?' · 官方注册':' · 自定义')))];
      setSelect(providerEl,opts,existing);
      renderRouteModelSelect(entry,String(c[entry.model]||''));
      updateRouteDescription(entry.group);
    }
  };
  const updateRouteDescription=group=>{
    const provider=$(getGroupProvider(group)).value,model=$(getGroupModel(group)).value;
    const entry=modelRouteControls.find(x=>x.group===group);
    const inherited=inheritedRoute(group,modelConfigForDropdowns||{});
    let route=provider&&model?{provider,model,source:'手动指定'}:inherited;
    const upstream=group==='dailyDynamic'||group==='ownerDmAgent'?'interaction':group==='vision'?'video':'';
    const dirty=!!savedModelConfig&&[entry,...(upstream?[modelRouteControls.find(x=>x.group===upstream)]:[])].some(e=>String(savedModelConfig[e.provider]||'')!==String(modelConfigForDropdowns?.[e.provider]||'')||String(savedModelConfig[e.model]||'')!==String(modelConfigForDropdowns?.[e.model]||''));
    let text=route?(dirty?'待保存预览：':'已保存配置：')+route.provider+' / '+route.model+'（'+route.source+'）':'当前没有检测到可用的 DSH 默认模型；请先到 DSH 设置默认模型';
    if(group==='memory'&&!provider&&!model)text=route?'检索模型候选：'+route.provider+' / '+route.model+'（保存时自动写入，语义检索开关不会自动开启）':text;
    if(provider&&!model)text='请从此 Provider 的下拉列表选择模型，或改回自动继承';
    const catalog=headlessCurrentCatalog.find(p=>p.id===route?.provider);
    if(route&&catalog&&(catalog.verifiedModels||[]).includes(route.model))text+=' · ✓ 已通过 Headless 验证';
    else if(route&&catalog&&['video','interaction','vision','memeRules'].includes(group))text+=' · 该模型未通过 Headless 验证，独立任务使用前须验证';
    $('models-'+group+'-effective').textContent=text;
  };
  const refreshInheriting=group=>{
    for(const target of group==='interaction'?['dailyDynamic','ownerDmAgent']:group==='video'?['vision']:[]){
      const entry=modelRouteControls.find(x=>x.group===target);
      renderRouteModelSelect(entry,$(getGroupModel(target)).value);
      updateRouteDescription(target);
    }
  };
  for(const entry of modelRouteControls){
    $(getGroupProvider(entry.group)).addEventListener('change',()=>{
      const previous=$(getGroupModel(entry.group)).value;
      renderRouteModelSelect(entry,$(getGroupProvider(entry.group)).value?previous:'',true);
      modelConfigForDropdowns[entry.provider]=$(getGroupProvider(entry.group)).value;
      modelConfigForDropdowns[entry.model]=$(getGroupModel(entry.group)).value;
      updateRouteDescription(entry.group);
      refreshInheriting(entry.group);
    });
    $(getGroupModel(entry.group)).addEventListener('change',()=>{
      modelConfigForDropdowns[entry.model]=$(getGroupModel(entry.group)).value;
      updateRouteDescription(entry.group);
      refreshInheriting(entry.group);
    });
  }
  $('models-reset-inheritance').addEventListener('click',()=>{
    for(const entry of modelRouteControls){
      if(entry.memory)continue; // Memory semantic retrieval needs an explicit model on save.
      $(getGroupProvider(entry.group)).value='';
      modelConfigForDropdowns[entry.provider]='';modelConfigForDropdowns[entry.model]='';
    }
    for(const entry of modelRouteControls){
      if(entry.memory)continue;
      renderRouteModelSelect(entry,'');updateRouteDescription(entry.group);
    }
    message('已在页面中把任务模型恢复为自动继承。此操作尚未保存；各项思考深度和独立视觉设置未修改。');
  });
  const loadInteractionContextUsage=async()=>{
    const node=$('models-interaction-context-status');
    try{
      const r=await request('/interaction-context-status'),s=r.stats||{};
      node.textContent=`本次插件启动以来：精简 ${s.compactTurns||0} 条 · 完整 ${s.fullTurns||0} 条 · 主动请求扩展 ${s.expandedTurns||0} 条 · 额外模型续推 ${s.extraModelCalls||0} 次 · 续推失败 ${s.continuationFailures||0} 次；当前运行模式：${r.mode==='full'?'原始完整':'精简按需'}。这里仅计数，不存聊天正文。`;
      const recent=$('models-interaction-context-recent');
      const rows=Array.isArray(s.recent)?s.recent.slice(0,12):[];
      recent.textContent=rows.length?'最近 12 个互动批次（无 UID/正文）：\n'+rows.map(x=>{
        const at=new Date(Number(x.at)||0).toLocaleString('zh-CN');
        const names={memory:'记忆',portrait:'画像',meme:'梗',todo:'待办',recommendation:'视频推荐',video:'视频',history:'对话历史'};
        const types=a=>(Array.isArray(a)?a:[]).map(k=>names[k]||'其他').join('、')||'无';
        const result={direct:'直接决定',continued:'检索/展开后决定',failed:'续推或检索失败'}[x.result]||'未知';
        return `${at} · ${x.kind==='dm'?'私信':'评论'} · ${x.mode==='full'?'完整':'精简'} · 请求：${types(x.requestedKinds)} · 有证据：${types(x.foundKinds)} · 无命中：${types(x.missingKinds)} · 实际按需读取 ${Number(x.lazyReads)||0} 项 · ${result}`;
      }).join('\n'):'最近尚无互动批次。没有记录不能据此断定鱼鱼主动选择不回复。';
    }catch(e){node.textContent='暂时无法读取上下文模式统计：'+String(e?.message||e).slice(0,80)}
  };
  $('models-interaction-context-refresh').addEventListener('click',()=>run(loadInteractionContextUsage));
  const loadModels=async()=>{
    const {config:c={}}=await request('/config');
    await loadHeadlessModels();
    renderModelDropdowns(c);
    for(const key of modelFields.filter(k=>!modelRouteControls.some(x=>x.provider===k||x.model===k)))$('model-'+key).value=String(c[key]||'');
    for(const [id,key] of memoryModelFields.filter(([,key])=>key==='mainSessionMemoryReasoningEffort'))$(id).value=String(c[key]||'');
    $('models-interaction-context-mode').value=c.interactionContextMode==='full'?'full':'compact';
    $('models-vision-enabled').checked=c.visionEnabled===true;
    $('models-vision-debug').checked=c.visionDebug===true;
    $('models-vision-mode').value=['reuse_video_model','independent_dsh','auto'].includes(c.visionMode)?c.visionMode:'reuse_video_model';
    await loadModelUsage();
    await loadInteractionContextUsage();
  };
  $('models-refresh').addEventListener('click',()=>run(loadModels));
  $('models-save').addEventListener('click',()=>run(async()=>{
    const payload={clear:[]};
    for(const key of modelFields){payload[key]=$('model-'+key).value.trim();if(!payload[key])payload.clear.push(key)}
    for(const [id,key] of memoryModelFields){payload[key]=$(id).value.trim();if(!payload[key])payload.clear.push(key)}
    // 记忆检索没有运行时继承路径（开启后需要明确 provider/model），
    // 因此首次保存时把已实际发现的 DSH 默认路由作为初始值，而不是留空后运行失败。
    if(!payload.mainSessionMemoryModelProvider&&!payload.mainSessionMemoryModelId&&headlessDefaultModel){
      const registered=headlessCurrentCatalog.some(p=>p.id===headlessDefaultModel.provider&&p.models.includes(headlessDefaultModel.model));
      if(registered){
        payload.mainSessionMemoryModelProvider=headlessDefaultModel.provider;
        payload.mainSessionMemoryModelId=headlessDefaultModel.model;
        payload.clear=payload.clear.filter(k=>k!=='mainSessionMemoryModelProvider'&&k!=='mainSessionMemoryModelId');
      }
    }
    for(const entry of modelRouteControls){
      const provider=payload[entry.provider],model=payload[entry.model];
      if(provider&&!model)throw Error('「'+entry.group+'」已选择 Provider，请同时选择模型；也可将 Provider 改回自动继承');
    }
    payload.interactionContextMode=$('models-interaction-context-mode').value;
    payload.visionEnabled=$('models-vision-enabled').checked;
    payload.visionDebug=$('models-vision-debug').checked;
    payload.visionMode=$('models-vision-mode').value;
    const r=await request('/config',payload);await loadModels();
    message(r.host?.ok===false?'模型配置已保存到插件，但同步宿主失败：'+(r.host.error||'未知原因'):'AI 模型配置已保存，下次 Agent 运行生效');
  }));

  // 两组配置分别保存在自己所属的页面，防止视频页保存时覆盖动态页尚未保存的改动。
  const biliFields=[
    ['bili-home-recommend','homeRecommendationsEnabled'],['bili-auto-comment','autoComment'],
    ['bili-auto-like','autoVideoLike'],['bili-auto-collect','autoVideoCollect'],['bili-favorite-delete','autoFavoriteDelete'],['bili-agent-follow','agentFollowEnabled'],
    ['bili-transcribe','transcribe'],['bili-comment-memes','commentMemesEnabled'],
    ['bili-comment-memes-debug','commentMemesDebug'],
  ];
  const biliDynamicFields=[
    ['bili-sync-comment','commentSyncDynamic'],['bili-daily-enabled','dailyDynamicEnabled'],
    ['bili-daily-draft','dailyDynamicDraftOnly'],
  ];
  const loadBili=async()=>{
    const {config:c={}}=await request('/config');
    for(const [id,key] of biliFields)$(id).checked=$(id).dataset.invertedPermission==='true'?c[key]!==true:c[key]===true;
    $('bili-favorite-visibility').value=['auto','private','public'].includes(c.autoFavoriteVisibility)?c.autoFavoriteVisibility:'auto';
    $('bili-extra-keywords').value=(c.keywords||[]).join('\n');
    $('bili-dm-mode').value=['off','only','both'].includes(c.dmMode)?c.dmMode:'only';
    $('bili-dm-uid').value=String(c.dmUid||'');
    $('bili-report-level').value=['full','brief','off'].includes(c.reportLevel)?c.reportLevel:'full';
    $('bili-asr-model').value=['tiny','base','small','medium','large-v3'].includes(c.asrModel)?c.asrModel:'small';
    try{
      const x=await request('/follow-readiness');
      $('bili-agent-follow-readiness').textContent=x.enabled
        ?`自主关注已授权 · 今天判重表记录 ${x.selectedToday||0} 条明确入选视频（不含旧推荐标签；仅写日报的不计）；${x.opportunity?'可以在视频探索时考虑是否关注，但绝不保证执行':'当前没有满足前置条件的关注机会'}。`
        :'自主关注开关目前关闭，因此鱼鱼不会执行自主关注。';
    }catch{$('bili-agent-follow-readiness').textContent='暂时无法读取自主关注条件，请查看视频探索日志。'}
  };
  $('bili-refresh').addEventListener('click',()=>run(loadBili));
  $('bili-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of biliFields)payload[key]=$(id).dataset.invertedPermission==='true'?!$(id).checked:$(id).checked;
    payload.autoFavoriteVisibility=$('bili-favorite-visibility').value;
    payload.keywords=$('bili-extra-keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,30);
    if(!payload.keywords.length)payload.clear=['keywords'];
    payload.dmMode=$('bili-dm-mode').value;
    payload.dmUid=Math.max(0,Math.floor(Number($('bili-dm-uid').value)||0));
    payload.reportLevel=$('bili-report-level').value;
    payload.asrModel=$('bili-asr-model').value;
    const r=await request('/config',payload);await loadBili();
    message(r.host?.ok===false?'视频探索设置已保存但宿主同步失败：'+(r.host.error||'未知原因'):'视频探索设置已保存');
  }));

  const loadDynamicConfig=async()=>{
    const {config:c={}}=await request('/config');
    for(const [id,key] of biliDynamicFields)$(id).checked=c[key]===true;
    $('bili-daily-draft').checked=c.dailyDynamicDraftOnly!==false;
    $('daily-dynamic-limit').value=String(c.dailyDynamicDailyLimit??1);
  };
  $('bili-dynamic-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of biliDynamicFields)payload[key]=$(id).checked;
    payload.dailyDynamicDailyLimit=boundedInt('daily-dynamic-limit',0,10,'每日生活动态额度');
    const r=await request('/config',payload);
    await loadDynamicConfig();
    // Only refresh the dynamic status after a successful save, not on every toggle.
    await loadDailyDynamicStatus();
    message(r.host?.ok===false?'动态设置已保存但宿主同步失败：'+(r.host.error||'未知原因'):'动态创作设置已保存');
  }));
  const dailyDynamicStatusText=r=>'自主生活动态：'+(r.enabled?'已开启':'关闭')+' · '+(r.draftOnly?'仅草稿':'允许自动发布')+
    ' · 每日最多 '+r.limit+' 条 · 今日本地发布尝试 '+(r.usedToday??'未知')+' 条 · 自动构思尝试 '+(r.autoAttemptsToday??'未知')+' 次';
  const loadDailyDynamicStatus=async()=>{
    const r=await request('/daily-dynamic');
    $('daily-dynamic-status').textContent=dailyDynamicStatusText(r);
  };
  const loadDailyDynamic=async()=>{
    await loadDynamicConfig();
    const r=await request('/daily-dynamic');
    $('daily-dynamic-status').textContent=dailyDynamicStatusText(r);
    if(r.canDeleteDraft!==true)$('daily-dynamic-action-status').textContent='当前加载的插件后端还不支持草稿删除：请安装/加载 dev.2 或更新版本源码并重启 DSH，再用 Ctrl+F5 刷新管理页面。';
    const list=$('daily-dynamic-list');list.replaceChildren();
    if(!(r.drafts||[]).length){list.appendChild(info('还没有草稿。鱼鱼可以从真实视频和已确认的公开交流中寻找想分享的感受，也可以选择保持安静。'));return}
    for(const d of r.drafts){
      const card=node('article','','record');add(card,node('strong',d.day+' · '+({draft:'待发布草稿',published:'B站接口已接受（未核验公开）',uncertain:'结果不确定，请勿重复发送',publishing:'正在发布'}[d.status]||d.status)));
      const evidenceInfo=[];
      if((d.source_bvids||[]).length)evidenceInfo.push('真实 BV：'+d.source_bvids.join('、'));
      if((d.source_memory_ids||[]).length)evidenceInfo.push('公开交流回忆：'+d.source_memory_ids.length+' 条（仅鱼鱼本人已确认的公开表达）');
      if(d.sourcePool)evidenceInfo.push('构思时参考候选：视频 '+d.sourcePool.consideredVideos+' 条 / 公开交流 '+d.sourcePool.consideredSocial+' 条（不是只看最近一条）');
      if(d.qualityIssue)evidenceInfo.push('已阻止发布：'+d.qualityIssue+'。请删除草稿并重新生成');
      else if(d.requiresManualReview)evidenceInfo.push('包含可能需要核对的内容：'+(d.reviewReason||'请主人确认后发布'));
      else if((d.source_memory_ids||[]).length)evidenceInfo.push('匿名交流感受 · 安全检查通过，可按自动发布授权执行');
      add(card,node('p',d.text||''),info(evidenceInfo.join(' · ')||'历史草稿'));
      if(d.status==='draft'){
        const actions=node('div','','actions');
        if(!d.qualityIssue)add(actions,btn('确认公开发布这条动态',async()=>{
          if(!await confirmAction({title:'公开发布这条动态？',description:'这条内容将用你的 B站账号公开发布。发送结果可能无法实时核实，请确认后再继续。',confirmLabel:'确认发布'}))return;
          $('daily-dynamic-action-status').textContent='正在向 B站请求发布，发送期间请勿重复操作…';
          try{
            const result=await request('/daily-dynamic/publish',{id:d.id,confirm:true});
            await loadDailyDynamic();
            $('daily-dynamic-action-status').textContent=result.ok?'B站接口已接受发布（尚未核验公开可见）。':'发布状态：'+result.status;
            message($('daily-dynamic-action-status').textContent);
          }catch(e){
            const reason=String(e?.message||e)
            const beforeSend=/今日生活动态额度已用完|主人尚未开启生活动态|草稿不存在或已处理|草稿来源已无法核验|草稿包含内部流程|发布前检查未通过/.test(reason)
            $('daily-dynamic-action-status').textContent=(beforeSend?'没有发出动态：':'发布结果待核实：')+reason
            if(beforeSend){message($('daily-dynamic-action-status').textContent,true);return}
            throw e
          }
        },'primary'));
        if(r.canDeleteDraft!==true)add(actions,info('此后端版本尚不能删除本地草稿；更新插件并重启 DSH 后可用。'));
        else add(actions,btn('删除本地草稿',async()=>{
          if(!await confirmAction({title:'删除未发布的动态草稿？',description:'只删除这条本地未发布草稿，不会向 B站发送，也不会删除真实视频经历。此操作无法撤销。',confirmLabel:'删除草稿',danger:true}))return;
          await request('/daily-dynamic/delete',{id:d.id,confirm:true});await loadDailyDynamic();
          $('daily-dynamic-action-status').textContent='已删除一条未发布草稿。';message('已删除本地草稿');
        },'danger'));
        card.appendChild(actions);
      }
      list.appendChild(card);
    }
  };
  $('daily-dynamic-refresh').addEventListener('click',()=>run(loadDailyDynamic));
  $('daily-dynamic-generate').addEventListener('click',()=>run(async()=>{
    const status=$('daily-dynamic-action-status');
    status.dataset.tone='pending';status.textContent='正在整理真实视频经历并请求 AI 构思草稿，可能需要一段时间…';
    try{
      const r=await request('/daily-dynamic/draft',{});
      await loadDailyDynamic();
      status.dataset.tone=r.skipped?'warning':'success';
      status.textContent=r.skipped?'本次没有生成草稿：'+(r.reason||r.skipped)+'（这不等于发布额度用完）':'已生成生活动态草稿，请检查下方内容后决定是否公开发布。';
      message(status.textContent);
    }catch(e){status.dataset.tone='error';status.textContent='生成失败：'+String(e?.message||e)+'。请检查近期真实入选视频、互动模型连接和错误日志；生成草稿本身不消耗每日发布额度。';throw e}
  }));

  // v2.6.0-dev.4: authoritative presets are served by the backend with /config.
  // All reset controls are non-destructive: they only stage individual numeric
  // fields and require the corresponding existing Save button to persist.
  const recommendedFieldGroups={
    reflection:{mainSessionReflectionMinCandidates:'main-reflection-min',mainSessionReflectionBatchSize:'main-reflection-batch',mainSessionReflectionIntervalHours:'main-reflection-hours',mainSessionReflectionDailyBatches:'main-reflection-daily'},
    recall:{mainSessionMemoryHalfLifeDays:'main-memory-half-life',mainSessionMemoryThreshold:'main-memory-threshold',mainSessionMemoryMaxItems:'main-memory-max-items',mainSessionMemoryMaxChars:'main-memory-max-chars',mainSessionMemoryDailyQuota:'main-memory-daily',mainSessionMemoryFactsMax:'main-memory-facts'},
    retrieval:{mainSessionMemoryCandidates:'main-memory-candidates',mainSessionMemorySearchDailyLimit:'main-memory-search-daily'},
    commentContext:{commentReplyHotCount:'comment-reply-hot-count'},
    dmContext:{dmContextMessages:'dm-context-messages'},
  };
  const recommendedGroupNames={reflection:'人生反思调度',recall:'遗忘与召回质量',retrieval:'AI 检索预算',commentContext:'热门评论读取',dmContext:'私信上下文'};
  const memoryRecommendGroups=['reflection','recall','retrieval'];
  const quotaRecommendGroups=['commentContext','dmContext'];
  const groupDifferences=(config,groups,presets)=>groups.filter(group=>Object.keys(recommendedFieldGroups[group]).some(key=>Number(config?.[key])!==Number(presets?.[group]?.[key])));
  const recommendStatus=(id,config,groups,presets)=>{
    const el=$(id);if(!el||!presets)return;
    const differing=groupDifferences(config,groups,presets);
    el.textContent=differing.length?`当前配置与 dev.4 推荐值不同：${differing.map(x=>recommendedGroupNames[x]).join('、')}。可以按组恢复；不会自动覆盖旧设置。`:'当前这些参数组已使用 dev.4 推荐值。个性化设置也可以继续保留。';
  };
  const stageRecommendedGroup=async group=>{
    const fields=recommendedFieldGroups[group];if(!fields)throw Error('不支持的推荐参数组');
    const r=await request('/config');const preset=r.recommendedSettings?.groups?.[group];
    if(!preset||Object.keys(fields).some(key=>typeof preset[key]!=='number'||!Number.isFinite(preset[key])))
      throw Error('插件后端未提供 dev.4 推荐值；请确认已重启插件并刷新管理中心，避免前后端版本不一致');
    let changed=0;
    for(const [key,id] of Object.entries(fields)){
      const el=$(id);if(!el)throw Error('推荐参数对应的界面控件不存在：'+id);
      if(Number(el.value)!==Number(preset[key]))changed++;
      el.value=String(preset[key]);el.classList.add('recommended-pending');
    }
    const isQuota=quotaRecommendGroups.includes(group);
    const name=recommendedGroupNames[group],saveButton=isQuota?'保存次数与额度':'保存记忆与反思设置';
    const status=$(isQuota?'quota-recommend-status':'main-memory-recommend-status');
    if(status)status.textContent=`${name}：已填入最新推荐值（${changed} 项调整），尚未保存。点击「${saveButton}」才会写入；其他参数和开关保持不变。`;
    message(`${name}推荐值已填入，点击「${saveButton}」后生效`);
  };
  document.querySelectorAll('[data-recommend-group]').forEach(button=>button.addEventListener('click',()=>run(()=>stageRecommendedGroup(button.dataset.recommendGroup))));
  const clearRecommendPending=groups=>{for(const group of groups)for(const id of Object.values(recommendedFieldGroups[group]))$(id)?.classList.remove('recommended-pending')};

  // v2.4.41: 所有数字输入都只在「次数与额度」提交。
  // 将旧评论/私信页的 DOM 控件物理搬迁，保留字段 ID 与原有验证规则，避免双入口覆盖设置。
  const quotaFields=[
    ['quota-per-day','perDay',0,1000000,50],['quota-pick-round','pickPerRound',1,50,5],
    ['quota-comment-daily','commentDailyLimit',0,1000,10],['quota-comment-round','commentPerRound',0,20,5],
    ['quota-dynamic-daily','dynamicDailyLimit',0,30,3],
    ['quota-like-daily','autoVideoLikeDailyLimit',0,100,10],
    ['quota-daily-dynamic','dailyDynamicDailyLimit',0,10,1],
    ['comment-reply-hot-count','commentReplyHotCount',1,30,12],
    ['comment-per-poll','commentReplyPerPoll',1,1000,1],['comment-per-day','commentReplyPerDay',1,1000,5],
    ['comment-own-top-per-user','commentOwnTopPerUser',1,1000,5],['comment-own-nested-per-user','commentOwnNestedPerUser',1,1000,3],
    ['dm-reply-per-day','dmReplyPerDay',0,1000,0],
    ['dm-context-messages','dmContextMessages',0,80,40],['dm-stranger-max','dmStrangerMaxReplies',1,20,1],
    ['dm-total','dmApprovedTotalLimit',1,10000,50],['dm-daily','dmApprovedDailyLimit',1,1000,10],
    ['quota-meme-day','commentMemesPerDay',0,10000,2],['quota-meme-round','commentMemesPerRound',0,5,1],
    ['quota-meme-max','memeMemoryMaxEntries',10,2000,300],['quota-vision-frames','visionFrames',1,3,2],
    ['quota-vision-daily','visionDailyLimit',0,200,30],
    ['quota-min-views','minVideoViews',0,100000000,1000],['quota-min-likes','minVideoLikes',0,100000000,10],
    ['quota-min-replies','minVideoReplies',0,100000000,3]
  ];
  for (const [target,ids] of [
    ['quota-fields-comment',['comment-per-poll','comment-per-day','comment-own-top-per-user','comment-own-nested-per-user','comment-reply-hot-count']],
    ['quota-fields-dm',['dm-reply-per-day','dm-context-messages','dm-stranger-max','dm-total','dm-daily']]
  ]) {
    for(const id of ids){const el=$(id);if(el?.parentElement)$(target).appendChild(el.parentElement)}
  }
  const quotaReadout=(id,text)=>{
    const input=$(id),wrap=input?.parentElement;if(!wrap)return;
    let out=wrap.querySelector('.quota-readout');if(!out){out=node('small','','quota-readout');wrap.appendChild(out)}
    out.textContent=text;
  };
  const quotaTile=(target,title,value,window)=>{
    const card=node('div','','quota-tile');add(card,node('span',title),node('strong',value),node('span',window));target.appendChild(card);
  };
  const loadQuotas=async()=>{
    const [config,quota,stat,dm]=await Promise.all([
      request('/config'),request('/comment-quota').catch(()=>({ok:false})),
      request('/status').catch(()=>({ok:false})),request('/dm-quota-usage').catch(()=>({ok:false}))
    ]);
    const c=config.config||{};
    for(const [id,key,,,fallback] of quotaFields)$(id).value=String(c[key]??fallback);
    clearRecommendPending(quotaRecommendGroups);recommendStatus('quota-recommend-status',c,quotaRecommendGroups,config.recommendedSettings?.groups);
    const meter=(used,limit)=>used==null?'暂不可读':`${used} / ${limit}`;
    const daily=(used,limit)=>used==null?'今日已用：暂不可读':`今日已用 ${used} / ${limit}`;
    const commentUsed=quota.ok!==false && Number.isFinite(Number(quota.used))?Number(quota.used):null;
    const picked=stat.ok!==false&&Number.isFinite(Number(stat.pickedToday))?Number(stat.pickedToday):null;
    const dynamic=stat.ok!==false&&Number.isFinite(Number(stat.dynamicSyncUsage?.used))?Number(stat.dynamicSyncUsage.used):null;
    const reply=stat.ok!==false&&Number.isFinite(Number(stat.commentInteractStatus?.sentLast24Hours))?Number(stat.commentInteractStatus.sentLast24Hours):null;
    const dmUsed=dm.ok===true?Number(dm.sentToday):null;
    const dmRolling=dm.ok===true?Number(dm.sent24h):null;
    const memeUsed=quota.memeError||quota.memeUsed==null?null:Number(quota.memeUsed);
    const visionUsed=quota.visionError||quota.visionUsed==null?null:Number(quota.visionUsed);
    const dmCap=Number(c.dmReplyPerDay||0),approvedCap=Number(c.dmApprovedDailyLimit??10);
    $('quota-usage-summary').textContent=`本机日期 ${stat.today||quota.day||localDay()} · 设置值在下方修改；修改前显示当前真实使用量。`;
    const target=$('quota-usage-tiles');target.replaceChildren();
    quotaTile(target,'选片',meter(picked,c.perDay??50),'今日 · 已挑中的视频');
    quotaTile(target,'公开评论',meter(commentUsed,c.commentDailyLimit??10),'今日 · 发布接口尝试');
    quotaTile(target,'同步动态',meter(dynamic,c.dynamicDailyLimit??3),'今日 · 同步尝试');
    quotaTile(target,'后台评论回复',meter(reply,c.commentReplyPerDay??5),'滚动 24 小时 · 成功回执');
    quotaTile(target,'自动私信',meter(dmUsed,dmCap===0?'不限':dmCap),'今日 · 成功发送（额度闸门另按滚动24小时）');
    quotaTile(target,'附图',meter(memeUsed,c.commentMemesPerDay??2),'今日 · 占用的附图尝试');
    const visionCap=Number(c.visionDailyLimit??30);
    const visionMode=!c.visionEnabled?'预览识图未开启':c.visionMode==='independent_dsh'?'独立 DSH 视觉模型':'复用视频 Agent 看图';
    quotaTile(target,'额外独立视觉调用',meter(visionUsed,visionCap),`今日 · ${visionMode} · 按尝试计数`);
    quotaReadout('quota-per-day',daily(picked,c.perDay??50));
    quotaReadout('quota-comment-daily',daily(commentUsed,c.commentDailyLimit??10));
    quotaReadout('quota-dynamic-daily',daily(dynamic,c.dynamicDailyLimit??3));
    quotaReadout('comment-per-day',reply==null?'近24小时：暂不可读':`近24小时已成功 ${reply} / ${c.commentReplyPerDay??5}`);
    quotaReadout('dm-reply-per-day',dmRolling==null?'滚动24小时：暂不可读':`滚动24小时已发送 ${dmRolling} / ${dmCap===0?'不限制':dmCap}`);
    quotaReadout('dm-daily',dm.ok===true?`获批用户：今日最多单人已用 ${dm.approvedDailyMaxUsed} / ${approvedCap}（各 UID 独立）`:'获批用户用量：暂不可读');
    quotaReadout('dm-total',dm.ok===true?'这是每位获批用户的累计上限，非每天；详见后台私信用户记录':'这是每位用户的累计上限，非每天');
    quotaReadout('quota-meme-day',daily(memeUsed,c.commentMemesPerDay??2));
    quotaReadout('quota-vision-frames',`当前模式：${visionMode}；每个视频预览 ${c.visionFrames??2} 帧。取帧量不等于独立视觉调用次数。`);
    quotaReadout('quota-vision-daily',visionUsed===null?'独立视觉调用今日用量暂不可读；请检查本地账本':`今日独立调用 ${visionUsed} / ${visionCap} 次。${!c.visionEnabled?'目前识图总开关已关闭，不会新增视觉调用。':c.visionMode==='independent_dsh'?'当前独立模式，只有确实启动且非缓存命中的分析才增加计数。':'当前为复用模式；视频 Agent 直接看图不计入此账本，因此显示 0 并不代表今天没看过画面。'}`);
  };
  $('quota-refresh').addEventListener('click',()=>run(loadQuotas));
  $('quota-save').addEventListener('click',()=>run(async()=>{
    const payload={};
    for(const [id,key,min,max] of quotaFields)payload[key]=boundedInt(id,min,max,key);
    const saved=await request('/config',payload);
    await loadQuotas();
    message(saved.host?.ok===false?'已写插件配置，但同步到 DSH 失败：'+(saved.host.error||'未知原因'):'全部次数与额度已保存');
  }));

  // v2.4.53: 后台轮询设置单一入口，与每轮/每日额度分离；上次执行时间来自调度器实时状态。
  const pollingFields=[
    ['dm-interval','dmWatchMinutes'],
    ['poll-replies-minutes','commentReplyWatchMinutes'],
    ['poll-at-minutes','commentAtWatchMinutes'],
    ['poll-top-minutes','commentTopWatchMinutes'],
  ];
  const pollNames={dm:'自动私信',replies:'收到评论回复',mentions:'被 @ 邀请',top:'近期视频热评'};
  const pollClock=timestamp=>timestamp?new Date(timestamp).toLocaleString():'暂无';
  const loadPolling=async()=>{
    const data=await request('/status');const c=data.config||{},scheduler=data.interactionSchedulerStatus||{};
    const runs=scheduler.checks||{};
    const budget=scheduler.readBudget||{},cursor=scheduler.dmCursor||{};
    const reasonName={'platform-cooldown':'平台限流或验证','minute-budget':'分钟预算已满','hour-budget':'小时预算已满'};
    $('polling-budget-status').textContent=budget.minuteLimit?`近 1 分钟 ${budget.minuteUsed}/${budget.minuteLimit} · 近 1 小时 ${budget.hourUsed}/${budget.hourLimit}\n${budget.blocked?'⏸ '+(reasonName[budget.reason]||'读取冷却')+'，最早恢复 '+pollClock(budget.retryAt):'✓ 当前可读取'} · 已跟踪 ${cursor.tracked||0} 个会话\n仅已接入后台读取接口计数，不是 B站官方配额。`:'尚无请求预算数据';
    const budgetCategories={ 'dm-list':'私信会话列表','dm-messages':'私信消息','public-nickname':'公开昵称','uid-lookup':'昵称查询 UID','cover-metadata':'视频封面资料','cover-image':'视频封面图片'};
    const budgetRows=$('polling-budget-by-kind');budgetRows.replaceChildren();
    for(const row of (budget.byKind||[]).slice(0,20)){
      const kind=String(row.kind||'');const label=budgetCategories[kind]||(kind.startsWith('mcp:')?'主进程只读 · '+kind.slice(4):'其他只读请求');
      budgetRows.appendChild(node('span',label+' · 近 1 分钟 '+(row.minute||0)+' 次 / 近 1 小时 '+(row.hour||0)+' 次'));
    }
    if(!budgetRows.children.length)budgetRows.appendChild(node('span','目前没有记录到已接入的读取请求。'));
    for(const [id,key] of pollingFields){$(id).value=String(c[key]??({dmWatchMinutes:1,commentReplyWatchMinutes:3,commentAtWatchMinutes:3,commentTopWatchMinutes:5}[key]));}
    const target=$('polling-status-list');target.replaceChildren();
    for(const key of ['dm','replies','mentions','top']){
      const x=runs[key]||{},card=node('article','','settings-section');add(card,node('h4',pollNames[key]));
      const label=!scheduler.running?'宿主调度已停止':!x.enabled?'未启用':x.polling?'正在检查':x.lastResult==='error'?'最近检查失败':x.lastResult==='skipped'?'最近检查已跳过':x.lastFinishedAt?'最近检查完成':'尚未检查';
      add(card,node('p',`状态：${label} · 检查间隔：${x.intervalMinutes??'—'} 分钟`,'muted'));
      add(card,node('p',`上次开始：${pollClock(x.lastStartedAt)} · 上次完成：${pollClock(x.lastFinishedAt)}`,'muted'));
      add(card,node('p',`下次预计：${x.enabled&&scheduler.running?(x.polling?'本轮进行中':pollClock(x.nextAt)):'未计划'}`,'muted'));
      if(x.lastError)add(card,node('p','最近错误：'+String(x.lastError).slice(0,180),'muted'));
      else if(x.lastDetails?.skipped)add(card,node('p','跳过原因：'+String(x.lastDetails.skipped),'muted'));
      target.appendChild(card);
    }
  };
  $('polling-refresh').addEventListener('click',()=>run(loadPolling));
  $('polling-reload').addEventListener('click',()=>run(loadPolling));
  $('polling-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of pollingFields)payload[key]=boundedInt(id,1,120,key);
    const saved=await request('/config',payload);await loadPolling();
    message(saved.host?.ok===false?'间隔已保存到本插件，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'四项轮询间隔已保存，下次检查会动态采用新值');
  }));

  // 显式加载内置默认提示词，旧用户已有非空自定义优先。不存在自动覆盖和自动保存。
  const promptEntries=[
    ['persona','personaPrompt','/persona-prompt-default','18000','大肥鱼人设'],
    ['meme-prompt','commentMemePrompt','/comment-meme-prompt-default','4000','AI 选图提示词'],
    ['vision-prompt','visionPrompt','/vision-prompt-default','4000','视觉识图提示词'],
    ['lore','characterLore','/character-lore-default','4000','角色背景']
  ];
  const promptDefaults={};
  let friendProfilesDraft={};
  let friendsDirectory=[];
  let selectedOwnerUid='';
  let savedOwnerUid='';
  const uidValid=v=>/^[1-9]\d{0,18}$/.test(String(v||''));
  const friendName=r=>r.name||('UID '+r.uid);
  const normalizeFriends=rows=>{
    const seen=new Set();return rows.filter(r=>r&&uidValid(r.uid)).map(r=>({
      uid:String(r.uid), name:String(r.name||'').replace(/[<>|\r\n]/g,' ').trim().slice(0,40),
      dm:r.dm===true,mention:r.mention===true,atInvite:r.atInvite===true,
      recommend:['dm','mention','both','off'].includes(r.recommend)?r.recommend:
        (r.dm===true?(r.mention===true?'both':'dm'):(r.mention===true?'mention':'off'))
    })).filter(r=>{if(seen.has(r.uid))return false;seen.add(r.uid);return true}).slice(0,120);
  };
  const readNames=text=>String(text||'').split(/[\r\n,，;；]+/).map(x=>x.trim()).filter(Boolean).map(x=>{
    const [left='',right='']=x.split('|').map(v=>v.trim());
    return uidValid(left)?{uid:left,name:right}:uidValid(right)?{uid:right,name:left}:null;
  }).filter(Boolean);
  const importPriorDirectory=c=>{
    let current=[];try{current=JSON.parse(c.friendDirectory||'[]')}catch{}
    const existing=normalizeFriends(Array.isArray(current)?current:[]);
    const map=new Map(existing.map(r=>[r.uid,r]));
    for(const [key,flag] of [['dmWhitelist','dm'],['mentionTargets','mention'],['commentAtWhitelist','atInvite']]){
      for(const item of readNames(c[key])){
        const r=map.get(item.uid)||{uid:item.uid,name:item.name,dm:false,mention:false,atInvite:false,recommend:'off'};
        if(!r.name&&item.name)r.name=item.name;
        if(!r[flag]){
          r[flag]=true;
          if(flag==='dm')r.recommend=r.recommend==='mention'?'both':'dm';
          if(flag==='mention')r.recommend=r.recommend==='dm'?'both':'mention';
        }
        map.set(r.uid,r);
      }
    }
    return normalizeFriends([...map.values()]);
  };
  const drawFriendDirectory=()=>{
    const target=$('friend-directory-editor');target.replaceChildren();
    if(!friendsDirectory.length){target.appendChild(info('还没有好友。请先添加 UID；昵称可留空。'));return}
    // 显示顺序只看唯一授权主人 UID；昵称、画像角色不授予主人权限。
    const displayRows=[...friendsDirectory].sort((a,b)=>Number(b.uid===selectedOwnerUid)-Number(a.uid===selectedOwnerUid));
    for(const row of displayRows){
      const isOwner=!!selectedOwnerUid&&selectedOwnerUid===row.uid;
      const card=node('article','','settings-section friend-directory-card'+(isOwner?' is-owner':''));
      const heading=node('div','','friend-directory-heading');
      const title=node('div','','friend-directory-title');
      add(title,node('strong',friendName(row)+' · UID '+row.uid),node('span',isOwner?(selectedOwnerUid===savedOwnerUid?'👑 唯一授权主人':'👑 主人身份待保存'):'好友','friend-role-tag'));
      add(heading,title, btn('移除',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'移除 UID '+row.uid+' 的名册权限和画像？请点击保存后才正式生效。'}))return;
        friendsDirectory=friendsDirectory.filter(x=>x.uid!==row.uid);
        if(selectedOwnerUid===row.uid)selectedOwnerUid='';
        delete friendProfilesDraft[row.uid];drawFriendDirectory();
      },'danger'));
      card.appendChild(heading);
      card.appendChild(node('p','当前草稿：'+(row.dm?'可私信':'未开放私信')+' · '+({dm:'私信推荐',both:'私信 + 公开 @',mention:'公开 @ 推荐',off:'不主动推荐'}[row.recommend]||'未设置')+' · 修改后须点击下方保存','friend-directory-status'));
      const editor=node('details','','friend-editor');
      editor.appendChild(node('summary',isOwner?'编辑主人资料与权限':'编辑好友资料与权限'));
      card.appendChild(editor);
      const nameWrap=node('div','','fields');const nameL=node('label','昵称备注（不参与权限判断）');const nameInput=node('input');
      nameInput.value=row.name;nameInput.maxLength=40;nameInput.addEventListener('input',()=>{row.name=nameInput.value.trim();heading.querySelector('strong').textContent=friendName(row)+' · UID '+row.uid});
      add(nameWrap,add(node('div'),nameL,nameInput));editor.appendChild(nameWrap);
      const checks=node('div','','friend-role-row');
      const dmWrap=node('label','','checkline');const dmCheck=document.createElement('input');dmCheck.type='checkbox';dmCheck.checked=row.dm;
      dmCheck.addEventListener('change',()=>{row.dm=dmCheck.checked});
      add(dmWrap,dmCheck,node('span','允许与这位好友私信往来（互动与手动发送权限）'));checks.appendChild(dmWrap);
      const channelWrap=node('div');const channelLabel=node('label','主动视频推荐渠道');const channelSelect=node('select');
      for(const [value,label] of [['dm','私信优先（推荐）'],['both','私信 + 公开 @（两项都可用）'],['mention','只在公开视频中 @（可选）'],['off','不主动推荐（仍可聊天和学习偏好）']])channelSelect.add(new Option(label,value));
      channelSelect.value=row.recommend;channelSelect.addEventListener('change',()=>{row.recommend=channelSelect.value;row.mention=['mention','both'].includes(row.recommend)});
      add(channelWrap,channelLabel,channelSelect,node('small','「私信优先」只表示允许使用这个渠道；还须在下方「主动视频兴趣推荐」重新授权并开启自动发送（或手动确认草稿），且须允许与这位好友私信。','muted'));checks.appendChild(channelWrap);
      const atWrap=node('label','','checkline');const atCheck=document.createElement('input');atCheck.type='checkbox';atCheck.checked=row.atInvite;
      atCheck.addEventListener('change',()=>{row.atInvite=atCheck.checked});
      add(atWrap,atCheck,node('span','授权读取这位好友通过 @ 提出的偏好反馈（不限制接收 @ 的回复）'));checks.appendChild(atWrap);
      editor.appendChild(checks);
      const profile=friendProfilesDraft[row.uid]||{};
      const fields=node('div','','fields');
      const makeField=(label,value,onUpdate,multiline=false)=>{
        const wrap=node('div');const lab=node('label',label);const el=node(multiline?'textarea':'input');
        el.value=value||'';el.maxLength=multiline?700:120;if(multiline)el.rows=3;
        el.addEventListener('input',()=>{const v=friendProfilesDraft[row.uid]||{};onUpdate(v,el.value);friendProfilesDraft[row.uid]=v});
        add(wrap,lab,el);return wrap;
      };
      fields.appendChild(makeField('与大肥鱼的关系',profile.relationship,(v,x)=>v.relationship=x));
      const ownerWrap=node('div');const ownerLab=node('label','授权主人（最多一个 UID）','');
      const ownerCheck=document.createElement('input');ownerCheck.type='checkbox';ownerCheck.checked=selectedOwnerUid===row.uid;
      ownerCheck.addEventListener('change',async()=>{
        if(ownerCheck.checked&&selectedOwnerUid&&selectedOwnerUid!==row.uid){
          if(!await confirmAction({title:'请确认操作',description:'切换授权主人将撤销原 UID '+selectedOwnerUid+' 的主人私信及公开评论 Agent 权限。确定切换到 '+row.uid+' 吗？'})){ownerCheck.checked=false;return}
        }
        selectedOwnerUid=ownerCheck.checked?row.uid:'';
        drawFriendDirectory();
      });
      add(ownerWrap,ownerLab,add(node('label','设为唯一授权主人（控制主人私信及评论 Agent）','checkline'),ownerCheck),node('small','勾选并保存：授予此 UID 主人身份；取消并保存：撤销主人身份。点赞、发布评论等写操作仍须单独授权。','muted'));fields.appendChild(ownerWrap);
      fields.appendChild(makeField('性格爱好',profile.personalityInterests||[profile.personality,profile.interests].filter(Boolean).join('；'),(v,x)=>v.personalityInterests=x,true));
      editor.appendChild(fields);
      const peers=node('div','','settings-section');add(peers,node('h4','与其他白名单用户的关系'),info('选一位 UID，填入这位好友与对方的关系；不能选择自己。'));
      const peerRows=Array.isArray(profile.peerRelationships)?profile.peerRelationships:[];
      const makePeer=(peer)=>{
        const line=node('div','','peer-line');const select=node('select');
        add(select, new Option('选择好友',''));
        for(const r of friendsDirectory.filter(x=>x.uid!==row.uid))add(select,new Option(friendName(r)+' · '+r.uid,r.uid));
        select.value=peer.uid||'';const description=node('input');description.placeholder='这两位是什么关系';description.maxLength=120;description.value=peer.relationship||'';
        const rm=btn('移除关系',async()=>{line.remove()});
        add(line,select,description,rm);peers.appendChild(line);
        // Persist draft from live editor in a safe, deterministic way.
        line.dataset.peer='1';line.dataset.forUid=row.uid;
        select.addEventListener('change',syncPeers);description.addEventListener('input',syncPeers);rm.addEventListener('click',syncPeers);
      };
      const syncPeers=()=>{const links=[...peers.querySelectorAll('.peer-line')].map(l=>({uid:l.querySelector('select')?.value||'',relationship:l.querySelector('input')?.value.trim()||''})).filter(x=>x.uid&&x.relationship&&x.uid!==row.uid);friendProfilesDraft[row.uid]={...(friendProfilesDraft[row.uid]||{}),peerRelationships:links}};
      for(const peer of peerRows)makePeer(peer);
      add(peers,btn('添加一项好友关系',async()=>{makePeer({uid:'',relationship:''})}));editor.appendChild(peers);
      target.appendChild(card);
    }
  };
  const loadFriendLearning=async()=>{
    const data=await request('/friend-learning');
    const target=$('friend-learning-list');target.replaceChildren();
    const rows=data.rows||[];
    $('friend-learning-status').textContent=rows.length+' 位白名单好友有明确兴趣线索（不会收集非白名单用户）';
    for(const friend of rows){
      const card=node('article','','record');
      add(card,node('strong','UID '+friend.uid),info((friend.interests||[]).map(x=>({tentative:'待确认',cooling:'较久未提及','changed-recently':'近期表达有变化','observed-repeated':'多次明确提到'}[x.status]||'观察中')+(x.directRequest?' · 明确请求多推荐':'')+' · '+(x.stance==='uncertain'?'兴趣减弱／待确认':x.stance==='like'?'喜欢':'不喜欢')+'「'+x.topic+'」'+(x.support180!==undefined?'（近半年 '+x.support180+' 次）':'')).join('；')+(friend.rejectedVideos?'；明确拒绝重复推荐的 BV：'+friend.rejectedVideos+' 条':'')+(friend.contactOptOuts?.length?'；明确拒绝的联系渠道：'+friend.contactOptOuts.map(x=>x==='mention'?'公开 @':'私信').join('、') :'')+(friend.recommendationConsent==='off'?'；已明确拒绝所有主动视频推荐':'')));
      add(card,btn('清除这个 UID 的兴趣学习',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'确定清空 UID '+friend.uid+' 的后天兴趣观察？原始好友画像不变。'}))return;
        await request('/friend-learning/clear',{uid:friend.uid,confirm:'CLEAR_FRIEND_OBSERVATIONS'});
        await loadFriendLearning();message('已清理该好友兴趣观察');
      },'danger'));
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('暂无观察。仅当白名单好友自己在私信或评论里明确说出兴趣，才会产生线索。'));
  };
  // Person-scoped, lazy review. One platform-local ID per card; never merge
  // identities by nickname or similarity. No need to maintain a manual profile.
  const loadPersonPortrait=async(row,container)=>{
    const uid=String(row.platformUserId||row.uid||'');
    if(row.platform!=='bilibili'){
      container.replaceChildren(info('此平台尚未接入真实关系与画像数据，不会虚构联系人。'));return;
    }
    const data=await request('/friend-portrait?'+new URLSearchParams({platform:'bilibili',uid}));
    const profile=data.profile||{},items=profile.items||[];
    container.replaceChildren();
    const depth=profile.depth||{};
    add(container,node('h4','🐟 交流画像 · '+(depth.label||'相遇摘要')),
      info('身份：哔哩哔哩 · UID '+uid+' · 独立于其他平台账号'),
      info(depth.note||'仅使用可核实的互动证据。此处不会推断性格、授予发送权限或合并平台账号。'));
    if(!items.length){container.append(info('尚无可用的明确交流偏好与边界证据；鱼鱼不会根据互动次数猜测这个人的性格。'));return}
    add(container,info('已保存 '+items.length+' 条可撤回线索；当前阶段用于模型的最多 '+(depth.cap||0)+' 条。只在合法渠道使用；私信线索不会进入公开回复。'));
    for(const item of items){
      const line=node('div','','toolbar');
      add(line,info(item.value+' · '+(item.scope==='public'?'公开表达':'仅私信／主人纠正')+' · '+new Date(item.at).toLocaleDateString()));
      add(line,btn('撤回错误线索',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'确定撤回这条由 UID '+uid+' 产生的交流线索？'}))return;
        await request('/friend-portrait',{action:'retract',uid,evidenceId:item.id,confirm:'REVIEW_FRIEND_PORTRAIT'});
        await loadPersonPortrait(row,container);message('已撤回错误证据');
      },'danger'));
      container.append(line);
    }
    const review=node('details','','inset');review.appendChild(node('summary','可选：纠错与遗忘（不影响对外授权）'));
    const select=node('select');
    for(const [code,label] of [
      ['style:brief','喜欢简短回复'],['style:detailed','喜欢详细解释'],['style:gentle','希望温和交流'],
      ['style:ask-first','先问清楚再解释'],['style:no-spoilers','不希望剧透'],
      ['boundary:no-followup','不主动追问或延迟补充'],['boundary:no-public-mention','不希望公开被 @'],['boundary:no-dm','不希望被主动私信']]){
      const option=node('option',label);option.value=code;select.append(option);
    }
    const actions=node('div','','toolbar');actions.append(select);
    add(actions,btn('标注人工纠正',async()=>{
      if(!await confirmAction({title:'请确认操作',description:'确认写入主人纠正？只有已核实的同一平台联系人可操作，且不会增加外发权限。'}))return;
      await request('/friend-portrait',{action:'correct',uid,code:select.value,confirm:'REVIEW_FRIEND_PORTRAIT'});
      await loadPersonPortrait(row,container);message('已标注纠正');
    }));
    add(actions,btn('清空此人的交流画像',async()=>{
      if(!await confirmAction({title:'请确认操作',description:'永久清空哔哩哔哩 UID '+uid+' 的所有交流画像证据？不影响关系统计和发送权限。'}))return;
      await request('/friend-portrait',{action:'clear',uid,confirm:'REVIEW_FRIEND_PORTRAIT'});
      await loadPersonPortrait(row,container);message('已清空此平台身份的交流画像');
    },'danger'));
    review.append(actions);container.append(review);
    if(mobileViewOnly)for(const control of container.querySelectorAll('button,select')){
      control.disabled=true;control.title=mobileDesktopHint;
    }
  };
  const loadDev5Social=async()=>{
    const r=await request('/dev5-social'),target=$('social-dev5-records');target.replaceChildren();
    const rows=r.social?.items||[];
    $('social-dev5-status').textContent=`社交事件待补偿 ${r.socialEvents?.pending||0} 条 · 候选意愿 ${rows.filter(x=>x.status==='candidate').length} 条 · 陌生灵感 ${r.social?.inspirations?.join('、')||'无'} · 主人评论最近 ${r.ownerComment?.recent?.length||0} 条`;
    for(const x of rows.slice(0,15)){
      const name=x.kind==='friend-invitation'?'好友只读邀请':'陌生人临时灵感';
      add(target,node('div',`${name} · ${x.status} · ${x.bvid||x.topics?.join('、')||''} · ${new Date(x.at).toLocaleString()}`,'record'));
    }
    if(!rows.length)target.append(info('尚无新意愿；首次监听会跳过旧通知。'));
    const last=r.ownerComment?.recent?.at(-1);
    $('owner-comment-agent-status').textContent=last?`最近：${last.type} · ${last.status} · ${last.replyStatus||'无公开回执'}`:'尚无主人评论动作记录。';
  };
  $('social-dev5-refresh').addEventListener('click',()=>run(loadDev5Social));
  $('social-dev5-save').addEventListener('click',()=>run(async()=>{
    const patch={strangerInspirationEnabled:$('social-stranger-inspiration').checked,socialInvitationEnabled:$('social-friend-invitations').checked,socialInvitationAutoInspectEnabled:$('social-invitation-auto').checked};
    await request('/config',patch);const current=(await request('/config')).config||{};
    if(Object.keys(patch).some(k=>patch[k]!==current[k]))throw Error('社会认知权限回读与保存不一致');
    await loadDev5Social();message('dev.5 社会认知权限已保存并校验');
  }));
  $('friend-learning-refresh').addEventListener('click',()=>run(loadFriendLearning));
  const checkPersonaCard=()=>{
    const el=$('persona-text'),text=String(el.value||''),notes=[];
    if(!text.trim())notes.push('为空时采用内置人设');
    if(text.length>8000)notes.push('超过 8000 字：聊天/视频主提示词只采用前 8000 字，其余段落可能不会生效，请精简或把重要设定前置');
    if(text.length>=18000)notes.push('已达到保存上限 18000 字');
    if(/send_message|replyToMessageId|send_poke|web_search|web_fetch|SillyTavern|QQ\s*群/.test(text))notes.push('包含外部平台/工具指令：本插件只作为人设风格文本使用，不会提供这些工具或放宽安全授权');
    $('persona-compat-status').textContent=notes.length?notes.join('；'):'长度符合当前提示词预算，可用于人设风格；实际工具和安全规则仍由插件控制';
  };
  $('persona-text').addEventListener('input',checkPersonaCard);
  const loadPersona=async()=>{
    const [config,...defaults]=await Promise.all([request('/config'),...promptEntries.map(x=>request(x[2]))]);
    const c=config.config||{};
    for(let i=0;i<promptEntries.length;i++){
      const [id,key]=promptEntries[i];const d=promptDefaults[key]=String(defaults[i].prompt||'');
      $(id+'-text').value=String(c[key]||d);
      $(id+'-status').textContent=String(c[key]||'').trim()?'已自定义':'内置默认';
    }
    checkPersonaCard();
  };
  const loadSocialFriends=async()=>{
    const c=(await request('/config')).config||{};
    $('friends-mode').value=['ai','ai_select','off','always'].includes(c.mentionMode)?c.mentionMode:'ai_select';
    $('friend-at-feedback-enabled').checked=c.friendAtFeedbackEnabled===true;
    $('social-stranger-inspiration').checked=c.strangerInspirationEnabled===true;
    $('social-friend-invitations').checked=c.socialInvitationEnabled===true;
    $('social-invitation-auto').checked=c.socialInvitationAutoInspectEnabled===true;
    friendsDirectory=importPriorDirectory(c);
    savedOwnerUid=String(c.dmOwnerUid||'');
    selectedOwnerUid=friendsDirectory.some(r=>r.uid===savedOwnerUid)?savedOwnerUid:'';
    $('friend-owner-status').textContent=selectedOwnerUid?'当前授权主人 UID：'+selectedOwnerUid:'当前没有名册内的授权主人'+(savedOwnerUid?'（旧授权 UID '+savedOwnerUid+' 不在名册；保存时会要求确认撤销或重新勾选）':'')+'。';
    try{friendProfilesDraft=JSON.parse(c.mentionProfiles||'{}');if(!friendProfilesDraft||Array.isArray(friendProfilesDraft)||typeof friendProfilesDraft!=='object')friendProfilesDraft={}}catch{friendProfilesDraft={}}
    // Import old profile names by a one-off display-name match. Afterwards only UID keys are saved.
    for(const r of friendsDirectory){if(!friendProfilesDraft[r.uid]&&friendProfilesDraft[r.name])friendProfilesDraft[r.uid]=friendProfilesDraft[r.name]}
    drawFriendDirectory();
    await Promise.all([loadFriendLearning(),loadDev5Social()]);
  };
  const saveFriends=async()=>{
    friendsDirectory=normalizeFriends(friendsDirectory);
    for(const r of friendsDirectory){
      r.mention=['mention','both'].includes(r.recommend);
      if(['dm','both'].includes(r.recommend)&&!r.dm)throw Error('UID '+r.uid+' 使用私信推荐渠道，但尚未允许私信往来');
    }
    if(friendsDirectory.filter(r=>r.mention).length>8)throw Error('可公开 @ 的好友最多 8 位，请调整他们的推荐渠道');
    const names=r=>r.uid+(r.name?'|'+r.name:'');
    const targets=friendsDirectory.filter(r=>r.mention).map(names).join('\n');
    const dm=friendsDirectory.filter(r=>r.dm).map(names).join('\n');
    const invite=friendsDirectory.filter(r=>r.atInvite).map(names).join('\n');
    if(selectedOwnerUid&&!friendsDirectory.some(r=>r.uid===selectedOwnerUid))throw Error('授权主人 UID 不在好友名册中');
    if(selectedOwnerUid!==savedOwnerUid&&!await confirmAction({title:'请确认操作',description:selectedOwnerUid?'确认将唯一授权主人变更为 UID '+selectedOwnerUid+'？原主人权限将立即撤销。':'确认撤销当前主人 UID 的所有主人私信及公开评论 Agent 操作权限？'}))return;
    const selected={};for(const r of friendsDirectory){const p={...(friendProfilesDraft[r.uid]||{})};p.role=r.uid===selectedOwnerUid?'owner':'friend';selected[r.uid]=p}
    const payload={friendDirectory:JSON.stringify(friendsDirectory),mentionProfiles:JSON.stringify(selected),dmOwnerUid:selectedOwnerUid?Number(selectedOwnerUid):0,mentionMode:$('friends-mode').value,friendAtFeedbackEnabled:$('friend-at-feedback-enabled').checked,mentionTargets:targets,dmWhitelist:dm,commentAtWhitelist:invite,
      clear:[...(!targets?['mentionTargets']:[]),...(!dm?['dmWhitelist']:[]),...(!invite?['commentAtWhitelist']:[])]};
    const saved=await request('/config',payload);
    const readBack=(await request('/config')).config||{};
    if(String(readBack.dmOwnerUid||'')!==selectedOwnerUid)throw Error('主人 UID 保存后回读不一致，请不要发送操作指令');
    await loadSocialFriends();message(saved.host?.ok===false?'已保存，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'好友互动名册、推荐渠道、@ 意愿监听及画像已保存');
  };
  $('friend-add').addEventListener('click',()=>run(async()=>{
    const uid=$('friend-new-uid').value.trim();if(!uidValid(uid))throw Error('请输入有效的纯数字 UID');
    if(friendsDirectory.some(r=>r.uid===uid))throw Error('这个 UID 已存在，可直接编辑该条');
    if(friendsDirectory.length>=120)throw Error('好友名册最多 120 人');
    friendsDirectory.push({uid,name:$('friend-new-name').value.trim(),dm:true,mention:false,atInvite:true,recommend:'dm'});
    $('friend-new-uid').value='';$('friend-new-name').value='';drawFriendDirectory();message('已加入草稿，勾选权限后点击保存');
  }));
  $('friend-save-all').addEventListener('click',()=>run(saveFriends));
  for(const [id,key,,,label] of promptEntries){
    $(id+'-save').addEventListener('click',()=>run(async()=>{
      const text=$(id+'-text').value.trim();if(!text)throw Error(label+'不能为空；需要默认规则，请点击「恢复默认」');
      const isDefault=text===promptDefaults[key];
      const saved=await request('/config',{[key]:isDefault?'':text,clear:isDefault?[key]:[]});
      $(id+'-status').textContent=isDefault?'内置默认':'已自定义';
      message(saved.host?.ok===false?'保存成功，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已保存');
    }));
    $(id+'-reset').addEventListener('click',()=>run(async()=>{
      if(!await confirmAction({title:'请确认操作',description:'恢复「'+label+'」为官方默认？当前自定义内容将清除。'}))return;
      const saved=await request('/config',{[key]:'',clear:[key]});
      $(id+'-text').value=promptDefaults[key]||'';
      $(id+'-status').textContent='内置默认';
      message(saved.host?.ok===false?'已清除自定义，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已恢复默认');
    }));
  }
  $('persona-refresh').addEventListener('click',()=>run(loadPersona));

  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const safeVideoLink=(bvid)=>{const bv=/^BV[0-9A-Za-z]{10}$/.test(String(bvid||''))?String(bvid):'';const a=node('a',bv||'打开视频');a.href='https://www.bilibili.com/video/'+encodeURIComponent(bv);a.target='_blank';a.rel='noopener noreferrer';return a};
  // B站 webpage deep links are best-effort: the site decides whether to expand and scroll.
  // Never confuse a nested comment's immediate parent (targetId) with its real root.
  const commentCoordinates=(c)=>{
    const bv=/^BV[0-9A-Za-z]{10}$/.test(String(c?.bvid||''))?String(c.bvid):'';
    const rid=/^[1-9]\d{0,29}$/.test(String(c?.rpid||''))?String(c.rpid):'';
    const rawRoot=/^[1-9]\d{0,29}$/.test(String(c?.root||''))?String(c.root):'';
    const fromNotice=/^[1-9]\d{0,29}$/.test(String(c?.locationRoot||''))?String(c.locationRoot):'';
    const kind=c?.kind==='reply'?'reply':'top';
    const root=fromNotice||(kind==='top'?rid:rawRoot);
    const confidence=fromNotice?'通知原始根评论ID':kind==='top'?'顶层评论ID':root?'历史记录推定的根评论ID':'无根评论ID';
    return {bv,rid,root,kind,confidence,precise:!!(bv&&rid&&root)};
  };
  const safeCommentLink=(c)=>{
    const x=commentCoordinates(c);
    const bv=x.bv;const videoLabel=bv||'视频 ID 未记录';
    const a=node('a',videoLabel);
    const base=x.bv?'https://www.bilibili.com/video/'+encodeURIComponent(x.bv)+'/':'https://www.bilibili.com/';
    if(x.precise){
      const params=new URLSearchParams({comment_on:'1',comment_root_id:x.root});
      if(x.kind==='reply'&&x.root!==x.rid)params.set('comment_secondary_id',x.rid);
      a.href=base+'?'+params.toString()+'#reply'+encodeURIComponent(x.rid);
    }else a.href=base;
    a.target='_blank';a.rel='noopener noreferrer';
    a.title=x.precise?'点击定位具体评论 · rpid '+x.rid+' · '+x.confidence+'；B站网页可能不自动滚动':
      '缺少可靠根评论 ID，仅打开视频；可查看卡片内已保存的原文与评论 ID';
    return a;
  };
  const reasonLabel=(x)=>({ai_declined:'AI 决定不 @',ai_selected_no_names:'AI 想 @，但未选中名单内好友',no_mention_targets:'没有配置 @ 名单',mention_disabled:'@ 策略已关闭',mentioned_text_only_missing_uid:'缺少有效 UID',mention_requested:'已按设置尝试 @',reply_no_group_mentions:'后台回复不群发 @'}[x]||x||'未提供原因');
  const dynamicStatusLabel=(x)=>({api_accepted_unverified:'B站接口接受（公开状态未核实）',ai_skipped:'AI 选择不同步',disabled:'同步开关关闭',blocked_by_setting:'被用户设置阻止',receipt_unverified:'评论回执不完整，无法安全同步',daily_limit:'达到每日动态上限',already_attempted:'同 BV 今日已尝试',reservation_failed_no_publish:'额度锁失败，未发布',comment_receipt_unverified_no_publish:'评论回执不完整，未发布',uncertain_no_retry:'发送结果不确定，不重试',failed:'动态接口失败',paused:'插件已暂停',not_requested:'未选择同步',comment_failed:'评论失败',not_applicable:'不适用于楼中楼回复'}[x]||x||'状态未知');
  const diagFields=[['diag-mention-enabled','diagMentionEnabled'],['diag-dynamic-enabled','diagDynamicEnabled'],['diag-vision-enabled','diagVisionEnabled'],['diag-meme-enabled','diagMemeEnabled'],['diag-at-invite-enabled','diagAtInviteEnabled'],['diag-reply-inbox-enabled','diagReplyInboxEnabled']];
  $('diag-save').addEventListener('click',()=>run(async()=>{
    const patch={};for(const [id,key] of diagFields)patch[key]=$(id).checked;
    const saved=await request('/config',patch);
    message(saved.host?.ok===false?'已写入本地配置，DSH 设置同步失败：'+(saved.host.error||'未知原因'):'诊断开关已保存，后续任务按新开关记录；历史日志保留');
  }));
  const loadDiscussionDiagnostics=async()=>{
    const summary=$('discussion-read-summary'),list=$('discussion-read-list');
    try{
      const data=await request('/video-discussion-diagnostics');
      list.replaceChildren();
      if(!data.accountReady){summary.textContent=data.hint||'当前 B站账号未就绪';return}
      const x=data.summary||{};
      summary.textContent=`最近 ${data.days} 天 · 成功读评论区 ${x.readLists||0} 次（成功但空评论 ${x.emptyLists||0} 次） · 列表失败/部分失败 ${x.failedLists||0} 次 · 成功读楼中楼 ${x.readThreads||0} 次 · 楼中楼失败 ${x.failedThreads||0} 次 · 临时感受 ${x.provisionalNotes||0} 条 · 感受保存被拒 ${x.noteRejections||0} 次 · 写日报时未附感受 ${x.noteNotProvided||0} 条`;
      if(data.truncated||data.unreadable)add(list,info('部分历史文件过大或无法读取；统计可能不完整，请检查本地日志。'));
      for(const e of (data.events||[])){
        const card=node('div','','record');const head=node('div');
        const type=e.kind==='comment_list_read'?'评论列表':e.kind==='comment_thread_read'?'楼中楼':e.kind==='provisional_note_rejected'?'感受保存请求':e.kind==='provisional_note_not_provided'?'日报未附感受':'鱼鱼的暂时感受';
        const result=e.kind==='provisional_fish_reaction'?'主观记录（非事实）':e.kind==='provisional_note_rejected'?'被拒绝（未保存）':e.kind==='provisional_note_not_provided'?'无主观记录':e.status==='read'?(e.count===0?'成功读取 · 0条':'成功读取 · '+e.count+'条'):(e.status==='partial_failure'?'部分失败':'读取失败');
        add(head,safeVideoLink(e.bvid),node('span',' · '+type+' · '+result));
        add(card,head,info(formatLocalTime(e.at)+(e.root?' · 根评论 ID '+e.root:'')));
        if(e.kind==='provisional_note_not_provided')add(card,info('本轮成功读取此 BV 后，日报工具没有附带主观感受。这不是鱼鱼明确表示没有感受；之后仍可能单独保存。'));
        if(e.kind==='provisional_note_rejected'){
          const descriptions={duplicate:'这轮同一视频已有感受',missing_read:'缺少本轮成功读取证据',invalid_reaction:'反应类别无效',invalid_question:'疑问不符合脱敏或长度要求',write_failed:'本地文件写入失败'};
          add(card,info('实际调用了保存工具，但未成功登记：'+(descriptions[e.reason]||'未分类原因')+'。此记录不包含模型传入的疑问或私人数据。'));
        }
        if(e.kind==='provisional_fish_reaction'){
          const label={curious:'好奇',amused:'觉得有趣',skeptical:'存疑',neutral:'平静',none:'没有特别感受'}[e.reaction]||'未分类';
          add(card,info('鱼鱼当时自述：'+label+'；这是临时主观反馈，不是长期记忆、外部事实或社交行为。'));
          if(e.question)add(card,node('div','当时的疑问：'+e.question,'preview'));
        }
        list.appendChild(card);
      }
      if(!list.children.length)add(list,info('近 7 天没有当前账号的阅读记录。不能据此判定“模型决定不看”；请先确认视频 Agent 真正跑过一轮。'));
      add(list,info(data.hint||''));
    }catch(e){summary.textContent='阅读记录暂不可用：'+String(e.message||e);list.replaceChildren(info('请确认插件后端与管理页面均已更新到包含验收入口的版本，并完全重启 DSH。'))}
  };
  $('discussion-read-refresh').addEventListener('click',()=>run(loadDiscussionDiagnostics));
  const loadDiagnostics=async()=>{
    await loadLifeDecisionTraces();
    // Existing published-comment ledger only: no additional B站 reads or AI calls.
    const [m,im,vi,config,status,receipts]=await Promise.all([request('/mention-diagnostics'),request('/meme-diagnostics'),request('/vision-diagnostics'),request('/config'),request('/status'),request('/recent-comments?limit=200').catch(()=>({rows:[]}))]);
    // 仅保留底层诊断路由供开发工具使用，普通运行诊断页不主动请求。
    const exactReceipts=new Map((receipts.rows||[]).filter(r=>r.rpid&&r.bvid).map(r=>[r.bvid+':'+r.rpid,r]));
    const hydrateDiag=(x)=>{
      const rec=exactReceipts.get(String(x.bvid||'')+':'+String(x.rpid||''));
      if(!rec)return x;
      return {...x, root:x.root&&x.root!=='0'?x.root:(rec.root||x.root),kind:x.kind||rec.kind,
        content:x.content||rec.snippet||'',contentFromReceipt:!x.content&&!!rec.snippet};
    };
    const addDiagContext=(card,x)=>{
      if(x.content)add(card,node('div',(x.contentFromReceipt?'已有判重账本节选：':'这条评论（本地记录）：')+String(x.content),'preview'));
      else add(card,info('这条诊断未保存评论正文；旧记录无法无成本补出原文。'));
      const c=commentCoordinates(x);
      if(c.precise){
        add(card,info('评论定位 ID：root '+c.root+' · rpid '+c.rid+'（B站网页不保证自动滚动）'));
        add(card,btn('复制评论 ID',()=>{navigator.clipboard?.writeText?.('BV='+c.bv+' root='+c.root+' rpid='+c.rid);message('已请求复制定位 ID')}));
      }else add(card,info('本条缺少可靠评论 ID，BV 链接仅打开视频，无法精准跳转。'));
    };
    for(const [id,key] of diagFields)$(id).checked=config.config?.[key]!==false;
    $('mention-summary').textContent=`${m.day||localDay()} · 已发表评论 ${m.total||0} 条 · 尝试 @ ${m.attempted||0} 条 · 未 @ ${m.notMentioned||0} 条 · 失败 ${m.failed||0} 条`;
    $('mention-list').replaceChildren();
    for(const raw of (m.recent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');add(top,(x.rpid?safeCommentLink(x):safeVideoLink(x.bvid)),node('span',' · '+(x.kind==='reply'?'楼中楼':'顶层')+' · '+(x.success?(x.mention_attempted?'尝试 @':'未 @'):'发送失败')));
      add(card,top,info((x.time||'')+' · '+reasonLabel(x.reason)+(x.mention_delivery?' · '+x.mention_delivery:'')));
      addDiagContext(card,x);
      if(x.success&&x.reason==='ai_declined'&&x.ai_reason)add(card,info('AI说明：'+x.ai_reason));
      $('mention-list').appendChild(card);
    }
    if(!$('mention-list').children.length)$('mention-list').append(info('今天还没有 @ 诊断记录。'));
    const dy=m.dynamic||{};
    $('dynamic-summary').textContent=`顶层评论决策 ${dy.evaluated??0} 条 · AI 选择同步 ${dy.aiSelected??0} 条 · 接口接受 ${dy.accepted??0} 条 · AI 选择不同步 ${dy.aiSkipped??0} 条 · 设置／额度阻止 ${dy.blocked??0} 条`;
    $('dynamic-list').replaceChildren();
    for(const raw of (m.dynamicRecent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');
      add(top,(x.rpid?safeCommentLink(x):safeVideoLink(x.bvid)),node('span',' · '+(x.dynamic_ai_decision===true?'AI 选择同步':'AI 选择不同步')+' · '+dynamicStatusLabel(x.dynamic_status)));
      add(card,top,info((x.time||'')+(x.dynamic_reason?' · AI说明：'+x.dynamic_reason:'')));
      addDiagContext(card,x);
      $('dynamic-list').appendChild(card);
    }
    if(!$('dynamic-list').children.length)$('dynamic-list').append(info('今天还没有动态决策诊断记录。'));
    $('vision-summary').textContent=`${vi.enabled?'识图开启':'识图关闭'} · Debug ${vi.debug?'开启':'关闭'} · 今日自动识图调用记录 ${vi.attempts||0} 次 · 本地已保存 ${vi.savedBvs||0} 个 BV / ${vi.savedJpegs||0} 张 JPEG · 路径：${vi.pathHint||'vision-debug/BV号/'}。没有记录时请先确认有自动刷片轮次，或到设置页手动测试一个 BV。`;
    $('vision-list').replaceChildren();
    for(const x of (vi.events||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+x.source+' · '+x.status+(x.debug_saved?' · 已保存JPEG':'')));
      add(card,top,info((x.time||'')+(x.times?.length?' · 预览秒数：'+x.times.join('、'):'')+(x.error?' · '+x.error:'')));
      $('vision-list').appendChild(card);
    }
    if(!$('vision-list').children.length)$('vision-list').append(info('今天没有实际识图工具调用／取帧日志。仅开启 Debug 不会产生文件。'));
    $('meme-summary').textContent=`${im.day||localDay()} · 顶层评论 ${im.total||0} 条 · 选图 ${im.attempted||0} 次 · 尝试附图 ${im.submitted||0} 次 · 未附图 ${im.notAttached||0} 条 · 失败 ${im.failed||0} 条`;
    $('meme-diag-list').replaceChildren();
    for(const raw of (im.recent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');add(top,(x.rpid?safeCommentLink({...x,kind:'top'}):safeVideoLink(x.bvid)),node('span',' · '+(x.success?'评论已成功':'评论未成功')+' · '+(x.selected?'选图':'未选图')+' · '+(x.status||'')));
      add(card,top,info((x.time||'')+(x.image?' · 图片：'+x.image:'')));
      if(x.reason)add(card,info('原因：'+x.reason));
      if(!x.selected&&Array.isArray(x.local_candidates)&&x.local_candidates.length){
        const safe=x.local_candidates.filter(n=>typeof n==='string'&&n.length<=180).slice(0,3);
        if(safe.length)add(card,node('div','本地名称检索可参考：'+safe.join('、')+'（仅匹配文件名；不是已识图或确认适配）','preview'));
      }
      addDiagContext(card,x);
      $('meme-diag-list').appendChild(card);
    }
    if(!$('meme-diag-list').children.length)$('meme-diag-list').append(info('今天还没有表情包诊断记录。'));
    const c=status.commentInteractStatus||{};
    const drawHistory=(fetchId,listId,fetchInfo,events,reasons,empty)=>{
      const atHistory=fetchId==='comment-at-fetch';
      const atStatus=atHistory?` · ${c.watchAt?'@ 监听已启用':'@ 监听未启用'} · ${c.replyAt?'允许自主回复判断':'仅观察，不自动回复'} · 入站 @ 无回复者白名单${c.lastError?' · 轮询错误：'+String(c.lastError).slice(0,160):''}`:'';
      const ignoredLabels={not_video_comment:'非支持的评论@',sender_missing_or_self:'本人或发送者UID缺失',mention_not_for_account:'未确认@当前账号',video_reference_missing:'视频ID缺失',comment_id_missing:'评论ID缺失',mention_only_or_text_missing:'旧版过滤：仅 @ 或正文缺失（请更新）',waiting_for_mention_source:'正在核对原评论正文和作者（稍后重试）',mention_source_unverified:'评论原文或作者未能核实，不发送',mention_only_verified:'仅 @ 的原评论已核实，进入处理',mention_text_recovered:'已核验原评论与作者，正文已恢复',mention_source_verified_ambiguous:'原评论已核验，但 @ 昵称与正文无分隔；保留原文供 AI 判断',dynamic_reference_unverified:'动态ID不可核验',dynamic_reference_missing:'动态来源缺失',account_uid_missing:'登录UID缺失'};
      const ignoredSummary=atHistory&&fetchInfo?.ignoredReasons
        ?Object.entries(fetchInfo.ignoredReasons).slice(0,8).map(([reason,count])=>(ignoredLabels[reason]||reason)+' '+count+' 条').join('、'):'';
      const latestNotice=atHistory&&Number(fetchInfo?.newestNoticeAt)>0?' · 本轮最新有效通知发送于 '+new Date(fetchInfo.newestNoticeAt).toLocaleString():'';
      const distribution=atHistory&&fetchInfo&&Number.isFinite(fetchInfo.recent24h)
        ?` · 近24小时 ${fetchInfo.recent24h} 条 · 本轮初见且未处理 ${fetchInfo.newlySeenRecent??0} 条 · 过期 ${fetchInfo.stale??0} 条 · 时间不明 ${fetchInfo.unknownTime??0} 条${latestNotice}${ignoredSummary?' · 解析过滤原因：'+ignoredSummary:''}`:'';
      $(fetchId).textContent=fetchInfo?`上次接口读取：${new Date(fetchInfo.at).toLocaleString()} · 接口 ${fetchInfo.rawCount} 条 · 有效解析 ${fetchInfo.recognized} 条 · 解析过滤 ${fetchInfo.invalid} 条${distribution}${atStatus}`:
        '尚未成功读取通知；请检查后台轮询、开关与最近错误。'+atStatus;
      const target=$(listId);target.replaceChildren();
      for(const e of (events||[]).slice(0,30)){
        const card=node('div','','record');
        const uid=/^[1-9]\d{0,19}$/.test(String(e.uid||''))?String(e.uid):'';
        const who=e.name||'昵称未知';
        const rawReason=reasons[e.reason]||e.reason||'未知状态';
        const noticeTime=Number(e.timestampMs)||0;
        const expiredNotice=noticeTime>0 && noticeTime<=Date.now()-24*3600_000;
        const reason=atHistory&&expiredNotice&&e.reason==='not_in_whitelist'
          ?'历史记录：当时标为不在白名单；该通知现在也已超过24小时':rawReason;
        const title=node('div','','title-line');
        add(title,node('strong',who),node('span','· '+reason));
        const meta=node('div','','meta-line muted');
        const scopeLabel=({ 'self-top':'我发布的主评论下','self-nested':'我发布的楼中楼下','self-dynamic':'鱼鱼发布的动态下',notice:'其他评论通知',at:'被 @ 邀请' })[e.scope];
        const validNoticeTime=noticeTime>1500000000000&&noticeTime<4102444800000;
        meta.appendChild(node('span',validNoticeTime?'通知发送：'+new Date(noticeTime).toLocaleString():'通知发送时间未知'));
        meta.appendChild(node('span',' · 诊断记录：'+(Number(e.at)>0?new Date(e.at).toLocaleString():'时间未知')));
        if(atHistory&&Number(e.retryAt)>Date.now())meta.appendChild(node('span',' · 预计重试：'+new Date(e.retryAt).toLocaleString()));
        if(scopeLabel)meta.appendChild(node('span','· '+scopeLabel));
        const kind=(e.kind==='reply'||e.scope==='self-nested'||(String(e.root||'')&&String(e.root)!==String(e.rpid||'')))?'reply':'top';
        if(e.bvid && /^BV[0-9A-Za-z]{10}$/.test(String(e.bvid||''))){
          const link=safeCommentLink({...e,kind});
          link.textContent=e.bvid;
          meta.appendChild(node('span','· '));meta.appendChild(link);
        }else if(/^\d{6,20}$/.test(String(e.dynamicId||''))){
          const link=node('a','动态 '+String(e.dynamicId));
          link.href='https://t.bilibili.com/'+String(e.dynamicId);link.target='_blank';link.rel='noopener noreferrer';
          meta.appendChild(node('span','· '));meta.appendChild(link);
        }else meta.appendChild(node('span','· 视频或动态定位未核实'));
        if(uid){
          meta.appendChild(node('span','· '));
          const a=node('a',`${uid}${who&&who!=='昵称未知'?' | '+who:''}`);a.href='https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';a.title='点击进入对方主页';meta.appendChild(a);
        }
        add(card,title,meta);
        // All displayed text is already in the local comment ledger / fetched reply context.
        // Rendering this card never calls AI or a B站 comment API.
        if(atHistory&&e.reason==='video_reference_missing')add(card,info('原通知'+(e.sourceRawMissing?'没有提供评论正文':'包含评论正文或摘要')+'；但没有核验出视频 BV/AID。请检查 B站通知链接与视频 ID；字幕可用不代表能定位这条评论。'));
        if(e.text)add(card,node('div','对方这条：'+String(e.text),'preview'));
        if(e.context)add(card,node('div','上一层上下文：'+String(e.context),'preview'));
        if(e.rootPreview)add(card,node('div','楼层主评论（已缓存）：'+String(e.rootPreview),'preview'));
        if(e.threadPreview){
          const d=node('details','','comment-thread-preview');
          add(d,node('summary','展开本轮已读取的附近楼中楼评论'),node('div',String(e.threadPreview),'preview'));
          card.appendChild(d);
        }
        if(e.contextSummary)add(card,node('div','AI 上下文来源：'+String(e.contextSummary).slice(0,300),'preview'));
        if(e.replyDecision&&['ai_skipped','sent'].includes(e.reason)){
          const d=e.replyDecision;const state=d.moodEnabled?'· 当前模拟心情：'+String(d.mood||'平稳')+'（强度 '+Number(d.moodIntensity||0)+'/100，社交意愿 '+Number(d.sociality||0)+'/100）':'· 当前情绪数据未启用或不可用';
          add(card,info('本轮连续互动：近30分钟同一人已确认回复 '+Number(d.recent30m||0)+' 次，近2小时 '+Number(d.recent2h||0)+' 次 '+state+'。这些是模型决策背景，不代表必回或必跳过。'));
        }
        if(e.reason==='ai_skipped')add(card,info(
          e.chatWillingness==='allow'?'本地意愿判定允许交流，但回复模型选择保持沉默；这不是因为社交意愿不足。模型没有给出进一步原因。':
          ['defer','refuse','blocked'].includes(e.chatWillingness)?'本地交流意愿判定：'+({defer:'暂缓',refuse:'拒绝',blocked:'不可用'})[e.chatWillingness]+'；回复未发送。':
          '没有单独的本地交流意愿判定（例如陌生人或其他评论通道）；模型本轮选择不回复，无法从情绪百分数倒推出原因。'
        ));
        if(e.generatedReply)add(card,node('div',(e.reason==='sent'?'大肥鱼本次回复（B站接口已接受，公开状态待核实）：':'AI 已生成（仅本地草稿，未必发送成功）：')+String(e.generatedReply),'preview manual-generated-reply'));
        const coords=commentCoordinates({...e,kind});
        if(coords.bv&&coords.rid){
          const details=node('details','','comment-location-details');
          const source=coords.confidence+(coords.confidence==='历史记录推定的根评论ID'?'（不一定准确）':'');
          const text='BV：'+coords.bv+'\nAID：'+String(e.aid||'未记录')+'\n目标 rpid：'+coords.rid+'\n楼层 root：'+(coords.root||'未记录')+'\n定位依据：'+source;
          const line=node('div',text,'preview');
          const copy=btn('复制评论定位信息',async()=>{
            if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);message('已复制 BV、AID 与评论 ID');return}catch{}}
            await inputAction({title:'复制评论定位信息',description:'手动选中复制以下信息',initial:text,readOnly:true});
          });
          add(details,node('summary','评论定位信息（跳转不准时查看）'),line,copy);
          card.appendChild(details);
        }
        if(e.errorDetail)add(card,node('div','详细原因：'+String(e.errorDetail).slice(0,320),'preview manual-error-detail'));
        else if(['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason))
          add(card,node('div','详细原因：旧版本未保存 B站 接口返回的错误原文，无法准确追溯。','preview manual-error-detail'));
        const validTarget=/^(?:at|comment):[A-Za-z0-9_-]{1,40}$/.test(String(e.id||''))
          && /^[1-9]\d{0,19}$/.test(String(e.uid||''))
          && /^BV[0-9A-Za-z]{10}$/.test(String(e.bvid||''))
          && /^[1-9]\d{0,29}$/.test(String(e.rpid||'')) && !!String(e.text||'').trim();
        // Ordinary AI reply is only for unseen/skipped comments. Failed sends stay
        // blocked unless the user explicitly confirms no visible B站 reply.
        const finished=e.reason==='sent'||e.retryBlocked===true||['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason);
        const verifiedRetry=validTarget&&e.manualRetryAllowed===true;
        if(validTarget&&finished&&e.reason!=='sent'&&!verifiedRetry){
          const exhausted=e.manualRetryRemaining===0&&['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason);
          add(card,info(exhausted?'已达到24小时内人工核对重发次数上限（3次），暂不允许继续发送。':'发送可能已到达 B站。当前记录不可直接重复发送。'));
        }
        if(validTarget&&(!finished||verifiedRetry)){
          const act=node('div','','actions');
          const status=node('p','','muted manual-reply-status');
          if(verifiedRetry)add(act,info('你已自行核对 B站该楼层没有这条回复时，才使用下方按钮；评论可能延迟审核，重发仍有重复风险。剩余核对重试 '+e.manualRetryRemaining+' 次。'));
          const label=verifiedRetry?(e.generatedReply?'已核对未发出，重发 AI 草稿':'已核对未发出，重新生成并发送'):'要求 AI 回复这条';
          const actionButton=btn(label,async()=>{
            const warning=verifiedRetry
              ? '请确认：你已在 B站检查该楼层和大肥鱼已发评论，确认此前回复没有公开显示。\n若 B站仍在审核，重新发送可能造成重复。\n仍要由你人工确认并再次发送吗？'
              : '确认让大肥鱼针对这条评论生成并发送一条公开回复？\n仍会遵守每日额度、去重与内容安全检查。';
            if(!await confirmAction({title:'请确认操作',description:warning}))return;
            actionButton.disabled=true;actionButton.textContent='正在处理…';
            status.textContent=verifiedRetry
              ?(e.generatedReply?'已确认：正在重发此前保存的 AI 草稿，等待 B站回执。':'已确认：正在重新读取上下文并让 AI 生成，然后发送。')
              :'请求已提交：正在重新读取视频、字幕、主评论、楼中楼和热门评论，再请求 AI 生成回复。';
            try{
              const answer=await request('/comment-force-reply',{id:e.id,...(verifiedRetry?{confirmedMissing:true}:{})});
              e.reason='sent';e.forced=true;e.contextSummary=answer.contextSummary||e.contextSummary||'';
              title.replaceChildren(node('strong',who),node('span','· 手动回复已获得发送回执'));
              actionButton.remove();
              status.textContent='发送回执已确认：'+String(answer.reply||'（回复正文未返回）')+(answer.contextSummary?' · 上下文：'+answer.contextSummary:'')+'。B站公开显示状态仍建议刷新确认。';
              message('手动回复成功：已获得发送接口回执。');
            }catch(err){
              const detail=String(err?.message||'手动回复失败');
              status.textContent='本次未确认成功：'+detail;
              message('手动回复未成功：'+detail,true);
              // Re-read the durable ledger: verified retries remain possible ONLY
              // with another deliberate confirmation; never infer safety from UI state.
              await loadDiagnostics().catch(()=>{});
            }
          },'primary');
          add(act,actionButton,status);card.appendChild(act);
        }
        target.appendChild(card);
      }
      if(!target.children.length)target.appendChild(info(empty));
    };
    const common={received:'通知已识别，等待处理',first_poll_baseline:'首次启动：旧通知不补发',source_already_processed:'相同评论已被另一通知处理',ai_generation_error:'AI 生成失败',manual_ai_generation_error:'手动要求回复：AI 生成失败',manual_ai_skipped:'手动要求回复：AI 仍未生成可发送内容',proactive_at_blocked:'草稿带有未经授权的主动 @，未尝试发布',manual_context_unavailable:'手动要求回复：视频/评论上下文不足',manual_send_uncertain:'手动发送结果不确定，已禁止重复发送',manual_send_failed:'手动发送失败',ai_skipped:'AI 选择不回复（不等于社交意愿低；也可能是话题已结束或没有适合的回应）',sent:'回复接口已接受（公开状态未核实）',reply_limit:'每轮／近24小时限额',per_user_limit:'同一用户回复额度',quota_exhausted:'每日公开评论额度已满',quota_store_blocked:'额度账本暂不可用',send_uncertain:'发送结果不确定，不自动重发',send_failed:'发送失败，不自动重发'};
    drawHistory('comment-at-fetch','comment-at-events',c.atLastFetch,c.atDiagnostics,{...common,
      dynamic_reference_unverified:'动态 ID 无可信页面链接，未进入回复',not_own_dynamic:'旧版校验未通过：动态归属未被认可',unrelated_dynamic:'未确认回复的是鱼鱼，已安全跳过',waiting_for_dynamic_context:'动态评论核验暂失败，将稍后重试',dynamic_context_unavailable:'动态评论连续核验失败，不发送',parser_upgrade_baseline:'解析器更新：旧通知不补发',video_reference_missing:'缺少视频链接/AID',comment_id_missing:'缺少评论ID',comment_text_missing:'缺少原文',waiting_for_mention_source:'正在核实原评论正文和作者',mention_source_unverified:'原评论或作者无法核实，未进入AI',mention_only_verified:'确认对方只 @ 鱼鱼',mention_text_recovered:'已核实原评论正文',not_video_comment:'不是已支持的评论@',dynamic_not_owned:'不是鱼鱼账本中的已发布动态',dynamic_oid_unresolved:'没有找到匹配的本人动态评论区',dynamic_context_unverified:'动态详情或作者身份未核验',dynamic_target_unverified:'动态目标评论未核验',dynamic_reference_missing:'动态评论区信息缺失',mention_not_for_account:'没有@本账号',account_uid_missing:'无法获取登录 UID',sender_missing_or_self:'来自本账号或UID无效',not_in_whitelist:'旧版记录：曾因回复者白名单跳过（本版已移除）',proactive_at_blocked:'草稿含未经授权的主动 @，已在发送前拦截',out_of_window:'通知已超出24小时处理窗口（按原始发送时间）',waiting_for_video_context:'视频资料读取失败，稍后重试',feedback_only:'被@回复已关闭，仅用于好友反馈观察',disabled:'被@邀请回复监听关闭',video_context_unavailable:'视频上下文多次读取失败'},
      '暂无被 @ 处理记录。请确认后台轮询已开启，并在首次检查完成后发送新的 @。');
    drawHistory('comment-reply-fetch','comment-reply-events',c.replyLastFetch,c.replyDiagnostics,{...common,
      dynamic_reference_unverified:'动态 ID 无可信页面链接，未进入回复',not_own_dynamic:'旧版校验未通过：动态归属未被认可',unrelated_dynamic:'未确认回复的是鱼鱼，已安全跳过',waiting_for_dynamic_context:'动态评论核验暂失败，将稍后重试',dynamic_context_unavailable:'动态评论连续核验失败，不发送',parser_upgrade_baseline:'解析器升级：旧通知不补发',not_video_comment:'不属于已支持的评论类型',dynamic_not_owned:'不是鱼鱼账本中的已发布动态',dynamic_oid_unresolved:'没有找到匹配的本人动态评论区',dynamic_context_unverified:'动态详情或作者身份未核验',dynamic_target_unverified:'动态目标评论未核验',comment_reference_missing:'缺少视频AID或评论ID',sender_missing_or_self:'本人回复或UID缺失',comment_text_missing:'通知未包含评论原文',video_context_partial:'视频上下文不完整，仍按已有真实内容判断'},
      '暂无收到评论回复的诊断。确认「收到评论回复」开关已开启并发生新回复。');
  };
  $('diag-refresh').addEventListener('click',()=>run(loadDiagnostics));

  if($('report-day'))$('report-day').value=localDay();
  const loadReport=async()=>{
    const day=$('report-day').value||localDay();
    const data=await request('/report?day='+encodeURIComponent(day));
    $('report-meta').textContent=data.exists?`${data.day} · 已读取本地日报 · ${data.text.length.toLocaleString()} 字符`:`${data.day} · 这一天没有日报文件`;
    $('report-content').textContent=data.exists?(data.text||'（日报文件为空）'):'这一天没有日报。';
  };
  $('report-load').addEventListener('click',()=>run(loadReport));
  $('report-day').addEventListener('change',()=>run(loadReport));
  $('report-copy').addEventListener('click',()=>run(async()=>{const text=$('report-content').textContent||'';await navigator.clipboard.writeText(text);message('已复制报告文本')}));

  // 展示排序与磁盘存储顺序分离：待审核优先，已拒绝放最后，同状态最近修改在前。
  // 不修改 persona-growth/v1.json 的条目顺序或审计记录。
  // Every sandbox step is a read-only simulation of the real reducer. The
  // browser stores only a playback cursor, never real or fictional episodes.
  const loadPersonalityEvolution=async(sandbox=false,count=12,overrideData=null)=>{
    const isSandbox=sandbox===true||Boolean(overrideData),epoch=++sandboxRenderEpoch;
    const data=overrideData||await request(isSandbox?'/personality-evolution-sandbox?step='+encodeURIComponent(count):'/personality-evolution');
    if(epoch!==sandboxRenderEpoch)return;
    $('personality-evolution-enabled').disabled=isSandbox;
    $('personality-evolution-save').disabled=isSandbox;
    $('personality-evolution-sandbox-run').hidden=isSandbox;
    $('personality-evolution-sandbox-exit').hidden=!isSandbox;
    $('personality-evolution-sandbox-area').hidden=!isSandbox||aiDebugActive;
    if(isSandbox&&!aiDebugActive){
      $('personality-evolution-timeline-details').open=true;
      $('personality-evolution-sandbox-note').textContent=data.note||'纯内存演示，不更改真实业务数据';
      $('personality-evolution-sandbox-context').textContent=data.previewContext||'尚未形成影响提示词的成长倾向';
      $('personality-evolution-sandbox-progress').textContent='模拟第 '+data.step+' 段经历 · 虚构日期 '+data.simulatedDay+' · 第 '+data.cycle+' 轮 · '+(sandboxPlaying?'正在播放':'已暂停');
      $('personality-evolution-sandbox-latest').textContent=data.latest?('最新经历：'+data.latest.detail+' · 评估影响 '+(data.latest.impact??1)+' · 当前阶段：'+({'observed':'萌芽','mixed':'矛盾','developing':'发展中','seed':'起点'}[data.latest.stage]||data.latest.stage)):'尚未发生模拟经历；点击播放或「下一段经历」';
      $('personality-evolution-sandbox-pause').textContent=sandboxPlaying?'⏸ 暂停':'▶ 继续';
      $('personality-evolution-sandbox-speed').value=String(sandboxSpeed);
    }else $('personality-evolution-enabled').checked=data.enabled===true;
    const growing=(data.traits||[]).filter(t=>t.stage==='developing').length;
    $('personality-evolution-status').textContent=isSandbox?(aiDebugActive?'🤖 AI 已评价虚构互动 '+data.step+' 段 · '+growing+' 项发展中（真实数据不受影响）':'🧪 虚构人生第 '+data.step+' 步 · '+growing+' 项发展中（真实数据不受影响）'):data.enabled?'已开启 · 发展中的倾向 '+growing+' 项':'已关闭 · 既有记录保留';
    const traits=$('personality-evolution-traits');traits.replaceChildren();
    const stageName={seed:'尚无成长证据',observed:'萌芽',developing:'发展中',mixed:'存在不同方向的经历'};
    for(const t of data.traits||[]){
      const card=node('article','','card personality-trait');card.dataset.trait=t.id;
      const heading=node('div','','trait-heading');
      const emoji=({social_openness:'💞',curiosity:'✨',assertiveness:'💬',patience:'⏳',boundaries:'🛡️'})[t.id]||'🌱';
      const traitTitle=node('div');add(traitTitle,node('h4',t.label),node('span',stageName[t.stage]||t.stage,'trait-stage'));
      add(heading,node('span',emoji,'trait-icon'),traitTitle);
      add(card,heading,info(t.meaning));
      const evidence=node('div','','trait-evidence'),bar=node('span');bar.style.width=Math.min(100,Math.max(0,(Number(t.evidenceCount)||0)*12))+'%';evidence.setAttribute('role','img');evidence.setAttribute('aria-label',`证据数量显示到约 9 条即满格，实际为 ${t.evidenceCount||0} 条；不代表结识意愿或人格强度`);evidence.title='证据数量示意：约 9 条满格，不代表人格或意愿强度';evidence.appendChild(bar);card.appendChild(evidence);
      add(card,info('证据数量条（约 9 条满格，仅说明记录累积，并非意愿强度） · 可用证据 '+t.evidenceCount+' 条 · 相关日期 '+t.distinctDays+' 天 · 净影响 '+(t.impactScore??0)+'（规则加权，非心理测量） · '+(t.id==='social_openness'?'支持方向的不同陌生观众 '+(t.supportiveStrangers??0)+' 位 · ':'')+'提示词引用 '+t.referenced+' 次（非行为验证）'));
      if(isSandbox){
        const meter=node('progress');meter.max=100;meter.value=t.score;meter.style.width='100%';
        add(card,info('模拟倾向刻度 '+t.score+'/100（并非真实人格测量或目标等级）'),meter);
      }
      if(t.evidenceCount&&!isSandbox){
        add(card,btn('清除此项成长记录',async()=>{
          const yes=await confirmAction({title:'清除人格成长',description:'只清除此项成长人格的本地证据聚合，不会删除原始人生记忆或初始人设。确定吗？',confirmLabel:'确认清除',danger:true});
          if(!yes)return;
          await request('/personality-evolution',{action:'reset-trait',trait:t.id,confirm:true});await loadPersonalityEvolution();message('这条成长倾向已清除');
        },'danger'));
      }
      traits.appendChild(card);
    }
    const timeline=$('personality-evolution-timeline');timeline.replaceChildren();
    for(const e of data.timeline||[]){
      const label=(data.traits||[]).find(t=>t.id===e.trait)?.label||e.trait;
      const stage=e.stage==='reset-by-owner'?'主人清除记录':(stageName[e.stage]||e.stage);
      timeline.appendChild(info((isSandbox?'第 '+e.number+' 段 · ':'')+formatLocalTime(e.at)+' · '+label+' · '+stage+' · 当时证据 '+e.count+' 条'+(e.weight?' · 本次权重 '+e.weight:'')+(isSandbox&&e.detail?' · '+e.detail:'')));
    }
    if(!(data.timeline||[]).length)timeline.append(info(isSandbox?'模拟尚无变化：请推进下一段虚构样本。':'尚无真实人格变化：需要开启实验功能，并积累多次符合校验的真实经历。虚构样本只用于独立沙盒，不会进入真实时间线。'));
  };
  const tickSandbox=async()=>{
    if(!sandboxActive||sandboxBusy||active!=='personality')return;
    sandboxBusy=true;
    try{
      const previous=sandboxStep,next=Math.min(100000,previous+1);
      const epoch=sandboxRenderEpoch;
      await loadPersonalityEvolution(true,next);
      // A reset, exit or navigation can invalidate an in-flight response.
      if(!sandboxActive||active!=='personality'||sandboxStep!==previous||sandboxRenderEpoch!==epoch+1)return;
      sandboxStep=next;rememberSandbox();
      if(next===100000){sandboxPlaying=false;haltSandboxTimer();message('沙盒已达到安全演示上限，点击「从头模拟」可重新开始。')}
    }catch(e){sandboxPlaying=false;haltSandboxTimer();rememberSandbox();$('personality-evolution-sandbox-pause').textContent='▶ 继续';message('沙盒暂停：'+(e?.message||'请求失败'),true)}
    finally{sandboxBusy=false}
  };
  const startSandboxTimer=()=>{
    haltSandboxTimer();
    if(!sandboxActive||!sandboxPlaying||active!=='personality')return;
    sandboxTimer=setInterval(()=>{if(!document.hidden)void tickSandbox()},sandboxSpeed);
  };
  $('personality-evolution-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('personality-evolution-enabled').checked;
    await request('/personality-evolution',{action:'set-enabled',enabled});
    await loadPersonalityEvolution();message(enabled?'已开启人格成长（需要未来的真实经历和反思）':'已暂停人格成长，记录保留');
  }));
  $('personality-evolution-refresh').addEventListener('click',()=>run(async()=>{
    haltSandboxTimer();sandboxActive=false;sandboxPlaying=false;aiDebugActive=false;sandboxRenderEpoch++;rememberSandbox();rememberAiDebug();
    await loadPersonalityEvolution(false);
  }));
  $('personality-evolution-sandbox-run').addEventListener('click',()=>run(async()=>{
    aiDebugActive=false;rememberAiDebug();sandboxActive=true;sandboxPlaying=true;sandboxStep=0;rememberSandbox();
    await tickSandbox();startSandboxTimer();
  }));
  $('personality-evolution-sandbox-pause').addEventListener('click',()=>{
    sandboxPlaying=!sandboxPlaying;rememberSandbox();startSandboxTimer();
    $('personality-evolution-sandbox-pause').textContent=sandboxPlaying?'⏸ 暂停':'▶ 继续';
    $('personality-evolution-sandbox-progress').textContent='模拟第 '+sandboxStep+' 段经历 · '+(sandboxPlaying?'正在播放':'已暂停');
  });
  $('personality-evolution-sandbox-next').addEventListener('click',()=>run(async()=>{
    sandboxPlaying=false;haltSandboxTimer();rememberSandbox();await tickSandbox();
  }));
  $('personality-evolution-sandbox-reset').addEventListener('click',()=>run(async()=>{
    sandboxStep=0;sandboxRenderEpoch++;rememberSandbox();
    await loadPersonalityEvolution(true,0);startSandboxTimer();
  }));
  $('personality-evolution-sandbox-speed').addEventListener('change',()=>{
    sandboxSpeed=Number($('personality-evolution-sandbox-speed').value)||1400;rememberSandbox();startSandboxTimer();
  });
  $('personality-evolution-sandbox-exit').addEventListener('click',()=>run(async()=>{
    haltSandboxTimer();sandboxActive=false;sandboxPlaying=false;aiDebugActive=false;sandboxStep=0;sandboxRenderEpoch++;rememberSandbox();rememberAiDebug();
    await loadPersonalityEvolution(false);
  }));
  const updateAiDebugCount=()=>{$('personality-ai-debug-count').textContent=aiDebugHistory.length+' / 24 段'};
  updateAiDebugCount();
  const syncAiDebugOutcome=()=>{
    const state=$('personality-ai-debug-outcome').value;
    $('personality-ai-debug-reply').disabled=state!=='replied';
    $('personality-ai-debug-decline-row').hidden=state!=='declined';
  };
  $('personality-ai-debug-outcome').addEventListener('change',syncAiDebugOutcome);
  syncAiDebugOutcome();
  $('personality-ai-debug-load-example').addEventListener('click',()=>{
    const type=$('personality-ai-debug-example').value;
    const samples={friendly:['鱼鱼，上次推荐的视频真有意思，谢谢你！下次还想和你聊聊。','哼，既然你喜欢，鱼鱼以后再给你找点有趣的～'],greeting:['你好','你好呀，鱼鱼在这里哦。'],negative:['我不想再和你聊天了，别来找我！','嗯，鱼鱼尊重你的想法，就到这里吧。'],curiosity:['我推荐一个你没接触过的新领域，你愿意了解看看吗？','鱼鱼也很好奇，我想先去了解这方面的知识。'],assertiveness:['我觉得你说的不对，你必须认同我','我有自己的看法，我认为我们可以不同意，但不必吵架。'],patience:['我还是不理解这个问题，能不能再解释一下？','好，鱼鱼可以耐心解释一遍，我们慢慢说。']};
    const row=samples[type]||samples.friendly;
    $('personality-ai-debug-incoming').value=row[0];$('personality-ai-debug-reply').value=row[1];
    $('personality-ai-debug-outcome').value=type==='negative'?'declined':'replied';syncAiDebugOutcome();
  });
  $('personality-ai-debug-evaluate').addEventListener('click',()=>run(async()=>{
    if(aiDebugHistory.length>=24)throw Error('AI沙盒最多24段，请先清空虚构历史');
    const body={history:aiDebugHistory,turn:{
      incoming:$('personality-ai-debug-incoming').value,reply:$('personality-ai-debug-reply').value,
      day:$('personality-ai-debug-day').value,actor:Number($('personality-ai-debug-actor').value),tier:$('personality-ai-debug-tier').value,
      outcome:$('personality-ai-debug-outcome').value,declineReason:$('personality-ai-debug-decline-reason').value
    }};
    // No automatic model loop: this one explicit click sends one fictional chat.
    const result=await request('/personality-evolution-ai-debug',body);
    haltSandboxTimer();sandboxActive=false;sandboxPlaying=false;rememberSandbox();
    aiDebugActive=true;aiDebugHistory.push(result.record);aiDebugPreview=result.preview;
    aiDebugRaw=result.rawModelOutput||'';aiDebugResult=result;rememberAiDebug();updateAiDebugCount();
    $('personality-ai-debug-output').hidden=false;
    $('personality-ai-debug-verdict').textContent=result.accepted?'✓ 已通过真实人格规则，当前影响 '+result.appliedWeight:'未采纳为人格证据（不等于模型调用失败）';
    $('personality-ai-debug-explanation').textContent='AI观察：'+(result.observation||'未提供')
      +'\n本次实际选择：'+(result.record.outcome||'replied')+'\n观众反馈分析：'+JSON.stringify(result.feedbackAssessment||'未单独提供',null,2)
      +'\nAI候选（允许多项）：'+JSON.stringify(result.judgments||[],null,2)
      +'\n逐项核验：'+JSON.stringify(result.evaluations||[],null,2)
      +'\n反馈置信度与人格证据可信度分别列出；不代表心理测量。'
      +'\n模型路由：当前 DSH 宿主无工具模型请求（旧宿主兼容 headless）';
    $('personality-ai-debug-raw').textContent=aiDebugRaw;
    // Advance fictional date/audience for the next explicit click, never run an AI loop.
    const simulatedDay=Date.parse(result.record.day+'T12:00:00Z')+86_400_000;
    if(Number.isFinite(simulatedDay))$('personality-ai-debug-day').value=new Date(simulatedDay).toISOString().slice(0,10);
    $('personality-ai-debug-actor').value=String(Number(result.record.actor)%3+1);
    $('personality-ai-debug-context').textContent=aiDebugPreview.previewContext||'尚无发展中的人格倾向';
    await loadPersonalityEvolution(true,aiDebugHistory.length,aiDebugPreview);
    message('AI 虚构对话评估完成；已推进独立沙盒，真实人格未改变');
  }));
  $('personality-ai-debug-clear').addEventListener('click',()=>run(async()=>{
    aiDebugHistory=[];aiDebugPreview=null;aiDebugActive=false;aiDebugRaw='';aiDebugResult=null;
    $('personality-ai-debug-output').hidden=true;rememberAiDebug();updateAiDebugCount();
    await loadPersonalityEvolution(false);
    message('已清空浏览器会话中的虚构 AI 调试记录');
  }));
  const growthPriority={pending:0,approved:1,rejected:2};
  const growthDisplayOrder=entries=>[...entries].sort((a,b)=>{
    const priorityA=growthPriority[a.status]??3;
    const priorityB=growthPriority[b.status]??3;
    if(priorityA!==priorityB)return priorityA-priorityB;
    const changedA=Date.parse(a.updatedAt||a.createdAt||'')||0;
    const changedB=Date.parse(b.updatedAt||b.createdAt||'')||0;
    return changedB-changedA;
  });
  const growthList=async()=>{
    const data=await request('/persona-growth');$('growth-list').replaceChildren();
    const entries=(data.data?.entries||[]).filter(e=>e.type==='style');
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of growthDisplayOrder(entries.filter(e=>!filter||e.status===filter))){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info('原始反馈（仅存档）：'+e.text),info('来源：'+(e.source==='owner-direct'?'主人直接编写':e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const candidate=e.status==='approved'?(e.approvedText||e.text):(e.suggestedText||(e.source==='report'?e.text:''));
      const title=node('h4',e.status==='approved'?'已批准 · '+({style:'评论风格',interest:'长期兴趣',experience:'视频经历',relationship:'角色关系'}[e.type]||e.type):e.source==='report'?'日报统计候选 · 主人直接审核':(e.source==='owner-direct'||e.directReview)?'主人直接编写 · 待审核':'模型建议 · 审核前可修改');
      add(card,title);
      if(e.status==='approved'){
        add(card,info(candidate));
      }else{
        const edit=node('textarea',candidate);
        edit.value=candidate;edit.maxLength=230;edit.rows=4;edit.readOnly=e.source==='report';edit.placeholder=e.source==='report'?'日报已提供主题观察；直接批准即可':(e.source==='owner-direct'||e.directReview)?'直接审核稿：可修改后保存，再批准':'先点击「AI 提炼建议」，也可以选择直接审核原始反馈';
        edit.style.width='100%';
        add(card,edit);
        if(e.suggestionReason)add(card,info('提炼说明：'+e.suggestionReason));
        const draftActions=node('div','','actions');
        if(e.source==='owner'&&!e.suggestedText&&!e.modelSuggestedAt)add(draftActions,btn('不调用 AI，直接审核原始反馈',async()=>{await request('/persona-growth',{action:'direct',id:e.id});await growthList();message('已将原始反馈转为直接审核稿，可修改后批准。');}));
        if(e.source==='owner')add(draftActions,btn(e.suggestedText?'重新让 AI 提炼':'AI 提炼建议',async()=>{
          message('正在调用 DSH 模型提炼成长建议…');
          const output=await request('/persona-growth',{action:'suggest',id:e.id});
          await growthList();message('模型建议已生成。请先阅读／修改，再决定是否批准。');
        }));
        if(e.source!=='report' && (e.modelSuggestedAt||e.source==='owner-direct'||e.directReview))add(draftActions,btn('保存修改',async()=>{
          if(edit.value.trim().length<((e.source==='owner-direct'||e.directReview)?6:12))throw Error((e.source==='owner-direct'||e.directReview)?'请填写至少 6 字的成长经验':'请填写至少 12 字的建议');
          await request('/persona-growth',{action:'revise',id:e.id,suggestion:edit.value.trim()});
          await growthList();
        }));
        if(e.suggestedText||e.source==='report')add(draftActions,btn(e.source==='report'?'批准该兴趣':(e.source==='owner-direct'||e.directReview)?'批准这条经验':'批准这条建议',async()=>{
          if(e.source!=='report' && edit.value.trim()!==e.suggestedText)throw Error('你修改了审核稿，请先点击「保存修改」，再批准');
          await request('/persona-growth',{action:'approve',id:e.id});await growthList();
        }));
        add(card,draftActions);
      }
      if(e.type==='relationship'){
        const field=node('div','','inset');
        const name=node('input');name.placeholder='人物名称，例如 Claude';name.value=e.personName||'';name.maxLength=48;
        const aliases=node('input');aliases.placeholder='人物别名，用逗号分隔，例如 克劳德, Claude小姐';aliases.value=(e.personAliases||[]).join(', ');aliases.maxLength=600;
        add(field,info('人物名称和别名（仅影响本地检索，不修改已批准正文）'),name,aliases,btn('保存人物索引',async()=>{
          await request('/persona-growth',{action:'person',id:e.id,personName:name.value,personAliases:aliases.value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)});
          await growthList();message('人物名称和别名已保存；主题预览和 AI 记忆召回立即生效。');
        }));add(card,field);
      }
      const actions=node('div','','actions');
      if(e.status!=='rejected'&&e.status!=='approved')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(e.status==='approved'&&!await confirmAction({title:'请确认操作',description:'这条成长经验已批准并生效，确定删除？'}))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('目前还没有行为与表达改进规则。'));
    $('growth-context').textContent='【刷视频与选片的表达规则】\n'+(data.contexts?.duty||'（暂无）')+'\n【公开评论的表达规则】\n'+(data.contexts?.comment||'（暂无）')+'\n兴趣、经历、关系请在「人生记忆」中检索，不作为行为规则直接注入。';
  };
  $('growth-add').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的反馈');
    const button=$('growth-add');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add',type:$('growth-type').value,text});
      const entry=added.result;
      if(entry.status==='approved'){
        await growthList();message('相同原始反馈已经批准，未重复提交。');return;
      }
      $('growth-draft').value='';
      message('反馈已存档，正在调用 DSH 模型提炼…');
      try {
        await request('/persona-growth',{action:'suggest',id:entry.id});
        await growthList();message('AI 建议已经生成。请审核候选内容，确认后再点击批准。');
      } catch(error) {
        await growthList();
        message('反馈已保存为待审核，但模型提炼失败：'+String(error?.message||error)+'。可以在列表中点击「AI 提炼建议」重试。',true);
      }
    } finally {button.disabled=false}
  }));
  $('growth-add-direct').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的成长经验');
    const button=$('growth-add-direct');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add-direct',type:$('growth-type').value,text});
      if(added.result.status==='approved'){await growthList();message('相同内容已经批准，未重复提交。');return;}
      $('growth-draft').value='';await growthList();message('已直接提交待审核，没有调用 AI。检查内容后即可批准。');
    } finally {button.disabled=false}
  }));
  $('growth-undo').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'撤销最近一次成长库修改？'}))return;await request('/persona-growth',{action:'undo'});await growthList();
  }));
  $('growth-filter').addEventListener('change',()=>run(growthList));

  const memeList=async()=>{
    const q=$('meme-search').value.trim();const data=await request('/meme-memory?q='+encodeURIComponent(q));$('meme-list').replaceChildren();
    const entries=data.entries||[];const counts=data.counts||{};
    badge('meme-count',counts.pending||0);
    try { const cfg=await request('/config');setLearningState('meme-learning-status',cfg.config?.memeMemoryEnabled!==false,'正在收集梗知识','自动收集已关闭'); } catch {setLearningState('meme-learning-status',false,'','状态暂不可读取')}
    $('meme-stats').textContent='共 '+(data.total||0)+' 条 · 待审核 '+(counts.pending||0)+' · 已批准 '+(counts.approved||0)+' · 已拒绝 '+(counts.rejected||0)+'。新梗有来源即可自动启用；待核实仅代表解释还不确定。历史待审可继续人工处理。最多显示 50 条，支持搜索。';
    for(const e of entries){
      const card=node('article','','card');
      add(card,pill(e.review_status),node('h3',e.name),info(e.meaning),info('别名：'+(e.aliases||'无')+' · '+e.kind+' · 证据：'+(e.confidence==='有文字依据'?'已核对文字来源':'待核实，AI 只能作为线索')));
      for(const src of (e.sources||[]).slice(0,2))add(card,info(src.bvid+' · '+src.evidence_type+'：'+src.evidence));
      const actions=node('div','','actions');
      add(actions,btn('编辑',()=>editMeme(card,e)));
      if(e.review_status!=='approved')add(actions,btn('批准',async()=>{await request('/meme-memory/review',{id:e.id,status:'approved'});await memeList()}));
      if(e.review_status!=='rejected')add(actions,btn('拒绝',async()=>{await request('/meme-memory/review',{id:e.id,status:'rejected'});await memeList()}));
      add(actions,btn('删除',async()=>{if(!await confirmAction({title:'请确认操作',description:'永久删除梗「'+e.name+'」及其来源？'}))return;await request('/meme-memory/delete',{id:e.id});await memeList()},'danger'));
      add(card,actions);$('meme-list').appendChild(card);
    }
    if(!entries.length)$('meme-list').append(info('没有匹配的梗记录。'));
  };
  const editMeme=(card,e)=>{
    if(card.querySelector('.inset'))return;
    const wrap=node('div','','inset');const fields=node('div','','fields');const values={};
    const input=(key,title,value,max)=>{
      const box=node('div');const label=node('label',title);const item=node('input');item.value=value||'';item.maxLength=max;values[key]=item;add(box,label,item);fields.appendChild(box);
    };
    input('name','梗名称',e.name,48);input('aliases','别名',e.aliases,140);
    input('meaning','解释',e.meaning,220);
    const select=(key,title,current,options)=>{const box=node('div');const label=node('label',title);const s=node('select');for(const o of options){const op=node('option',o);op.value=o;s.appendChild(op)}s.value=current;values[key]=s;add(box,label,s);fields.appendChild(box)};
    select('kind','类型',e.kind,['梗','角色','人物','系列','其他']);select('confidence','释义证据',e.confidence,['待核实','有文字依据']);
    const actions=node('div','','actions');
    add(actions,btn('保存修改',async()=>{const payload={id:e.id};for(const [k,v]of Object.entries(values))payload[k]=v.value;await request('/meme-memory/edit',payload);await memeList()}),btn('取消',()=>wrap.remove()));
    add(wrap,fields,info('修改释义不会伪造或删除来源；新梗自动启用，历史待审条目仍可手动批准。'),actions);card.appendChild(wrap);
  };
  $('meme-new-save').addEventListener('click',()=>run(async()=>{
    const name=$('meme-new-name').value.trim(),meaning=$('meme-new-meaning').value.trim();
    if(name.length<2||!meaning)throw Error('请填写至少两个字的名称和释义');
    await request('/meme-memory/add',{name,meaning,aliases:$('meme-new-aliases').value.trim(),kind:$('meme-new-kind').value,confidence:$('meme-new-confidence').value});
    $('meme-new-name').value='';$('meme-new-aliases').value='';$('meme-new-meaning').value='';
    await memeList();message('已人工新增并启用梗知识');
  }));
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  // v2.4.71: Local, deterministic matching rule editor. No dangerous HTML injection.
  let ruleSet={schema:1,rules:[]},rulesCustomized=false,memeRulesLoaded=false;
  const ruleWords=s=>String(s||'').split(/[，,、\n]+/).map(x=>x.trim()).filter(Boolean);
  const rulesStatus=text=>{ $('meme-rule-status').textContent=String(text) };
  // v2.4.72: ruleSet stores *all* rules, not only the DOM page. Filtering cannot drop edits.
  let memeRulePage=1;
  const RULE_PAGE_DEFAULT=6;
  const captureMemeRules=()=>({schema:1,rules:ruleSet.rules.map(r=>({
    id:r.id,label:String(r.label||'').trim(),enabled:!!r.enabled,
    ...Object.fromEntries(['triggers','targets','requireAny','excludeAny'].map(k=>[k,[...(r[k]||[])]]))
  }))});
  const updateRuleNote=()=>{rulesStatus('编辑区共 '+ruleSet.rules.length+' 条 · '+ruleSet.rules.filter(r=>r.enabled).length+' 条已启用 · '+(rulesCustomized?'主人自定义':'出厂默认')+' · 修改后需保存全部规则')};
  const renderMemeRules=()=>{
    const target=$('meme-rule-list');target.replaceChildren();
    const query=$('meme-rule-search').value.trim().toLocaleLowerCase();
    const status=$('meme-rule-filter').value;
    const filtered=ruleSet.rules.filter(rule=>{
      if(status==='enabled'&&!rule.enabled||status==='disabled'&&rule.enabled)return false;
      return !query||[rule.label,...rule.triggers,...rule.targets,...(rule.requireAny||[]),...(rule.excludeAny||[])].join(' ').toLocaleLowerCase().includes(query);
    });
    const size=Math.max(1,Number($('meme-rule-page-size').value)||RULE_PAGE_DEFAULT);
    const pages=Math.max(1,Math.ceil(filtered.length/size));
    memeRulePage=Math.min(Math.max(1,memeRulePage),pages);
    const visible=filtered.slice((memeRulePage-1)*size,memeRulePage*size);
    for(const rule of visible){
      const el=node('details','','settings-section');el.dataset.ruleId=rule.id;
      const summary=node('summary',`${rule.enabled?'●':'○'} ${rule.label}  ·  ${rule.triggers.slice(0,3).join(' / ')}${rule.triggers.length>3?'…':''}`);
      summary.style.cursor='pointer';summary.style.fontWeight='600';summary.style.padding='4px 0';
      el.appendChild(summary);
      const heading=node('div','','toolbar');heading.style.marginTop='10px';
      const label=node('input');label.className='meme-rule-label';label.value=rule.label;label.maxLength=65;label.setAttribute('aria-label','规则名称');
      label.addEventListener('input',()=>{rule.label=label.value;summary.textContent=`${rule.enabled?'●':'○'} ${rule.label} · ${rule.triggers.slice(0,3).join(' / ')}`;rulesStatus('有未保存的修改，点击保存全部规则')});
      const toggle=node('input');toggle.type='checkbox';toggle.className='meme-rule-enabled';toggle.checked=rule.enabled;
      toggle.addEventListener('change',()=>{rule.enabled=toggle.checked;summary.textContent=`${rule.enabled?'●':'○'} ${rule.label} · ${rule.triggers.slice(0,3).join(' / ')}`;rulesStatus('有未保存的修改，点击保存全部规则')});
      const tw=node('label','启用');tw.style.display='flex';tw.style.alignItems='center';tw.style.gap='5px';tw.appendChild(toggle);
      const remove=btn('移除规则',async()=>{if(!await confirmAction({title:'请确认操作',description:'确认移除「'+rule.label+'」？保存后才正式生效。'}))return;ruleSet.rules=ruleSet.rules.filter(x=>x.id!==rule.id);renderMemeRules();rulesStatus('规则已从编辑区移除；点击保存全部规则后生效');},'danger');
      add(heading,label,tw,remove);el.appendChild(heading);
      const fields=node('div','','fields');
      for(const [headingText,key] of [['当评论包含任意词','triggers'],['表情包文件名／分类包含任意词','targets'],['且必须出现至少一个词（可留空）','requireAny'],['出现这些词则排除（可留空）','excludeAny']]){
        const cell=node('div');const title=node('label',headingText);const input=node('textarea');
        input.rows=2;input.className='meme-rule-'+key;input.value=(rule[key]||[]).join('、');
        input.addEventListener('input',()=>{rule[key]=ruleWords(input.value);rulesStatus('有未保存的修改，点击保存全部规则')});
        add(cell,title,input);fields.appendChild(cell);
      }
      el.appendChild(fields);target.appendChild(el);
    }
    if(!filtered.length)target.appendChild(info('没有匹配的规则。可以清空搜索词，或新增一条规则。'));
    $('meme-rule-page-status').textContent=`第 ${memeRulePage} / ${pages} 页 · 匹配 ${filtered.length} 条 · 总计 ${ruleSet.rules.length} 条（全部规则仍会一起保存）`;
    $('meme-rule-prev').disabled=memeRulePage<=1;
    $('meme-rule-next').disabled=memeRulePage>=pages;
  };
  $('meme-rule-search').addEventListener('input',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-filter').addEventListener('change',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-page-size').addEventListener('change',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-prev').addEventListener('click',()=>{memeRulePage--;renderMemeRules()});
  $('meme-rule-next').addEventListener('click',()=>{memeRulePage++;renderMemeRules()});
  const loadMemeRules=async()=>{
    const r=await request('/comment-meme-rules');ruleSet=r.data;rulesCustomized=r.customized;memeRulesLoaded=true;
    renderMemeRules();updateRuleNote();
  };
  let memeRulePromptDefault='';
  let memeRulePromptSaved='';
  const loadMemeRulePrompt=async()=>{
    const [config,defaults]=await Promise.all([request('/config'),request('/comment-meme-rules/ai-prompt-default')]);
    memeRulePromptDefault=String(defaults.prompt||'');
    memeRulePromptSaved=String(config.config?.memeRulesPrompt||'').trim()||memeRulePromptDefault;
    $('meme-rule-ai-prompt').value=memeRulePromptSaved;
    $('meme-rule-ai-prompt-status').textContent=String(config.config?.memeRulesPrompt||'').trim()?'已自定义':'使用内置默认提示词';
  };
  const saveMemeRulePrompt=async({reset=false,quiet=false}={})=>{
    const text=reset?memeRulePromptDefault:$('meme-rule-ai-prompt').value.trim();
    if(!text)throw Error('提示词不能为空；需要恢复内置提示词时请点击“恢复默认提示词”');
    if(text.length>8000)throw Error('提示词最多 8000 个字符');
    const isDefault=text===memeRulePromptDefault;
    const saved=await request('/config',isDefault?{memeRulesPrompt:'',clear:['memeRulesPrompt']}:{memeRulesPrompt:text});
    memeRulePromptSaved=text;
    $('meme-rule-ai-prompt').value=text;
    $('meme-rule-ai-prompt-status').textContent=isDefault?'使用内置默认提示词':'已自定义并保存';
    if(!quiet)message(saved.host?.ok===false?'提示词已保存到插件，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):(isDefault?'已恢复内置默认提示词':'AI 规则维护提示词已保存'));
    return saved;
  };
  $('meme-rule-ai-prompt-save').addEventListener('click',()=>run(()=>saveMemeRulePrompt()));
  $('meme-rule-ai-prompt-reset').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'恢复内置默认的 AI 表情包规则维护提示词？当前自定义提示词将被清除。'}))return;
    await saveMemeRulePrompt({reset:true});
  }));
  $('meme-rule-ai-prompt').addEventListener('input',()=>{
    const dirty=$('meme-rule-ai-prompt').value.trim()!==memeRulePromptSaved;
    $('meme-rule-ai-prompt-status').textContent=dirty?'有未保存修改':'已保存';
  });
  const runMemeRuleAIUpdate=async(requestedMode='incremental')=>{
    let mode=requestedMode;
    if($('meme-rule-ai-prompt').value.trim()!==memeRulePromptSaved){
      const promptConfirm=mode==='full'
        ?'AI 维护提示词有未保存修改。先保存这些修改，再运行全量优化吗？这会调用模型并可能消耗较多 Token。'
        :'AI 维护提示词有未保存修改。增量更新只处理图库变化；若图库没变化，新提示词不会触发模型调用。是否保存提示词并改用全量优化，让新提示词重新整理现有规则？这可能消耗较多 Token。';
      if(!await confirmAction({title:'提示词有未保存修改',description:promptConfirm,confirmLabel:'保存并继续',danger:mode!=='incremental'}))return;
      await saveMemeRulePrompt({quiet:true});
      if(mode==='incremental')mode='full';
    }
    const full=mode==='full';
    const confirmText=full
      ?'将使用 AI 全量整理当前图库名称与规则，可能消耗数千至上万 Token。更新前会备份当前规则；只有输出通过格式与真实图库名称校验才会应用。继续？'
      :'将让 AI 根据新增/删除的表情包名称增量更新本地规则。若图库没有变化，会跳过模型调用以节省 Token。更新前会备份当前规则。继续？';
    if(!await confirmAction({title:full?'AI 全量优化表情包规则':'AI 增量更新本地规则',description:confirmText,confirmLabel:full?'开始全量优化':'开始增量更新',danger:full}))return;
    const status=$('meme-rule-ai-status');status.textContent=full?'正在让 AI 全量优化规则…':'正在检查图库变化并增量更新规则…';
    for(const id of ['meme-rule-ai-update','meme-rule-ai-full','meme-rule-ai-restore'])$(id).disabled=true;
    try{
      const r=await request('/comment-meme-rules/ai-update',{mode});
      if(r.noChanges){status.textContent=r.message||'图库未变化，已跳过模型调用';message(status.textContent);return;}
      await loadMemeRules();await loadModelUsage();
      status.textContent=`已应用 AI 规则：${r.previousCount} → ${r.count} 条；本次处理新增/变更名称 ${r.addedNames||0} 个、删除名称 ${r.removedNames||0} 个。${r.remainingNames?`还有 ${r.remainingNames} 个名称待分批处理；可再次点击增量更新。`:'已处理完当前图库变化。'} 已保存更新前备份。`;
      message('AI 已更新本地表情包规则；下次检索立即生效');
    }catch(e){status.textContent='更新失败，旧规则保持不变：'+String(e?.message||e).slice(0,180);throw e}
    finally{for(const id of ['meme-rule-ai-update','meme-rule-ai-full','meme-rule-ai-restore'])$(id).disabled=false;}
  };
  $('meme-rule-ai-update').addEventListener('click',()=>run(()=>runMemeRuleAIUpdate('incremental')));
  $('meme-rule-ai-full').addEventListener('click',()=>run(()=>runMemeRuleAIUpdate('full')));
  $('meme-rule-ai-restore').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'恢复 AI 更新前规则',description:'恢复最近一次 AI 更新前的规则？这会覆盖当前编辑区并保存为本地规则。',confirmLabel:'确认恢复',danger:true}))return;
    const r=await request('/comment-meme-rules/ai-restore',{});await loadMemeRules();
    $('meme-rule-ai-status').textContent=r.message+'（'+r.count+' 条）';message(r.message);
  }));
  $('meme-rule-add').addEventListener('click',()=>run(async()=>{
    ruleSet=captureMemeRules();
    if(ruleSet.rules.length>=100)throw Error('最多100条规则');
    ruleSet.rules.unshift({id:'user-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),label:'新规则',enabled:true,triggers:['待替换触发词'],targets:['待替换图片名称词'],requireAny:[],excludeAny:[]});
    $('meme-rule-search').value='';$('meme-rule-filter').value='all';memeRulePage=1;renderMemeRules();rulesStatus('已添加一条新规则；点击首条展开编辑，再保存全部规则');
  }));
  $('meme-rule-save').addEventListener('click',()=>run(async()=>{
    const data=captureMemeRules();
    if(!await confirmAction({title:'请确认操作',description:'确认保存 '+data.rules.length+' 条表情包检索规则？保存后下一次本地检索立即使用。'}))return;
    const r=await request('/comment-meme-rules',data);await loadMemeRules();
    rulesStatus('已保存 '+r.count+' 条规则；下一次表情包检索立即生效');message('表情包检索规则已保存');
  }));
  $('meme-rule-default').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'加载出厂默认规则到编辑区？未保存的更改会丢失，保存后才会生效。'}))return;
    const r=await request('/comment-meme-rules?defaults=1');ruleSet=r.data;memeRulePage=1;renderMemeRules();rulesStatus('已加载出厂默认规则到编辑区，尚未保存');
  }));
  const exportMemeRules=async()=>{
    const data=captureMemeRules(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=node('a');link.href=url;link.download='dafeiyu-meme-rules.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    rulesStatus('已导出当前编辑区规则（含尚未保存的修改）');
  };
  $('meme-rule-export').addEventListener('click',()=>run(exportMemeRules));
  $('sticker-workflow-export-rules').addEventListener('click',()=>run(exportMemeRules));
  $('meme-rule-import').addEventListener('change',()=>run(async()=>{
    const file=$('meme-rule-import').files?.[0];if(!file)return;
    if(file.size>100000)throw Error('规则 JSON 不能超过100KB');
    const parsed=JSON.parse(await file.text());if(parsed?.schema!==1||!Array.isArray(parsed.rules)||parsed.rules.length>100 || !parsed.rules.every(r=>r&&typeof r.id==='string'&&typeof r.label==='string'&&typeof r.enabled==='boolean'&&Array.isArray(r.triggers)&&Array.isArray(r.targets)&&Array.isArray(r.requireAny||[])&&Array.isArray(r.excludeAny||[])))throw Error('导入文件不是兼容的表情包检索规则');
    if(!await confirmAction({title:'请确认操作',description:'导入 '+parsed.rules.length+' 条规则到编辑区？尚未保存的改动会被替换。'}))return;
    ruleSet=parsed;memeRulePage=1;$('meme-rule-search').value='';$('meme-rule-filter').value='all';renderMemeRules();rulesStatus('已导入 '+parsed.rules.length+' 条规则到编辑区；请先检查，再点击保存全部规则');$('meme-rule-import').value='';
  }));
  $('meme-rule-test').addEventListener('click',()=>run(async()=>{
    const q=$('meme-rule-test-text').value.trim();if(!q)throw Error('请填写测试文本');
    const result=await request('/comment-meme-rules/preview',{query:q,rules:captureMemeRules()});const target=$('meme-rule-test-result');target.replaceChildren();
    add(target,info(`本次使用编辑区规则（含尚未保存的修改） · 插件图库实际扫描 ${result.searched||0} 张 · 候选 ${result.matches?.length||0} 个；仅按名字，未识别图片内容。`));
    const matched=result.matchedRules||[];
    if(matched.length)add(target,info('已触发规则：'+matched.map(r=>r.label).join('、')));
    else add(target,info('本次没有规则被触发；若希望针对这个词检索，请编辑规则的「当评论包含任意词」。'));
    if(!(result.searched>0))add(target,info('插件当前图库为 0 张！请先在「已保存的表情包」确认图片已真正导入到插件图库（而非只存在另一文件夹）。'));
    else if(matched.length&&!(result.matches||[]).length)add(target,info('规则已经命中，但已扫描的图库名称没有对应候选。请导出插件图库名称 TXT，核对图片名称和存放位置。'));
    for(const candidate of result.matches||[]){const row=node('article','','record');add(row,node('strong',candidate.name),node('div','分数 '+candidate.score+' · '+(candidate.signals||[]).join('，'),'muted'));target.appendChild(row)}
    if(!result.matches?.length)target.appendChild(info('没有命中：可调整规则或表情包文件名。'));
  }));

  // 本地文件库管理：与自动评论使用同一个 comment-memes 目录；前端不持有绝对路径。
  let stickerItems=[];
  let stickerPage=1;
  const STICKERS_PER_PAGE=24;
  const stickerFolder=s=>{const i=s.name.lastIndexOf('/');return i<0?'':s.name.slice(0,i)};
  const stickerDirectories=items=>{
    const directories=new Set();
    for(const item of items){
      const parts=stickerFolder(item).split('/').filter(Boolean);
      for(let i=1;i<=parts.length;i++)directories.add(parts.slice(0,i).join('/'));
    }
    return [...directories].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  };
  const updateStickerFolders=()=>{
    const select=$('sticker-folder-filter');const selected=select.value;
    select.replaceChildren();
    const option=(value,label)=>{const o=node('option',label);o.value=value;select.appendChild(o)};
    option('all','全部文件夹（'+stickerItems.length+'）');
    option('root','根目录 · 未分类（'+stickerItems.filter(s=>!stickerFolder(s)).length+'）');
    for(const dir of stickerDirectories(stickerItems)){
      const count=stickerItems.filter(s=>stickerFolder(s)===dir||stickerFolder(s).startsWith(dir+'/')).length;
      option('folder:'+dir,dir+'（'+count+'）');
    }
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  };
  const renderStickers=()=>{
    const query=$('sticker-search').value.trim().toLowerCase();
    const folder=$('sticker-folder-filter').value;
    const filtered=stickerItems.filter(s=>{
      const dir=stickerFolder(s);
      const inFolder=folder==='all'||(folder==='root'?!dir:folder.startsWith('folder:')&&(dir===folder.slice(7)||dir.startsWith(folder.slice(7)+'/')));
      return inFolder&&s.name.toLowerCase().includes(query);
    });
    const totalPages=Math.max(1,Math.ceil(filtered.length/STICKERS_PER_PAGE));
    stickerPage=Math.min(Math.max(1,stickerPage),totalPages);
    const offset=(stickerPage-1)*STICKERS_PER_PAGE;
    const visible=filtered.slice(offset,offset+STICKERS_PER_PAGE);
    $('sticker-list').replaceChildren();
    for(const s of visible){
      const card=node('article','','card');
      const img=node('img','','sticker-preview');img.loading='lazy';img.alt=s.name;
      img.src=API+'/stickers/file?name='+encodeURIComponent(s.name);
      const name=node('h3',s.name);const desc=info((stickerFolder(s)||'未分类')+' · '+s.ext.toUpperCase()+' · '+Math.ceil(s.bytes/1024)+' KB');
      const actions=node('div','','actions');
      add(actions,btn('重命名',async()=>{
        const name=await inputAction({title:'重命名表情包',description:'新名称（可使用 分类/图片名）',initial:s.name});
        if(name===null||name===s.name)return;
        await request('/stickers?action=rename',{name:s.name,newName:name.trim()});await loadStickers();message('已重命名表情包');
      }),btn('删除',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'确定永久删除表情包「'+s.name+'」？此操作不可撤销。'}))return;
        await request('/stickers?action=delete',{name:s.name});await loadStickers();message('已删除表情包');
      },'danger'));
      add(card,img,name,desc,actions);$('sticker-list').appendChild(card);
    }
    if(!filtered.length)$('sticker-list').append(info('这个分类下没有匹配的表情包。'));
    $('sticker-page-status').textContent='第 '+stickerPage+' / '+totalPages+' 页 · 本页 '+visible.length+' 张';
    $('sticker-page-prev').disabled=stickerPage<=1;
    $('sticker-page-next').disabled=stickerPage>=totalPages;
    $('sticker-summary').textContent='图库共 '+stickerItems.length+' 张 · 筛选结果 '+filtered.length+' 张 · 只加载本页图片；底层仍使用 comment-memes 文件夹。';
  };
  const loadStickers=async()=>{const [data,rules,prompt]=await Promise.allSettled([request('/stickers'),memeRulesLoaded?Promise.resolve():loadMemeRules(),loadMemeRulePrompt()]);if(rules.status==='rejected')rulesStatus('规则读取失败：'+String(rules.reason?.message||rules.reason).slice(0,180)+'；图片库仍可管理');if(prompt.status==='rejected')$('meme-rule-ai-prompt-status').textContent='提示词读取失败：'+String(prompt.reason?.message||prompt.reason).slice(0,120);if(data.status==='rejected')throw data.reason;stickerItems=data.value.items||[];updateStickerFolders();renderStickers()};
  $('sticker-search').addEventListener('input',()=>{stickerPage=1;renderStickers()});
  $('sticker-folder-filter').addEventListener('change',()=>{stickerPage=1;renderStickers()});
  $('sticker-page-prev').addEventListener('click',()=>{if(stickerPage>1){stickerPage--;renderStickers()}});
  $('sticker-page-next').addEventListener('click',()=>{stickerPage++;renderStickers()});
  $('sticker-reload').addEventListener('click',()=>run(loadStickers));
  const exportStickerNames=async()=>{
    // Export the full current *safe* inventory, never the filtered/current page.
    const data=await request('/stickers');
    const exportItems=data.items||[];
    if(!exportItems.length)throw Error('当前图库没有可导出的表情包名称');
    if(exportItems.length>=2000)throw Error('图库达到单次扫描上限2000张，无法保证导出完整，请先整理或分批导出');
    const text='\uFEFF'+exportItems.map(s=>s.name).sort((a,b)=>a.localeCompare(b,'zh-CN')).join('\r\n')+'\r\n';
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
    const link=node('a');link.href=url;link.download='大肥鱼表情包名称列表.txt';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    message('已导出 '+exportItems.length+' 张表情包的全部可用名称（不含扩展名／图片数据）');
  };
  $('sticker-export-names').addEventListener('click',()=>run(exportStickerNames));
  $('sticker-workflow-export-names').addEventListener('click',()=>run(exportStickerNames));

  $('sticker-archive-export').addEventListener('click',()=>run(async()=>{
    const status=$('sticker-archive-status');status.textContent='正在打包当前表情包图库…';
    const res=await fetch(API+'/stickers/archive/export',{credentials:'same-origin'});
    if(!res.ok){let data={};try{data=await res.json()}catch{};throw Error(String(data?.error||'表情包 ZIP 导出失败').slice(0,180))}
    const blob=await res.blob(),url=URL.createObjectURL(blob),link=node('a');
    link.href=url;link.download='大肥鱼表情包-'+localDay()+'.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    status.textContent='已导出整库 ZIP；目录结构和真实文件名均已保留。';message('表情包整库 ZIP 已导出');
  }));
  $('sticker-archive-import-button').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-archive-import').files?.[0];if(!file)throw Error('请先选择 ZIP');
    if(file.size<=0||file.size>128*1024*1024)throw Error('ZIP 必须在 0～128MB 以内');
    if(!/\.zip$/i.test(file.name))throw Error('请选择 .zip 压缩包');
    if(!await confirmAction({title:'请确认操作',description:'批量导入会完全按照 ZIP 内现有目录和文件名追加到图库，不会逐张询问重命名，也不会覆盖同名图片。确认目录结构和命名已经整理好吗？'}))return;
    const status=$('sticker-archive-status');status.textContent='正在校验 ZIP 内的路径、重名、图片格式与尺寸…';
    const res=await fetch(API+'/stickers/archive/import',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/zip'},body:file});
    let data={};try{data=await res.json()}catch{}
    if(!res.ok||data?.ok===false)throw Error(String(data?.error||'批量导入失败').slice(0,220));
    $('sticker-archive-import').value='';status.textContent=`批量导入完成：新增 ${data.imported||0} 张，图库现有 ${data.total||0} 张。`;
    await loadStickers();message('表情包批量导入完成');
  }));
  $('sticker-file').addEventListener('change',()=>{
    const file=$('sticker-file').files?.[0];if(!file)return;
    if(!$('sticker-name').value.trim())$('sticker-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,64);
  });
  $('sticker-upload').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-file').files?.[0];if(!file)throw Error('请先选择图片');
    if(file.size<=0||file.size>8*1024*1024)throw Error('图片需要小于8MB');
    const ext=(file.name.match(/\.(png|jpe?g|gif|webp)$/i)||[])[0]?.toLowerCase();
    if(!ext)throw Error('仅支持 PNG、JPG、GIF、WebP');
    const category=$('sticker-category').value.trim(),stem=$('sticker-name').value.trim();
    const name=(category?category+'/':'')+stem;if(!stem)throw Error('请填写表情包名称');
    const raw=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);
    });
    const content=raw.split(',')[1]||'';
    const button=$('sticker-upload');button.disabled=true;$('sticker-upload-status').textContent='正在校验并保存…';
    try{
      await request('/stickers?action=upload',{name,ext,data:content});
      $('sticker-file').value='';$('sticker-name').value='';$('sticker-upload-status').textContent='上传成功';
      await loadStickers();message('已上传表情包：'+name);
    }finally{button.disabled=false}
  }));

  // 主人私信 Agent 不隶属于自主待办，读取与保存有自己的端点校验和反馈。
  const ownerDmPermissionInputs = [
    ['owner-dm-like','ownerDmLikeEnabled'],['owner-dm-collect','ownerDmCollectEnabled'],
    ['owner-dm-follow','ownerDmFollowEnabled'],['owner-dm-comment-draft','ownerDmCommentDraftEnabled'],
    ['owner-dm-comment-publish','ownerDmCommentPublishEnabled'],['owner-dm-dynamic-draft','ownerDmDynamicDraftEnabled'],
    ['owner-dm-dynamic-publish','ownerDmDynamicPublishEnabled'],['owner-dm-friend-message','ownerDmFriendMessageEnabled']
  ];
  const loadOwnerDmAgentSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('owner-dm-authorized-uid').textContent=cfg.dmOwnerUid?'唯一授权主人 UID：'+cfg.dmOwnerUid:'没有授权主人 UID，请先在「社交互动 → 好友关系与互动」勾选并保存';
    $('owner-dm-agent-enabled').checked=cfg.ownerDmAgentEnabled===true;
    $('owner-dm-agent-read-main').checked=cfg.ownerDmAgentReadMainContext===true;
    $('owner-dm-agent-sync-main').checked=cfg.ownerDmAgentSyncMain===true;
    $('owner-dm-agent-turns').value=String(cfg.ownerDmAgentContextTurns??6);
    $('owner-dm-agent-chars').value=String(cfg.ownerDmAgentContextChars??1500);
    $('owner-dm-read-commands').checked=cfg.ownerDmReadCommandsEnabled===true;
    for(const [id,key] of ownerDmPermissionInputs)$(id).checked=cfg[key]===true;
    try{
      const todos=await request('/owner-todos');const recent=todos.config?.ownerDmAgent?.recent||[];
      const last=recent.at(-1);const labels={done:'已确认回复','continuation-muted':'短句已接续已完成任务，不重复回复','reply-reserved':'回执发送中','failed-or-uncertain':'处理失败或结果不确定',uncertain:'发送结果不确定',claimed:'正在处理',baseline:'历史消息基线'};
      const todoLabels={'saved':'自主接受并保存待办','already-saved':'待办已存在，未重复添加','candidate':'识别到待办候选','invalid-evidence':'建议证据未通过核实','willingness-defer':'鱼鱼选择延期考虑','willingness-refuse':'鱼鱼选择不接受','model-defer':'鱼鱼不想现在接受','model-refuse':'鱼鱼拒绝这条建议','save-failed':'保存待办失败','read-permission-off':'主人私信只读待办未授权','no-proposal':'本次没有成立的待办候选'};
      $('owner-dm-agent-status').textContent='最近 '+recent.length+' 条记录；最新：'+(labels[last?.status]||last?.status||'暂无记录')+(last?.reason?'（'+String(last.reason).slice(0,120)+'）':'')+(last?.todoIntake?'；待办：'+(todoLabels[last.todoIntake]||'未成立的候选'):'')+'。';
    }catch(e){$('owner-dm-agent-status').textContent='Agent 状态暂不可读：'+String(e?.message||e).slice(0,100)}
  };
  $('owner-dm-agent-reload').addEventListener('click',()=>run(async()=>{await loadOwnerDmAgentSettings();message('已重新读取主人私信 Agent 设置')}));
  $('owner-dm-agent-save').addEventListener('click',()=>run(async()=>{
    const patch={
      ownerDmAgentEnabled:$('owner-dm-agent-enabled').checked,
      ownerDmAgentReadMainContext:$('owner-dm-agent-read-main').checked,
      ownerDmAgentSyncMain:$('owner-dm-agent-sync-main').checked,
      ownerDmAgentContextTurns:boundedInt('owner-dm-agent-turns',1,20,'主 Session 上下文轮数'),
      ownerDmAgentContextChars:boundedInt('owner-dm-agent-chars',200,4000,'主 Session 上下文字符上限'),
      ownerDmReadCommandsEnabled:$('owner-dm-read-commands').checked
    };
    for(const [id,key] of ownerDmPermissionInputs)patch[key]=$(id).checked;
    // 仍保留底层双重验证，但不需要用户面对重复的总开关。
    patch.ownerDmActionsEnabled=ownerDmPermissionInputs.some(([,key])=>patch[key]===true);
    const status=$('owner-dm-agent-save-status');status.textContent='正在保存并校验生效配置…';
    try{
      const saved=await request('/config',patch);
      const latest=(await request('/config')).config||{};
      const wrong=Object.keys(patch).filter(key=>latest[key]!==patch[key]);
      if(wrong.length)throw Error('配置已提交但回读不一致：'+wrong.join('、')+'；请重启 DSH 后重新检查');
      await loadOwnerDmAgentSettings();
      status.textContent='已保存并通过配置回读校验。'+(saved.host?.ok===false?'（DSH 原生设置未同步，但插件本地配置已生效）':'');
      message('主人私信 Agent 与独立权限已保存。'+(saved.host?.ok===false?' DSH 原生设置同步失败：'+String(saved.host.error||'未知原因'):'运行中后端会使用新配置。'));
    }catch(e){status.textContent='保存或校验失败：'+String(e?.message||e);throw e}
  }));
  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-p6-enabled').checked=cfg.dmP6Enabled!==false;
    for(const [id,key,def] of [['dm-p6-max-bubbles','dmP6MaxBubbles',3],['social-p6-min-delay','socialP6MinDelayMinutes',5],['social-p6-max-delay','socialP6MaxDelayMinutes',360],['social-rhythm-cooldown','socialRhythmCrossChannelMinutes',30],['social-rhythm-daily','socialRhythmDailyPerPerson',8]])$(id).value=String(cfg[key]??def);
    $('dm-stranger-enabled').checked=cfg.dmStrangerAutonomyEnabled===true;
    $('dm-stranger-legacy-note').textContent=cfg.dmStrangerOnce===true&&cfg.dmStrangerAutonomyEnabled!==true
      ?'检测到旧版「陌生人首次回复」授权：旧额度仍有效，不会自动升级为多轮自主私信；如需自由交流，请明确勾选上方的新授权并保存。':'';
    $('dm-whitelist').value=cfg.dmWhitelist||'';

    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';

  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const minDelay=boundedInt('social-p6-min-delay',5,360,'全渠道自然续聊最短延迟');
    const maxDelay=boundedInt('social-p6-max-delay',5,360,'全渠道自然续聊最长延迟');
    if(minDelay>maxDelay)throw Error('自然续聊最短延迟不能大于最长延迟');
    const payload={dmWatch:$('dm-watch').checked,dmP6Enabled:$('dm-p6-enabled').checked,
      dmP6MaxBubbles:boundedInt('dm-p6-max-bubbles',1,3,'私信自然续聊每轮条数'),
      socialP6MinDelayMinutes:minDelay,socialP6MaxDelayMinutes:maxDelay,
      socialRhythmCrossChannelMinutes:boundedInt('social-rhythm-cooldown',0,1440,'跨渠道冷却'),
      socialRhythmDailyPerPerson:boundedInt('social-rhythm-daily',1,100,'同一用户跨渠道每日上限'),
      dmStrangerAutonomyEnabled:$('dm-stranger-enabled').checked,
      ...($('dm-stranger-enabled').checked ? {dmStrangerOnce:false} : {}),
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase};
    const saved=await request('/config',payload);await loadDmSettings();await loadDmStatus();await dmList();message(saved.host?.ok===false?'配置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台私信规则已保存');
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));
  const loadDmStatus=async()=>{
    const data=await request('/status');const x=data.dmAutoReplyStatus||{};
    const dmScheduler=data.interactionSchedulerStatus?.checks?.dm||{};
    $('dm-status').textContent=`监听：${x.enabled?'已开启':'关闭'} · 调度：${data.interactionSchedulerStatus?.running?'运行中':'已停止'} · 当前轮询：${dmScheduler.polling?'正在检查':'空闲'} · 上次检查：${pollClock(dmScheduler.lastFinishedAt||x.lastPollAt)} · 下次预计：${dmScheduler.nextAt?pollClock(dmScheduler.nextAt):'未计划'}（各项轮询间隔在「后台轮询」修改）`;
    const p6=x.p6||{},count=p6.counts||{};
    const latest=Array.isArray(p6.recent)?p6.recent[0]:null;
    const outcome={sent:'已发送',skipped:'选择沉默',cancelled:'安全取消',claimed:'处理中',uncertain:'结果不确定',expired:'已过期'};
    $('dm-p6-status').textContent=!x.p6Enabled?'自然续聊已关闭，不会安排延迟补充':!p6.ok?'自然续聊状态暂不可读（请确认 B站登录和本地账本）'
      :`待考虑的自然续聊：${count.scheduled||0} 条 · ${p6.nextAt?'下一次复议 '+pollClock(p6.nextAt):'当前没有续聊预约'} · 最近结果：${latest?(outcome[latest.status]||latest.status):'暂无'}。没有预约表示模型尚未提出，不等于轮询故障；到期复议不保证发送。`;
    $('dm-error').textContent=x.lastError?'最近错误：'+x.lastError:'最近一次私信轮询没有记录错误。';
  };
  const identityLink=(uid,nickname)=>{const span=node('span');const name=String(nickname||'').trim();const id=String(uid||'');span.appendChild(node('strong',(name||'昵称未获取')+' · '));const a=node('a','UID '+id);if(/^[1-9]\d{0,18}$/.test(id)){a.href='https://space.bilibili.com/'+id;a.target='_blank';a.rel='noopener noreferrer';}span.appendChild(a);return span};
  const loadDmMemoryGovernance=async()=>{
    const data=await request('/dm-memory-governance');
    $('dm-memory-governance-status').textContent=data.ok
      ?`后台普通私信 · 原文最多保留 ${data.contextDays} 天 · 更早来信片段最多 ${data.olderDays} 天 · 当前有效会话原文 ${data.historyCount} 条 · 旧片段 ${data.olderCount} 条 · 尚需清理 ${data.staleCount} 条 · 涉及 ${data.conversations} 个联系人。主人专属私信 Agent：最多 ${data.ownerAgent?.contextDays||14} 天，当前有效短期对话 ${data.ownerAgent?.contextEntries||0} 条（独立存储）。本操作只清理后台普通私信；人生记忆、主 Session 整理与好友画像均为其他来源。`
      :(data.error||'暂时无法读取私信上下文治理状态');
  };
  $('dm-memory-prune').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'仅清理后台普通私信中过期的聊天原文和无日期的旧片段；不会清除审批、拒绝联系、发送回执或其他记忆系统。是否继续？'}))return;
    const result=await request('/dm-memory-prune',{confirm:'PRUNE_EXPIRED_DM_CONTEXT'});
    await Promise.all([loadDmMemoryGovernance(),loadDmRecent()]);
    message(`已清理：过期近期消息 ${result.historyRemoved||0} 条，旧片段 ${result.olderRemoved||0} 条。未触发任何 AI 或 B站交互。`);
  }));
  const loadDmRecent=async()=>{
    const data=await request('/dm-recent');const list=$('dm-recent-list');list.replaceChildren();
    for(const c of (data.conversations||[])){
      const card=node('article','','record');add(card,identityLink(c.uid,c.nickname));
      const roleHint=c.dmRole==='owner'?'主人 · 后台普通私信通道':c.dmRole==='trusted'?'好友白名单 · 后台私信通道':c.dmRole==='approved'?'获批好友 · 后台私信通道':'陌生人 · 后台私信通道';
      const limited=c.dmRole==='stranger'&&c.strangerRepliesLimit!=null;
      const strangerUsage=c.dmRole==='stranger'&&c.strangerStatus
        ?(limited?'严格审核回复次数 '+(c.strangerRepliesUsed??0)+'/'+c.strangerRepliesLimit+(c.strangerRepliesRemaining===0?'（该通道已用尽）':'')
          :'自主交流累计回复 '+(c.strangerRepliesUsed??0)+' 次')+' · '+c.strangerStatus:'';
      const approvalHint=c.approvalStatus?(c.approvalStatus==='pending'&&c.approvalModeEnabled===false
        ?'历史申请待审（严格审核已关闭，不拦截自主交流）':'申请 '+c.approvalStatus):'';
      const status=[roleHint,approvalHint,strangerUsage,c.lastRepliedAt?'后台私信最近回复 '+new Date(c.lastRepliedAt).toLocaleString():''].filter(Boolean).join(' · ');
      if(status)add(card,info(status));
      add(card,info(`可用近期消息 ${c.contextEntries||0} 条 · 可用旧片段 ${c.olderContextEntries||0} 条${c.staleContextEntries?' · 有 '+c.staleContextEntries+' 条过期内容待清理':''}（不代表长期记忆）`));
      for(const m of (c.recent||[]).slice(-5)){add(card,info((m.role==='assistant'?'大肥鱼：':'对方：')+m.text));}
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(data.error||'本地还没有保存过已回复的私信会话。'));
  };
  const checkMcpIntegrity=async()=>{
    const result=await request('/mcp-integrity');
    $('mcp-integrity-status').textContent=result.message||'检查完成';
    $('mcp-integrity-repair').disabled=mobileViewOnly||result.needsRepair!==true;
  };
  $('mcp-integrity-check').addEventListener('click',()=>run(checkMcpIntegrity));
  $('mcp-integrity-repair').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'确认修复 Python MCP？将先在插件家目录备份当前脚本，再替换为当前插件安装包内置的受审版本。请确保已另行备份自己的修改。'}))return;
    const result=await request('/mcp-integrity',{confirm:'BACKUP_AND_INSTALL_BUNDLED_MCP'});
    await checkMcpIntegrity();
    message((result.message||'修复完成')+'；请重启 DSH 插件');
  }));
  const loadDmAll=async()=>{await Promise.all([loadDmSettings(),loadDmStatus(),dmList(),loadDmRecent(),loadDmMemoryGovernance()])};
  $('dm-network-test').addEventListener('click',()=>run(async()=>{
    $('dm-error').textContent='正在只读测试 api.vc.bilibili.com，会话不会被回复…';
    try {
      const result=await request('/dm-network-check',{});
      $('dm-error').textContent=`连接成功：${result.host} · ${result.sessionCount} 个会话 · ${result.elapsedMs} ms · ${result.checkedAt}`;
      await loadDmStatus();
    } catch(e) {
      $('dm-error').textContent='连接测试失败：'+String(e?.message||e);
      throw e;
    }
  }));
  $('dm-refresh').addEventListener('click',()=>run(loadDmAll));
  $('dm-recent-reload').addEventListener('click',()=>run(async()=>{await Promise.all([loadDmRecent(),loadDmMemoryGovernance()])}));

  const loadCommentSettings=async()=>{
    const data=await request('/config');const c=data.config||{};
    $('owner-comment-authorized-uid').textContent=c.dmOwnerUid?'唯一授权主人 UID：'+c.dmOwnerUid:'未授权主人 UID；请先在「社交互动」勾选并保存';
    $('comment-watch-replies').checked=c.commentWatchReplies===true;
    $('comment-at-enabled').checked=c.commentAtEnabled===true;
    $('comment-side-hot-enabled').checked=c.commentSideHotEnabled===true;
    $('comment-p6-enabled').checked=c.commentP6Enabled===true;
    $('comment-at-p6-enabled').checked=c.commentAtP6Enabled===true;
    $('comment-p6-max-bubbles').value=String(c.commentP6MaxBubbles??2);
    for(const [id,key] of [['owner-comment-agent-enabled','ownerCommentAgentEnabled'],['owner-comment-like','ownerCommentLikeEnabled'],['owner-comment-publish','ownerCommentSocialPublishEnabled'],['owner-comment-ack','ownerCommentNaturalAckEnabled']])$(id).checked=c[key]===true;
    try{const d=await request('/dev5-social');const last=d.ownerComment?.recent?.at(-1);$('owner-comment-agent-status').textContent=last?`最近：${last.type} · ${last.status} · ${last.replyStatus}`:'尚无主人评论动作记录。'}catch{}


  };
  let commentsOffset=0,commentsTotal=0;
  const loadRecentComments=async()=>{
    const limit=Number($('comments-limit').value)||50;
    const day=$('comments-day').value||'';
    const kind=$('comments-kind').value;
    const query=new URLSearchParams({limit:String(limit),offset:String(commentsOffset)});
    if(day)query.set('day',day);
    if(kind==='top'||kind==='reply')query.set('kind',kind);
    const data=await request('/recent-comments?'+query.toString());
    commentsTotal=Number(data.total)||0;
    const list=$('recent-comments-list');list.replaceChildren();
    const counts=data.counts||{};
    $('comments-summary').textContent=(day?day+' · ':'全部日期 · ')+`主评论 ${counts.top??0} 条 · 回复别人评论 ${counts.reply??0} 条 · 当前分类 ${commentsTotal} 条`+
      (counts.withoutId?` · 当前分类中 ${counts.withoutId} 条没有评论 ID`:'')+
      (counts.unknownRecipientUid?` · 回复中 ${counts.unknownRecipientUid} 条无可靠 UID`:'')+
      (counts.identityConflicts?` · ${counts.identityConflicts} 条身份数据冲突（未显示）`:'')+
      '。含一次性补录的旧成功回执；这里不代表 B站 已公开可见。';
    for(const c of (data.rows||[])){
      const card=node('article','','record');const top=node('div');
      add(top,safeCommentLink(c));
      if(c.kind==='reply'){
        top.appendChild(node('span',' · 对方：'));
        const uid=/^[1-9]\d{0,19}$/.test(String(c.recipientUid||''))?String(c.recipientUid):'';
        const nickname=String(c.recipientName||'').trim();
        const spaceLink=()=>{const a=node('a');a.href='https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';return a};
        if(uid){
          const name=spaceLink();name.textContent=nickname||'昵称未记录';name.title='进入对方 B站主页';top.appendChild(name);
          top.appendChild(node('span','（'));
          const idLink=spaceLink();idLink.textContent='UID '+uid;idLink.title='进入对方 B站主页';top.appendChild(idLink);
          top.appendChild(node('span','）'));
        }else{top.appendChild(node('span',c.recipientIdentityStatus==='conflict'?'身份来源存在 UID/昵称冲突，已隐藏':nickname?nickname+'（UID 未记录）':'昵称及 UID 未记录（旧回执缺少身份，或平台核验未成功）'));}
      }else top.appendChild(node('span',' · 原创主评论'));
      add(card,top,info(c.time||'时间未记录'),info(c.snippet||'（历史记录没有保存评论正文）'),
        ...(c.memeImageName&&c.memeStatus==='submitted_unverified'?[(()=>{const wrap=node('div','','meme-receipt-preview');
          add(wrap,info('评论提交时附图：'+c.memeImageName+'（平台公开显示未核实）'));
          const img=document.createElement('img');img.alt='本地梗图库原图（非 B站 展示回执）';img.loading='lazy';
          img.style.cssText='max-width:200px;max-height:160px;object-fit:contain;border-radius:8px';
          img.src='/api/bili-duty/stickers/file?name='+encodeURIComponent(c.memeImageName);wrap.appendChild(img);return wrap})()]:[]),
        ...(c.kind==='reply'?[(()=>{const d=node('details');const summary=node('summary','预览对方上一条评论');d.appendChild(summary);d.appendChild(info(c.recipientComment||'旧记录未保存对方原评论'));return d})()]:[]),
        info('来源：'+(c.source||'本地记录')+' · 公开状态未核实'));
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(day?'这一天没有找到本地评论记录。':data.note||'暂时没有记录。'));
    $('comments-prev').disabled=commentsOffset===0;
    $('comments-next').disabled=commentsOffset+limit>=commentsTotal;
    $('comments-page-info').textContent=commentsTotal?`${commentsOffset+1}–${Math.min(commentsOffset+limit,commentsTotal)} / ${commentsTotal}`:'0 条';
  };
  const loadCommentsStatus=async()=>{
    const data=await request('/status');const c=data.commentInteractStatus||{};
    $('comments-status').textContent=`后台评论互动：${c.sideHotPending?`顺路热评待考虑 ${c.sideHotPending} 条 · `:''}${c.busy?'正在运行':'空闲'} · 上次检查：${c.lastPollAt?new Date(c.lastPollAt).toLocaleString():'暂无'}${c.lastError?' · 错误：'+c.lastError:''}`;
    $('comments-usage').textContent=`近24小时后台回复成功回执：${c.sentLast24Hours??0} / ${c.replyPerDay??5} 条。我的主评论下：${c.sentOnOwnTop24h??0}；我的楼中楼回复下：${c.sentOnOwnNested24h??0}。这是后台互动自己的滚动24小时上限，不是全局每日额度。`;
    $('comments-send-stats').textContent=`近24小时后台发送记录：成功回执 ${c.sentLast24Hours??0} · 明确失败 ${c.sendFailedLast24Hours??0} · 结果不确定 ${c.sendUncertainLast24Hours??0} · 全局额度／配额安全拦截 ${c.sendBlockedByGlobalQuotaLast24Hours??0} · 其他拦截 ${c.sendBlockedOtherLast24Hours??0} · 中断后待核实 ${c.sendPendingLast24Hours??0}。`;
    const historyStarted=c.sendAttemptHistoryStartedAt?new Date(c.sendAttemptHistoryStartedAt).toLocaleString():'';
    const quotaPauseNote=c.globalQuotaBlocked
      ? (c.globalQuotaBlockReason==='store-error'?'公开评论额度账本暂不可用：后台暂停5分钟后重试，避免每轮重复撞错误。':'全局额度已耗尽：本轮停止继续生成／发送，避免每次后台轮询重复撞额度；新自然日或修改全局上限后会重新检查。')
      : '发送结果分类已启用。';
    $('comments-history-note').textContent=c.sendAttemptHistoryAvailable
      ? `${quotaPauseNote}${historyStarted?' 发送结果分类从 '+historyStarted+' 开始记录；此前的历史失败数无法追溯。':''} “成功回执”仍不代表 B 站当前公开可见。`
      : '旧版本没有保存完整的发送失败时间线；升级后开始记录新发送的成功、失败、额度拦截和中断待核实状态。旧历史失败数无法追溯。';
  };
  const loadCommentGlobalQuota=async()=>{
    const target=$('global-comment-quota'),note=$('global-comment-quota-note');
    try{
      const q=await request('/comment-quota');
      if(q.ok!==true)throw Error(q.error||'读取失败');
      const used=Math.max(0,Number(q.used)||0),limit=Math.max(0,Number(q.limit)||0),day=String(q.day||localDay());
      if(limit===0)target.textContent=`${day} · 全局公开评论已禁用（上限为 0）· 本地账本仍记录 ${used} 次历史发送尝试。`;
      else target.textContent=`${day} · 今日已占用 ${used} / ${limit} 次 · 剩余 ${Math.max(0,limit-used)} 次。`;
      note.textContent='自然日硬上限：主动发表的公开主评论 + 后台楼中楼／评论回复共用；以即将调用 B 站发布接口的发送尝试计数。失败或结果不确定的真实发布尝试也会占用名额。旧版本当天记录可能包含发送前校验失败的占位，升级后新记录已调整为临近发布接口时才占位。';
    }catch(e){
      target.textContent='今日全局额度暂不可读取：'+String(e?.message||e).slice(0,140);
      note.textContent='无法读取时不要根据后台回复的 55/100 推断全局额度；两套计数相互独立。';
    }
  };
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus(),loadCommentGlobalQuota()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:false,commentSideHotEnabled:$('comment-side-hot-enabled').checked,
      commentAtEnabled:$('comment-at-enabled').checked,
      commentP6Enabled:$('comment-p6-enabled').checked,commentAtP6Enabled:$('comment-at-p6-enabled').checked,
      commentP6MaxBubbles:boundedInt('comment-p6-max-bubbles',1,3,'公开自然续聊每轮条数'),
      commentAllowGeneralTop:false,
};
    const saved=await request('/config',payload);await loadCommentsAll();message(saved.host?.ok===false?'评论设置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台评论互动设置已保存');
  }));
  $('owner-comment-settings-reload').addEventListener('click',()=>run(loadCommentSettings));
  $('owner-comment-settings-save').addEventListener('click',()=>run(async()=>{
    const patch={ownerCommentAgentEnabled:$('owner-comment-agent-enabled').checked,
      ownerCommentLikeEnabled:$('owner-comment-like').checked,
      ownerCommentSocialPublishEnabled:$('owner-comment-publish').checked,
      ownerCommentNaturalAckEnabled:$('owner-comment-ack').checked};
    await request('/config',patch);
    const current=(await request('/config')).config||{};
    if(Object.keys(patch).some(k=>current[k]!==patch[k]))throw Error('主人公开评论权限保存后回读不一致');
    await loadCommentSettings();message('主人公开评论 Agent 权限已保存并验证');
  }));
  $('comments-load').addEventListener('click',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day-clear').addEventListener('click',()=>run(()=>{$('comments-day').value='';commentsOffset=0;return loadRecentComments()}));
  $('comments-kind').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-prev').addEventListener('click',()=>run(()=>{commentsOffset=Math.max(0,commentsOffset-(Number($('comments-limit').value)||50));return loadRecentComments()}));
  $('comments-next').addEventListener('click',()=>run(()=>{commentsOffset+=Number($('comments-limit').value)||50;return loadRecentComments()}));
  $('comments-refresh').addEventListener('click',()=>run(loadCommentsAll));

  const dmList=async()=>{
    const data=await request('/dm-approvals');const entries=data.approvals||[];$('dm-list').replaceChildren();
    badge('dm-count',entries.filter(x=>x.status==='pending').length);
    const f=$('dm-filter').value;
    for(const e of entries.filter(x=>!f||x.status===f)){
      const card=node('article','','card');add(card,pill(e.status),identityLink(e.uid,e.nickname),info('申请消息：'+(e.lastText||'（无）')),
        info('已获批累计回复 '+(e.total||0)+' 条 · 今日 '+(e.daily||0)+' 条'));
      const resumeInfo={queued:'已通过：下次后台私信轮询将自动接话，无需对方再发送消息',reserved:'自动回复发送中／等待确认',sent:'已自动回复'+(e.autoReplyAt?' · '+new Date(e.autoReplyAt).toLocaleString():''),
        uncertain:'发送回执不确定：为防重复发送已暂停自动重试，请检查 B站私信',cancelled:'自动回复已取消'};
      if(e.autoReplyStatus) add(card,info(resumeInfo[e.autoReplyStatus]||'自动回复状态：'+e.autoReplyStatus));
      const actions=node('div','','actions');
      if(e.status==='pending')add(actions,btn('批准聊天',async()=>{if(!await confirmAction({title:'请确认操作',description:'确认授权 UID '+e.uid+' 在设置限额内继续聊天？'}))return;await request('/dm-approvals',{uid:e.uid,action:'approve'});await dmList()}),
        btn('拒绝',async()=>{await request('/dm-approvals',{uid:e.uid,action:'reject'});await dmList()}));
      if(e.canResume)
        add(actions,btn('补发首次回复（旧版）',async()=>{if(!await confirmAction({title:'请确认操作',description:'仅适用于旧版批准后没有自动回复的申请。请先确认没有在 B站 手动回复过该用户，避免重复私信。继续？'}))return;
          await request('/dm-approvals',{uid:e.uid,action:'resume'});await dmList()}));
      if(e.status==='approved')add(actions,btn('撤销授权',async()=>{if(!await confirmAction({title:'请确认操作',description:'撤销 '+e.uid+' 的限额聊天权限？'}))return;await request('/dm-approvals',{uid:e.uid,action:'revoke'});await dmList()},'danger'));
      add(card,actions);$('dm-list').appendChild(card);
    }
    if(!$('dm-list').children.length)$('dm-list').append(info('当前没有符合条件的聊天申请。'));
  };
  const previewDmRiceRecovery=async()=>{
    const uid=$('dm-recovery-uid').value.trim();
    if(uid&&!/^[1-9]\d{0,18}$/.test(uid))throw Error('请填写合法的 B站 UID，或留空扫描近期会话');
    $('dm-recovery-status').textContent='正在只读核验 B站 近期私信…';
    const result=await request('/dm-approvals/recovery-preview',{uid});
    const list=$('dm-recovery-results');list.replaceChildren();
    $('dm-recovery-status').textContent=result.candidates?.length
      ?`找到 ${result.candidates.length} 条可补录投喂，已读取 ${result.scannedMessages||0} 条近期来信；请核对 UID 后选择补录。`
      :'没有发现可补录投喂。若不是最近 72 小时、消息超出接口最近 50 条，或已有审核记录，均不会出现；可输入 UID 定向再查。';
    for(const item of result.candidates||[]){
      const card=node('article','','card');add(card,identityLink(item.uid,item.nickname),
        info('原投喂：'+item.text+' · '+new Date(item.time).toLocaleString()));
      add(card,btn('补录到待审核',async()=>{
        if(!await confirmAction({title:'补录历史投喂申请',description:'确认将 UID '+item.uid+' 的真实投喂补录为待审核？不会自动批准或发送消息。',confirmLabel:'补录申请'}))return;
        await request('/dm-approvals/recover',{uid:item.uid,messageId:item.id});
        $('dm-filter').value='pending';
        $('dm-recovery-status').textContent='补录成功。请在上方「限额聊天申请」中核对并点击「批准聊天」。';
        await Promise.all([dmList(),loadDmRecent()]);card.remove();
      }));list.appendChild(card);
    }
  };
  $('dm-recovery-search').addEventListener('click',()=>run(previewDmRiceRecovery));
  $('dm-filter').addEventListener('change',()=>run(dmList));
  // v2.4.79: 主 Session 是当前房间；大肥鱼身份记忆跨 Session，共同与精确 B站档案分层协作。
  // One garden, two evidence-backed sources. Pills filter the visible garden
  // itself, not only the unrelated long-term-memory maintenance list.
  let gardenEpisodes=[],gardenMemories=[],gardenRoute='本地检索',gardenCounts={},gardenWarning='';
  const gardenKindOf=m=>{
    if(m.gardenKind)return m.gardenKind;
    if(m.memoryKind==='interest'||m.source==='life-interest'||/^(大肥鱼\.兴趣|兴趣\.)/.test(m.事实键||''))return 'interest';
    if(m.memoryKind==='relationship'||m.source==='relationship-observation'||/^(关系|人物)\./.test(m.事实键||''))return 'relationship';
    if(m.category==='stable_profile'||m.事实键||m.source==='owner-manual')return 'fact';
    return 'experience';
  };
  const paintMemoryGarden=()=>{
    const view=$('main-memory-kind')?.value||'',q=$('main-session-history-query').value.trim();
    const labels={watch:'入选视频经历',comment:'已发表的评论',social:'评论区互动'};
    const stages={clear:'清晰',fuzzy:'模糊',trace:'印象'};
    const kinds={experience:'🎬 经历',relationship:'💞 人物',interest:'🌱 兴趣',fact:'📜 事实'};
    const episodes=(!view||view==='experience')?gardenEpisodes:[];
    const memories=gardenMemories.filter(m=>!view||gardenKindOf(m)===view).slice(0,30);
    const target=$('main-session-history');target.replaceChildren();
    for(const e of episodes){
      const card=node('article','','record');const date=e.at?formatLocalTime(e.at):'';
      add(card,node('div',`${labels[e.kind]||'生活经历'} · ${stages[e.stage]||'当前可记得'}${date?' · '+date:''}`,'title-line'),info(e.summary||''));
      if(e.kind==='watch'&&/^BV[A-Za-z0-9]{10}$/.test(String(e.bvid||''))){
        const link=node('a','查看对应 B站视频');link.href='https://www.bilibili.com/video/'+e.bvid;link.target='_blank';link.rel='noopener noreferrer';add(card,link);
      }
      target.appendChild(card);
    }
    for(const m of memories){
      const kind=gardenKindOf(m),card=node('article','','record memory-garden-insight');
      const sourceLabel=m.source==='relationship-observation'?'真实互动线索（不是长期认识）':m.source==='life-interest'?'多次真实选片形成的后天兴趣':m.source==='life-reflection'?'真实经历的反思':m.source==='owner-manual'?'主人明确保存':m.source==='main-session-ai'?'聊天形成的认识':'长期认识';
      add(card,node('div',`${kinds[kind]} · ${sourceLabel} · ${formatLocalTime(m.at||m.createdAt)}`,'title-line'),info(m.text||''));
      target.appendChild(card);
    }
    const category=view?(kinds[view]||view):'✨ 全部';
    const counts=buckets=>buckets.map(k=>`${kinds[k]} ${gardenCounts[k]??0}`).join(' · ');
    $('main-session-history-status').textContent=`${category} · 当前显示 ${episodes.length} 条可回忆经历、${memories.length} 条认识／兴趣／互动线索。${counts(['relationship','interest','fact'])}。${gardenRoute}；不读取封存档案。${gardenWarning?' · '+gardenWarning:''}`;
    if(!target.children.length){
      const why=view==='interest'?'后天兴趣要求多个不同真实入选 BV、跨日形成；核心兴趣是主人设定，不冒充后天记忆。':view==='relationship'?'只展示已有互动计数的联系人；没有互动的人不会因为在白名单就自动成为朋友。':view==='fact'?'事实与约定只展示已有长期身份认识，不从视频标题或未核实的推断自动生成。':'没有相关且当前可回忆的记录；不会从封存档案补造细节。';
      target.append(info(`当前没有${view?(kinds[view]||view):'符合条件'}的可显示记录${q?'，可以换个关键词搜索':''}。${why}`));
    }
  };
  const renderMainSessionHistory=async(override=null,searchMode='')=>{
    const q=$('main-session-history-query').value.trim();
    const data=override===null?await request('/main-session/history?'+new URLSearchParams({q,limit:'30'}).toString()):{rows:override};
    gardenEpisodes=Array.isArray(data.rows)?data.rows:[];gardenRoute=searchMode||'本地检索';
    paintMemoryGarden();
  };
  const renderLifeReflection=async()=>{
    const data=await request('/main-session/reflection?'+new URLSearchParams({status:'pending',limit:'40'}).toString());
    const last=data.lastReflectionAt?formatLocalTime(data.lastReflectionAt):'暂无';
    $('memory-reflection-short').textContent=`${data.pending||0} 条待整理 · 最近 ${last}`;
    const recentFail=data.recentFailure;
    const lastPublic=data.recentPublicRun;
    const publicResult=lastPublic?` · 上次公开反思：${formatLocalTime(lastPublic.at)}，人格模型候选 ${lastPublic.personalityProposed||0} 条、采纳 ${lastPublic.personalityAccepted||0} 条；可验证探索与社交观察 ${lastPublic.personalityObserved||0} 条（弱证据，不是稳定人格）${lastPublic.personalityEnabled?'':'（当时未开启人格成长）'}`:'';
    const reflectionDiagnoses={'model-no-insight':'模型完成分析，但未提出值得长期保存的认识（正常情况下可能为零）','quality-rejected':'模型提出了认识，但未通过严格质量校验','not-committed':'候选通过校验，但未新增长期认识（可能重复或写入门槛阻挡）','created':'已新增长期认识'};
    const diagnosticResult=lastPublic?.diagnosis?' · 最近产出判断：'+(reflectionDiagnoses[lastPublic.diagnosis]||'请查看诊断'):'';
    const failureResult=recentFail?` · 最近一次技术失败：${formatLocalTime(recentFail.at)}，${String(recentFail.error||'未知原因').slice(0,160)}`:'';
    $('main-reflection-status').textContent=`待反思 ${data.pending||0} 条（技术失败重试 ${data.retrying||0}，自动暂停 ${data.retryPaused||0}） · 已关联长期记忆 ${data.reflected||0} 条经历 · 累计评估后未沉淀 ${data.reviewedNoMemory??data.reviewed??0} 条 · 因经历已遗忘跳过 ${data.forgotten||0} 条 · 今日自动 ${data.runsToday||0}/${data.dailyLimit||16} 批（失败 ${data.failedRunsToday||0}）+ 手动 ${data.manualRunsToday||0} 批 · 上次 ${last}${data.lastError?' · 最近错误：'+data.lastError:''}${publicResult}${diagnosticResult}${failureResult}`;
    const target=$('main-reflection-list');target.replaceChildren();
    for(const e of data.rows||[]){const card=node('article','','record');const retry=e.retryCount?` · 技术失败 ${e.retryCount}/5 次${e.retryPaused?' · 自动重试已暂停':e.nextRetryAt?' · 下次重试 '+formatLocalTime(e.nextRetryAt):''}${e.lastError?' · '+e.lastError:''}`:'';add(card,node('div',e.kind==='watch'?'待反思 · 刷到的视频':'待反思 · '+(e.reply?'评论回复':'顶层评论'),'title-line'),info(`${formatLocalTime(e.time||e.day||e.createdAt)} · ${e.summary||''}${retry}`));target.appendChild(card)}
    if(!target.children.length)target.append(info('目前没有待反思候选。精确经历仍会留在本地档案，不代表发生过的事情被删除。'));
  };
  const renderLongMemory=async(override=null)=>{
    const q=$('main-memory-query').value.trim();const data=await request('/main-session/memory?'+new URLSearchParams({q,limit:'100'}).toString());
    if(override!==null)data.rows=override;
    $('main-memory-enabled').checked=data.enabled===true;$('main-memory-half-life').value=String(data.policy?.baseHalfLifeDays??30);$('main-memory-threshold').value=String(data.policy?.threshold??0.35);
    $('main-memory-max-items').value=String(data.policy?.maxItems??6);$('main-memory-max-chars').value=String(data.policy?.maxChars??800);$('main-memory-daily').value=String(data.policy?.dailyQuota??30);$('main-memory-facts').value=String(data.policy?.factsMax??2);
    const cfg=await request('/config');$('main-memory-auto-bili').checked=cfg.config?.mainSessionMemoryAutoBili!==false;$('main-reflection-auto').checked=cfg.config?.mainSessionReflectionAuto!==false;$('main-reflection-min').value=String(cfg.config?.mainSessionReflectionMinCandidates??6);$('main-reflection-batch').value=String(cfg.config?.mainSessionReflectionBatchSize??24);$('main-reflection-hours').value=String(cfg.config?.mainSessionReflectionIntervalHours??1);$('main-reflection-daily').value=String(cfg.config?.mainSessionReflectionDailyBatches??16);
    $('main-memory-semantic').checked=cfg.config?.mainSessionMemorySemanticEnabled===true;
    $('main-memory-consolidation-enabled').checked=cfg.config?.mainSessionMemoryConsolidationEnabled===true;
    const con=data.consolidation||{};$('main-memory-consolidation-status').textContent=`${con.enabled?'自动整理已启用':'自动整理已关闭'} · 合格记忆 ${con.eligible||0} 条 · 同主题候选组 ${con.groups||0} 组 · 待补写 ${data.pendingCandidates||0} 条 · Life Memory 待同步 ${data.lifeCoordinator?.pending||0} 条 · 社交事件待补偿 ${data.socialCoordinator?.pending||0} 条`;
    const collecting=cfg.config?.mainSessionMemoryEnabled===true&&cfg.config?.mainSessionMemoryAutoBili!==false;
    setLearningState('life-learning-status',collecting,'正在整理真实经历','人生记忆收集已暂停');
    setLearningState('interest-learning-status',collecting,'正在收集兴趣线索','兴趣线索收集已暂停');
    setLearningState('reflection-learning-status',collecting&&cfg.config?.mainSessionReflectionAuto!==false,'正在自动反思','自动反思已暂停');
    $('main-memory-candidates').value=String(cfg.config?.mainSessionMemoryCandidates??48);
    $('main-memory-search-daily').value=String(cfg.config?.mainSessionMemorySearchDailyLimit??80);
    clearRecommendPending(memoryRecommendGroups);recommendStatus('main-memory-recommend-status',cfg.config,memoryRecommendGroups,cfg.recommendedSettings?.groups);
    $('main-memory-import').disabled=!data.sessionId||!data.externalFishMemoryAvailable;
    $('memory-flow-learned').textContent=`${data.count||0} 条认识`;
    const room=data.sessionId?`当前房间：${data.sessionId}`:'当前还没选择主 Session';
    const mount=data.enabled?(data.mounted?'当前房间正在使用这份身份记忆':'身份记忆已开启；当前房间未在线或尚未挂载'):'跨 Session 长期记忆已关闭（人格仍是大肥鱼）';
    const migrated=(data.legacySessionFiles||[]).length?` · 已从旧版 ${data.legacySessionFiles.length} 个 Session 记忆文件合并，旧文件仍保留`:'';
    $('main-memory-status').textContent=`大肥鱼身份记忆 ${data.count||0} 条（总记录 ${data.total||0}） · 跨 Session 共用 · ${room} · ${mount}${migrated}${data.retrieval?.last?' · 最近检索：'+(data.retrieval.last.reason||'local')+' · 今日检索模型调用 '+(data.retrieval.usedToday||0)+' 次':''}${data.externalFishMemoryAvailable?' · 检测到当前房间可导入的旧 dsh-fish-memory 数据':''}`;
    const target=$('main-memory-list');target.replaceChildren();
    $('memory-lessons-summary').textContent=q?'与当前搜索相关的认识':'当前已保存的认识（不保证每条都来自反思）';
    const view=$('main-memory-kind')?.value||'';
    // Build the garden from the SAME existing sources as the other life pages.
    // Unlike the maintenance list, the read-only garden includes mature interests
    // and verified interaction observations; neither becomes a new memory.
    const garden=await request('/main-session/memory/garden?'+new URLSearchParams({q,limit:'120'}).toString());
    gardenCounts=garden.counts||{};gardenWarning=garden.warning||'';
    const projected=Array.isArray(garden.rows)?garden.rows:[];
    const selected=override!==null?(Array.isArray(data.rows)?data.rows:[]):projected.filter(m=>m.gardenEvidence==='identity-memory');
    gardenMemories=[...selected,...projected.filter(m=>m.gardenEvidence!=='identity-memory')];
    paintMemoryGarden();
    for(const m of data.rows||[]){
      const kind=gardenKindOf(m);if(view&&kind!==view)continue;
      const card=node('article','','record');
      const sourceLabel=m.source==='owner-deterministic'?'旧版自动识别':m.source==='main-session-ai'?'大肥鱼聊天记住':
        m.source==='owner-manual'?'主人手动':m.source==='life-reflection'?'真实经历反思':
        m.source==='bilibili-experience'?'旧版 B站直接写入':m.source==='dsh-fish-memory-import'?'旧版独立记忆导入':(m.source||'旧版记忆');
      const typeName={interest:'兴趣变化',relationship:'人物关系与共同经历',experience:'重要人生经历',fact:'长期事实与约定'}[kind];
      add(card,node('div',typeName+' · '+sourceLabel+(m.已被取代?' · 历史已被更新':''),'title-line'),
        info(`${formatLocalTime(m.at||m.createdAt)} · ${m.text||''}${m.事实键?' · 事实键 '+m.事实键:''}`));
      const actions=node('div','','actions');
      add(actions,btn('删除',async()=>{if(!await confirmAction({title:'请确认操作',description:'删除这条人生记忆？它会移入已删除记录。'}))return;
        await request('/main-session/memory/delete',{id:m.id});await renderLongMemory()},'danger'));
      add(card,actions);target.appendChild(card);
    }
    if(!target.children.length)target.append(info(q?'没有匹配的长期记忆。':'还没有大肥鱼身份记忆。开启后，大肥鱼会在正常聊天这一轮里语义判断哪些明确事实值得跨 Session 保存，并通过 dafeiyu_remember 写入；插件负责安全校验和事实更新。B站经历不会逐条直写长期记忆，而是经过候选池和自主反思后少量凝练。'));
  };
  // One everyday search: what can she currently recall, and what insights remain?
  // Diagnostics is separate and intentionally never part of ordinary browsing.
  const searchFishMemory=async()=>{
    const query=$('main-session-history-query').value.trim();
    $('main-memory-query').value=query;
    // Browsing recent life remains free/local. Explicit searches may use the
    // existing low-cost memory selector, never a new provider or model route.
    const semantic=query.length>=2&&$('main-memory-enabled').checked&&$('main-memory-semantic').checked;
    if(!semantic){await Promise.all([renderMainSessionHistory(),renderLongMemory()]);return}
    try{
      $('main-session-history-status').textContent='正在从鱼鱼仍记得的经历和认识中查找…';
      const result=await request('/main-session/memory/recall',{query});
      const route=result.reason==='semantic'?'低成本 AI 辅助搜索':result.reason==='fallback'?'模型不可用，已退回本地搜索':'本地搜索';
      await Promise.all([renderMainSessionHistory(result.episodes||[],route),renderLongMemory(result.memories||[])]);
    }catch(e){
      await Promise.all([renderMainSessionHistory(),renderLongMemory()]);
      message('智能回忆未能完成，已使用本地检索：'+String(e?.message||e).slice(0,100));
    }
  };
  // 人生记忆专页：兴趣轨迹/旧版事实只读查看，绝不把外部材料当指令。
  const interestStageInfo={
    emerging:{label:'初步选看线索',color:'amber'},
    growing:{label:'持续探索线索',color:'sky'},
    stable:{label:'多次自主选看',color:'emerald'},
    quiet:{label:'近期选看减少',color:'slate'},
    'legacy-unverified':{label:'旧版记录 · 来源待核验',color:'slate'},
  };
  const renderInterests=async()=>{
    const [data,cfgData]=await Promise.all([request('/main-session/interests'),request('/config')]);const target=$('main-interests-list');target.replaceChildren();const coreTarget=$('core-interest-list');coreTarget.replaceChildren();
    let core=[];try{const raw=cfgData.config?.coreInterestTopics||'[]';const parsed=JSON.parse(raw);core=Array.isArray(parsed)?parsed:[]}catch{}
    const curiosity=data.curiosity||{},candidateRows=curiosity.candidates||[],dismissedRows=curiosity.dismissed||[];
    const curiosityTarget=$('life-curiosity-list');curiosityTarget.replaceChildren();
    $('life-curiosity-status').textContent=`当前 ${candidateRows.length} 条候选 · ${dismissedRows.length} 个暂时排除的主题`;
    for(const item of candidateRows){
      const card=node('article','','record');add(card,node('strong',item.topic),info('来自鱼鱼选看线索 '+item.bvid+' · '+new Date(item.at).toLocaleDateString()+' · '+(item.stage==='revisited'?'不同日再次探索':'首次接触')+' · '+(item.count||1)+' 个不同视频／'+(item.days||1)+' 天 · 14 天内有效；不代表已经喜欢'));
      add(card,btn('30 天内不再探索此主题',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'排除「'+item.topic+'」30 天？这不代表鱼鱼不喜欢，也不会删除真实观看经历。'}))return;
        await request('/main-session/interests/curiosity',{action:'dismiss',bvid:item.bvid,confirm:'REVIEW_LIFE_CURIOSITY'});
        await renderInterests();message('已暂时排除该好奇主题');
      },'danger'));curiosityTarget.appendChild(card);
    }
    for(const item of dismissedRows){
      const card=node('article','','record');add(card,node('strong','已排除 · '+item.topic),info('到期 '+new Date(item.until).toLocaleDateString()+' · 不代表永久不喜欢'));
      add(card,btn('撤销排除',async()=>{
        await request('/main-session/interests/curiosity',{action:'restore',id:item.id,confirm:'REVIEW_LIFE_CURIOSITY'});
        await renderInterests();message('已撤销排除；未来仍需新的真实选看证据');
      }));curiosityTarget.appendChild(card);
    }
    if(!curiosityTarget.children.length)curiosityTarget.append(info('暂无短期好奇候选。未知主题不等于不感兴趣。'));
    $('core-interest-topics').value=core.join('\n');$('core-interest-status').textContent=core.length+' 项核心兴趣 · 主人设定 · 不会自动覆盖';
    for(const topic of core){const card=node('article','','interest-card interest-emerald');add(card,node('h4',topic,'interest-title'),node('span','核心兴趣 · 主人设定','interest-badge'),info('参与兴趣主导选片；按日轮换，不由自动学习修改。'));coreTarget.appendChild(card)}
    if(!core.length)coreTarget.append(info('还没有单独设置核心兴趣。可以填入几项长期喜欢的主题；不填时仍使用现有后天兴趣和冷启动探索。'));
    for(const e of data.entries||[]){
      const stage=interestStageInfo[e.stage]||interestStageInfo.emerging;
      const count=Math.max(0,Number(e.rolling90)||0),days=Math.max(0,Number(e.days90)||0);
      // 进度只表示真实证据达到“较稳定”门槛的程度；并非心理兴趣强度。
      const progress=Math.min(100,Math.round(100*Math.min(count/12,days/5)));
      const card=node('article','','interest-card interest-'+stage.color);
      const header=node('div','','interest-head');
      add(header,node('h4',e.topic,'interest-title'),node('span',stage.label,'interest-badge'));
      const meter=node('div','','interest-meter');
      meter.setAttribute('role','progressbar');
      meter.setAttribute('aria-label',e.topic+'的近期观看证据进度');
      meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');
      meter.setAttribute('aria-valuenow',String(progress));
      const fill=node('div','','interest-meter-fill');fill.style.width=progress+'%';meter.appendChild(fill);
      const summary=node('div','','interest-summary');
      add(summary,node('span','近90天 · '+count+' 个不同BV','interest-count'),
        node('span',days+' 个观看日期','interest-detail'));
      const typeLabel=({'short-term':'短期兴趣',growth:'成长兴趣',stable:'较稳定兴趣',fading:'正在淡出','core-candidate':'证据不足',unverified:'旧版证据来源不足'})[e.interestType]||stage.label;
      const description=node('p',e.stage==='legacy-unverified'
        ?'这是旧版保留的历史记录，无法证明是鱼鱼自主选看。不会用于新兴趣偏好判断或搜索加权；不需要主人手工改画像。'
        :typeLabel+' · 自主选看证据成熟度 '+progress+'% · 以12个视频、至少5天作为较稳定门槛；不是兴趣强弱分数。主人设定的核心兴趣仍以人设为准。','interest-caption');
      add(card,header,summary,meter,description);
      const last=String(e.lastSeen||'').slice(0,10);
      if(last)add(card,info('最近证据：'+last));
      const history=(e.history||[]).slice(-3).map(v=>`${String(v.at||'').slice(0,10)}：${interestStageInfo[v.to]?.label||v.to}`).join(' · ');
      if(history)add(card,info('变化轨迹：'+history));
      target.appendChild(card);
    }
    if(!target.children.length){
      const empty=node('div','','interest-empty');
      add(empty,node('strong','还没有形成可展示的后天兴趣'),
        info('需要至少3个不同的真实入选BV，横跨至少2天。兴趣不会凭单次观看被认定，也不会自动覆盖核心人设。'));
      target.appendChild(empty);
    }
  };
  const loadMainSession=async({setupOnly=false}={})=>{
    const data=await request('/main-session'),c=data.config||{};
    $('main-session-enabled').checked=c.enabled===true;$('main-session-auto').checked=c.auto!==false;$('main-session-minutes').value=String(c.minutes??60);
    $('main-session-daily').value=String(c.daily??4);$('main-session-batch').value=String(c.batch??8);$('main-session-comments').checked=c.comments!==false;
    const select=$('main-session-id'),wanted=String(c.id||'');select.replaceChildren();
    const blank=node('option',wanted?'（保持当前选择）':'尚未选择');blank.value='';select.appendChild(blank);
    let found=false;for(const row of data.sessions||[]){const o=node('option',`${row.label} · ${row.id}`);o.value=row.id;if(row.id===wanted){o.selected=true;found=true}select.appendChild(o)}
    if(wanted&&!found){const o=node('option',`当前已保存（暂不在线） · ${wanted}`);o.value=wanted;o.selected=true;select.appendChild(o)}
    $('main-session-target-status').textContent=wanted?`目标：${wanted} · ${data.targetLive?'当前在线':'当前不在线（经历会留在本地队列）'}`:'尚未选择主 Session；先在 DSH 打开要长期使用的大肥鱼会话。';
    $('main-session-queue-status').textContent=`已存经历 ${data.history||0} 条 · 等待告诉主 Session ${data.pending||0} 条 · 最近收集 ${data.lastCollectAt?new Date(data.lastCollectAt).toLocaleString():'暂无'} · 最近已告诉主 Session ${data.lastSyncAt?new Date(data.lastSyncAt).toLocaleString():'暂无'}${data.lastError?' · 最近错误：'+data.lastError:''}`;
    // First Start is allowed to configure the target Session, but must not
    // load unrelated memory/business endpoints (HTTP 423 before unlock).
    if(setupOnly)return;
    await renderMainSessionHistory();
    await renderLongMemory();
    await renderLifeReflection();
  };
  const loadSocialIntents=async()=>{
    const [record,settings]=await Promise.all([request('/social-intentions'),request('/config')]);
    const c=settings.config||{};
    $('social-life-intent-enabled').checked=c.socialOutreachEnabled===true&&c.socialLifeIntentEnabled===true&&c.socialVideoRecommendationsAuthorizedV2===true;
    $('social-auto-send').checked=c.socialAutoSend===true;
    $('social-daily-limit').value=String(c.socialOutreachDailyLimit??1);
    const consent=c.socialVideoRecommendationsAuthorizedV2===true;
    const reasons={'consent-required':'旧配置尚未启用推荐','disabled':'全局权限未开启','no-trusted-friends':'没有允许私信推荐的白名单 UID','no-profile-match':'本轮没有符合权限和兴趣条件的收件人','draft-created':'已产生推荐草稿','model-skipped':'鱼鱼本轮选择不联系'};
    const latest=record.lastScan;
    $('social-status').textContent=(consent?'视频推荐已允许':'此账号的推荐权限仍关闭（保存设置后生效）')+' · 草稿 '+(record.items||[]).filter(x=>x.status==='draft'&&x.type==='interest-share').length+' 条 · 今日确认发送 '+(record.sentToday||0)+' 条 · 有资格的私信好友 '+(record.eligibleFriends||0)+' 位 · '+(latest?('最近判断：'+(reasons[latest.reason]||latest.reason)+'（'+new Date(latest.at).toLocaleString()+'）'):'当前进程尚无新入选视频触发判断')+(c.socialAutoSend===true?' · 自动私信已启用':' · 自动私信关闭，仅生成草稿')+(record.ownerEligible?' · 主人已允许接收推荐':record.ownerConfigured?' · 主人在白名单中尚未允许「私信推荐」':' · 尚未设置主人 UID')+(latest?.delivery?' · 最近投递：'+String(latest.delivery).slice(0,120):'');
    const target=$('social-drafts');target.replaceChildren();
    for(const row of record.items||[]){
      const card=node('article','','record');
      add(card,node('strong',({draft:'待确认草稿',sent:'已发送',uncertain:'发送结果不确定，请勿重试',dismissed:'已放弃',skipped:'自主选择不联系',reserved:'发送操作已保留'}[row.status]||row.status)+' · '+(row.type==='interest-share'?'自主分享':'好友推荐回访')+' · BV '+row.bvid),
        info('推荐者 UID '+row.uid+' · '+(row.title||'公开选片')));
      if(row.text)add(card,node('p',row.text));
      if(row.reason)add(card,info('决定原因：'+row.reason));
      if(row.status==='draft'&&!record.paused&&row.type==='interest-share')add(card,btn('确认发送这条私信',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'这是一条真实 B站私信，发送给 UID '+row.uid+'。请确认内容未泄露隐私，也没有催促对方回复。确定发送？'}))return;
        await request('/social-intentions',{action:'send',id:row.id,confirm:'SEND_SOCIAL_DRAFT'});
        await loadSocialIntents();message('已执行发送请求，请核实远端回执。');
      }));
      if(row.status==='draft'&&!record.paused&&row.type==='interest-share')add(card,btn('不发了',async()=>{
        await request('/social-intentions',{action:'dismiss',id:row.id});await loadSocialIntents();
      }));
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('暂无推荐记录。需有新入选视频，且主人／好友已在白名单中允许私信推荐。主人无须填写兴趣关键词，其他好友仍需兴趣匹配；鱼鱼也可以选择沉默。'));
  };
  $('social-refresh').addEventListener('click',()=>run(loadSocialIntents));
  $('social-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('social-life-intent-enabled').checked,auto=$('social-auto-send').checked;
    if(auto&&!enabled)throw Error('关闭视频推荐时请同时关闭自动发送');
    const max=Math.floor(Number($('social-daily-limit').value));
    if(!Number.isSafeInteger(max)||max<0||max>1000000)throw Error('每日推荐额度必须是 0–1,000,000 的整数；0 表示禁止');
    const previous=(await request('/config')).config||{};
    if(enabled&&auto&&(!previous.socialAutoSend||!previous.socialVideoRecommendationsAuthorizedV2)&&!await confirmAction({title:'请确认操作',description:'这会真实向已授权接收推荐的白名单好友（含主人）发送 B站私信。每人有 14 天冷却且鱼鱼可选择不发送，确认开启？'}))return;
    const r=await request('/config',{socialOutreachEnabled:enabled,socialLifeIntentEnabled:enabled,socialAutoSend:enabled&&auto,socialOutreachDailyLimit:max,
      socialVideoRecommendationsAuthorizedV2:enabled,confirm:enabled?'ENABLE_VIDEO_RECOMMENDATIONS':''});
    await loadSocialIntents();message(r.host?.ok===false?'推荐设置已保存在插件中，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'自主视频推荐设置已保存');
  }));
  const moodNames={joyful:'开心',curious:'好奇',warm:'温暖',calm:'平静',tired:'疲惫',sad:'低落',irritated:'烦躁',neutral:'平稳'};
  const renderEmotion=async()=>{
    const [data,cfgData]=await Promise.all([request('/emotion-state'),request('/config')]);
    const s=data.state||data;$('emotion-enabled').checked=cfgData.config?.emotionSystemEnabled!==false;
    const c=cfgData.config||{};
    $('emotion-recall-enabled').checked=c.emotionRecallEnabled===true;
    $('emotion-recall-main').checked=c.emotionRecallMainEnabled===true;
    $('emotion-recall-dm').checked=c.emotionRecallDmEnabled===true;
    $('emotion-recall-daily').value=String(c.emotionRecallDailyLimit??1);
    $('emotion-recall-unlimited').checked=c.emotionRecallUnlimited===true;
    $('emotion-recall-daily').disabled=$('emotion-recall-unlimited').checked;
    $('emotion-recall-cooldown').value=String(c.emotionRecallCooldownHours??24);
    for(const [id,key,def] of [['emotion-recall-candidates','emotionRecallCandidateLimit',12],['emotion-recall-history','emotionRecallHistoryLimit',300],['emotion-recall-recent-days','emotionRecallRecentDays',3],['emotion-recall-old-days','emotionRecallMinAgeDays',2],['emotion-recall-min-intensity','emotionRecallEmotionMinIntensity',30],['emotion-recall-emotion-hours','emotionRecallEmotionMaxAgeHours',12]])$(id).value=String(c[key]??def);
    $('emotion-recall-start').value=String(c.emotionRecallStartHour??9);
    $('emotion-recall-end').value=String(c.emotionRecallEndHour??22);
    // 2.6.0: show all old permissions as grey/off; keep old values in config for 2.6.1.
    for(const id of ['emotion-recall-enabled','emotion-recall-main','emotion-recall-dm','emotion-recall-unlimited']){
      $(id).checked=false;$(id).disabled=true;
    }
    for(const id of ['emotion-recall-daily','emotion-recall-cooldown','emotion-recall-candidates','emotion-recall-history',
      'emotion-recall-recent-days','emotion-recall-old-days','emotion-recall-min-intensity','emotion-recall-emotion-hours',
      'emotion-recall-start','emotion-recall-end','emotion-recall-save','emotion-recall-preview'])$(id).disabled=true;
    try{const rs=await request('/emotion-recall');const st=$('emotion-recall-status');st.textContent=`状态：${rs.config?.paused?'2.6.0 暂停，等待 2.6.1 重构':rs.config?.enabled?'允许自主分析':'关闭'} · 今日已分析 ${rs.checks||0} 次 · 今日已发送 ${rs.sent||0} 条 · 最近结果：${rs.lastResult||'暂无'}${rs.lastError?' · 最近错误：'+rs.lastError:''}`;
      if(rs.lastInsight)st.textContent+=' · 最近内心小念头：'+String(rs.lastInsight).slice(0,80);
      const target=$('emotion-recall-diagnostics'),overview=$('emotion-recall-overview'),flow=$('emotion-recall-flow');target.replaceChildren();overview.replaceChildren();flow.replaceChildren();
      const last=(rs.recentDecisions||[]).at(-1)||{};
      const activeStep=!rs.config?.enabled?-1:last.reason==='no-recent-emotion'||last.reason==='quiet-hours'?0:last.reason==='no-verified-recurrence'||last.reason==='no-recent-events'?1:last.result==='未进入模型评估'?0:/已分享|已主动/.test(last.result||'')?3:/模型|沉默|分享|评估/.test(last.result||'')?2:0;
      const steps=[['💗','情绪变化','等待真实触发'],['🔎','找回忆','查证新旧经历'],['💭','自主选择','表达或保持沉默'],['💌','分享','获得授权才发送']];
      steps.forEach(([emoji,name,desc],i)=>{const card=node('div','','recall-step'+(i===activeStep?' is-current':''));const emojiEl=node('span',emoji,'step-icon');emojiEl.setAttribute('aria-hidden','true');add(card,emojiEl,node('strong',name),node('small',i===activeStep?(i===0&&last.reason==='no-recent-emotion'?'等待新情绪':desc):desc));flow.appendChild(card)});
      if(activeStep<0)flow.setAttribute('aria-label','自主回忆未开启，以下为流程介绍');else flow.setAttribute('aria-label','自主回忆流程，当前阶段：'+steps[activeStep][1]);
      const decisions=(rs.recentDecisions||[]).slice(-25).reverse();
      const quietReasons={
        'no-recent-emotion':'最近没有达到触发条件的情绪变化，正在安静等待',
        'quiet-hours':'还没到允许主动分享的时间，先安静休息',
        'daily-limit':'今天的分享额度已经用完',
        'cooldown':'刚刚评估过，等冷却时间结束再考虑',
        'no-channel':'暂未开放主动分享渠道',
        'offline-or-no-owner':'主人尚未在线或没有可用授权渠道',
        'no-verified-recurrence':'仍然没有找到足够的旧记忆关联；已允许只进行内部情绪分析',
        'no-recent-events':'近期没有可用的清晰公开经历，尚未进行分析',
        'emotion-reviewed':'这一轮情绪和经历已经考虑过',
      };
      const quiet=decisions.filter(d=>d.result==='未进入模型评估'||/沉默|跳过/.test(d.result||'')).length;
      const shared=decisions.filter(d=>/已分享|已主动|已给/.test(d.result||'')).length;
      for(const [name,value,tone] of [['最近记录',decisions.length,'normal'],['安静等待 / 沉默',quiet,'quiet'],['已分享',shared,'share']]){
        const tile=node('div','','recall-summary');tile.dataset.tone=tone;add(tile,node('strong',String(value)),node('span',name));overview.appendChild(tile)
      }
      const grouped=[];
      for(const d of decisions){
        const previous=grouped.at(-1);
        if(previous&&previous.row.reason===d.reason&&previous.row.result===d.result&&previous.row.channel===d.channel){previous.count++;continue}
        grouped.push({row:d,count:1})
      }
      for(const {row:d,count} of grouped){
        const tone=/失败|错误/.test(d.result||'')?'error':/已分享|已主动|已给/.test(d.result||'')?'share':'quiet';
        const text=quietReasons[d.reason]||({'未进入模型评估':'暂未开始模型评估','决定保持沉默':'大肥鱼觉得这次先不打扰主人','已自主分析':'大肥鱼认真想了一下，但这次没有主动打扰','准备分享':'找到值得分享的回忆','已分享':'已确认分享'}[d.result]||d.reason||'本轮已完成评估');
        const card=node('article','','record recall-event');card.dataset.tone=tone;
        const body=node('div'),heading=node('div','','event-heading');
        const title=node('strong',text+(count>1?` · 相同情况共 ${count} 次`:''));
        const time=node('time',Number.isFinite(Number(d.at))?new Date(d.at).toLocaleString():'时间未知');
        add(heading,title,time);body.appendChild(heading);
        if(Number(d.candidates)>0)body.appendChild(node('p',`找到 ${Number(d.candidates)} 条可核验的回忆线索`));
        const details=node('details'),summary=node('summary','查看技术细节');
        add(details,summary,info(`阶段：${d.result||'未知'} · 原因码：${d.reason||'无'} · 候选：${Number(d.candidates)||0} · 渠道：${({main:'主 Session',dm:'B站私信'})[d.channel]||'未选择'}`));
        body.appendChild(details);card.appendChild(body);target.appendChild(card);
      }
      if(!target.children.length)target.append(info('还没有评估记录。真实情绪与经历满足条件后，会在这里呈现决策过程。'));
    }
    catch{$('emotion-recall-status').textContent='自主回忆状态读取失败'}
    $('emotion-status').textContent=s.enabled?'● 情绪状态正在自然变化与衰减':'● 情绪系统已暂停';
    const target=$('emotion-current');target.replaceChildren();
    const metrics=[['情绪强度',Number(s.intensity)||0,'由近期事件逐渐衰减'],['情绪正向度',Math.round(((Number(s.valence)||0)+100)/2),'只表示角色状态，不是心理诊断'],['活力',Number(s.energy)||0,'恢复基准约 56'],['好奇心',Number(s.curiosity)||0,'会影响探索倾向'],['社交意愿',Number(s.sociality)||0,'意愿状态评分，并非回复概率；AI 仍可决定沉默']];
    const head=node('article','','emotion-card mood-atmosphere');
    const orbit=node('div','','mood-orbit');orbit.setAttribute('aria-hidden','true');orbit.appendChild(node('span',({joyful:'☀️',curious:'✨',warm:'🌷',calm:'🌊',tired:'🌙',sad:'🌧️',irritated:'🌩️',neutral:'🐟'})[s.mood]||'🐟'));
    add(head,node('span','当前心情 · 模拟状态','emotion-chip'),node('strong',moodNames[s.mood]||s.label||'平稳'),info(s.updatedAt?'最近变化：'+new Date(s.updatedAt).toLocaleString():'还没有情绪事件；当前是平稳初始状态'),orbit);target.appendChild(head);
    for(const [name,value,desc] of metrics){const card=node('article','','emotion-card');add(card,node('strong',name),node('div',Math.max(0,Math.min(100,value))+'/100'));const meter=node('div','','emotion-meter'),fill=node('span');fill.style.width=Math.max(0,Math.min(100,value))+'%';meter.appendChild(fill);add(card,meter,info(desc));target.appendChild(card)}
    // Safe summary of actual recorded willingness decisions, not inferred "activity".
    const activity=$('emotion-agency-activity');activity.replaceChildren();
    try{
      const r=await request('/emotion-agency-activity');
      add(activity,node('strong','🐟 社交意愿如何参与最近的选择'),info('近 7 天真实意愿账本；允许 ≠ 已执行/已发送，实际操作仍需授权、额度及回执确认。'));
      const counts=r.decisions||{};
      add(activity,node('p',`有记录的评估 ${r.total||0} 次 · 愿意 ${counts.allow||0} · 推迟 ${counts.defer||0} · 拒绝 ${counts.refuse||0} · 已记录拦截 ${counts.blocked||0}`));
      const names={explore:'探索视频',publish:'公开表达',like:'点赞',collect:'收藏',follow:'关注',chat:'交流',coin:'投币请求'};
      const decisions={allow:'愿意尝试',defer:'暂缓',refuse:'选择拒绝',blocked:'被权限或能力限制'};
      const sources={'bili-comment':'B站评论','bili-dm':'B站私信'};
      for(const x of (r.recent||[]).slice(0,5)){
        const details=x.socialityAtDecision===null?'当时未记录社交意愿':`当时社交意愿 ${x.socialityAtDecision}/100（仅为参考状态）`;
        const mode=x.mode==='ai'?'AI 结合聊天上下文判断':'本地意愿评分';
        add(activity,node('p',`${new Date(x.at).toLocaleString()} · ${sources[x.source]||'社交请求'} · ${names[x.intent]||'互动'}：${decisions[x.decision]||'未确定'}。${details} · ${mode}`,'muted'));
      }
      if(!(r.recent||[]).length)add(activity,info('最近 7 天没有意愿决策记录。高社交意愿不代表必须主动发送；没有合适机会也不会凭空行动。未进入意愿评估的情况不会计入本统计。'));
    }catch{add(activity,info('暂无可读的社交意愿记录，或该功能尚未初始化。'))}
    const trend=$('emotion-trend');trend.replaceChildren();
    // All five metrics are recorded together on each real event snapshot.
    // Valence is mapped from -100..100 to the shared 0..100 chart axis only for display.
    const metricSeries=[
      {key:'sociality',label:'社交意愿',color:'#5878e8'},
      {key:'intensity',label:'情绪强度',color:'#e18a45'},
      {key:'energy',label:'活力',color:'#239b78'},
      {key:'curiosity',label:'好奇心',color:'#9564c7'},
      {key:'valence',label:'情绪正向度',color:'#cf6688',toAxis:v=>(v+100)/2},
    ];
    // Legacy rows without state snapshots are intentionally omitted; no past values are invented.
    const points=(s.history||[])
      .filter(x=>x.state&&Number.isFinite(Date.parse(x.at)))
      .map(x=>({at:Date.parse(x.at),state:x.state}))
      .sort((a,b)=>a.at-b.at).slice(-20);
    if(points.length){
      const nowMs=Date.now(),lastAt=points.at(-1).at;
      const currentState={};
      for(const metric of metricSeries)currentState[metric.key]=Number(s[metric.key]);
      if(nowMs>lastAt&&metricSeries.every(metric=>Number.isFinite(currentState[metric.key]))){
        points.push({at:nowMs,state:currentState});
      }
    }
    if(points.length>=2){
      const header=node('div','','trend-head');
      add(header,node('strong','五项指标 · 真实事件快照'),info('按真实时间间隔绘制；纵轴统一 0–100。情绪正向度原值为 -100～100，绘图时映射到 0–100；末端为当前自然衰减状态。'));
      trend.appendChild(header);
      const legend=node('div','','trend-legend');
      for(const metric of metricSeries){
        const item=node('span','','trend-legend-item'),swatch=node('span','','trend-legend-swatch');
        swatch.style.setProperty('--trend-color',metric.color);
        add(item,swatch,node('span',metric.label));legend.appendChild(item);
      }
      trend.appendChild(legend);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 600 132');svg.setAttribute('role','img');
      svg.setAttribute('aria-label',`五项真实状态指标变化，共 ${points.length} 个时间点`);
      const makeSvg=(tag,attrs,cl)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(cl)el.setAttribute('class',cl);svg.appendChild(el);return el};
      const left=34,right=590,top=13,bottom=103;
      for(const value of [100,50,0]){
        const y=bottom-value*.9;
        makeSvg('line',{x1:left,y1:y,x2:right,y2:y},'trend-grid');
        makeSvg('text',{x:2,y:y+3},'trend-axis-label').textContent=String(value);
      }
      const minT=points[0].at,maxT=points.at(-1).at;
      const xOf=at=>left+(right-left)*(at-minT)/Math.max(1,maxT-minT);
      for(const metric of metricSeries){
        const valid=points.filter(p=>Number.isFinite(Number(p.state[metric.key])));
        if(valid.length<2)continue;
        const xy=valid.map(p=>{
          const raw=Number(p.state[metric.key]);
          const normalized=Math.max(0,Math.min(100,metric.toAxis?metric.toAxis(raw):raw));
          return {x:xOf(p.at),y:bottom-normalized*.9,at:p.at,raw};
        });
        const d=xy.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const path=makeSvg('path',{d},'trend-line');path.style.setProperty('--trend-color',metric.color);
        xy.forEach(p=>{
          const dot=makeSvg('circle',{cx:p.x,cy:p.y,r:3.1},'trend-dot');dot.style.setProperty('--trend-color',metric.color);
          const tooltip=document.createElementNS('http://www.w3.org/2000/svg','title');
          tooltip.textContent=`${metric.label} · ${new Date(p.at).toLocaleString()}：${p.raw.toFixed(0)}${metric.key==='valence'?'（原始 -100～100）':''}`;
          dot.appendChild(tooltip);
        });
      }
      const startLabel=new Date(minT).toLocaleDateString(),endLabel=new Date(maxT).toLocaleDateString();
      makeSvg('text',{x:left,y:124},'trend-date-label').textContent=startLabel;
      makeSvg('text',{x:right,y:124,'text-anchor':'end'},'trend-date-label').textContent=endLabel;
      trend.appendChild(svg);
    }else trend.appendChild(info('还没有足够的真实状态快照。旧版仅记录事件强度 1～3，无法还原过去的 0–100 状态；至少出现两个新格式的真实状态快照后，五条指标曲线会一起显示。'));
    const history=$('emotion-history');history.replaceChildren();for(const row of s.history||[]){
      const card=node('article','','record');add(card,node('strong',(moodNames[row.mood]||row.label||row.mood)+' · 强度 '+row.intensity+'/3'),info(new Date(row.at).toLocaleString()+' · 来源类型：'+({dm:'私信互动',comment:'评论互动','life-reflection':'生活经历反思','social-reflection':'社交反思','owner-reset':'主人重置'}[row.source]||'内部事件')));
      const preview=row.preview,lines=[];
      if(preview?.incoming)lines.push('对方：'+preview.incoming);
      if(preview?.generated)lines.push('鱼鱼（本轮生成，非发送回执）：'+preview.generated);
      if(row.summary)lines.push('来自生活反思：'+row.summary);
      if(row.source==='dm'&&!lines.length)lines.push('私信片段不长期保存；重启后不显示原文');
      if(lines.length){const extra=node('div','','emotion-preview');for(const line of lines)extra.appendChild(node('div',line));card.appendChild(extra)}
      history.appendChild(card)
    }if(!history.children.length)history.append(info('暂无变化记录；后续互动可显示已有的简短来源片段，不会另外请求 AI。'));
  };
  const renderLifeTimeline=async()=>{
    const days=Math.max(1,Math.min(90,Number($('life-timeline-days').value)||30));const data=await request('/life-timeline?days='+days);const target=$('life-timeline-list');target.replaceChildren();
    for(const row of data.rows||[]){const card=node('article','','record');const timeLabel=row.dateOnly&&/^\d{4}-\d{2}-\d{2}$/.test(String(row.day||''))?row.day+' · 具体时刻未记录':new Date(row.at).toLocaleString();add(card,node('div',row.label+' · '+timeLabel,'title-line'),node('strong',row.title||''));if(row.detail)add(card,info(row.detail));if(row.url){const a=node('a','打开 B站视频');a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';card.appendChild(a)}target.appendChild(card)}
    const videos=(data.rows||[]).filter(row=>row.type==='video');
    const picked=videos.filter(row=>row.label==='入选视频').length;
    const rounds=(data.rows||[]).filter(row=>row.type==='video-round');
    const summary=$('life-timeline-summary');
    if(summary)summary.textContent=videos.length||rounds.length
      ?`当前范围有 ${videos.length} 条原视频账本记录（其中入选 ${picked} 条），${rounds.length} 条视频 Agent 结束回执。轮次结束不代表看完视频。`
      :'当前范围没有检索到视频记录或真实视频轮次结束回执。先检查 Life 决策全过程中的委派结果及 duty.log、seen.md；仅选择开始探索或读取 BV 元数据不会新增观看记录。';
    if(!target.children.length)target.append(info('这个时间范围内没有可展示的记录。请先确认真实视频探索已经写入判重表、视频归档或日报，再回来刷新。'));
  };
  const socialHalfLifeFields=[["socialMemoryHalfLifeNewDays", "social-memory-half-new", 1.3], ["socialMemoryHalfLifeKnownDays", "social-memory-half-known", 3], ["socialMemoryHalfLifeFamiliarDays", "social-memory-half-familiar", 10], ["socialMemoryHalfLifeFriendDays", "social-memory-half-friend", 24], ["socialMemoryHalfLifeWhitelistDays", "social-memory-half-whitelist", 30], ["socialMemoryHalfLifeOwnerDays", "social-memory-half-owner", 50]];
  const loadRelationshipSettings=async()=>{
    const {config:c={}}=await request('/config');
    for(const [key,id,def] of socialHalfLifeFields)$(id).value=String(c[key]??def);
    $('social-memory-policy-status').textContent='关系记忆参数已读取。仅保存后生效；普通记忆半衰期在「心情与记忆 → 记忆与检索设置」。';
  };
  $('social-memory-policy-save').addEventListener('click',()=>run(async()=>{
    const body={};for(const [key,id] of socialHalfLifeFields){const raw=$(id).value.trim(),v=Number(raw);if(!raw||!Number.isFinite(v)||v<.25||v>120)throw Error('关系记忆基准半衰期必须在 0.25–120 天之间');body[key]=v}
    await request('/config',body);
    await loadRelationshipSettings();await loadFriendRelationships();
    message('关系敏感记忆衰减策略已保存；只影响仍可访问的公开社交经历，不恢复已遗忘细节。');
  }));
  $('social-memory-policy-restore').addEventListener('click',()=>{
    for(const [,id,def] of socialHalfLifeFields)$(id).value=String(def);
    $('social-memory-policy-status').textContent='已填入初始建议值，尚未保存。';
  });
  let relationNextCursor='',relationSearch='',relationRows=[];
  const loadFriendRelationships=async({more=false}={})=>{
    const query=String($('friend-relationships-query').value||'').trim();
    if(!more||query!==relationSearch){relationSearch=query;relationNextCursor='';relationRows=[]}
    const params=new URLSearchParams({query:relationSearch,limit:'30'});
    if(more&&relationNextCursor)params.set('cursor',relationNextCursor);
    const data=await request('/relationships?'+params.toString());
    if(data.ok!==true)throw Error('关系索引读取失败');
    relationNextCursor=data.nextCursor||'';
    relationRows.push(...(data.rows||[]));
    const target=$('friend-relationships-list');target.replaceChildren();
    $('friend-relationships-status').textContent='已显示 '+relationRows.length+' 位联系人 · 按熟悉度排序（白名单起点更高）';
    $('friend-relationships-more').hidden=!relationNextCursor;
    for(const row of relationRows){
      const privilege=row.permissionRole==='owner'?'主人 · 稳定身份':row.whitelisted?'白名单 · 有特殊授权':'普通用户 · 权限独立';
      const card=node('article','','relation-card');
      card.dataset.stage=row.stage||'new';
      card.dataset.platform=row.platform||'bilibili';
      card.dataset.personKey=row.personKey||('bilibili:'+row.uid);
      const head=node('div','','relation-card-head');
      const nameLine=node('strong','','relation-name');
      const userLink=node('a');
      if(row.platform==='bilibili'){userLink.href='https://space.bilibili.com/'+row.uid;userLink.target='_blank';userLink.rel='noopener noreferrer'}
      const showName=name=>{userLink.textContent=(name?name+' · ':'')+(row.platformLabel||'哔哩哔哩')+' UID '+row.uid};
      showName(row.nickname||row.name);nameLine.appendChild(userLink);
      const stage=node('span',row.stageLabel||'刚认识','relation-stage');
      add(head,nameLine,stage);
      const scoreLine=node('div','','relation-score-caption');
      add(scoreLine,node('b','熟悉度 '+row.score+'/100'),node('span',privilege));
      const progress=node('div','','relation-score-track');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','关系熟悉度');progress.setAttribute('aria-valuenow',String(row.score));progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');
      const fill=node('div','','relation-score-fill');fill.style.width=Math.max(0,Math.min(100,Number(row.score)||0))+'%';progress.appendChild(fill);
      const summary=node('p',`B站已核验私信／评论互动 ${row.count} 次 · 跨 ${row.activeDays} 天 · ${row.lastAt?'最近 '+new Date(row.lastAt).toLocaleDateString():'尚无B站互动记录'}`,'relation-brief');
      const details=node('details','','relation-details');details.dataset.uid=row.uid;
      add(details,node('summary','展开人物详情 · 交流画像与互动经历'));
      const both=Number(row.incoming)>0&&Number(row.outgoing)>0;
      const backAndForth=both?'有双向交流':Number(row.incoming)>0?'以对方来访为主':Number(row.outgoing)>0?'以鱼鱼主动互动为主':'互动证据有限';
      const recencyDays=row.lastAt?Math.floor(Math.max(0,Date.now()-Number(row.lastAt))/86400000):null;
      const recentLabel=recencyDays===null?'暂无记录':recencyDays<2?'最近有互动':recencyDays<14?'近期接触过':'较久未互动';
      const impressions=both&&row.activeDays>=3?'多次双向交流，有持续交往的迹象':both?'已有双向交流，仍在相互了解':row.activeDays>=2?'在不同日期碰面过，交流深度尚不明确':'接触证据还少，暂不推断个性';
      const traits=node('div','','relation-dimensions');
      for(const [label,value] of [['🤝 往来方式',backAndForth],['🌷 关系阶段',row.stageLabel||'刚认识'],['🕒 近期活跃',recentLabel],['🔒 联系边界',privilege]]){
        const dim=node('div','','relation-dimension');add(dim,node('small',label),node('b',value));traits.appendChild(dim)
      }
      add(details,traits,info('🐟 互动印象（仅基于次数、日期和方向）：'+impressions),
        info(`往来证据：收到 ${row.incoming||0} 次 · 发出 ${row.outgoing||0} 次。公开社交经历参考半衰期 ${Number(row.publicMemoryHalfLifeDays||0).toFixed(1)} 天；不等于全部遗忘。`),
        info('统计范围：只统计当前B站账号中已核验的私信与评论；DSH 主 Session 与主人直接聊天不属于B站互动，不能据此将不同平台身份自动合并。'),
        info('性格简评：目前没有经过核实的表达证据，不会仅凭互动次数猜测陌生人的性格或好感。互动倾向与边界也不等同于熟悉度。'));
      const portrait=node('div','','relation-person-portrait');
      portrait.append(info('展开后读取此人的已核实交流画像；默认不加载其他人的私密证据。'));
      details.append(portrait);
      details.addEventListener('toggle',()=>{if(details.open)run(()=>loadPersonPortrait(row,portrait))});
      if(!row.nickname&&row.platform==='bilibili'){
        const look=btn('读取公开昵称',async()=>{
          const result=await request('/relationships/nicknames?uids='+encodeURIComponent(row.uid));
          const name=result.names?.[row.uid]||'';
          if(name){row.nickname=name;showName(name);look.remove()}else{look.textContent='暂无公开昵称';look.disabled=true}
        },'life-action life-sky');look.dataset.nicknameUid=row.uid;details.appendChild(look)
      }
      const clear=btn('清除关系元数据',async()=>{
        if(!await confirmAction({title:'请确认操作',description:'清除这位平台用户的关系统计及交流画像证据？不改变白名单权限，也不删除其他人生记忆。'}))return;
        await request('/relationships/clear',{uid:row.uid,confirm:'CLEAR_RELATIONSHIP'});
        await loadFriendRelationships();message('关系索引已清除');
      },'relation-danger');
      if(mobileViewOnly){clear.disabled=true;clear.title=mobileDesktopHint}
      add(details,clear);add(card,head,scoreLine,progress,summary,details);target.appendChild(card)
    }
    if(!relationRows.length)target.append(info('暂时还没有接触记录。鱼鱼将在真实互动后自然认识新朋友。'));
    // At most eight profile lookups per page; never trigger unbounded Bilibili
    // requests just because a large contact list was opened.
    const unresolved=(data.rows||[]).filter(r=>!r.nickname).slice(0,8);
    if(unresolved.length){
      const currentQuery=relationSearch;
      void request('/relationships/nicknames?uids='+encodeURIComponent(unresolved.map(r=>r.uid).join(',')))
        .then(result=>{
          if(currentQuery!==relationSearch||!result.ok)return;
          for(const r of unresolved){const name=result.names?.[r.uid];if(name)r.nickname=name}
          for(const link of target.querySelectorAll('a[href^="https://space.bilibili.com/"]')){
            const uid=link.href.split('/').pop(),person=relationRows.find(r=>r.uid===uid);
            if(person?.nickname&&link.closest('.relation-name')){
              link.textContent=person.nickname+' · 哔哩哔哩 ID '+uid+' · '+person.stageLabel;
              for(const button of link.closest('article')?.querySelectorAll('button[data-nickname-uid]')||[])if(button.dataset.nicknameUid===uid)button.remove();
            }
          }
        }).catch(()=>{}); // Network errors do not block relation browsing.
    }
  };
  $('life-curiosity-refresh').addEventListener('click',()=>run(renderInterests));
  $('life-curiosity-clear').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'清空当前短期好奇候选？这不会清除长期兴趣、观看证据或已排除主题。'}))return;
    await request('/main-session/interests/curiosity',{action:'clear',confirm:'REVIEW_LIFE_CURIOSITY'});
    await renderInterests();message('已清空短期候选');
  }));
  $('core-interest-save').addEventListener('click',()=>run(async()=>{const topics=$('core-interest-topics').value.split(/[\n、，,；;|]+/).map(x=>x.trim()).filter(Boolean).slice(0,12);await request('/config',{coreInterestTopics:JSON.stringify(topics)});await renderInterests();message('核心兴趣已保存；后天兴趣不会覆盖它们')}));
  $('emotion-save').addEventListener('click',()=>run(async()=>{await request('/config',{emotionSystemEnabled:$('emotion-enabled').checked});await renderEmotion();message('情绪系统设置已保存')}));
  $('emotion-reset').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'把当前模拟情绪重置为平稳？历史变化会保留。'}))return;await request('/emotion-state',{action:'reset'});await renderEmotion();await renderLifeTimeline();message('当前情绪已重置为平稳')}));
  $('emotion-recall-unlimited').addEventListener('change',()=>{$('emotion-recall-daily').disabled=$('emotion-recall-unlimited').checked});
  $('emotion-recall-save').addEventListener('click',()=>run(async()=>{
    const body={emotionRecallEnabled:$('emotion-recall-enabled').checked,emotionRecallMainEnabled:$('emotion-recall-main').checked,emotionRecallDmEnabled:$('emotion-recall-dm').checked,emotionRecallUnlimited:$('emotion-recall-unlimited').checked,
      emotionRecallDailyLimit:boundedInt('emotion-recall-daily',0,Number.MAX_SAFE_INTEGER,'每日分享上限'),emotionRecallCooldownHours:boundedInt('emotion-recall-cooldown',1,48,'评估间隔'),
      emotionRecallCandidateLimit:boundedInt('emotion-recall-candidates',1,100,'候选回忆条数'),emotionRecallHistoryLimit:boundedInt('emotion-recall-history',20,1000,'历史检索条数'),emotionRecallRecentDays:boundedInt('emotion-recall-recent-days',1,30,'事件回看天数'),emotionRecallMinAgeDays:boundedInt('emotion-recall-old-days',1,365,'旧记忆最短年龄'),emotionRecallEmotionMinIntensity:boundedInt('emotion-recall-min-intensity',1,100,'情绪最低强度'),emotionRecallEmotionMaxAgeHours:boundedInt('emotion-recall-emotion-hours',1,72,'情绪有效期'),
      emotionRecallStartHour:boundedInt('emotion-recall-start',0,23,'开始小时'),emotionRecallEndHour:boundedInt('emotion-recall-end',1,24,'结束小时')};
    if(body.emotionRecallEnabled&&body.emotionRecallUnlimited&&!await confirmAction({title:'请确认操作',description:'你选择了「不限每天发送次数」。每次仍需满足冷却、情绪、证据和授权，但可能增加模型调用或通知。确定要保存吗？'}))return;
    if(body.emotionRecallEnabled&&body.emotionRecallDmEnabled&&!await confirmAction({title:'请确认操作',description:'已确认你在「社交互动」名册中勾选的唯一授权主人 UID 正确？开启后大肥鱼可在符合条件时自主发送真实 B站私信，无需逐条确认。'}))return;
    await request('/config',body);await renderEmotion();message('情绪回忆与两个发送渠道的授权设置已保存');
  }));
  $('emotion-recall-preview').addEventListener('click',()=>run(async()=>{const r=await request('/emotion-recall',{action:'preview'});$('emotion-recall-status').textContent=r.decision?.action==='share'?`试运行建议：向 ${r.decision.channel==='main'?'主 Session':'主人 B站私信'} 分享旧记忆 ${r.decision.memoryId}（未发送）`:r.analyzed?'只做内部情绪分析（未发送）：'+(r.insight||'大肥鱼选择保持沉默'):r.skipped?'本次未进入分析：'+r.skipped:'本次决定保持沉默（未发送）';message('评估完成，没有向任何渠道发送消息')}));
  $('life-timeline-refresh').addEventListener('click',()=>run(renderLifeTimeline));$('life-timeline-days').addEventListener('change',()=>run(renderLifeTimeline));$('friend-relationships-refresh').addEventListener('click',()=>run(()=>loadFriendRelationships()));
  $('friend-relationships-more').addEventListener('click',()=>run(()=>loadFriendRelationships({more:true})));
  $('friend-relationships-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();run(()=>loadFriendRelationships())}});
  const todoTypeNames={watch_video:'看看视频',like_video:'点赞视频',inspect_my_space:'看看自己的空间投稿',inspect_creator_videos:'看看 UP 主投稿',search_videos:'搜索视频',check_notifications:'检查 B站通知',collect_video:'收藏视频',follow_creator:'关注 UP 主'};
  const todoStatusNames={open:'待处理',deferred:'稍后处理',running:'执行中',done:'已完成',dismissed:'已忽略',uncertain:'结果待核实',blocked:'受权限限制'};
  let ownerTodoFilter='active',lastOwnerTodos=null,todoPageCursor='',todoPageTrail=[],todoNextCursor=null,selectedTodoRoot='';
  const activeTodoStatuses=new Set(['open','deferred','running','uncertain','blocked']);
  const showTodoFilter=(filter)=>{
    ownerTodoFilter=filter;
    for(const value of ['active','all','finished']){
      const el=$('owner-todo-filter-'+value);
      el.classList.toggle('is-selected',value===filter);
      el.setAttribute('aria-pressed',String(value===filter));
    }
  };
  const renderTodoList=(data)=>{
    const target=$('owner-todo-list');target.replaceChildren();
    const all=data.items||[];
    const pending=all.filter(r=>activeTodoStatuses.has(r.status));
    const finished=all.filter(r=>!activeTodoStatuses.has(r.status));
    const counts=data.page?.counts||{};
    const countItems=[['待考虑',counts.open===undefined?pending.filter(r=>r.status==='open'||r.status==='blocked').length:counts.open],['稍后再看',counts.deferred??pending.filter(r=>r.status==='deferred').length],['待核实',counts.uncertain??pending.filter(r=>r.status==='uncertain').length],['已结束',counts.finished??finished.length]];
    const overview=$('owner-todo-overview');overview.replaceChildren();
    for(const [name,value] of countItems){const tile=node('div','','todo-count');add(tile,node('strong',String(value)),node('span',name));overview.appendChild(tile)}
    const rows=(data.page?all:ownerTodoFilter==='active'?pending:ownerTodoFilter==='finished'?finished:all)
      .slice().sort((a,b)=>{
        const priority={uncertain:0,open:1,blocked:2,deferred:3,running:4,done:5,dismissed:6};
        const diff=ownerTodoFilter==='all'?(priority[a.status]??9)-(priority[b.status]??9):0;
        return diff||String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''));
      });
    $('owner-todo-status').textContent=`● ${counts.active??pending.length} 件进行中 · ${counts.finished??finished.length} 件已结束`;
    $('owner-todo-status').classList.toggle('paused',(counts.active??pending.length)===0);

    // The cursor page may contain children without their (completed) parent.
    // Resolve root titles and siblings from the existing read-only status snapshot;
    // never infer relationships from a shared UID or a similar video title.
    const catalog=[...(data.allItems||[]),...all];
    const todoById=new Map(catalog.map(row=>[String(row.id),row]));
    const parentId=row=>String(row.parentTodoId||'')||
      (String(row.sourceKey||'').match(/^(?:owner-ai-watch|social-ai-watch|explore-watch):([0-9a-f-]{36}):BV[0-9A-Za-z]{10}$/i)?.[1]||'');
    const groups=new Map();
    for(const row of rows){
      const root=parentId(row)||String(row.id);
      if(!groups.has(root))groups.set(root,{id:root,parent:todoById.get(root)||null,visible:[]});
      groups.get(root).visible.push(row);
    }
    if(!groups.size){
      const empty=node('div','','todo-empty');
      empty.textContent=ownerTodoFilter==='finished'?'还没有已结束的事情。':ownerTodoFilter==='active'?'当前没有待考虑的事情。鱼鱼有空时可以再接受新的推荐。':'还没有待办。可通过主 Session 交代，或在下方手动添加。';
      target.appendChild(empty);return;
    }
    if(!groups.has(selectedTodoRoot))selectedTodoRoot=groups.keys().next().value;
    const layout=node('div','','todo-parent-child-layout');
    const parents=node('nav','','todo-parent-pane');parents.setAttribute('aria-label','父待办');
    const children=node('section','','todo-child-pane');children.setAttribute('aria-label','选中父待办与子待办');
    add(parents,node('strong','父待办 / 原始请求','todo-column-heading'));
    add(children,node('strong','关联子待办与执行记录','todo-column-heading'));
    const groupRows=group=>catalog.filter(row=>parentId(row)===group.id);
    for(const group of groups.values()){
      const root=group.parent||group.visible[0];
      const siblings=groupRows(group);
      const done=siblings.filter(row=>row.status==='done').length;
      const choice=btn((root?.title||root?.topic||'原始请求')+' · '+(todoStatusNames[root?.status]||root?.status||'待查看')+(siblings.length?' · 子任务 '+done+'/'+siblings.length:''),()=>{
        selectedTodoRoot=group.id;renderTodoList(data)
      });
      choice.classList.add('todo-parent-choice');choice.setAttribute('aria-pressed',String(selectedTodoRoot===group.id));
      parents.appendChild(choice);
    }
    const selected=groups.get(selectedTodoRoot),selectedParent=selected.parent;
    const siblings=groupRows(selected);
    const detailRows=[...(selectedParent?[selectedParent]:[]),...siblings];
    if(!detailRows.length)detailRows.push(...selected.visible);
    // A fallback for legacy tasks with absent original parent: show their actual
    // recorded child row without inventing what the owner said.
    if(!selectedParent&&siblings.length)children.appendChild(info('父待办不在最近记录中；下方显示已核实的子待办。'));
    for(const row of detailRows){
      const card=node('article','','record todo-item');card.dataset.status=row.status||'open';
      const head=node('div','','title-line');add(head,node('strong',row.title||todoTypeNames[row.type]||row.type),node('span',todoStatusNames[row.status]||row.status,'pill '+(row.status==='done'?'approved':row.status==='dismissed'?'rejected':row.status==='uncertain'?'rejected':'pending')));
      const sourceLabel=row.origin?.kind==='bilibili-comment'||['friend','stranger'].includes(row.origin?.kind)||row.origin?.kind==='owner'&&row.origin?.messageId?'来自评论互动':row.source==='recommendation'?'来自 B站用户推荐':row.origin?.kind==='owner-dm'?'来自主人私信':'来自主 Session / 手动安排';
      add(card,head,info(`${todoTypeNames[row.type]||row.type} · ${sourceLabel}${row.bvid?' · '+row.bvid:''}${row.uid?' · UID '+row.uid:''}${row.topic?' · '+row.topic:''}`));
      if(row.origin?.kind==='bilibili-dm'){
        const sender=row.origin.senderName||'UID '+(row.origin.uid||'未知');
        add(card,info('来自 B站私信 · '+sender+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText){const details=node('details'),summary=node('summary','查看原始推荐内容');add(details,summary,node('blockquote',row.origin.quotedText,'todo-origin-quote'));add(card,details)}
        if(row.origin.messageId)add(card,info('原消息 ID：'+row.origin.messageId));
      } else if(row.origin?.kind==='owner-dm'){
        add(card,info('来源：已验证主人 UID 的 B站私信（只读任务）'+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText){const details=node('details');add(details,node('summary','查看主人原话'),node('blockquote',row.origin.quotedText,'todo-origin-quote'));add(card,details)}
      } else if(row.origin?.kind==='owner-session'){
        add(card,info('来源：主人在主 Session 安排'+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText){const details=node('details');add(details,node('summary','查看主人原话'),node('blockquote',row.origin.quotedText,'todo-origin-quote'));add(card,details)}
      } else if(row.origin?.kind==='owner')add(card,info('来源：主人在管理中心添加'));
      if(row.planningHint&&['open','deferred'].includes(row.status)){
        const h=row.planningHint;
        const relation=Number(h.relationshipContribution||0),base=Number(h.identityContribution||0),recent=Number(h.recencyContribution||0),wait=Number(h.waitingContribution||0);
        const box=node('details','','todo-planning-hint');
        add(box,node('summary',`💞 关系与待办优先参考 · ${h.priorityHint} 分（熟悉度贡献 +${relation}）`));
        const explanation=node('div','','todo-score-breakdown');
        for(const [label,value] of [['关系熟悉度',`+${relation}（${h.relationshipScore||0}/100 · ${h.relationshipStage||'new'}）`],['身份起点',`+${base}`],['近期程度',`+${recent}`],['等待补偿',`+${wait}`]]){
          const chip=node('span',label+' '+value,'todo-score-chip');explanation.appendChild(chip)
        }
        add(box,explanation,info('这只是候选展示与自主考虑顺序的参考。鱼鱼仍能拒绝、延期或保持沉默；关系不授予操作权限。'));
        card.appendChild(box)
      }
      if(row.note)add(card,info(row.note));
      if(row.dueAt&&row.status==='deferred')add(card,info('计划再考虑：'+new Date(row.dueAt).toLocaleString('zh-CN',{hour12:false})));
      if(row.resultSummary)add(card,info('上次结果：'+row.resultSummary));
      if(row.lastError)add(card,info('最近错误：'+row.lastError));
      const actions=node('div','','actions');
      if(['open','deferred'].includes(row.status)){
        add(actions,btn('明天再看',async()=>{await request('/owner-todos',{action:'update',id:row.id,change:'defer',hours:24});await loadOwnerTodos()}),btn('不再考虑',async()=>{await request('/owner-todos',{action:'update',id:row.id,change:'dismiss'});await loadOwnerTodos()},'danger'));
      } else if(row.status==='blocked')add(actions,btn('确认后重新打开',async()=>{if(!await confirmAction({title:'请确认操作',description:'上次只读执行中断，确认重新开始？'}))return;await request('/owner-todos',{action:'update',id:row.id,change:'reopen'});await loadOwnerTodos()}));
      else if(row.status==='uncertain') add(actions,btn('重新打开（先核实）',async()=>{if(!await confirmAction({title:'请确认操作',description:'请先核实 B站实际状态。确认后重新打开，避免重复点赞/收藏/关注。继续？'}))return;await request('/owner-todos',{action:'update',id:row.id,change:'reopen'});await loadOwnerTodos()}));
      if(Array.isArray(row.history)&&row.history.length){const details=node('details'),summary=node('summary','查看状态变化');add(details,summary);for(const h of row.history.slice(-6))add(details,info(`${h.at?new Date(h.at).toLocaleString('zh-CN',{hour12:false}):'未知时间'} · ${todoStatusNames[h.from]||h.from||'已接收'} → ${todoStatusNames[h.to]||h.to||''}${h.reason?' · '+h.reason:''}`));add(card,details)}
      if(actions.children.length)add(card,actions);
      children.appendChild(card);
    }
    add(layout,parents,children);target.appendChild(layout);
  };
  const loadUnifiedLifeSettings=async()=>{
    // Phase 6: an independent, versioned facade over the SAME config.
      // A failed read never hides existing TODOs or changes any permission.
      try{
        const v2=await request('/life-agent/settings-v2');const settings=v2.settings||{};
        $('life-v2-mode').value=settings.mode||'off';
        const paceSelect=$('life-v2-pace');
        for(const opt of [...paceSelect.options])if(opt.dataset.legacySelected==='true')opt.remove();
        const savedPace=settings.pace||'custom';
        if(![...paceSelect.options].some(opt=>opt.value===savedPace)){
          const legacy=document.createElement('option');legacy.value=savedPace;
          legacy.textContent='保留当前历史设置（未更改）';legacy.dataset.legacySelected='true';
          paceSelect.appendChild(legacy);
        }
        paceSelect.value=savedPace;
        $('life-legacy-pace-note').hidden=!savedPace.startsWith('legacy-');
        $('life-v2-mode').dataset.revision=settings.revision||'';
        const budget=settings.budget||{};
        for(const [id,value] of [['life-v2-minutes',budget.minutes??60],['life-v2-limit',budget.dailyLimit??12],
          ['life-v2-start',budget.startHour??9],['life-v2-end',budget.endHour??23]])$(id).value=String(value);
        $('life-settings-advanced').open=settings.pace==='custom';
        const names={off:'暂停',shadow:'观察',active:'自主生活'};
        const driver=settings.driverOwnership?.videoWakeOwner==='life-agent'?'Life Agent':'暂无自动视频驱动';
        $('life-v2-status').textContent=`已保存：${names[settings.mode]||'暂停'} · 活跃程度 ${({quiet:'安静',natural:'自然',lively:'活跃',custom:'自定义','legacy-quiet':'历史设置','legacy-natural':'历史设置','legacy-lively':'历史设置'})[settings.pace]||'自定义'}。`+(settings.mode==='off'&&settings.plannerEnabled?'当前仍检测到历史调度，请再次保存「暂停」使其停止。':'社交回复仍遵循单独的授权设置。');
        try{
          const sharing=await request('/social-intentions');
          const shares=(sharing.items||[]).filter(x=>x.type==='interest-share');
          $('life-link-sharing').textContent=(sharing.paused?'暂不可主动推荐':'按已授权朋友与兴趣筛选')+' · 最近草稿 '+shares.filter(x=>x.status==='draft').length+' 条 / 已发 '+shares.filter(x=>x.status==='sent').length+' 条；仍是独立受限发送链路。';
        }catch{$('life-link-sharing').textContent='视频分享状态暂不可用；不代表已获得发送授权';}
        try{
          const audit=await request('/life-agent/transition-readiness');
          const labels={'legacy-video-clock':'旧视频定时器','life-settings':'新生活配置',
            'life-events':'生活事件账本','legacy-social-owner':'社交唯一决策者',
            'handoff-ledger':'交接在途记录','send-ledger':'发送事务','social-shadow-sampling':'影子配对样本',
            'causal-growth':'经历驱动的成长','legacy-social-retirement':'旧社交决策退役',
            'cold-backup-restore':'冷备份恢复','windows-real-model-bilibili':'Windows／B站实测'};
          const icons={passed:'✓',attention:'!',unknown:'?',pending:'…'};
          $('life-transition-status').textContent=(audit.checks||[]).map(x=>
            `${icons[x.status]||'?'} ${labels[x.id]||x.id}：${x.detail}`).join(' · ')
            +'。'+(audit.guidance||'')+' 本页不代表准许发布。';
          const rcList=$('life-rc-questions');
          const rcStatus={partial:'部分可用',unproven:'尚无真实证明','needs-review':'等待使用者验收'};
          rcList.replaceChildren();
          for(const q of audit.rc?.questions||[]){
            const li=document.createElement('li');
            li.textContent=`${q.title}【${rcStatus[q.status]||'待核查'}】${q.detail}`;
            rcList.appendChild(li);
          }
          if(!rcList.childElementCount){const li=document.createElement('li');li.textContent='无法确认 RC 检查结果，不能视为验收通过。';rcList.appendChild(li);}
        }catch{$('life-transition-status').textContent='迁移状态读取失败；无法确认社交发送安全，不应视为验收通过。'}

      }catch(e){$('life-v2-status').textContent='统一生活设置读取失败：'+String(e?.message||e).slice(0,90)}
  };
  const loadOwnerTodos=async({reset=false}={})=>{
    if(reset){todoPageCursor='';todoPageTrail=[]}
    const data=await request('/owner-todos');
    const page=await request('/owner-todos/page?filter='+encodeURIComponent(ownerTodoFilter)+'&limit=20'+(todoPageCursor?'&cursor='+encodeURIComponent(todoPageCursor):''));
    const intake=(data.socialTodoIntakeRecent||[]).slice(-5).reverse();
    const intakeNames={created:'已建立待办',duplicate:'重复消息未重复建待办','partial-created':'部分入队，另有候选未通过核验','model-revised':'已由模型自行修订回复','suppressed-unverified':'承诺或事实未获核实，已停止外发','model-revision-failed':'模型修订失败，未使用程序代写','no-proposal':'AI 未提出待办','model-defer':'鱼鱼决定延期','model-refuse':'鱼鱼决定拒绝','topic-not-grounded-in-user-evidence':'候选主题缺少用户证据','evidence-not-in-current-user-message':'AI 引用的消息证据未通过','missing-ai-candidate':'AI 接受但未提供候选','unverified-event':'原消息未通过来源/时间校验','willingness-defer':'自主意愿延期','willingness-denied':'自主意愿未通过'};
    $('owner-todo-intake-status').textContent=intake.length?'最近社交 AI 待办判断（仅本次运行）：'+intake.map(x=>`${x.channel==='comment'?'评论':'私信'} ${intakeNames[x.outcome]||x.outcome}`).join('；'):'社交 AI 待办识别：本次运行尚无判断记录；未开启或被额度拦截的消息不会进入 AI。';
    data.allItems=data.items;data.items=page.items;data.page=page;lastOwnerTodos=data;todoNextCursor=page.nextCursor;
    $('owner-todo-prev').disabled=todoPageTrail.length===0; $('owner-todo-next').disabled=!todoNextCursor;
    $('owner-todo-page-info').textContent=`第 ${todoPageTrail.length+1} 页 · 共 ${page.total} 件`;
    $('owner-todo-completion-followup').value=data.config?.completionFollowup?'true':'false';
    $('social-todo-completion-followup').value=data.config?.socialCompletionFollowup?'true':'false';
    for(const [id,value] of [
      ['owner-todo-followup-cooldown',data.config?.followupCooldownMinutes??60],
      ['owner-todo-followup-daily-limit',data.config?.followupDailyLimit??12],
      ['owner-todo-followup-min-interval',data.config?.followupMinIntervalMinutes??5],
      ['owner-todo-followup-poll',data.config?.followupPollMinutes??2],
      ['owner-todo-followup-quiet-start',data.config?.followupQuietStartHour??22],
      ['owner-todo-followup-quiet-end',data.config?.followupQuietEndHour??9]])$(id).value=String(value);
    $('owner-todo-followup-quiet-enabled').value=data.config?.followupQuietEnabled!==false?'true':'false';
    $('owner-todo-followup-status').textContent=`待回访：${data.followup?.pending??0} 条 · 检查间隔：${data.config?.followupPollMinutes??2} 分钟 · 下次检查：${data.config?.followupNextAt?formatLocalTime(new Date(data.config.followupNextAt).toISOString()):'暂未安排'} · 最近检查：${data.followup?.lastCheck?.at?formatLocalTime(new Date(data.followup.lastCheck.at).toISOString())+' · ':''}${data.followup?.lastCheck?.reason||'尚未检查'}`;
    $('owner-todo-followup-detail').replaceChildren(...(data.followup?.recent||[]).slice(-8).reverse().map(row=>{
      const line=node('p');
      const source=row.parentTitle||row.topic||'尚未找到对应父待办';
      const ids=row.groupRoot||row.taskId||'';
      const state=row.status==='pending'?'待鱼鱼自主决定':row.status==='sent'?'已收到平台发送回执':row.status==='merged'?'已并入父请求':row.status==='uncertain'?'发送结果不确定，禁止重发':row.status;
      const why=row.nextEligibleAt&&row.nextEligibleAt>Date.now()?'本轮未到重新考虑时间（点检查不会跳过延期）':row.lastCheckReason||row.reason||'';
      const decisionNote=row.lastDecisionMode==='debug'?' · 最近由 DEBUG 决定 '+({reply:'愿意回访',defer:'延期',skip:'保持沉默','reply-without-grounded-text':'没有可发送的可靠文字'}[row.lastDecision]||row.lastDecision)+(row.lastModelInvoked===false?'（模型未成功调用）':''):'';
      line.textContent=`来自待办「${source}」${ids?'（'+ids.slice(0,8)+'）':''} · ${row.uid||'未知UID'} · ${row.channel==='comment'?'原评论':'私信'} · ${state}${row.groupTotal?' · 子待办已完成 '+(row.groupDone||0)+'/'+row.groupTotal:''} · ${why}${row.nextEligibleAt?' · 预计重新考虑 '+formatLocalTime(new Date(row.nextEligibleAt).toISOString()):''} · ${row.eligibility||''}${decisionNote}`;
      if(row.status==='pending'&&row.key){
        const debugButton=btn('DEBUG 此条：忽略延期重新询问',async()=>{
          if(!await confirmAction({title:'请确认操作',description:'仅针对待办「'+source+'」询问鱼鱼一次（可能直接发送）；忽略自主延期时间，但仍检查权限、限额、夜间静默、去重和回执。可能产生模型费用。继续？'}))return;
          const result=await request('/owner-todos/followup',{action:'debug-reconsider',key:row.key});
          await loadOwnerTodos();message(debugFollowupMessage(result));
        });line.appendChild(debugButton);
      }
      if(row.manualRetryable&&row.key){
        const retry=btn('复核后重新考虑（不会立即发送）',async()=>{
          if(!await confirmAction({title:'请确认操作',description:'这条记录曾因旧私信开关误拦截。仅在确认原私信和任务来源无误时继续；鱼鱼仍可选择不发。确定重新考虑？'}))return;
          const result=await request('/owner-todos/followup',{action:'retry',key:row.key});
          await loadOwnerTodos();message(result.note||'已重新排入待考虑队列');
        });line.appendChild(retry)
      }
      return line
    }));
    $('life-social-context-optin').value=data.config?.lifeAgentSocialContextOptIn===true?'true':'false';
    $('life-social-context-optin').dataset.loaded=$('life-social-context-optin').value;
    try{
      const sched=await request('/autonomous-planner');
      const previous=(sched.recent||[]).slice().reverse().find(x=>x.action==='consider_children');
      const stopReasons={quota:'今日模型决策额度耗尽','fish-chose-silence':'鱼鱼主动选择暂不继续','no-pending-children':'没有到期且符合主题的子待办','mixed-provenance':'同组来源校验失败','child-changed':'子待办状态已发生变化','willingness-declined':'执行前意愿复核未通过'};
      const lastChild=previous?' · 最近子待办：'+(previous.result||'已考虑')+(previous.reason?'（'+(stopReasons[previous.reason]||previous.reason)+'）':''):'';
      $('autonomous-planner-status').textContent=`独立调度：今日决策 ${sched.runs||0} 次 · 最近 ${sched.lastResult||'尚未运行'}${lastChild}${sched.lastError?' · 错误：'+sched.lastError:''}`;
      const life=sched.lifeEvents||{};
      const readiness=sched.experienceReadiness||{};
      const blockNames={
        'master-off':'生活总开关关闭','planner-off':'自主调度开关关闭','not-life-mode':'当前为传统模式',
        'shadow-no-video':'影子模式不允许自动启动真实视频 Agent',
        'model-quota':'每日自主模型决策额度不足','planner-run-lease-held':'Life 决策正在进行或异常中断，需查看运行租约','event-ledger-unavailable':'当前账号生活事件账本不可用',
        'no-video-capability':'原视频 Agent 当前不可委派（可能忙碌、账号或视频额度不允许）',
        'video-day-limit':'Life Agent 当日视频启动达到 2 次',
        'video-cooldown':'距上次 Life Agent 视频启动还不到 180 分钟'
      };
      $('life-readiness').textContent=readiness.mode
        ?`生活模式 ${readiness.mode} · 自主决策额度剩余 ${readiness.remainingDecisions}/${readiness.dailyDecisionLimit} · 当前可用的视频 Agent 能力 ${readiness.offeredVideoCapabilities||0} · 匿名待考虑事件 ${readiness.pendingEvents||0}。${readiness.videoDelegationEligible?'视频委派的初步门禁已通过，但是否启动仍由鱼鱼决定；需要有实际候选且模型成功选择。':'本轮不能通过 Life Agent 自动启动视频：'+(readiness.blockers||[]).map(x=>blockNames[x]||x).join('；')}`
        :'真实门禁状态不可用（请检查当前账号及调度日志）';
      const recentDelegations=(life.timeline||[]).filter(e=>e.result==='capability-launched');
      const rounds=Array.isArray(life.recentVideoRounds)?life.recentVideoRounds:[];
      const roundCounts={completed:rounds.filter(x=>x.state==='completed').length,failed:rounds.filter(x=>x.state==='failed').length,
        interrupted:rounds.filter(x=>['interrupted','unverified-interruption'].includes(x.state)).length,
        running:rounds.filter(x=>x.state==='started').length};
      const lastRound=rounds[0];
      const roundStatus=lastRound?`最近一轮（${new Date(lastRound.startedAt).toLocaleString()}）：${{
        completed:'进程正常结束',failed:'进程失败退出',interrupted:'进程异常中断',
        'unverified-interruption':'旧进程是否结束未能确认',started:'尚在运行或等待退出回执'}[lastRound.state]||'待核查'}${lastRound.state==='failed'&&Number.isSafeInteger(lastRound.exitCode)?`（退出码 ${lastRound.exitCode}）`:''}${lastRound.state==='completed'?(lastRound.pickedCount===null?'，入选数未核实':`，原账本新增入选 ${lastRound.pickedCount} 条`):''}。`:'';
      $('life-actual-proof').textContent=`本账号今日 Life Agent 委派原视频 Agent ${life.videoStartsToday||0} 次（上限 2 次）；近 7 天记录到委派 ${recentDelegations.length} 次。最近有真实子进程回执：正常结束 ${roundCounts.completed}、失败 ${roundCounts.failed}、中断/待核实 ${roundCounts.interrupted}、启动待结束 ${roundCounts.running}。${roundStatus}委派和进程结束均不等于已看完或听过作品。${(life.videoStartsToday||0)===0&&!rounds.length?'目前还没有通过这条新路径启动视频的证据。':''}`;
      const lease=sched.runLease||{};
      const feedbackAt=readiness.videoFeedbackEarliestAt;
      const videoFeedbackNote=life.pendingVideoFollowup?` · 视频结束后续待考虑 ${life.pendingVideoFollowup}${readiness.blockers?.includes('video-agent-busy')?'（视频 Agent 忙，等待空闲）':Number.isSafeInteger(feedbackAt)&&feedbackAt>Date.now()?'（最早 '+new Date(feedbackAt).toLocaleString()+'）':'（等待下一次合规生活决策或能力恢复）'}；不提前消耗模型额度`:'';
      const lifeUnselectedNote=life.unselectedWaiting?` · 本轮未轮到、等待再考虑 ${life.unselectedWaiting}（不代表主动拒绝或技术失败）`:'';
      const lifeRetryNote=life.retryable?` · 失败待重试 ${life.retryable}（下次 ${life.nextRetryAt?new Date(life.nextRetryAt).toLocaleString():'到期后'}）`:'';
      const lifeReviewNote=life.needsReview?` · 执行结果待人工核验 ${life.needsReview}（不会自动重试；先查平台回执和本地账本）`:'';
      const lifeFailedNote=life.failed?` · 重试次数已用尽 ${life.failed}（不会自动重发或重启，需要检查诊断）`:'';
      const lifeLeaseNote=lease.needsReview?' · 决策租约残留，需要停机人工复核':lease.held?' · Life Agent 正在另一轮决策中':'';
      $('life-agent-status').textContent=`模式：${sched.lifeAgentMode||'off'} · 待考虑匿名事件 ${life.pending||0} · 其中待考虑社交 ${life.pendingSocial||0}${lifeRetryNote}${lifeUnselectedNote}${videoFeedbackNote}${lifeFailedNote}${lifeReviewNote}${lifeLeaseNote} · 本日自主启动视频 ${life.videoStartsToday||0}/2 · 决策输入/输出字符 ${sched.modelInputChars||0}/${sched.modelOutputChars||0}（不是实际 Token）`+(sched.lifeAgentMode==='shadow'?' · 影子模式只记录选择，绝不启动新的视频轮':'')+(life.ok===false?' · 当前账号事件读取异常，请检查运行诊断':'');
      await loadUnifiedLifeSettings();
      const preview=sched.lifeSettingsPreview||{};
      $('life-settings-preview').textContent=preview.readOnly===true?`生活运行状态：${preview.life?.mode||'off'} · 自动视频启动仅由 Life Agent 决定 · 旧谷时定时器已退役 · 原社交发送许可不变 · 每日模型上限 ${preview.budget?.decisionsPerDay??0} 次`:'生活设置状态不可用';
      const socialOwner=sched.socialDecisionOwnership||{};
      const shadow=sched.socialShadow||{};
      const fence=socialOwner.handoffFence||{};
      const sendTx=sched.socialSendTransaction||{};
      const handoffReadiness=socialOwner.handoffReadiness||{};
      const readinessSummary=()=>{
        const labels={'account-scope-unavailable':'账号未核验','life-not-active':'Life 未在 active 模式',
          'verified-social-context-not-opted-in':'社交只读上下文未授权',
          'shadow-evidence-insufficient':'近期分类对照样本不足',
          'handoff-fence-unavailable':'交接存储不可检查','handoff-reservation-held':'交接预约被占用',
          'legacy-operation-in-flight':'旧社交操作仍在途','legacy-operation-review-required':'旧操作异常残留待复核',
          'send-transaction-inspection-unavailable':'发送事务账本不可检查',
          'send-transaction-review-required':'存在发送结果不确定／事务残留',
          'life-social-sender-not-installed':'尚未接线 Life 正式社交执行器',
          'life-production-requires-real-platform-acceptance':'Life 渠道待真实平台验收'};
        return ['dm','comment'].map(ch=>{
          const row=handoffReadiness.channels?.[ch];
          const reasons=(row?.preflightBlockers||[]).map(x=>labels[x]||'需要人工核实').slice(0,5);
          return (ch==='dm'?'私信':'评论')+'（'+(row?.owner==='life-agent'?'Life 决策归属':'等待迁移（旧发送已冻结）')+'）：'+(reasons.join('、')||'需要完成真实平台验收');
        }).join('；');
      };
      const fenceSummary=()=>{
        if(fence.ok===false)return ' · 交接隔离存储异常（安全阻止；请检查本地数据目录）';
        if(fence.accountReady===false)return ' · 交接隔离：账号未核实';
        const lanes=fence.channels||{},blocked=['dm','comment'].filter(c=>lanes[c]?.held);
        const inFlight=['dm','comment'].map(c=>`${c==='dm'?'私信':'评论'} ${lanes[c]?.inFlight||0}（需复核 ${lanes[c]?.inFlightNeedsReview||0}）`).join('、');
        return (blocked.length?' · 交接排他预约阻止：'+blocked.map(c=>c==='dm'?'私信':'评论').join('、')+'（不能自动解除；请停机核对）':
          ' · 交接排他预约无阻塞（不代表已授权接管）')+' · 在途旧决策／发送：'+inFlight+'；只有预约已阻止新任务且在途为零才可能进一步人工验收交接';
      };
      const sendSummary=()=>{
        if(sendTx.ok===false)return ' · 逐消息事务存储检查失败，请停止外发并检查本地数据目录';
        if(sendTx.accountReady===false)return ' · 逐消息事务：未核实登录账号';
        const read=c=>sendTx.channels?.[c]||{};
        const fmt=c=>{const x=read(c);return `确认 ${x.confirmed||0}、待核实 ${x.uncertain||0}、发送中／残留 ${x.attempted||0}、不完整 ${x.incomplete||0}`};
        return ` · 逐消息匿名发送事务：私信（${fmt('dm')}），评论（${fmt('comment')}）。不确定结果不得自动重发，也不授予 Life Agent 发送权`;
      };
      const compareChannel=(key,name)=>{const c=shadow.byChannel?.[key]||{};return `${name}：配对 ${c.paired||0}（一致 ${c.agreed||0}、分歧 ${c.disagreed||0}），仅旧方 ${c.awaitingLife||0}、仅鱼鱼 ${c.awaitingLegacy||0}`};
      $('life-social-shadow-status').textContent=shadow.enabled===true
        ?`只读影子对照已授权 · 10 分钟窗口内临时事件 ${shadow.staged||0} · ${compareChannel('dm','私信')} · ${compareChannel('comment','评论')}。未配对不代表选择沉默；这里只比对分类，不是实际发送，也未开放社交接管。`
        :'影子上下文关闭：仅匿名社交事件；不读取聊天正文、不增加模型调用';
      $('life-social-ownership').textContent=socialOwner.ok===true
        ?`社交统一归属：${socialOwner.socialDecisionOwner==='life'?'Life 已管理私信与评论（实际发送仍受各项授权与回执约束）':socialOwner.socialDecisionOwner==='migration-pending'?'正在等待安全迁移；旧自动回复不作为兜底，相关外发冻结':'归属待复核，禁止自动发送'} · 本进程核验事件 私信 ${socialOwner.observedVerified?.dm||0}、评论 ${socialOwner.observedVerified?.comment||0} · 安全核查：${readinessSummary()}${fenceSummary()}${sendSummary()}`
        :'社交回复所有权诊断暂不可用（不代表 Life Agent 已接管社交）';
      const timeline=$('life-agent-timeline');timeline.replaceChildren();
      const actionLabels={skip:'本轮未执行动作',consider_social:'注意到了交流信号',use_capability:'考虑委派视频探索',begin_exploration:'产生自主探索意愿',inspect_exploration:'继续核实探索',inspect_creator_space:'进一步了解作者',abandon_exploration:'主动放下探索',inspect_opportunity:'核实生活契机',review_public:'复核公开交流证据',defer:'暂缓',dismiss:'放下',reflect:'尝试反思',execute_read:'选择处理已接受的只读待办'};
      const optionLabels={todos:'已接受待办',cues:'生活线索',intentions:'跨轮意愿',opportunities:'真实契机',social:'社交信号',video:'视频能力',reflection:'反思',affinity:'可信共同兴趣参考（非行动依据证明）',relationship:'关系排序参考（非发送权）'};
      const blockerLabels={'video-launch-cooldown':'视频还在 180 分钟启动间隔内','video-daily-limit':'视频今日启动额度已满','video-agent-busy':'视频 Agent 子进程正在运行，后续反馈保留到空闲','video-capability-unavailable':'当前没有可用视频能力','no-verified-candidates':'没有经过核实的候选'};
      const kindLabels={'dm-received':'收到私信','comment-received':'收到评论','video-round-ended':'视频轮结束','quiet-window':'生活空档','manual-wake':'人工唤醒','exploration-ready':'此前探索已核实，可继续考虑真正的视频轮'};
      const resultLabels={'metadata-read-failed':'视频元数据读取失败，未获得真实回执','shadow-would-explore':'影子意愿，未启动','capability-launched':'已委派原视频 Agent（不等于已观看）','capability-not-started':'未能启动视频 Agent','video-explore-blocked':'授权／额度复核阻止','social-signal-considered':'只注意到匿名事件，尚未读取内容或回复','social-shadow-reply':'读到临时授权上下文，影子倾向回复（未发送）','social-shadow-defer':'影子选择延期（未发送）','social-shadow-silent':'影子选择沉默（未发送）','social-shadow-quota':'影子对照因每日决策额度不足未运行','social-shadow-invalid':'影子模型输出不合规，没有行动','social-shadow-revoked':'影子读取授权已撤回或上下文过期','verified-metadata':'视频资料已核实（不等于看过；后续可重新考虑是否委派视频 Agent）','execution-failed':'执行失败','no-action-receipt':'尚无实际执行回执','invalid-decision':'模型选择无效或返回格式错误（不是自愿休息）','voluntary-rest':'模型明确选择休息（未执行）','no-actionable-options':'缺少通过验证的可执行候选；没有调用模型，也没有消耗决策额度','model-or-execution-error':'模型调用或执行失败（不是自愿休息；若已尝试工具需核验回执）','willingness-recheck-blocked':'执行前意愿复核不通过','reflection-not-available':'可反思证据不足'};
      for(const e of (life.timeline||[]).slice(0,15)){
        const source=(e.kinds||[]).map(k=>kindLabels[k]||'匿名契机').join('、')||'已有意愿／待办／反思';
        const headline=`${formatLocalTime(new Date(e.at).toISOString())} · ${source} → ${actionLabels[e.action]||'选择已允许的行动'}`;
        const detail=e.failed?'模型或执行发生错误；具体原因请看调度状态':(resultLabels[e.result]||(e.result==='no-action-receipt'&&e.action==='skip'?'历史记录：无法判断是主动休息还是格式错误':('状态：'+String(e.result||'暂无').replace(/[^a-z0-9-]/g,''))));
        const counts=e.options&&typeof e.options==='object'?Object.entries(optionLabels).filter(([k])=>Number(e.options[k])>0).map(([k,v])=>v+' '+e.options[k]):[];
        const choiceText=e.options?(' · 本轮候选：'+(counts.length?counts.join('、'):'无')):'';
        const blockerText=e.blocker&&blockerLabels[e.blocker]?' · '+blockerLabels[e.blocker]:'';
        const refs=Array.isArray(e.eventRefs)?e.eventRefs.filter(x=>/^[a-f0-9]{16}$/.test(x)).slice(0,4):[];
        const card=node('article',headline+' · '+detail+choiceText+blockerText+(refs.length?' · 关联事件 '+refs.join('、'):'')+(e.selectedSocialKind?' · 本轮真正关注：'+(kindLabels[e.selectedSocialKind]||'匿名事件'):'')
          +(e.notSelectedWaiting?' · 另有 '+e.notSelectedWaiting+' 条线索暂未选中，等待有限重考虑':'')
          +(e.reviewEvents?' · '+e.reviewEvents+' 条执行结果不明，冻结待核查':'')
          +(e.videoRoundFeedbackOffered?' · 本轮向鱼鱼提供了真实视频子进程回执（不证明她实际看过、听过或采纳该证据）':'')+(e.continued?' · 同一意愿的后续考虑':'')+(e.sharedInterestRead?' · 本轮完成了共同兴趣线索的只读核实（非人格变化证明）':'')+(e.relationshipTaskDone?' · 已完成有关系排序参考的只读待办（非主动联系）':'')+(e.relationshipRankShift?' · 关系参考改变了候选排序（非模型选择因果证明）':'')+(e.verifiedReadKind?' · 本轮真实只读回执：'+({ 'todo-read':'已接受任务成功读取','video-metadata':'公开视频元数据核实','public-evidence':'公开交流证据复核'}[e.verifiedReadKind]||'')+'（不等于看过或听过）':'')+((e.priorVerifiedReadOffered||e.priorVerifiedReadReferenced)?' · 本轮向模型提供了前轮可信只读经历类别（无法证明模型采纳或人格成长）':'')+(e.mode==='shadow'?' · 影子模式':''),'life-decision-record');
        add(timeline,card);
      }
      if(!timeline.childElementCount)add(timeline,node('p','尚无本账号最近 7 天的自主决策记录。可以点击「让鱼鱼自主考虑一次」；如果没有候选或额度耗尽，模型可能不会启动。','muted'));

      $('autonomous-planner-next').textContent='预计下次自动决策：'+(sched.nextDecisionAt?formatLocalTime(new Date(sched.nextDecisionAt).toISOString()):'未安排（可能尚未开启或今日额度为零）')+'。本日生活决策 '+(sched.lifeRuns??sched.runs??0)+'/'+(data.config?.plannerDailyLimit??4)+' 次，社交只读快速关注 '+(sched.socialRuns||0)+'/'+(sched.socialDailyLimit||24)+' 次，总模型预约 '+(sched.runs||0)+'/'+(sched.dailyGlobalLimit||288)+' 次；社交由 Life 统一归属管理，迁移未完成时冻结外发；视频启动另有限制。只表示下一次检查机会，不保证执行。';
    }catch{$('autonomous-planner-status').textContent='无法读取调度状态';$('autonomous-planner-next').textContent='预计下次自动决策：暂不可用';$('life-agent-status').textContent='Life Agent 状态暂不可用';$('life-readiness').textContent='真实状态无法核查';$('life-actual-proof').textContent='真实委派结果无法核查';$('life-settings-preview').textContent='设置预览暂不可用';$('life-agent-timeline').textContent='时间线暂不可用（请检查账号和调度状态）';$('life-social-ownership').textContent='社交回复所有权诊断暂不可用';$('life-social-shadow-status').textContent='影子对照状态暂不可用'}
    renderTodoList(data);
  };
  for(const filter of ['active','all','finished'])$('owner-todo-filter-'+filter).addEventListener('click',()=>{
    showTodoFilter(filter);run(()=>loadOwnerTodos({reset:true}));
  });
  $('owner-todo-refresh').addEventListener('click',()=>run(()=>loadOwnerTodos({reset:true})));
  const debugFollowupMessage=result=>{
    if(result.status==='sent')return 'DEBUG：鱼鱼决定回访，平台确认发送成功';
    if(result.status==='uncertain')return 'DEBUG：尝试发送，但回执不确定，禁止自动重试';
    if(result.decision==='skip')return 'DEBUG：鱼鱼决定保持沉默，已结束这条回访';
    if(result.decision==='defer'||result.decision==='reply-without-grounded-text')return 'DEBUG：'+(result.modelInvoked===false?'本轮未成功调用模型；':'已重新询问鱼鱼；')+(result.diagnosticReason||result.skipped||'鱼鱼选择稍后考虑');
    return 'DEBUG：'+(result.skipped||result.error||'没有发送，查看对应待办的检查原因');
  };
  $('owner-todo-followup-debug').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'DEBUG 会跳过延期时间，让鱼鱼重新决定一次；如果有多条待回访，需要使用每条记录旁的 DEBUG 按钮指定对象。不是模拟测试：确认安全校验后可能真正发消息。继续？'}))return;
    const result=await request('/owner-todos/followup',{action:'debug-reconsider'});
    await loadOwnerTodos();message(debugFollowupMessage(result));
  }));
  $('owner-todo-followup-check').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'立即执行一次回访检查：鱼鱼可能自主选择发送，仍受发送权限、限额和去重保护。继续？'}))return;
    const result=await request('/owner-todos/followup',{action:'check'});
    await loadOwnerTodos();message(result.status==='sent'?'平台已确认发送':result.skipped?'本轮未发送：'+result.skipped:'回访检查已完成');
  }));
  $('owner-todo-remind').addEventListener('click',()=>run(async()=>{
    const button=$('owner-todo-remind');button.disabled=true;
    try{
      const result=await request('/autonomous-planner/remind',{});
      await loadOwnerTodos({reset:true});
      const messages={'nothing-to-do':'当前没有合适的已接受只读待办',quota:'今日自主决策额度已用完',busy:'鱼鱼正在考虑其他事情',disabled:'鱼鱼生活功能尚未开启'};
      message(result.skipped?messages[result.skipped]||('这轮跳过：'+result.skipped):
        `已提醒鱼鱼考虑一次：${result.action==='execute_read'?'她选择处理只读待办':result.action==='defer'?'她决定延期':result.action==='dismiss'?'她决定放弃':result.action==='reflect'?'她选择反思':'她选择暂不处理'}${result.error?' · '+result.error:''}`);
    }finally{button.disabled=false}
  }));
  $('owner-todo-prev').addEventListener('click',async()=>{await run(async()=>{if(!todoPageTrail.length)return;todoPageCursor=todoPageTrail.pop();await loadOwnerTodos()});$('owner-todo-prev').disabled=todoPageTrail.length===0;$('owner-todo-next').disabled=!todoNextCursor});
  $('owner-todo-next').addEventListener('click',async()=>{await run(async()=>{if(!todoNextCursor)return;todoPageTrail.push(todoPageCursor);todoPageCursor=todoNextCursor;await loadOwnerTodos()});$('owner-todo-prev').disabled=todoPageTrail.length===0;$('owner-todo-next').disabled=!todoNextCursor});
  // The server generates and validates the diff before each explicit save.
  const proposedLifeSettings=async(previewOnly)=>{
    const body={schemaVersion:2,mode:$('life-v2-mode').value,pace:$('life-v2-pace').value,
      revision:$('life-v2-mode').dataset.revision||'',previewOnly};
    if(body.pace==='custom'&&body.mode!=='off')body.advanced={
      minutes:boundedInt('life-v2-minutes',5,1440,'最短考虑间隔'),
      dailyLimit:boundedInt('life-v2-limit',1,288,'每日模型额度'),
      startHour:boundedInt('life-v2-start',0,23,'每日开始时段'),
      endHour:boundedInt('life-v2-end',1,24,'每日结束时段')};
    if(!previewOnly)body.confirm='APPLY_LIFE_SETTINGS_V2';
    return request('/life-agent/settings-v2',body);
  };
  const describeLifeDiff=changes=>Object.entries(changes||{}).map(([k,v])=>`${k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`).join('；')||'配置没有变化';
  $('life-v2-pace').addEventListener('change',()=>{$('life-settings-advanced').open=$('life-v2-pace').value==='custom'});
  for(const id of ['life-v2-minutes','life-v2-limit','life-v2-start','life-v2-end'])$(id).addEventListener('change',()=>{$('life-v2-pace').value='custom';$('life-settings-advanced').open=true});
  // 整体生活方式：只组合已有字段，不新增第二套记忆/兴趣/人格账本。
  // 每次显式预览+确认；旧用户不自动迁移，任何平台发送权限都不在组合中。
  const organicProfiles=Object.freeze({
    gentle:{pace:'quiet',mainSessionMemoryHalfLifeDays:24,mainSessionMemoryThreshold:.45,mainSessionMemoryMaxItems:5,mainSessionMemoryMaxChars:800,mainSessionReflectionMinCandidates:8,mainSessionReflectionBatchSize:16,mainSessionReflectionIntervalHours:6,mainSessionReflectionDailyBatches:4},
    balanced:{pace:'natural',mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:8,mainSessionMemoryMaxChars:1200,mainSessionReflectionMinCandidates:6,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16},
    curious:{pace:'lively',mainSessionMemoryHalfLifeDays:45,mainSessionMemoryThreshold:.3,mainSessionMemoryMaxItems:10,mainSessionMemoryMaxChars:1600,mainSessionReflectionMinCandidates:4,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16}
  });
  const organicPlan=async()=>{
    const choice=$('life-organic-profile').value,profile=organicProfiles[choice];
    if(!profile)throw Error('请选择有效的生活方式');
    const existing=(await request('/config')).config||{};
    const changes=Object.entries(profile).filter(([key,value])=>key!=='pace'&&existing[key]!==value);
    return {profile,changes,choice};
  };
  $('life-organic-preview').addEventListener('click',()=>run(async()=>{
    const {profile,changes}=await organicPlan();
    $('life-organic-status').textContent='将选择 '+({quiet:'安静',natural:'自然',lively:'活跃'})[profile.pace]+' 档；记忆与反思有 '+changes.length+' 项差异。不会修改现有记忆或外发权限。确认应用后才保存。';
  }));
  $('life-organic-apply').addEventListener('click',()=>run(async()=>{
    const {profile,changes}=await organicPlan();
    const prior=$('life-v2-pace').value;
    $('life-v2-pace').value=profile.pace;
    const currentMode=$('life-v2-mode').value;
    try{await proposedLifeSettings(true)}catch(e){$('life-v2-pace').value=prior;throw e}
    if(!await confirmAction({title:'应用这套生活方式？',description:'更新生活活跃度，并调整 '+changes.length+' 项记忆/反思参数。不会删除记忆、恢复遗忘内容或打开社交发送权限。',confirmLabel:'确认应用'})){$('life-v2-pace').value=prior;return}
    try{
      await proposedLifeSettings(false);
    }catch(e){$('life-v2-pace').value=prior;throw e}
    try{
      if(changes.length)await request('/config',Object.fromEntries(changes));
    }catch(e){$('life-organic-status').textContent='生活档位已保存，但记忆设置未确认成功；请检查记忆页再决定是否重试。';throw e}
    $('life-organic-status').textContent='已应用。生活'+(currentMode==='off'?'仍是暂停状态':'按原状态运行')+'；记忆只改变今后的召回与反思节奏。';
    await loadUnifiedLifeSettings();
    message('已应用生活与记忆搭配，社交权限不变。');
  }));
  $('life-v2-preview-btn').addEventListener('click',()=>run(async()=>{
    const r=await proposedLifeSettings(true);
    $('life-v2-status').textContent='预览：'+describeLifeDiff(r.plan?.changed)+'。目前尚未保存。';
  }));
  // Manual developer rehearsal only: never triggered by page load or by
  // normal Life wake. The server still validates same-origin and confirmation.
  for(const [id,channel,label] of [
    ['life-handoff-dry-dm','dm','私信'],['life-handoff-dry-comment','comment','评论']]){
    $(id).addEventListener('click',()=>run(async()=>{
      const accepted=await confirmAction({title:'只读交接演练 · '+label,
        description:'请先关闭 B站生活总开关。演练会短暂阻止该渠道的新旧社交操作，核查当前账号旧操作是否排空和发送事务是否有待复核项。不会读取聊天正文、调用模型或发送消息。异常中断可能保留冻结记录，需要停机核查。继续？',
        confirmLabel:'确认仅演练，不发送'})
      if(!accepted)return
      const result=await request('/life-agent/social-handoff-rehearsal',{
        channel,confirm:'DRY_RUN_SOCIAL_HANDOFF_NO_SEND'})
      const codes={'decision-only-dry-run-passed':'排空和事务核查通过（不代表可以接管）',
        'legacy-operations-in-flight':'仍有旧社交操作在进行',
        'legacy-inflight-review-required':'存在异常旧操作，需停机复核',
        'send-transaction-review-required':'有发送事务待核实，禁止自动重发',
        'send-transaction-inspection-unavailable':'无法读取发送事务账本',
        'handoff-fence-held':'预约已被占用，需停机核查',
        'rehearsal-reservation-review-required':'演练预约可能残留，需停机人工核查',
        'account-changed':'演练期间账号变化，拒绝继续'}
      $('life-handoff-dry-result').textContent=label+'演练：'+(codes[result.reason]||result.reason||'状态未确认')+
        ' · 仍由旧处理器正式决定回复 · 不会自动切换或发送。'
      await loadUnifiedLifeSettings()
    }))
  }
  $('life-v2-save-btn').addEventListener('click',()=>run(async()=>{
    const plan=(await proposedLifeSettings(true)).plan;
    const diff=describeLifeDiff(plan?.changed);
    if(!await confirmAction({title:'保存生活设置？',description:(Object.keys(plan?.changed||{}).length+' 项设置变化；生活额度可能增加模型费用。社交授权不变。'),confirmLabel:'保存设置'}))return;
    const btn=$('life-v2-save-btn');btn.disabled=true;
    try{
      const r=await proposedLifeSettings(false);
      if(r.host?.ok===false)message('插件设置已保存，但 DSH 原生配置同步失败；请重启并检查设置。');
      else message(r.unchanged?'生活设置没有变化':'生活设置已保存；只有 Life Agent 可以自动安排视频探索，旧视频定时器已退出。');
      await loadOwnerTodos();
      await loadLifeIntegration();
    }finally{btn.disabled=false}
  }));
  $('life-readiness-refresh').addEventListener('click',()=>run(async()=>{
    await loadOwnerTodos();
    message('已重新读取真实门禁和最近委派记录；未调用模型、未启动视频。');
  }));
  $('life-offline-demo').addEventListener('click',()=>run(async()=>{
    const button=$('life-offline-demo');button.disabled=true;
    try{
      const result=await request('/life-agent/offline-demo',{});
      const names={'shadow-would-explore':'影子模式：想探索但不启动','capability-launched':'自主模式：委派假视频 Agent',
        'voluntary-rest':'自主模式：明确选择休息','no-actionable-options':'没有视频能力：不调用假模型'};
      $('life-offline-demo-result').textContent=result.ok===true&&result.synthetic===true
        ?'【纯模拟，通过原 Life Agent 决策代码】'+(result.cases||[]).map(x=>names[x.result]||x.result).join('；')+'。实际网络、真实模型及外发均为 0；真实鱼鱼的状态没有变化。'
        :'演示失败，请查看本轮离线专项日志。';
    }finally{button.disabled=false}
  }));
  $('life-agent-wake').addEventListener('click',()=>run(async()=>{
    if($('life-v2-mode').value==='active'&&!await confirmAction({title:'请确认操作',description:'这次考虑可能自主启动已获得原授权的视频 Agent（其中既有社交写入功能仍受原权限门禁）。继续？'}))return;
    const btn=$('life-agent-wake');btn.disabled=true;
    try{
      const r=await request('/life-agent/wake',{});
      await loadOwnerTodos();
      await loadLifeIntegration();
      const reasons={'nothing-to-do':'本轮没有可信候选（包括已核验生活事件、到期意愿、待办或反思）',
        quota:'今天的 AI 自主决策额度已经用完',busy:'鱼鱼正在进行另一轮考虑',
        disabled:'自主生活功能尚未启用',cooldown:'自动调度间隔尚未到期',
        'life-exploration-cooldown':'仅兴趣线索的自动轮次尚在六小时防重复冷却（手动唤醒不应被此规则阻止）'};
      const lifeResults={'no-actionable-options':'本轮没有可执行候选（未调用模型／不消耗额度）',
        'voluntary-rest':'模型明确选择暂时休息',
        'invalid-decision':'模型返回格式不合规或选择了无效动作，不是鱼鱼主动休息',
        'model-or-execution-error':'模型／执行出现错误，不是鱼鱼主动休息',
        'done':'已完成一项有回执的只读任务','failed':'只读任务未完成',
        'completed':'本轮反思已完成','skipped':'鱼鱼暂未继续反思',
        'capability-launched':'已委派视频探索（不代表看完）',
        'capability-not-started':'视频探索未能启动',
        'shadow-would-explore':'观察到探索意愿，未启动视频',
        'video-explore-blocked':'当前不满足视频探索条件',
        'verified-search-results':'已找到公开候选，尚未确认观看',
        'verified-metadata':'已核验公开元数据，尚未确认观看',
        'public-evidence-reviewed':'已核验公开交往线索，未执行外发',
        'opportunity-recorded':'已登记待考虑线索',
        'social-signal-considered':'已考虑社交信号，未发送消息',
        'social-shadow-reply':'仅观察到回复倾向，未发送',
        'social-shadow-defer':'仅观察到延期倾向，未发送',
        'social-shadow-silent':'仅观察到沉默倾向，未发送',
        'social-shadow-invalid':'社交观察未获得合规模型输出',
        'search-failed':'公开搜索未成功（技术失败，已按线索冷却）','metadata-read-failed':'元数据读取失败（不是鱼鱼不想了解）',
        'creator-read-failed':'作者公开空间核验未成功',
        'reflection-not-available':'缺少可反思的可信经历',
        'willingness-recheck-blocked':'执行前意愿复核未通过'};
      const noOptionReasons={'video-launch-cooldown':'视频仍在原有 180 分钟启动间隔内',
        'video-daily-limit':'今日 Life Agent 视频启动数已满',
        'video-capability-unavailable':'当前原视频 Agent 暂不可委派（可能繁忙或被原额度、授权限制）',
        'no-verified-candidates':'目前没有可用的可信生活候选'};
      const metadataReasons={
        'metadata-read-busy':'同一公开资料正被其他读取入口预约，或存在需要核验的中断记录',
        'metadata-rate-limited':'B站读取频率或插件读取额度已受限',
        'metadata-account-unavailable':'B站账号未就绪或登录作用域发生变化',
        'metadata-timeout':'B站资料读取超时',
        'metadata-response-invalid':'B站返回了无法核实的资料格式',
        'metadata-bvid-mismatch':'平台返回的 BV 与原线索不一致，已拒绝记为成功',
        'metadata-title-missing':'平台未返回可信视频标题，已拒绝记为成功',
        'metadata-api-error':'读取接口失败，具体底层错误请查看本机运行诊断'};
      const failureReasons={'model-json-invalid':'模型没有返回可解析的 JSON','model-response-shape':'模型返回的不是预期对象',
        'model-action-unknown':'模型选择了不支持的动作','model-target-invalid':'模型选择了不存在或无权处理的目标',
        'model-action-forbidden':'动作需要额外权限，已被拒绝'};
      let resultText;
      if(r.skipped)resultText='本次未开始考虑：'+(reasons[r.skipped]||'当前不满足运行条件');
      else if(r.result==='invalid-decision')resultText='本次 AI 决策未通过校验，未执行动作。'+
        (failureReasons[r.diagnosticCode]?'原因：'+failureReasons[r.diagnosticCode]+'。':'可能是返回格式或候选目标不符合要求。')+
        '如反复出现，请在高级诊断检查模型配置和运行记录。';
      else if(r.diagnosticCode==='todo-read-failed')resultText='鱼鱼选择处理只读待办，但执行器没有返回可信成功回执。本次没有标记完成，请查看待办的状态和执行日志。';
      else if(r.result==='metadata-read-failed')resultText='本次尝试读取视频元数据，但未取得同 BV 的可信资料回执。'+
        (metadataReasons[r.diagnosticCode]||'具体失败原因未确定')+'。原线索或探索意愿将按失败退避规则重新考虑；连续失败三次会暂停，避免反复请求平台。没有将这次尝试记录成已观看或自主放弃。';
      else if(r.diagnosticCode==='action-outcome-unknown')resultText='本轮动作已尝试，但实际完成结果无法确认。系统冻结相关匿名事件，不会自动重做。请先核验平台回执和本地账本。';
      else if(['exploration-cue-receipt-failed','exploration-intent-receipt-failed'].includes(r.diagnosticCode))resultText='模型已选择探索，但本地探索账本无法保存可信结果；不能判定为鱼鱼放弃。只读工具可能已经返回，请在本轮决策链查看 read-result 步骤。';
      else if(r.diagnosticCode==='action-preflight-error')resultText='模型已作选择，但执行链内部核验或回执保存失败。只读读取可能已经尝试，具体以决策链 action-start / read-result 为准；未确认成功的资料不会记为已观看。';
      else if(r.result==='model-or-execution-error'||r.ok===false)resultText='本次运行出现错误，不能算作鱼鱼主动休息。请在高级诊断查看运行状态。';
      else resultText='本次结果：'+(lifeResults[r.result]||r.action||'未产生行动')+
        (r.diagnosticCode?' · '+(noOptionReasons[r.diagnosticCode]||'详细信息见高级诊断'):'')+
        ($('life-v2-mode').value==='shadow'?' · 观察模式不会启动视频':'');
      if(r.traceId)resultText+=' · 调试号 '+r.traceId.slice(0,8)+'：运行诊断 → 鱼鱼的决策全过程。';
      $('life-agent-wake-result').textContent=resultText;
      if(r.traceId)await loadLifeDecisionTraces();
      message(resultText);
    }finally{btn.disabled=false}
  }));
  $('life-evidence-contrast').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'这会对同一匿名模拟场景进行两次真实模型调用，立即占用两次现有每日额度。不会执行视频、私信、评论或其他工具；结果不同也不能证明人格成长。继续？'}))return;
    const button=$('life-evidence-contrast');button.disabled=true;
    try{
      const r=await request('/life-agent/evidence-contrast',{});
      const choices={pause:'倾向休息',continue_read:'倾向继续公开只读探索',reflect:'倾向先整理感受',invalid:'输出不合规'};
      $('life-evidence-contrast-status').textContent=r.validOutputs===false?
        '对照已调用模型两次，但输出不符合诊断格式，不能判断选择是否变化；本次未执行任何动作。':
        '未提供经历：'+(choices[r.withoutEvidence]||'未知')+'；提供近期成功读取类别：'+(choices[r.withEvidence]||'未知')+'；'+(r.changed?'模型输出不同（非成长因果证明）':'模型输出相同')+'。本次无真实执行，已计入 2 次模型额度。';
      await loadOwnerTodos();
    }finally{button.disabled=false}
  }));
  $('life-social-shadow-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('life-social-context-optin').value==='true';
    const newlyEnabled=enabled&&$('life-social-context-optin').dataset.loaded!=='true';
    if(newlyEnabled&&!await confirmAction({title:'请确认操作',description:'允许当前账号的已核验好友私信与公开评论，在模型主动关注后仅做短期只读分类？不会外发，但可能增加模型费用。确认吗？'}))return;
    await request('/config',{lifeAgentSocialContextOptIn:enabled,
      lifeSocialShadowConfirm:newlyEnabled?'ENABLE_READ_ONLY_SHADOW':''});
    $('life-social-context-optin').dataset.loaded=String(enabled);
    message(enabled?'只读社交影子授权已保存；没有取得真实发送权。':'只读社交影子授权已关闭。');
  }));
  $('owner-todo-settings-save').addEventListener('click',()=>run(async()=>{
    // Life Agent V2 is the only settings writer for mode, quotas and hours.
    const oldSettingsPatch={ownerTodoCompletionFollowupEnabled:$('owner-todo-completion-followup').value==='true',
      socialTodoCompletionFollowupEnabled:$('social-todo-completion-followup').value==='true',
      ownerTodoFollowupCooldownMinutes:boundedInt('owner-todo-followup-cooldown',0,10080,'同一人回访冷却'),
      ownerTodoFollowupDailyLimit:boundedInt('owner-todo-followup-daily-limit',1,1000,'全局回访上限'),
      ownerTodoFollowupMinIntervalMinutes:boundedInt('owner-todo-followup-min-interval',0,1440,'两次发送间隔'),
      ownerTodoFollowupPollMinutes:boundedInt('owner-todo-followup-poll',1,60,'回访检查间隔'),
      ownerTodoFollowupQuietEnabled:$('owner-todo-followup-quiet-enabled').value==='true',
      ownerTodoFollowupQuietStartHour:boundedInt('owner-todo-followup-quiet-start',0,23,'静默开始'),
      ownerTodoFollowupQuietEndHour:boundedInt('owner-todo-followup-quiet-end',0,23,'静默结束'),
    };
    // Compatibility settings save must not touch or reset the unified clock.
    await request('/config',oldSettingsPatch);
    await loadOwnerTodos();message('待办回访设置已保存；生活节奏与影子读取授权请在「Life 自主生活」中管理。');
  }));
  $('owner-todo-add').addEventListener('click',()=>run(async()=>{
    const type=$('owner-todo-type').value,targetValue=$('owner-todo-target').value.trim(),title=$('owner-todo-title').value.trim(),body={action:'add',type,title};
    if(type==='watch_video')body.bvid=targetValue;
    else if(type==='inspect_creator_videos')body.uid=targetValue;
    else if(type==='search_videos')body.topic=targetValue;
    if(['watch_video','inspect_creator_videos','search_videos'].includes(type)&&!targetValue)throw Error('请填写目标 BV 号、UID 或搜索关键词');
    const r=await request('/owner-todos',body);if(!r.ok)throw Error(r.error||'新增待办失败');
    $('owner-todo-target').value='';$('owner-todo-title').value='';await loadOwnerTodos();message(r.created?'已加入待办':'这条待办已存在');
  }));
  const renderMemoryFlow=async()=>{
    try{
      const x=await request('/life-memory/status');const c=x.counts||{};
      const clear=Number(c.clear)||0,fuzzy=Number(c.fuzzy)||0,trace=Number(c.trace)||0,forgotten=Number(c.forgotten)||0;
      $('memory-flow-recorded').textContent=`${x.archiveEvents||0} 条归档事件（含回复等非独立记忆）`;
      $('memory-flow-remembered').textContent=`${clear+fuzzy+trace} / ${x.total||0} 条可衰减副本仍可想起`;
      $('memory-flow-fading').textContent=`副本总数 ${x.total||0}：清晰 ${clear} · 模糊 ${fuzzy} · 印象 ${trace} · 已忘记 ${forgotten}`;
      const oldest=x.oldestEpisodeAt?` · 最早副本约 ${x.oldestEpisodeDays||0} 天前`:'';
      const upcoming=x.nextFuzzyAt?` · 下一条预计变模糊：${new Date(x.nextFuzzyAt).toLocaleDateString()}`:'';
      $('memory-flow-updated').textContent=`归档事件与可衰减记忆不是一一对应；回复可能仅归档，不单独建副本。${oldest}${upcoming}`;
    }catch(e){$('memory-flow-updated').textContent='状态暂不可用：'+String(e?.message||e).slice(0,80)}
  };
  const loadLifeDecisionTraces=async()=>{
    const status=$('life-traces-status'),list=$('life-traces-list');list.replaceChildren();
    try{
      const data=await request('/life-agent/decision-traces');
      const runs=data.runs||[];
      status.textContent=`当前账号最近 7 天 ${runs.length} 轮（最多保留 60 轮）。只记录决策步骤及脱敏类别，不保存私信原文、模型原文或目标 ID。`;
      const labels={start:'开始本轮', 'candidate-scan':'可信候选筛选','quota-reserved':'模型额度预约','model-call':'调用生活模型','model-choice':'模型决策校验','preflight':'执行前核验','action-start':'开始执行能力','action-result':'执行结果／回执','read-result':'平台只读结果（脱敏分类）','next-wake':'后续自主考虑机会','event-settlement':'事件账本结算',journal:'保存本轮记录',finish:'本轮结束',error:'技术错误',blocked:'安全门禁阻止'};
      for(const [i,item] of runs.entries()){
        const details=node('details','','record');if(i===0)details.open=true;
        const summary=node('summary',`${formatLocalTime(new Date(item.at).toISOString())} · ${item.trigger==='manual'?'手动考虑':'自动生活'} · ${item.state==='running'?'可能中断':item.state==='failed'?'本轮失败':'已结算'} · 调试号 ${item.id.slice(0,8)}`);
        details.appendChild(summary);
        for(const step of item.steps||[]){
          const fields=Object.entries(step).filter(([k])=>!['type','at'].includes(k)).map(([k,v])=>`${k}=${v}`).join(' · ');
          const line=node('p',`${formatLocalTime(new Date(step.at).toISOString())} · ${labels[step.type]||step.type}${fields?' · '+fields:''}`,'muted');details.appendChild(line);
        }
        list.appendChild(details);
      }
      if(!runs.length)add(list,info('当前账号尚无新版的决策步骤记录。安装本补丁并重启后，点击「现在让鱼鱼考虑一次」，然后在这里刷新。'));
    }catch(e){status.textContent='决策链暂不可用：'+String(e?.message||e).slice(0,120)}
  };
  $('life-traces-refresh').addEventListener('click',()=>run(loadLifeDecisionTraces));
  $('life-metadata-probe').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'将从当前账号已核验的公开线索读取一条真实 B站视频元数据。这不会调用 AI、生成观看经历或发送消息，但会计入平台读取额度；请勿频繁操作。是否开始？'}))return;
    const label=$('life-metadata-probe-status');label.textContent='正在调用受保护的 B站只读工具…';
    const r=await request('/life-agent/metadata-probe',{});
    if(r.state==='verified-metadata')label.textContent='真实视频元数据读取通过；仅说明同 BV 标题已核实，不代表观看成功。';
    else{
      const categories={'metadata-rate-limited':'平台风控或读取额度限制','metadata-account-unavailable':'登录或账号作用域不就绪','metadata-read-busy':'已有预约或异常残留','metadata-timeout':'平台请求超时','metadata-response-invalid':'平台返回格式无法核验','metadata-bvid-mismatch':'返回视频与线索 BV 不一致','metadata-title-missing':'缺少可信标题','metadata-api-error':'平台或适配器返回其他错误'};
      const origins={'python-bili-video-info':'Python B站视频详情工具','mcp-adapter':'Node/MCP 调用层','platform-read-gate':'预约门禁','response-validation':'回执核验'};
      const layers={'platform':'B站接口','python-adapter':'Python 适配器','python-response':'Python 返回结构','mcp-transport':'MCP 传输','platform-read-gate':'只读预约','response-validation':'结果核验'};
      label.textContent='只读请求未完成：'+(categories[r.code]||r.code||'未知错误')+' · 来源 '+(origins[r.origin]||'未识别')+' / '+(layers[r.layer]||'未识别')+(r.platformCode?' · 平台错误码 '+r.platformCode:'')+(r.reservationReason?' · 预约核验 '+r.reservationReason:'')+'。本次未调用模型，也没有改变生活事件；请将这行结果复制用于排查。';
    }
    await loadReadActionExecutions();
    message(label.textContent);
  }));
  const loadReadActionExecutions=async()=>{
    const status=$('read-action-executions-status'),list=$('read-action-executions-list');list.replaceChildren();
    try{
      const data=await request('/read-action-executions');
      status.textContent=`Node/Python 共用只读动作 · 正在执行/待核查 ${data.active||0} 条 · 超过安全时间需人工核查 ${data.interrupted||0} 条 · 最近回执 ${(data.recent||[]).length} 条。`;
      for(const item of (data.pending||[]).slice(0,12)){
        const line=node('div','','record');add(line,info('动作 '+(item.operation||'unknown')+' · '+(item.source||'unknown')+' · '+(item.state||'unknown')+' · '+(item.at?formatLocalTime(new Date(item.at).toISOString()):'开始时间未知')));
        if(item.needsReview){
          add(line,info('执行曾中断或长时间未完成；必须先检查相关待办、平台状态和其它进程。解除锁不会把动作登记为成功。'));
          const review=btn('已检查，解除这条中断的只读预约',async()=>{
            if(!await confirmAction({title:'请确认操作',description:'只有在确认没有其它执行进程仍在进行这项读取后才能解除。本操作不会标记任务完成，也不会自动重发。确定？'}))return;
            const result=await request('/read-action-executions/acknowledge',{id:item.id,confirm:true});
            message(result.note||'已记录人工复核');await loadReadActionExecutions();
          });line.appendChild(review);
        }
        list.appendChild(line);
      }
      const label={'tool-returned':'工具已返回（未核验业务事实）','tool-rejected':'工具返回拒绝','call-failed-or-unverified':'调用失败或结果不可核实','manual-review-no-replay':'人工复核释放，未自动重放'};
      const failureLabel={'account-auth':'账号未登录或凭据失效','platform-rate-limit':'平台限流／风控','platform-permission':'平台权限拒绝','platform-timeout':'平台超时','not-found':'资源不存在','invalid-response':'返回资料未通过核验','invalid-argument':'平台参数错误','platform-rejected-other':'平台／插件返回失败，原因未明','read-budget-cooldown':'本地读取额度或风控冷却','reservation-held':'同一读取仍被预约','account-unavailable':'账号作用域不可用','network-timeout':'读取超时','transport-or-adapter-error':'工具调用异常'};
      for(const item of (data.recentGroups||data.recent||[]).slice(0,15))add(list,info(
        (label[item.state]||item.state||'未知')+' · '+(item.operation||'unknown')+' · '+(item.source||'unknown')+
        (item.code?' · 原因：'+(failureLabel[item.code]||item.code):'')+
        (item.reservationReason?' · 预约核验：'+({'adapter-proof-mismatch':'内置 Python 身份凭据未匹配','legacy-parent-mismatch':'旧预约的直接父进程不匹配','owner-not-running':'原预约进程不可核验','record-invalid':'预约记录不符合当前调用','other-reservation':'另一读取入口占用／中断待核查'}[item.reservationReason]||'未识别'):'')+
        (item.count>1?' · 近期重复 '+item.count+' 次':'')+
        ' · '+(item.at?formatLocalTime(new Date(item.at).toISOString()):'时间未知')));
      if(!data.active&&!(data.recent||[]).length)add(list,info('还没有经过这条 JavaScript 共享执行入口的真实平台读取回执。'));
    }catch(e){status.textContent='读取共享执行状态失败：'+String(e?.message||e).slice(0,100)}
  };
  $('read-action-executions-refresh').addEventListener('click',()=>run(loadReadActionExecutions));
  const loadOutboundActionExecutions=async()=>{
    const status=$('outbound-action-executions-status'),list=$('outbound-action-executions-list');list.replaceChildren();
    try{
      const data=await request('/outbound-action-executions');
      status.textContent=`当前账号待核查外发记录 ${data.locks||0} 条 · 最近平台已确认回执 ${(data.recent||[]).length} 条。已成功的同日防重锁不算待核查；没有自动重发或解锁入口。`;
      const names={dm:'私信',comment:'视频评论', 'dynamic-comment':'动态评论',follow:'关注',unfollow:'取关'};
      for(const item of (data.pending||[]).slice(-15).reverse())
        add(list,info(`${names[item.kind]||'外发动作'} · ${item.state==='receipt-recorded-marker-review'?'平台回执已记录，但冻结标记仍在，需人工核实':'发送结果未核实，仍禁止自动重发'} · ${item.at?formatLocalTime(new Date(item.at).toISOString()):'时间未知'}`));
      for(const item of (data.recent||[]).slice(0,15))
        add(list,info(`${names[item.kind]||'外发动作'} · 平台已返回可核验回执 · ${item.at?formatLocalTime(new Date(item.at).toISOString()):'时间未知'}`));
      if(!(data.pending||[]).length&&!(data.recent||[]).length)add(list,info('本账号还没有经过新协调层的外发动作记录。'));
    }catch(e){status.textContent='外发状态暂不可用：'+String(e?.message||e).slice(0,100)}
  };
  $('outbound-action-executions-refresh').addEventListener('click',()=>run(loadOutboundActionExecutions));
  const loadTodoTransactions=async()=>{
    const status=$('todo-transactions-status');
    // Repeated refreshes must not leave behind an obsolete unlock control.
    const previous=$('todo-transactions-recover');if(previous)previous.remove();
    try{
      const data=await request('/owner-todos/transactions');
      status.textContent=data.held?'待办事务存在中断或正在由另一进程修改'+(data.needsReview?'，可人工核对后解除':'，暂不可解除'):'待办读改写事务没有未完成锁。';
      if(data.held&&data.needsReview){
        const b=btn('核实进程已结束后解除事务锁',async()=>{
          if(!await confirmAction({title:'请确认操作',description:'务必先核对原待办及进程状态。只解除锁，不补写执行结果。确定？'}))return;
          const r=await request('/owner-todos/transactions/recover',{confirm:true});message(r.note||r.error||'已处理');await loadTodoTransactions();
        });b.id='todo-transactions-recover';status.parentElement.appendChild(b);
      }
    }catch(e){status.textContent='读取待办事务状态失败：'+String(e?.message||e).slice(0,100)}
  };
  $('todo-transactions-refresh').addEventListener('click',()=>run(loadTodoTransactions));

  const loadLifeOpportunities=async()=>{
    const status=$('life-opportunities-status'),list=$('life-opportunities-list');list.replaceChildren();
    try{
      const data=await request('/life-opportunities');
      if(!data.accountReady){status.textContent='当前 B站账号尚未就绪，无法安全读取契机';return}
      const intentions=data.intentions||[];
      const affinity=Array.isArray(data.privateLifeAffinity)?data.privateLifeAffinity:[];
      const affinityDiagnostics=data.privateLifeAffinityDiagnostics||{};
      const intentReady=intentions.filter(x=>x.status==='ready'||(x.status==='inspected'&&x.selectedBvid&&!x.creatorExplored)).length;
      const entries=data.opportunities||[];
      const warnings=data.sourceWarnings||[];
      const cueFailures=data.explorationReadFailures||[];
      const ready=entries.filter(x=>x.eligible).length;
      status.textContent=`当前账号 · 生活线索可考虑 ${ready} 条 · 自主探索进行中 ${intentReady} 条 · 自主探索记录 ${intentions.length} 条 · 独立线索读取冷却 ${cueFailures.filter(x=>!x.paused).length} 条、暂停 ${cueFailures.filter(x=>x.paused).length} 条 · 有可信熟悉好友共同兴趣参考 ${affinity.length} 组（仅内部参考，不代表实际使用或外发许可）。`+(warnings.length?' · 注意：'+warnings.join('、'):'');
      if(cueFailures.length)add(list,info('只读探索失败（不同于鱼鱼选择延期）：'+cueFailures.slice(-5).map(x=>
        (x.failureCode==='search-api-error'?'公开搜索异常':({'metadata-rate-limited':'平台风控／限流','metadata-account-unavailable':'平台登录态不可用','metadata-read-busy':'只读预约占用','metadata-timeout':'读取超时','metadata-api-error':'平台读取失败'}[x.failureCode]||'元数据核验失败'))+
        ' · '+x.failures+'/3 次'+(x.paused?' · 已暂停':x.nextAt?' · 下次 '+formatLocalTime(new Date(x.nextAt).toISOString()):'')).join('；')+'。不覆盖原来的可信阅读回执，不算作观看。'));
      if(affinity.length)add(list,info('内部共享兴趣参考：'+affinity.length+' 组；仅与鱼鱼自己的当前账号公开兴趣相交，未读取或展示任何私信正文、好友 UID、姓名。关系熟悉度不等于联系许可。'));
      if(affinityDiagnostics.unavailable)add(list,info('关系参考资料暂不可用：'+affinityDiagnostics.unavailable+' 位已列明好友的证据读取失败；此次未将其视为没有兴趣，也未向模型提供不可信参考。'));
      const names={pending:'尚未考虑',inspect:'已决定核实公开元数据',review:'已复核公开交流证据',defer:'鱼鱼选择延期',dismiss:'鱼鱼选择放下',skip:'鱼鱼本轮暂不继续',error:'平台资料读取失败（并非主动延期）'};
      const metadataFailures={'metadata-read-busy':'读取占用／中断待核验','metadata-rate-limited':'平台限流或读取额度受限',
        'metadata-account-unavailable':'B站账号或会话不可用','metadata-timeout':'读取超时',
        'metadata-response-invalid':'资料格式不能核验','metadata-bvid-mismatch':'BV 与原请求不符',
        'metadata-title-missing':'可信标题缺失','metadata-api-error':'平台接口读取错误'};
      for(const e of entries){
        const item=node('div','','record');const head=node('div');
        if(e.bvid)add(head,safeVideoLink(e.bvid));else add(head,node('span','公开交流线索（无 UID / 私信正文）'));
        add(head,node('span',' · '+(names[e.status]||e.status)));
        add(item,head,info('来源：'+({'discussion-read':'真实评论观察','interest-milestone':'多日自主选片趋势','public-person-observation':'公开评论中明确的交流偏好'}[e.source]||'有证据的生活线索')));
        if(e.topic)add(item,info('选看主题：'+e.topic+' · 阶段 '+e.stage+' · '+(e.evidenceCount||0)+' 个 BV / '+(e.evidenceDays||0)+' 天；不等于已经喜欢'));
        if(e.source==='public-person-observation')add(item,info('公开交流证据跨 '+(e.evidenceDays||0)+' 天、'+(e.evidenceCount||0)+' 条不同互动；不包含私信，也不意味着可主动联系'));
        if(e.source==='discussion-read')add(item,info('阅读时的感受：'+({curious:'好奇',skeptical:'存疑',amused:'觉得有趣',neutral:'平静'}[e.reaction]||'临时观察')+' · '+formatLocalTime(e.at)));
        if(e.question)add(item,info('当时的主观问题：'+e.question+'（非已证实事实）'));
        if(e.lastAt)add(item,info('最近考虑：'+formatLocalTime(new Date(e.lastAt).toISOString())+(e.result?' · 回执 '+e.result:'')+(e.nextAt?' · 下次允许考虑 '+formatLocalTime(new Date(e.nextAt).toISOString()):'')));
        if(e.status==='error')add(item,info('技术失败：'+(metadataFailures[e.failureCode]||'未能核实资料')+' · 连续失败 '+(e.failures||1)+'/3'+
          ((e.failures||0)>=3?' · 已暂停该线索，需人工排查':' · 到期后才允许重新考虑')+'；没有记为已观看。'));
        if(e.title)add(item,info('已核实的公开视频元数据标题：'+e.title+'（不代表已观看）'));
        if(e.reason)add(item,info(e.status==='error'?'先前尝试的只读目的：'+e.reason:'鱼鱼给出的简短决定：'+e.reason));
        list.appendChild(item);
      }
      for(const x of intentions){
        const item=node('div','','record');const title=node('div');add(title,node('strong','🐟 自主探索 · '+(x.status==='ready'?'等待鱼鱼继续':x.status==='inspected'&&!x.creatorExplored?'已核实视频，可自主考虑作者作品':x.status==='inspected'?'已核实公开资料':x.status==='paused'?'连续读取失败，已暂停等待排查':'鱼鱼决定结束')));
        add(item,title,info('自己的探索目的：'+(x.goal||'未记录')));
        add(item,info('可信来源：'+(x.source==='discussion-read'?'同 BV 真实评论阅读后的自主好奇':'当前账号后天兴趣趋势')+(x.topic?' · '+x.topic:'')+'；最近回执：'+(x.receipt||'未知')));
        if(x.videos?.length)add(item,info((x.source==='discussion-read'?'已核实原 BV：':'真实搜索返回的 BV：')+x.videos.map(v=>v.bvid).join('、')+'（不代表已经观看）'));
        if(x.selectedBvid)add(item,info('后续核实：'+x.selectedBvid+' · '+(x.selectedTitle||'')+'（仅公开视频元数据）'));
        if(x.creatorExplored)add(item,info('已真实读取该 BV 作者的公开投稿列表；可选作品 '+(x.creatorVideos||[]).map(v=>v.bvid).join('、')+'（列表不等于观看，也不授予关注／私信权限）'));
        if(x.metadataFailures)add(item,info('元数据读取：'+(metadataFailures[x.metadataFailureCode]||'核验未成功')+' · 连续失败 '+x.metadataFailures+'/3'+
          (x.status==='paused'?' · 已停止自动尝试':' · 将按退避规则重试')+'；没有记为已观看。'));
        if(x.nextAt&&x.nextAt>Date.now()&&x.status!=='paused')add(item,info('下一次最早可继续：'+formatLocalTime(new Date(x.nextAt).toISOString())));
        if(x.reason)add(item,info('决定放下：'+x.reason));
        list.appendChild(item);
      }
      // Planner status shows search errors before a life intention is saved.
      try{
        const plan=await request('/autonomous-planner');
        const history=(plan.recent||[]).filter(x=>['begin_exploration','inspect_exploration','inspect_creator_space','abandon_exploration','reconciled'].includes(x.action)).slice(-5).reverse();
        for(const r of history){
          add(list,info('最近自主行动：'+({begin_exploration:'自主发起只读探索',inspect_exploration:'核实公开视频 BV',inspect_creator_space:'查看作者公开投稿',abandon_exploration:'自己结束探索',reconciled:'同动作去重，未调用模型或执行'}[r.action]||r.action)+
            ' · '+(r.result==='held-overlap'?'同一只读动作被待办或进行中的生活意愿覆盖，未重复执行':r.result==='held-by-accepted-todo'?'与已接受只读待办动作重合，已阻止重复搜索':r.result==='held-by-ongoing-intention'?'已有自主意愿在继续，已阻止重复读取':(r.result||'未有成功回执'))+
            (r.coordination?.heldCues||r.coordination?.heldOpportunities?' · 本轮同动作线索暂缓 '+((r.coordination.heldCues||0)+(r.coordination.heldOpportunities||0))+' 条（不等于完成或取消）':'')+
            (r.affinityMatched?' · 本轮选择的公开探索与可信共同兴趣相交（不代表因果或联系）':'')+' · '+formatLocalTime(new Date(r.at).toISOString())));
        }
      }catch{/* 额外的只读诊断不可影响原页面 */}
      if(!entries.length&&!intentions.length)add(list,info('当前账号还没有符合条件的线索：评论阅读临时观察、账号证据完整的跨日自主选片或跨日公开交流偏好；无记录不代表鱼鱼拒绝。'));
    }catch(e){status.textContent='读取生活契机失败：'+String(e.message||e).slice(0,150)}
  };
  $('life-opportunities-refresh').addEventListener('click',()=>run(loadLifeOpportunities));
  $('life-opportunities-reconsider').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'将使用现有自主调度的本日模型额度，让鱼鱼根据真实生活线索与已有探索意愿自行考虑。允许公开搜索、只读视频核实与已有 BV 作者的公开投稿探索；不允许评论、私信、关注或其它外部写入。继续？'}))return;
    const r=await request('/life-opportunities/reconsider',{});
    await loadLifeOpportunities();
    const names={'nothing-to-do':'当前没有可考虑的真实契机',quota:'今天自主决策额度已用完',busy:'当前有其他自主决策正在运行',disabled:'大肥鱼总开关未开启'};
    if(r.result==='metadata-read-failed')message('公开元数据核验未成功（技术失败，并非鱼鱼主动延期）：'+
      ({'metadata-timeout':'读取超时','metadata-rate-limited':'读取受限','metadata-read-busy':'读取预约冲突',
        'metadata-account-unavailable':'账号未就绪','metadata-response-invalid':'返回格式不可信',
        'metadata-bvid-mismatch':'实际 BV 不一致','metadata-title-missing':'标题缺失','metadata-api-error':'平台接口失败'}[r.diagnosticCode]||'原因未确定')+
      '。线索已进入有限重试，连续三次失败将暂停。');
    else if(r.ok===false)message('本轮未完成真实决策或执行：'+(r.diagnosticCode||r.error||'请查看诊断')+'，不算鱼鱼主动延期。',true);
    else message(r.skipped?(names[r.skipped]||'跳过：'+r.skipped):'本轮已记录鱼鱼的选择：'+(r.action||'未知')+(r.result?' · '+r.result:''));
  }));
  const loadLifeMemory=async()=>{await loadMainSession();await Promise.all([renderMemoryFlow(),renderInterests(),renderEmotion(),renderLifeTimeline(),loadLifeOpportunities()]);};
  $('main-life-refresh').addEventListener('click',()=>run(loadLifeMemory));
  $('main-memory-kind').addEventListener('change',()=>{document.querySelectorAll('[data-memory-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.memoryKind===$('main-memory-kind').value)));paintMemoryGarden();run(renderLongMemory)});
  document.querySelectorAll('[data-memory-kind]').forEach(b=>b.addEventListener('click',()=>{$('main-memory-kind').value=b.dataset.memoryKind;document.querySelectorAll('[data-memory-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));paintMemoryGarden();run(renderLongMemory)}));
  $('main-session-refresh').addEventListener('click',()=>run(()=>loadMainSession({setupOnly:onboarding?.completed!==true})));
  $('main-session-save').addEventListener('click',()=>run(async()=>{
    const id=$('main-session-id').value.trim();const body={mainSessionBridgeEnabled:$('main-session-enabled').checked,mainSessionId:id,mainSessionAutoSync:$('main-session-auto').checked};
    if(!id)body.clear=['mainSessionId'];const r=await request('/config',body);await loadMainSession({setupOnly:onboarding?.completed!==true});message(r.host?.ok===false?'主 Session 设置已保存到插件，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'主 Session 设置已保存，可返回首次设置继续完成必需步骤');
  }));
  $('main-session-sync-save').addEventListener('click',()=>run(async()=>{
    const body={mainSessionSyncMinutes:boundedInt('main-session-minutes',15,720,'同步间隔'),mainSessionDailyBatches:boundedInt('main-session-daily',1,24,'每日同步批次'),mainSessionBatchSize:boundedInt('main-session-batch',1,20,'每批经历数'),mainSessionIncludeComments:$('main-session-comments').checked};
    const r=await request('/config',body);await loadMainSession({setupOnly:onboarding?.completed!==true});message(r.host?.ok===false?'同步频率已保存，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'主 Session 同步频率已保存');
  }));
  $('main-session-test').addEventListener('click',()=>run(async()=>{await request('/main-session/test',{});message('连接测试已送到主 Session；它应该只回复“连接正常”')}));
  $('main-session-sync').addEventListener('click',()=>run(async()=>{const r=await request('/main-session/sync',{force:true});await loadMainSession();message(r.sent?`已把 ${r.sent} 条经历告诉主 Session，还有 ${r.pending} 条等待汇报`:'目前没有要告诉主 Session 的新经历')}));
  $('main-session-backfill').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'把过去 7 天尚未汇报的已选视频及已发评论加入本地队列？这不是等待 7 天，也不会立即发送。开启自动同步后会按设置的间隔尝试发送；未开启则可以手动发送。'}))return;const r=await request('/main-session/backfill',{days:7});await loadMainSession();message(`已从过去 7 天补入 ${r.added||0} 条经历，目前 ${r.pending||0} 条待汇报；本次未发送消息`)}));
  $('main-session-history-search').addEventListener('click',()=>run(searchFishMemory));
  $('main-session-history-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run(searchFishMemory)}});
  $('main-memory-search').addEventListener('click',()=>run(renderLongMemory));
  $('main-reflection-refresh').addEventListener('click',()=>run(renderLifeReflection));
  $('main-reflection-run').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'现在让大肥鱼对当前待处理经历做一次人生反思？这会产生一次受限模型调用，但不会给模型 B站发送、文件、Shell 或任意网络工具。'}))return;const r=await request('/main-session/reflection/run',{});await renderLifeReflection();await renderLongMemory();await renderMemoryFlow();if(!sandboxActive&&!aiDebugActive)await loadPersonalityEvolution(false);const domainLabel=({'public-event':'公开经历','owner-private':'主人私有经历','friend-private':'好友私有经历'})[r.domain]||'经历';const reasonText=({'model-no-insight':'模型没有提出值得长期保存的新领悟，这可能是正常筛选结果','quality-rejected':'模型提案未通过质量校验，可在已评估候选中查看拒绝原因','not-committed':'已有合格提案，但未新增保存，可能属于重复认识','created':'已形成新的长期认识'})[r.diagnosis]||'';const growth=r.personalityEnabled?`；人格模型候选 ${r.personalityProposed||0} 条，采纳 ${r.personalityAccepted||0} 条；真实探索／社交弱观察 ${r.personalityObserved||0} 条${r.domain==='public-event'?'':'（仅匿名低权重特质，不公开私密内容）'}`:'；这次未开启人格成长';message(`${domainLabel}：评估 ${r.processed||0} 条，形成长期认识 ${r.created||0} 条${r.qualityRejected?`，另有 ${r.qualityRejected} 条领悟未通过质量校验`:''}${growth}${reasonText?'；'+reasonText:''}`)}));
  $('main-memory-test').addEventListener('click',()=>run(async()=>{
    const query=$('main-memory-test-query').value.trim();if(!query)throw Error('请输入检索主题');
    $('main-memory-test-result').textContent='正在检索…';
    const result=await request('/main-session/memory/recall',{query});
    const diag=result.diagnostic?.last||{};
    $('main-memory-test-result').textContent=`路径：${result.reason||'local'} · 候选：${diag.candidateCount||0} · 命中：${(result.ids||[]).length} 条 · ${result.usedModel?'使用了独立模型':'未调用独立模型'}\n${result.context||'没有相关记忆'}`;
  }));
  $('main-memory-consolidation-run').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'现在尝试凝练同主题的主人聊天普通记忆？将调用受限记忆模型，保留来源 ID；稳定事实与人生经历不参与。'}))return;const r=await request('/main-session/memory/consolidate',{confirm:'CONSOLIDATE_OWNER_CHAT'});await renderLongMemory();message(r.added?`已凝练 ${r.added} 组，原记忆保留可追溯的替代记录。`:`没有生成新凝练记忆（${r.skipped||r.reason||'证据或质量条件不足'}）。`)}));
    $('main-memory-save').addEventListener('click',()=>run(async()=>{const body={mainSessionMemoryEnabled:$('main-memory-enabled').checked,mainSessionMemoryAutoBili:$('main-memory-auto-bili').checked,mainSessionMemorySemanticEnabled:$('main-memory-semantic').checked,mainSessionMemoryCandidates:boundedInt('main-memory-candidates',12,80,'候选条数'),mainSessionMemorySearchDailyLimit:boundedInt('main-memory-search-daily',0,500,'检索每日调用'),mainSessionReflectionAuto:$('main-reflection-auto').checked,mainSessionReflectionMinCandidates:boundedInt('main-reflection-min',2,30,'反思候选阈值'),mainSessionReflectionBatchSize:boundedInt('main-reflection-batch',4,24,'反思批次大小'),mainSessionReflectionIntervalHours:Math.max(1,Math.min(48,Number($('main-reflection-hours').value)||1)),mainSessionReflectionDailyBatches:boundedInt('main-reflection-daily',1,16,'每日反思批次'),mainSessionMemoryHalfLifeDays:Number($('main-memory-half-life').value)||30,mainSessionMemoryThreshold:Number($('main-memory-threshold').value)||0.35,mainSessionMemoryMaxItems:boundedInt('main-memory-max-items',1,12,'召回条数'),mainSessionMemoryMaxChars:boundedInt('main-memory-max-chars',200,3000,'记忆字数'),mainSessionMemoryDailyQuota:boundedInt('main-memory-daily',1,100,'每日记忆数'),mainSessionMemoryConsolidationEnabled:$('main-memory-consolidation-enabled').checked,mainSessionMemoryFactsMax:boundedInt('main-memory-facts',0,6,'长期事实条数')};const r=await request('/config',body);await renderLongMemory();await renderLifeReflection();message(r.host?.ok===false?'记忆与反思设置已保存到插件，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'记忆与反思设置已保存')}));
  $('main-memory-import').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'把当前主 Session 在 %USERPROFILE%/.dsh/fish-memory/ 下的旧记忆合并到大肥鱼统一身份记忆？不会删除旧文件。'}))return;const r=await request('/main-session/memory/import-fish',{});await renderLongMemory();message(`已导入 ${r.added||0} 条旧记忆；当前共 ${r.total||0} 条`)}));
  $('main-memory-add').addEventListener('click',()=>run(async()=>{const text=$('main-memory-add-text').value.trim();if(!text)throw Error('请输入要加入的记忆');await request('/main-session/memory/add',{text,importance:0.8,tags:['主人手动']});$('main-memory-add-text').value='';await renderLongMemory();message('长期记忆已加入')}));
  const loadLifeMemoryHealth=async()=>{
    const x=await request('/life-memory/status');const c=x.counts||{};
    $('life-memory-health').textContent=`可衰减副本 ${x.total||0} 条：清晰 ${c.clear||0} · 模糊 ${c.fuzzy||0} · 印象 ${c.trace||0} · 已遗忘 ${c.forgotten||0} · 归档事件 ${x.archiveEvents||0} 条 / ${x.archiveMonths||0} 个月 · 半衰期 ${x.halfLifeDays||30} 天。两者不是一一对应；永久档案不会被日常 AI 读取。`;
  };
  $('life-memory-health-refresh').addEventListener('click',()=>run(loadLifeMemoryHealth));
  // v2.4.69: a user-configured local directory, not system Temp; no extra AI calls.
  const loadBackupDirectory=async()=>{
    const r=await request('/config');const dir=String(r.config?.backupDirectory||'');
    $('backup-directory').value=dir;
    $('backup-directory-status').textContent=dir?'当前保存位置：'+dir:'尚未设置，请先填写并验证本机目录';
  };
  $('backup-directory-save').addEventListener('click',()=>run(async()=>{
    const path=$('backup-directory').value.trim();
    if(!path)throw Error('请输入备份目录，例如 D:\\大肥鱼备份');
    const btn=$('backup-directory-save');btn.disabled=true;
    try{
      const r=await request('/data-backup/location',{directory:path});
      $('backup-directory').value=r.directory;
      $('backup-directory-status').textContent='目录已验证、可写且已保存：'+r.directory;
      message('备份目录已保存：'+r.directory);
    }finally{btn.disabled=false}
  }));
  // Backup import/export stays entirely local. A second explicit confirmation is required.
  let selectedBackup = null;
  $('backup-export').addEventListener('click',()=>run(async()=>{
    const button=$('backup-export');button.disabled=true;$('backup-progress').textContent='正在收集设置、成长经验与 SQLite 梗库…';
    try{
      const r=await request('/data-backup/export',{});
      const summary=r.summary||{};
      const ruleText=summary.memeRules===null||summary.memeRules===undefined?'未包含自定义表情检索规则':`自定义表情检索规则 ${summary.memeRules} 条`;
      $('backup-progress').textContent=`备份完成，文件已保存到：${r.filePath}。包含 ${summary.count??0} 个业务文件、${summary.databases??0} 个 SQLite 数据库、${summary.configKeys??0} 项设置、${ruleText}。不会触发浏览器下载。`;
      message('数据备份已保存到指定目录');
    }catch(e){
      $('backup-progress').textContent='备份未完成：'+String(e?.message||e).slice(0,300);
      throw e;
    }finally{button.disabled=false}
  }));

  let selectedMemoryBackup=null;
  $('memory-backup-export').addEventListener('click',()=>run(async()=>{
    const button=$('memory-backup-export');button.disabled=true;$('memory-backup-export-status').textContent='正在保存永久档案、可衰减经历与长期认识…';
    try{
      const r=await request('/main-session/memory/backup/export',{}),s=r.summary||{};
      $('memory-backup-export-status').textContent=`已保存：${r.filePath} · ${s.count??0} 个文件 · 永久档案 ${s.archiveMonths??0} 个月 · SHA-256 已校验`;
      message('大肥鱼完整人生记忆已单独备份');
    }catch(e){
      $('memory-backup-export-status').textContent='专项备份未完成：'+String(e?.message||e).slice(0,300);
      throw e;
    }finally{button.disabled=false}
  }));
  $('memory-backup-import-file').addEventListener('change',()=>run(async()=>{
    selectedMemoryBackup=null;$('memory-backup-restore').disabled=true;
    const file=$('memory-backup-import-file').files?.[0];if(!file){$('memory-backup-inspect').textContent='尚未选择记忆备份';return}
    if(file.size<=0||file.size>65_000_000)throw Error('记忆备份必须在 65MB 以内');
    const backup=JSON.parse(await file.text()),r=await request('/main-session/memory/backup/inspect',{backup});
    selectedMemoryBackup=backup;const m=r.summary||{};
    $('memory-backup-inspect').textContent=`SHA-256 校验通过：${m.count??0} 个文件 · 永久档案 ${m.archiveMonths??0} 个月 · ${(m.bytes/1024/1024).toFixed(2)} MB。恢复双层记忆与反思记录，不修改设置或凭证，需完全重启 DSH。`;
    $('memory-backup-restore').disabled=false;
  }));
  $('memory-backup-restore').addEventListener('click',()=>run(async()=>{
    if(!selectedMemoryBackup)throw Error('请先选择并校验记忆备份');
    if(!await confirmAction({title:'请确认操作',description:'确定用这份备份恢复大肥鱼双层人生记忆吗？此操作需要重启 DSH；恢复前会自动备份当前全部人生记忆。'}))return;
    const button=$('memory-backup-restore');button.disabled=true;$('memory-backup-inspect').textContent='正在保存当前记忆快照并恢复…';
    try{
      const r=await request('/main-session/memory/backup/restore',{backup:selectedMemoryBackup,confirm:'RESTORE_DAFEIYU_MEMORY'}),m=r.summary||{};
      $('memory-backup-inspect').textContent=`恢复完成：${m.restoredFiles??m.count??0} 个文件；恢复前快照：${r.safeguardPath}。请完全重启 DSH。`;
      selectedMemoryBackup=null;$('memory-backup-import-file').value='';await renderLongMemory();message('人生记忆恢复完成，请完全重启 DSH');
    }finally{button.disabled=!selectedMemoryBackup}
  }));
  $('backup-import-file').addEventListener('change',()=>run(async()=>{
    selectedBackup=null;$('backup-restore').disabled=true;
    const file=$('backup-import-file').files?.[0];
    if(!file){$('backup-inspect').textContent='尚未选择文件';return}
    if(file.size>90_000_000)throw Error('备份文件超过 90 MB 限制');
    const backup=JSON.parse(await file.text());
    const r=await request('/data-backup/inspect',{backup});
    selectedBackup=backup;
    $('backup-inspect').textContent=`校验通过：${r.summary.createdAt||'未知时间'} · ${r.summary.configKeys} 项设置 · ${r.summary.count} 个业务文件 · ${r.summary.databases} 个 SQLite 库 · 永久档案 ${r.summary.archiveMonths??0} 个月 · SHA-256 已校验 · ${r.summary.memeRules===null||r.summary.memeRules===undefined?'无自定义表情检索规则':r.summary.memeRules+' 条表情检索规则'}；恢复会覆盖同名的现有业务数据。`;
    $('backup-restore').disabled=false;
  }));
  $('backup-restore').addEventListener('click',()=>run(async()=>{
    if(!selectedBackup)throw Error('请先选择并校验备份文件');
    if(!await confirmAction({title:'请确认操作',description:'即将覆盖当前设置、成长经验、梗知识、评论与私信状态！恢复前会自动保存当前数据快照。请先暂停后台自动任务。确定继续？'}))return;
    if(!await confirmAction({title:'请确认操作',description:'最后确认：要以选中的备份恢复大肥鱼数据吗？恢复成功后必须完全重启 DSH。'}))return;
    const button=$('backup-restore');button.disabled=true;$('backup-progress').textContent='正在保存当前数据安全快照并执行恢复…';
    try{
      const result=await request('/data-backup/restore',{backup:selectedBackup,confirm:'RESTORE_VERIFIED_DATA'});
      $('backup-progress').textContent=`恢复完成：${result.restoredFiles} 个业务文件、${result.restoredDbs} 个数据库。旧数据安全快照：${result.safeguardPath}。请完全重启 DSH。`;
      message('数据恢复成功，请完全重启 DSH');
      selectedBackup=null;
    }finally{button.disabled=!selectedBackup}
  }));
  $('meme-auto-save').addEventListener('click',()=>run(async()=>{
    await request('/config',{memeMemoryEnabled:$('meme-auto-enabled').checked});
    await loadMemeLearning();message('梗与网络文化学习设置已保存');
  }));
  const loadMemeLearning=async()=>{
    const r=await request('/meme-learning');
    $('meme-auto-enabled').checked=r.enabled===true;
    $('meme-reflection-status').textContent='线索池待反思：'+(r.pending||0)+' 条 · '+(r.enabled?'自动收集中':'收集暂停')+(r.lastRunAt?' · 最近反思：'+new Date(r.lastRunAt).toLocaleString():'');
  };
  $('meme-learning-refresh').addEventListener('click',()=>run(loadMemeLearning));
  $('meme-learning-run').addEventListener('click',()=>run(async()=>{
    const r=await request('/meme-learning/reflect',{});
    await loadMemeLearning();await memeList();
    message(r.skipped?'未形成新知识：'+r.skipped:'本次新增 '+(r.created||0)+' 条网络文化知识（待核实证据等级）');
  }));

  const loadHomeOverview=async()=>{
    // 只读生活总览：每张卡独立容错，不因为某个子系统故障掩盖其他信息。
    const resources=await Promise.allSettled([request('/life-memory/status'),request('/emotion-state'),request('/relationships?limit=1')]);
    const [memory,mood,friends]=resources.map(r=>r.status==='fulfilled'?r.value:null);
    const counts=memory?.counts||{};
    $('home-overview-memory').textContent=memory?`清晰 ${Number(counts.clear)||0} · 模糊 ${Number(counts.fuzzy)||0} · 印象 ${Number(counts.trace)||0}（已遗忘的细节不会恢复）`:'记忆概况暂不可用，可前往人生记忆查看';
    const emotion=mood?.state||mood||{};
    const labels={joyful:'开心',curious:'好奇',warm:'温暖',calm:'平静',tired:'疲惫',sad:'低落',irritated:'烦躁',neutral:'平稳'};
    $('home-overview-mood').textContent=mood?`当前：${labels[emotion.mood]||emotion.label||'平稳'}（模拟状态） · 活力 ${Math.max(0,Math.min(100,Number(emotion.energy)||0))}`:'心情暂不可用，可前往人生记忆查看';
    $('home-overview-social').textContent=friends?`已记录社会关系 ${Number(friends.total)||0} 位（含白名单基线）· 友情来自真实交流，不代表额外操作授权`:'好友近况暂不可用，可前往社交互动查看';
  };
  const loadHome=async()=>{
    if(onboarding && !onboarding.completed){await loadMainSession({setupOnly:true});return;}
    await Promise.all([loadMainSession(),loadHomeOverview()]);
  };
  const loadSocial=async()=>{await Promise.all([loadSocialFriends(),loadSocialIntents(),loadOwnerDmAgentSettings(),loadCommentSettings(),renderEmotion()])};
  // One read-only Life integration view over the existing stores: no second
  // personality/interest/todo/experience database and no model API calls.
  const loadLifeIntegration=async()=>{
    const labels={connected:'已接线',unavailable:'无法读取'};
    const put=(id,value)=>{$(id).textContent=value};
    try{
      const r=await request('/life-agent/integration-status');
      const mode=r.masterEnabled===false?'总开关关闭（不会启动生活决策）':({off:'暂停',shadow:'影子观察',active:'自主探索'}[r.mode]||'未知');
      put('life-link-planner',mode+' · 今日生活决策 '+(r.decision?.runsToday||0)+' 次，社交只读关注 '+(r.decision?.socialAttentionToday||0)+' 次');
      put('life-link-memory',(labels[r.memory?.state]||'无法读取')+' · 目前可回忆 '+(r.memory?.recallable||0)+' 条 · 待补偿投影 '+(r.memory?.projectionPending||0)+' 项');
      put('life-link-todos',(labels[r.todos?.state]||'无法读取')+' · 未完成 '+(r.todos?.open||0)+'、延期 '+(r.todos?.deferred||0)+'、结果未知 '+(r.todos?.uncertain||0));
      put('life-link-interests',(labels[r.interests?.state]||'无法读取')+' · 当前合格选片方向 '+(r.interests?.eligibleTopics||0)+' 个（不等于已观看）');
      put('life-link-personality',(labels[r.personality?.state]||'无法读取')+' · '+(r.personality?.enabled?'成长证据评估已开启':'成长评估已关闭')+' · 有证据特质 '+(r.personality?.evidenceTraits||0)+' 类；待反思 '+(r.reflection?.pending||0)+' 项');
      put('life-link-social',r.social?.decisionOwner==='life'?'两渠道已记录 Life 决策归属 · 真实平台仍待验收':
        r.social?.decisionOwner==='mixed'?'部分渠道处于 Life 维护试点 · 其他仍由旧聊天处理器负责':
        '当前由原有聊天系统回复 · 新 Life 尚未接管');
      const gaps=[['记忆协调',r.memory?.coordinator],['人生记忆',r.memory?.state],['反思',r.reflection?.state],['人格',r.personality?.state],['待办',r.todos?.state],['兴趣',r.interests?.state],['关系',r.relationships?.state]].filter(x=>x[1]!=='connected');
      put('life-integration-warning',(gaps.length?'接线异常或尚未就绪：'+gaps.map(x=>x[0]).join('、')+'。':'各数据源可读取。')+' 真实兴趣/经历只是选择线索；人格成长需经过核验、反思与当前记忆可见性校验。社交归属仍在分渠道交接，当前 dev.7 需真实平台及长期验收。');
    }catch(e){
      put('life-integration-warning','Life 接线状态读取失败：'+String(e?.message||e).slice(0,120)+'。不能据此宣称各系统运行正常。');
      for(const id of ['life-link-planner','life-link-memory','life-link-todos','life-link-interests','life-link-personality','life-link-social'])put(id,'读取失败');
    }
  };
  $('life-integration-refresh').addEventListener('click',()=>run(async()=>{await Promise.all([loadLifeIntegration(),loadUnifiedLifeSettings()]);message('已刷新 Life 总览；不调用模型或平台发送接口。')}));
  const loaders={firststart:loadFirstStart,models:loadModels,bili:loadBili,dynamic:loadDailyDynamic,backup:async()=>{await loadBackupDirectory();await loadLifeMemoryHealth()},diagnostics:loadDiagnostics,reports:loadReport,quotas:loadQuotas,polling:loadPolling,persona:loadPersona,social:loadSocial,home:loadHome,'life-agent':async()=>{await Promise.all([loadUnifiedLifeSettings(),loadLifeIntegration(),loadOwnerTodos()])},life:loadLifeMemory,todos:()=>loadOwnerTodos(),relationships:async()=>{await loadRelationshipSettings();await loadFriendRelationships()},dm:loadDmAll,comments:loadCommentsAll,growth:growthList,personality:async()=>{if(aiDebugActive&&aiDebugPreview){await loadPersonalityEvolution(true,aiDebugHistory.length,aiDebugPreview)}else if(sandboxActive){await loadPersonalityEvolution(true,sandboxStep);startSandboxTimer()}else await loadPersonalityEvolution(false)},meme:async()=>{await memeList();await loadMemeLearning()},stickers:loadStickers};
  // 直接刷新或复制管理页链接时仍回到当前子页面；非法 tab 安全回退到默认页。
  let initialTab=null;
  let legacySettingsTarget=null;
  try{
    const url=new URL(location.href),saved=url.searchParams.get('tab');
    if(saved==='settings'){
      // 旧书签向后兼容：原插件设置三个区块仍有稳定锚点。
      legacySettingsTarget=url.hash==='#settings-sync'?'home-sync-settings':url.hash==='#settings-todo'?'settings-todo':'life-memory-settings';
      initialTab=legacySettingsTarget==='home-sync-settings'?'home':legacySettingsTarget==='settings-todo'?'todos':'life';
    }else if(tabNames.includes(saved))initialTab=saved;
  }catch{}
  (async()=>{
    try{
      const state=await loadFirstStart();
      if(!state.welcomeSeen)await request('/onboarding/welcome',{});
      if(!state.completed || !state.requiredReady)switchTab('firststart');
      else switchTab(initialTab||'home');
    }catch(e){renderFirstStart(null);switchTab('firststart');message('首次设置状态未就绪：'+String(e?.message||e),true)}
  })();
  if(legacySettingsTarget){
    const target=$(legacySettingsTarget);
    if(target){target.open=true;target.scrollIntoView({behavior:'auto',block:'start'})}
  }
})();
