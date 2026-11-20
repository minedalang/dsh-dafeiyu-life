'use strict';
// No eval/innerHTML for user-supplied strings. Same-origin local console only.
(() => {
  // Pure draft-tracker contract is mirrored by the focused Node test helper; this stays inline for the classic script.
  const createSettingDraftTracker=()=>{
    const baselines=new WeakMap(),drafts=new Map();
    const snapshot=field=>field?.type==='checkbox'||field?.type==='radio'?{checked:field.checked===true}:
      field?.multiple&&field.selectedOptions?{values:[...field.selectedOptions].map(x=>String(x.value)).sort()}:{value:String(field?.value??'')};
    const key=value=>JSON.stringify(value);
    return {drafts,capture(field){if(!field||baselines.has(field))return false;baselines.set(field,snapshot(field));return true;},
      change(field,save,panel='当前页面'){if(!field||!save||!baselines.has(field))return false;const baseline=baselines.get(field);let row=drafts.get(save.id);
        if(key(snapshot(field))===key(baseline)){row?.fields?.delete(field);if(!row?.fields?.size)drafts.delete(save.id);}
        else{if(!row){row={panel,save,fields:new Set()};drafts.set(save.id,row);}row.fields.add(field);}return drafts.has(save.id);},
      saved(save){if(!save?.id||!drafts.has(save.id))return false;const row=drafts.get(save.id);for(const field of row?.fields||[])baselines.set(field,snapshot(field));drafts.delete(save.id);return true;},
      has:()=>drafts.size>0,clear:()=>drafts.clear()};
  };
  const API='/api/bili-duty';
  // DSH Mobile's Android WebView is a remote companion, not a privileged local
  // management session. Do not send state-changing requests that the gateway
  // may reject; let the user inspect data and finish setup on the host PC.
  const mobileViewOnly=typeof navigator!=='undefined'&&/Android/i.test(String(navigator.userAgent||''));
  const mobileDesktopHint='此项需要在运行 DSH 的电脑端管理中心完成；DSH Mobile 手机端目前仅供查看。';
  const mobileReadOnlySelector='[data-tab],[data-open-tab],[data-open-settings],[data-nav-tab],[data-memory-kind],#refresh,#headless-sync-refresh,#models-refresh,#life-behavior-refresh,#life-growth-refresh,#release-281-close,#release-281-view-setup';
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
  let toastTimer=null,pendingRequests=0,embeddingPollTimer=null,localEmbeddingEnabled=false;
  let saveWriteCount=0,saveClickTarget=null,finishSettingsSave=()=>{};
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
    const before=$('message').textContent,saveIntent=saveClickTarget,saveWritesBefore=saveWriteCount;
    if(button){button.disabled=true;button.classList.add('is-busy');button.setAttribute('aria-busy','true')}
    message('正在处理，请稍候…');
    try{await fn();finishSettingsSave(saveIntent,saveWriteCount>saveWritesBefore);if($('message').textContent==='正在处理，请稍候…'||$('message').textContent===before)message('操作已完成')}
    catch(e){message(e?.message||'操作失败',true)}
    finally{if(button){button.disabled=(mobileViewOnly&&!mobileButtonAllowed(button))||button.dataset.readinessDisabled==='true';button.classList.remove('is-busy');button.removeAttribute('aria-busy')}}
  };
  const request=async(path,body)=>{
    // Security boundary is also server-side; this is a UX guard, not auth.
    if(mobileViewOnly&&body!==undefined)throw Error(mobileDesktopHint);
    const indicator=$('request-indicator');pendingRequests++;indicator.hidden=false;
    const controller=typeof AbortController==='function'?new AbortController():null;const timeoutMs=path==='/dsh-vision/verify'?240000:120000;
    const timeout=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
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
      // An intentionally deferred connectivity probe is normal throttling,
      // not an HTTP or platform connection failure.
      if(path==='/dm-network-check'&&data?.deferred===true)return data;
      if(!res.ok||data?.ok===false){
        if(mobileViewOnly&&(res.status===401||res.status===403))
          throw Error('此项在手机端不可用，请在电脑端管理中心查看或操作。');
        const raw=String(data?.error||'请求失败');
        if(path==='/daily-dynamic/delete'&&res.status===404&&/^unknown POST \/api\/bili-duty\/daily-dynamic\/delete$/.test(raw))
          throw Error('运行中的 DSH 插件后端仍是旧版，不支持草稿删除。请确认加载的是当前 dev 源码，重启 DSH 后强制刷新管理页面（Ctrl+F5）。');
        throw Error(raw.slice(0,220));
      }
      // A preview or diagnostic request is not a confirmed saved setting.
      if(body!==undefined&&body?.previewOnly!==true&&!/(?:preview|verify|probe|status|diagnostic|repair|dm-contact-check|dm-contact-reconsider)/i.test(path))saveWriteCount++;
      return data;
    }catch(e){if(e?.name==='AbortError')throw Error(path==='/dsh-vision/verify'?
      '图片验收请求超时，后台可能仍在结束；请先刷新图片验收状态，不要立即重复发起。':
      '请求超过120秒仍未完成。请查看诊断或模型配置；若涉及对外发送，请先核实结果，避免重复操作。');throw e}
    finally{clearTimeout(timeout);pendingRequests=Math.max(0,pendingRequests-1);indicator.hidden=pendingRequests===0}
  };
  // A save assistant for the EXISTING independently saved settings groups.
  // Never auto-commit social permissions or silently pick a save handler among
  // ambiguous multi-form sections. Only native save buttons perform writes.
  const settingDraftTracker=createSettingDraftTracker();
  const settingDrafts=settingDraftTracker.drafts;
  const saveHint=$('settings-save-hint');
  const saveHintText=$('settings-save-hint-text');
  const saveHintAction=$('settings-save-hint-action');
  const saveButtonSelector='button[id]';
  const isSaveControl=button=>button?.matches?.(saveButtonSelector)&&
    /(?:保存|确认并保存|应用到 Headless)/.test(button.textContent||'')&&
    /save|apply/.test(button.id||'')&& !button.closest('dialog');
  const settingPanel=element=>element?.closest?.('section[id^="panel-"]');
  const scopeSaveControls=scope=>[...scope?.querySelectorAll?.(saveButtonSelector)||[]].filter(isSaveControl);
  const saveForField=field=>{
    const panel=settingPanel(field);if(!panel)return null;
    // The model page contains a whole-page model route save and independent
    // FFmpeg/Whisper and meme writes. Prefer the explicit owning form.
    const special={
      'models-comment-memes':'models-memes-save','models-comment-memes-debug':'models-memes-save',
      'models-ffmpeg-path':'models-ffmpeg-path-save','models-whisper-model-path':'models-whisper-path-save'
    };
    let direct=special[field.id];
    // Whole-panel legacy forms live below long lists; map only unambiguous
    // configuration IDs to the existing owning save transaction.
    if(!direct&&panel.id==='panel-bili'&&field.id?.startsWith('bili-'))
      direct=field.id.startsWith('bili-vision-plan-')?'bili-vision-plan-save':'bili-save';
    if(!direct&&panel.id==='panel-quotas'&&field.id?.startsWith('quota-'))direct='quota-save';
    if(!direct&&panel.id==='panel-dynamic'&&
      (field.id?.startsWith('bili-daily-')||field.id==='bili-sync-comment'||field.id==='daily-dynamic-limit'))direct='bili-dynamic-save';
    if(!direct&&panel.id==='panel-home'&&['main-session-minutes','main-session-daily','main-session-batch','main-session-comments'].includes(field.id))direct='main-session-sync-save';
    if(!direct&&panel.id==='panel-relationships'&&field.id?.startsWith('social-memory-half-'))direct='social-memory-policy-save';
    if(!direct&&panel.id==='panel-diagnostics'&&field.id?.startsWith('diag-')&&field.id.endsWith('-enabled'))direct='diag-save';
    if(!direct&&panel.id==='panel-social'){
      if(['social-stranger-inspiration','social-friend-invitations','social-invitation-auto'].includes(field.id))direct='social-dev5-save';
      else if(['friend-at-feedback-enabled','friends-mode'].includes(field.id))direct='friend-save-all';
      else if(field.id==='life-public-interaction-enabled')direct='life-public-interaction-save';
    }
    if(!direct&&panel.id==='panel-models'){
      if(field.id?.startsWith('models-aux-')||['models-transcribe','models-asr-model'].includes(field.id))direct='models-aux-save';
      else if(field.id?.startsWith('model-')||field.id?.startsWith('models-default-')||['models-interaction-context-mode','models-vision-mode','models-vision-enabled','models-vision-debug'].includes(field.id))direct='models-save';
    }
    if(direct&&isSaveControl($(direct)))return $(direct);
    let scope=field.closest('.quick-config-section,.settings-section,.fs-step,.card,.quick-settings-home');
    // With several distinct save handlers in one block, do not guess.
    while(scope&&panel.contains(scope)){
      const candidates=scopeSaveControls(scope);
      if(candidates.length===1)return candidates[0];
      if(candidates.length>1)return null;
      scope=scope.parentElement?.closest('.quick-config-section,.settings-section,.fs-step,.card,.quick-settings-home')||null;
    }
    const candidates=scopeSaveControls(panel);
    return candidates.length===1?candidates[0]:null;
  };
  const captureSettingBaseline=event=>{
    const target=event.target;
    const field=target?.closest?.('input,select,textarea')||target?.closest?.('label')?.control||null;
    if(!field||!saveForField(field))return;
    if(event.type==='keydown'&&![' ','Enter','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    if(field.type==='radio'&&field.name){
      const group=[...(field.form?.elements||document.querySelectorAll('input[type="radio"]'))].filter(x=>x.type==='radio'&&x.name===field.name&&x.form===field.form);
      for(const item of group)if(saveForField(item))settingDraftTracker.capture(item);
    }else settingDraftTracker.capture(field);
  };
  document.addEventListener('beforeinput',captureSettingBaseline,true);
  document.addEventListener('pointerdown',captureSettingBaseline,true);
  document.addEventListener('keydown',captureSettingBaseline,true);
  const summarizeSaveDrafts=()=>{
    if(!saveHint)return;
    const count=settingDrafts.size;
    saveHint.hidden=count===0||mobileViewOnly;
    if(!count)return;
    const activePanel=document.querySelector('section[id^="panel-"]:not([hidden])');
    const local=[...settingDrafts.values()].filter(item=>item.panel===activePanel);
    const chosen=local.at(-1)||[...settingDrafts.values()].at(-1);
    saveHintText.textContent=count===1?'此处修改尚未保存。'+(chosen?.save?'点击保存将使用原设置分组的保存规则。':'请找到所属分组的保存按钮。'):
      `有 ${count} 组设置尚未保存；请逐组确认，不能一次混合提交。`;
    saveHintAction.textContent=local.length===1?'保存本组设置':'请到所属分组保存';
    saveHintAction.disabled=local.length!==1||!local[0]?.save||local[0].save.disabled;
    saveHint.dataset.pending=String(count);
  };
  const trackSettingChange=event=>{
    const field=event.target;
    if(mobileViewOnly||!field?.matches?.('input,select,textarea')||field.disabled||field.readOnly||
      field.matches('input[type="search"],input[type="file"],input[type="hidden"],input[type="button"]')||
      field.closest('dialog,.settings-finder,.headless-sync-board'))return;
    const panel=settingPanel(field),save=saveForField(field);
    if(!panel||!save)return;
    // Only a user edit whose pre-change value was captured can mark a draft.
    // Returning the field to its baseline clears the unsaved marker again.
    if(field.type==='radio'&&field.name){
      const group=[...(field.form?.elements||document.querySelectorAll('input[type="radio"]'))].filter(x=>x.type==='radio'&&x.name===field.name&&x.form===field.form);
      for(const item of group){const owner=saveForField(item);if(owner)settingDraftTracker.change(item,owner,settingPanel(item));}
    }else settingDraftTracker.change(field,save,panel);
    summarizeSaveDrafts();
  };
  document.addEventListener('input',trackSettingChange,true);
  document.addEventListener('change',trackSettingChange,true);
  document.addEventListener('click',event=>{
    const clicked=event.target?.closest?.('button');
    saveClickTarget=isSaveControl(clicked)?clicked:null;
  },true);
  saveHintAction?.addEventListener('click',()=>{
    // The sticky bar is itself a save control, NOT a navigation shortcut.
    // Never move the viewport or focus to the original form's distant button.
    const activePanel=document.querySelector('section[id^="panel-"]:not([hidden])');
    const own=[...settingDrafts.values()].filter(item=>item.panel===activePanel);
    if(own.length!==1||!own[0].save||own[0].save.disabled)return;
    // Reuse the original transaction, validation and finishSettingsSave hook.
    // Calling click() on the underlying button does not require scrolling.
    own[0].save.click();
  });
  finishSettingsSave=(button,success)=>{
    if(!button||!success||!settingDrafts.has(button.id))return;
    settingDraftTracker.saved(button);
    summarizeSaveDrafts();
  };
  // Never persist draft text in localStorage, URLs, logs, or cross-origin APIs.
  // Browser-native navigation warning is allowed for the unsaved form state.
  window.addEventListener('beforeunload',event=>{
    if(!settingDrafts.size)return;
    event.preventDefault();event.returnValue='';
  });
  // A passive reminder is retained when switching sections: DOM edits are not
  // discarded until a caller deliberately reloads a panel or the page.
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
  let liveRecentSnapshot=false;let knownRecentKeys=new Set();
  let liveNowContentFingerprint='';
  const refreshLiveNow=async()=>{
    const title=$('life-now-title');if(!title)return;
    try{
      const result=await request('/live-activity');
      const active=Array.isArray(result.active)?result.active:[];
      const item=active[0];
      const liveFingerprint=JSON.stringify([item?.title,item?.detail,item?.since]);
      const liveChanged=liveNowContentFingerprint!==''&&liveFingerprint!==liveNowContentFingerprint;
      liveNowContentFingerprint=liveFingerprint;
      title.textContent=item?.title||'鱼鱼现在没有正在执行的动作';
      $('life-now-detail').textContent=item?.detail||'正在休息或等待下一次自主选择；这不是模拟的活动。';
      $('life-now-time').textContent=item?.since?'开始于 '+new Date(item.since).toLocaleTimeString('zh-CN'):'仅显示本进程已确认的运行中任务';
      if(liveChanged){
        for(const element of [title,$('life-now-detail')]){
          element.classList.remove('is-arriving');void element.offsetWidth;element.classList.add('is-arriving');
        }
      }
      const list=$('life-now-recent');const rows=(result.recent||[]).slice(-5).reverse();
      const incomingKeys=new Set(rows.map(row=>String(row.seq||row.at)+'|'+String(row.kind||'')));
      const fingerprint=JSON.stringify(rows.map(row=>[row.seq,row.at,row.kind,row.text]));
      if(list.dataset.fingerprint!==fingerprint){
        list.replaceChildren();let newCount=0;
        for(const row of rows){
          const card=node('div','','life-now-recent-item');
          const key=String(row.seq||row.at)+'|'+String(row.kind||'');
          if(liveRecentSnapshot&&!knownRecentKeys.has(key)){card.classList.add('is-arriving');card.style.animationDelay=Math.min(newCount++*70,210)+'ms'}
          add(card,node('span',new Date(row.at).toLocaleTimeString('zh-CN'),'muted'),node('span',row.text||'已完成一项活动'));
          list.appendChild(card);
        }
        list.dataset.fingerprint=fingerprint;
      }
      knownRecentKeys=incomingKeys;liveRecentSnapshot=true;
    }catch(e){title.textContent='暂时无法核对实时动作';$('life-now-detail').textContent='请检查账号与管理中心连接';}
  };
  // Managed SSE stream below updates this pane only when the underlying facts change.
  const refresh=()=>loaders[active]();
  // dev49: activity ticker removed; diagnostics use the existing local health snapshot only.
  const tabNames=['firststart','persona','social','home','models','bili','dynamic','life-agent','plans','life','relationships','personality','comments','dm','growth','stickers','meme','quotas','polling','open-platform','reports','diagnostics','backup'];
  let onboarding=null;
  const skipFirstStart=new Set();
  const switchTab=tab=>{
    // Do not destroy editable DOM fields by reloading another tab silently.
    if(tab!==active&&[...settingDrafts.values()].some(item=>item.panel.id==='panel-'+active)){
      message('当前页面有未保存的修改。请先使用底部保存栏，或明确选择放弃修改。',true);
      return;
    }
    if(tab==='todos')tab='plans'; // old todo bookmarks open the real plans page
    if(!tabNames.includes(tab))return;
    if(onboarding && !(onboarding.welcomeCompleted??onboarding.completed) && !['firststart','models','home'].includes(tab))tab='firststart';
    if(tab!=='personality')haltSandboxTimer();
    active=tab;
    for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`)?.setAttribute('aria-selected',String(t===tab))}
    const selectedNav=document.querySelector(`.tabs [data-tab="${tab}"]`),navTrack=selectedNav?.closest?.('.tabs');
    if(navTrack&&navTrack.scrollWidth>navTrack.clientWidth){const r=selectedNav.getBoundingClientRect(),c=navTrack.getBoundingClientRect();navTrack.scrollTo({left:Math.max(0,navTrack.scrollLeft+r.left-c.left-18),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
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
    // Video observation is an independent permission *inside* the visual
    // model settings. Deep links must expand the accordion even if video is off.
    const groups=[];
    for(let parent=element?.parentElement;parent;parent=parent.parentElement){
      if(parent.tagName==='DETAILS')groups.unshift(parent);
    }
    for(const group of groups)group.open=true;
    if(element?.tagName==='DETAILS')element.open=true;
    element?.scrollIntoView({behavior:'auto',block:'start'});
    // A visible one-shot cue makes links locate a control rather than only scrolling.
    const marker=element?.closest?.('.quick-config-section,.fs-step,.settings-section,.model-task,.card,.vision-switch-setting')||element;
    if(marker){marker.classList.remove('management-jump-cue');void marker.offsetWidth;marker.classList.add('management-jump-cue');}
  };
  // Search existing controls, never clone a setting or change its value.
  // Find the closest meaningful label, then navigate and expand its section.
  const finder=$('settings-finder-input'),finderResults=$('settings-finder-results')
  if(finder&&finderResults){
    const buildSettingsIndex=()=>{
      const rows=[],used=new Set()
      for(const panel of document.querySelectorAll('section[id^="panel-"]')){
        const tab=panel.id.slice(6),tabName=document.querySelector(`.tabs [data-tab="${tab}"]`)?.textContent?.trim()||tab
        for(const field of panel.querySelectorAll('label,summary,h3,h4')){
          const title=(field.textContent||'').replace(/\s+/g,' ').trim().slice(0,110)
          if(title.length<2)continue
          const target=field.control||field
          const key=tab+'|'+title
          if(used.has(key))continue
          used.add(key);rows.push({tab,tabName,title,target})
        }
      }
      return rows
    }
    const close=()=>{finderResults.hidden=true;finder.setAttribute('aria-expanded','false')}
    finder.addEventListener('input',()=>{
      finderResults.replaceChildren();const q=finder.value.trim().toLocaleLowerCase()
      if(q.length<1){close();return}
      const words=q.split(/\s+/).filter(Boolean)
      const found=buildSettingsIndex().filter(r=>words.every(w=>(r.title+' '+r.tabName).toLocaleLowerCase().includes(w))).slice(0,9)
      for(const item of found){const button=node('button',item.tabName+' · '+item.title,'settings-finder-item');button.type='button';button.setAttribute('role','option')
        button.addEventListener('click',async()=>{close();finder.value='';await switchTab(item.tab);if(active!==item.tab)return;const fresh=buildSettingsIndex().find(r=>r.tab===item.tab&&r.title===item.title);const target=fresh?.target||item.target;revealTarget(target);target?.focus?.({preventScroll:true})})
        finderResults.appendChild(button)
      }
      if(!found.length)finderResults.appendChild(node('p','没有找到相关设置，可试试更短的关键词。','muted'))
      finderResults.hidden=false;finder.setAttribute('aria-expanded','true')
    })
    finder.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Enter'&&!finderResults.hidden){const first=finderResults.querySelector('button');if(first){event.preventDefault();first.click()}}})
    document.addEventListener('click',event=>{if(!event.target.closest('.settings-finder'))close()})
  }
  // Navigation must not implicitly discard unsaved edits, including deep links.
  // All user-confirmed discards are explicit. Nothing is persisted here.
  let confirmedDiscardNavigation=false;
  document.addEventListener('click',async event=>{
    const link=event.target?.closest?.('[data-tab],[data-open-tab],[data-nav-tab],[data-open-settings]');
    if(!link||confirmedDiscardNavigation||mobileViewOnly)return;
    const destination=link.dataset.tab||link.dataset.openTab||link.dataset.navTab||link.dataset.targetTab;
    if(!destination||destination===active)return;
    const unsaved=[...settingDrafts.entries()].filter(([,draft])=>draft.panel.id==='panel-'+active);
    if(!unsaved.length)return;
    event.preventDefault();event.stopImmediatePropagation();
    const discard=await confirmAction({title:'当前设置还没有保存',
      description:`本页有 ${unsaved.length} 组修改尚未保存。离开会丢失这些编辑，且不会写入插件配置。你可以取消并使用底部保存栏。`,
      confirmLabel:'放弃本页修改并切换',danger:true});
    if(!discard)return;
    for(const [key] of unsaved)settingDrafts.delete(key);
    summarizeSaveDrafts();
    confirmedDiscardNavigation=true;
    try{link.click()}finally{confirmedDiscardNavigation=false;}
  },true);
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-nav-tab]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();switchTab(link.dataset.navTab);try{const url=new URL(location.href);url.hash='unified-friends';history.replaceState(history.state,'',url)}catch{}const target=document.getElementById('unified-friends');if(target)revealTarget(target);}));
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
  // Internal hash-only jump buttons also provide a visible destination cue.
  document.addEventListener('click',event=>{
    const link=event.target?.closest?.('a[href^="#"]');
    if(!link || link.hasAttribute('data-open-tab') || link.closest('.fs-progress') || link.closest('.context-jump'))return;
    const id=link.getAttribute('href').slice(1),target=id?$(id):null;
    if(!target || target.closest('section[id^="panel-"]')?.id!=='panel-'+active)return;
    event.preventDefault();revealTarget(target);
    try{history.replaceState(history.state,'','#'+encodeURIComponent(id));}catch{}
  });
  document.querySelectorAll('#fs-progress a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
    const target=$(link.getAttribute('href').slice(1));if(!target)return;
    event.preventDefault();revealTarget(target);
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

  // First-run quick cards operate on the existing Life V2 / main-memory / social
  // keys through the bounded onboarding API; this page has no second config.
  let quickOptions=null;
  const quickLabels={mainSessionMemoryHalfLifeDays:'记忆半衰期（天）',mainSessionMemoryThreshold:'召回门槛',mainSessionMemoryMaxItems:'召回条数',mainSessionMemoryMaxChars:'召回字数',mainSessionReflectionMinCandidates:'反思候选门槛',mainSessionReflectionBatchSize:'每批反思候选',mainSessionReflectionIntervalHours:'反思间隔（小时）',mainSessionReflectionDailyBatches:'每日反思批数'};
  const quickSelected=name=>document.querySelector('input[name="'+name+'"]:checked')?.value||'';
  const quickSetSelected=(name,value)=>document.querySelectorAll('input[name="'+name+'"]').forEach(radio=>{radio.checked=radio.value===value});
  const quickStatus=(id,text)=>{const el=$(id);if(el)el.textContent=text};
  const quickMemoryDescription=()=>{
    const target=$('quick-memory-parameters');if(!target)return;
    target.replaceChildren();
    const profile=quickOptions?.memory?.profiles?.[quickSelected('quick-memory-choice')];
    if(!profile){target.appendChild(node('p','自定义：保持当前已保存的详细记忆参数；可到记忆与检索页面单独修改。','muted'));return}
    for(const [key,value]of Object.entries(profile)){
      const row=node('div');row.appendChild(node('span',quickLabels[key]||key));row.appendChild(node('strong',value));target.appendChild(row);
    }
  };
  const loadQuickOptions=async()=>{
    const data=await request('/onboarding/quick/options');quickOptions=data;
    const life=data.life||{},memory=data.memory||{},social=data.social?.values||{};
    quickSetSelected('quick-life-mode',life.mode==='active'?'active':'off');
    quickSetSelected('quick-life-pace',['quiet','natural','lively'].includes(life.pace)?life.pace:'custom');
    quickStatus('quick-life-current','当前已保存：'+(life.mode==='active'?'自主生活':'暂停／观察')+' · '+({quiet:'安静',natural:'自然',lively:'活跃',custom:'自定义'}[life.pace]||'保留旧值')+' · '+(life.budget?.minutes??'?')+' 分钟 / '+(life.budget?.dailyLimit??'?')+' 次 / 日。修改不会自动开启额外发送权限。');
    const currentMemory=memory.values||{};
    const memoryChoice=Object.entries(memory.profiles||{}).find(([,values])=>Object.entries(values).every(([key,value])=>currentMemory[key]===value))?.[0]||'custom';
    quickSetSelected('quick-memory-choice',memoryChoice);quickMemoryDescription();
    quickStatus('quick-memory-current','当前：'+(memoryChoice==='custom'?'已保留原有自定义参数':'与「'+({gentle:'慢慢记住',balanced:'自然记忆',curious:'好奇反思'}[memoryChoice])+'」一致')+' · 只修改召回和反思参数，不更改生活活跃度。');
    const dmChoice=social.dmWatch!==true?'paused':social.dmStrangerAutonomyEnabled===true?'free':social.dmApprovalEnabled!==true?'friends':'custom';
    quickSetSelected('quick-dm-choice',dmChoice);
    quickStatus('quick-dm-current','当前已保存：'+({paused:'暂停后台私信',friends:'熟人优先',free:'陌生人也可自主交流',custom:'原有自定义权限（保留不覆盖）'}[dmChoice])+'；白名单和渠道限额不在此重置。');
    const sharing=social.socialOutreachEnabled===true&&social.socialLifeIntentEnabled===true&&social.socialAutoSend===true&&social.socialVideoRecommendationsAuthorizedV2===true;
    quickSetSelected('quick-share-choice',sharing?'autonomous':'paused');
    quickStatus('quick-share-current','当前：'+(sharing?'自主分享已授权':'未完整授权自主分享')+' · 不设旧版每日分享次数硬上限；实际发不发由鱼鱼选择。');
  };
  document.querySelectorAll('input[name="quick-memory-choice"]').forEach(x=>x.addEventListener('change',quickMemoryDescription));
  const quickConfirmSave=async(kind,body,statusId,label)=>{
    if(!quickOptions)throw Error('快速设置尚未加载，请刷新本页');
    const preview=await request('/onboarding/quick/save',{kind,...body,previewOnly:true});
    const changed=Object.entries(preview.changed||{});
    if(!changed.length){quickStatus(statusId,'当前配置与所选方案一致，无需保存。');return}
    const describe=changed.slice(0,12).map(([key,value])=>key+'：'+JSON.stringify(value.before)+' → '+JSON.stringify(value.after)).join('；');
    if(!await confirmAction({title:'确认保存'+label+'？',description:'将修改 '+changed.length+' 个现有配置字段：'+describe+'。没有自动外发操作；只有确认后保存。',confirmLabel:'确认保存'}))return;
    const confirm=kind==='life'?'APPLY_QUICK_LIFE':kind==='memory'?'APPLY_QUICK_MEMORY':'APPLY_QUICK_SOCIAL';
    const result=await request('/onboarding/quick/save',{kind,...body,previewOnly:false,confirm});
    if(result.localVerified!==true)throw Error('未取得插件配置回读确认，不能显示保存成功，请刷新核对');
    await loadQuickOptions();
    const nativeWarning=result.host?.ok===false;
    quickStatus(statusId,label+'已保存并经配置回读确认。'+(nativeWarning
      ?'当前插件已使用新设置；DSH 原生设置镜像暂未同步（不影响本插件生效）。原因：'+String(result.host?.error||'宿主不支持本次写入').slice(0,170)
      :'已同步到 DSH 原生设置。'));
    message(label+'已保存并生效'+(nativeWarning?'；DSH 原生设置镜像未同步，可在状态栏查看原因。':'。'));
  };
  $('quick-life-save').addEventListener('click',()=>run(async()=>{
    const mode=quickSelected('quick-life-mode'),pace=quickSelected('quick-life-pace');
    if(mode==='active'&&pace==='custom')throw Error('启用自定义生活需要先到「生活设置」补齐时间与额度参数');
    if(!['active','off'].includes(mode))throw Error('请先选择生活开关');
    await quickConfirmSave('life',{mode,pace,revision:quickOptions.life.revision,enableMaster:mode==='active'},'quick-life-current','自主生活');
  }));
  $('quick-memory-save').addEventListener('click',()=>run(async()=>{
    const choice=quickSelected('quick-memory-choice');
    if(!['gentle','balanced','curious','custom'].includes(choice))throw Error('请选择记忆方案');
    await quickConfirmSave('memory',{choice,revision:quickOptions.memory.revision},'quick-memory-current','记忆与反思');
  }));
  $('quick-dm-save').addEventListener('click',()=>run(async()=>{
    const choice=quickSelected('quick-dm-choice');
    if(!['paused','friends','free'].includes(choice))throw Error('请选择私信方案；保留自定义无需保存');
    await quickConfirmSave('social',{channel:'dm',choice,revision:quickOptions.social.revision},'quick-dm-current','私信自主权限');
  }));
  $('quick-share-save').addEventListener('click',()=>run(async()=>{
    const choice=quickSelected('quick-share-choice');
    if(!['paused','autonomous'].includes(choice))throw Error('请选择有效的分享方案');
    await quickConfirmSave('social',{channel:'share',choice,revision:quickOptions.social.revision},'quick-share-current','自主视频兴趣分享');
  }));
  // Release introduction is shown once per browser session until revision 5
  // is acknowledged server-side. Closing this view never writes an opt-in.
  const release281Dialog=$('release-281-dialog');
  const release281SessionKey='bili-duty-2.8.2-intro-dismissed';
  let release281Shown=false;
  const closeRelease281=()=>{
    try{sessionStorage.setItem(release281SessionKey,'1')}catch{}
    if(release281Dialog?._styledFallbackCleanup){
      release281Dialog._styledFallbackCleanup();
      delete release281Dialog._styledFallbackCleanup;
    }else if(release281Dialog?.open&&typeof release281Dialog.close==='function')release281Dialog.close();
  };
  $('release-281-close').addEventListener('click',closeRelease281);
  $('release-281-view-setup').addEventListener('click',()=>{
    closeRelease281();
    void switchTab('firststart');
    const target=$('fs-vision-guide');
    if(target)revealTarget(target);
  });
  release281Dialog?.addEventListener('close',()=>{try{sessionStorage.setItem(release281SessionKey,'1')}catch{}});
  const showRelease281IfNeeded=state=>{
    if(release281Shown||!state||state.quickSetupSeen===true)return;
    try{if(sessionStorage.getItem(release281SessionKey)==='1')return}catch{}
    release281Shown=true;
    if(release281Dialog)showStyledDialog(release281Dialog,closeRelease281);
  };

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
    $('fs-headless-next').textContent=state?.headlessVerified?'✓ 快速设置的模型验证已达标。其他模型不要求逐个验证，只有使用该独立 Headless 模型时才需要验证。':'⚠ 快速设置只需任选一个模型完成真实连接验证；仅同步不算完成。';
    b.className='fs-state '+(state?.biliVerified?'good':'bad');h.className='fs-state '+(state?.headlessVerified?'good':'bad');
    $('fs-summary').textContent=ready?'必需设置已完成，可进入管理中心；可选设置可以跳过。':'尚缺少：'+(state?.missing||['配置状态未读取']).join('、');
    $('fs-complete').disabled=!ready;$('fs-complete-skip').disabled=!ready;
    const quickAcknowledged=state?.quickSetupSeen===true;
    // A unified wizard visualizes existing status; it never resets or writes
    // configuration simply because an old installation opens the page.
    const progress={account:state?.biliVerified===true,model:state?.headlessVerified===true,
      preferences:quickAcknowledged,session:state?.completed===true||
      (Array.isArray(state?.skipped)&&state.skipped.includes('main-session')),finish:state?.completed===true}
    for(const [step,done] of Object.entries(progress)){
      const target=document.querySelector(`[data-fs-step="${step}"]`)
      if(target){target.dataset.state=done?'done':step==='session'?'optional':'attention';
        target.setAttribute('aria-label',({account:'B站登录',model:'模型验证',preferences:'新版设置检查',session:'主 Session',finish:'完成引导'}[step]||step)+'：'+(done?'已完成':'待检查'))}
    }
    const progressHint=$('fs-progress-hint')
    if(progressHint)progressHint.textContent='已完成 '+Object.values(progress).filter(Boolean).length+
      '/5 项 · 完成必要验证即可进入管理中心；可选生活方案只在明确保存后生效。'
    $('fs-quick-ack').hidden=quickAcknowledged;
    $('fs-quick-ack-status').textContent=quickAcknowledged
      ?'已查看快速设置。可直接在上方选择、预览并保存；高级配置仍在独立页面。'
      :'新版本首次访问需查看本页；老用户原设置不变，也不会打断已开启的后台生活。';
    // A completed 2.8.0 installation remains operational while the user
    // reviews 2.8.1. The UI still routes back here until revision 5 is seen.
    $('fs-warning').hidden=unlocked&&quickAcknowledged;
    $('fs-warning-text').textContent=unlocked
      ? (quickAcknowledged?'':'新版快速设置尚未确认：请查看视频视觉模型引导并点击「我已查看本版快速设置」。现有后台 Life 不会因此暂停。')
      : (ready?'两项必需配置已经通过；可先设置主 Session，点击「完成快速设置」后解锁业务运行。':'快速设置未完成：'+(state?.missing||[]).join('、')+'。全部业务功能暂时锁定。');
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
      const btn=$(id);if(!btn)continue;btn.disabled=!unlocked;
      btn.textContent=unlocked?label:'完成引导后设置';
      btn.title=unlocked?'可随时调整设置':'这是可选步骤，可以先跳过；完成快速设置后再进入完整设置页面';
    }
  };
  // All dependency *installation* lives in Quick Setup. The AI Models page
  // remains the single place that owns video transcription settings and probes.
  let setupDepsPoll=null;
  const refreshSetupDependencies=async()=>{
    // Core onboarding must stay usable when optional FFmpeg/Whisper status fails.
    // Check the B站 main runtime FIRST; do not couple QR readiness to video addons.
    const main=await request('/status');
    const mainReady=main.venvReady===true;
    $('fs-main-deps-badge').textContent=mainReady?'已就绪':main.installing?'安装中':main.installPhase==='failed'||main.installFailed?'安装失败':'未就绪';
    $('fs-main-deps-badge').classList.toggle('pending',!mainReady);
    const missing=Array.isArray(main.missingDeps)?main.missingDeps:[];
    $('fs-main-deps-status').textContent=mainReady?'主依赖就绪，B站读取与 MCP 环境检查通过。':
      main.installing?'正在安装主依赖，请查看下方进度日志。':
      (main.installPhase==='failed'||main.installFailed?'上次安装未成功：'+String(main.installFailureHint||'请查看下方实际安装日志'):'运行环境缺失')+(missing.length?'；缺少：'+missing.join(' / '):'；可点击安装／修复主依赖。');
    $('fs-main-deps-install').textContent=mainReady?'修复／重装主依赖':'安装主依赖';
    $('fs-main-deps-install').disabled=main.installing===true||mobileViewOnly;
    $('fs-bili-start').disabled=!mainReady||mobileViewOnly;
    $('fs-main-deps-log').textContent=String(main.installTail||'').slice(-1400)||'暂无安装记录';
    if(main.installing&&setupDepsPoll===null)
      setupDepsPoll=setTimeout(()=>{setupDepsPoll=null;void refreshSetupDependencies().catch(e=>{
        $('fs-main-deps-status').textContent='进度刷新失败：'+String(e?.message||e).slice(0,120);
      })},2500);
    // Optional probes must never throw away the verified core readiness result.
    let addons={},config={};
    try{
      const [aux,cfgResult]=await Promise.all([request('/video-dependencies/status'),request('/config')]);
      addons=aux;config=cfgResult.config||{};
      const ffmpeg=addons.ffmpeg||{},whisper=addons.whisper||{};
      const model=String(config.asrModel||'small');
      $('fs-addons-status').textContent='FFmpeg：'+(ffmpeg.available?'已找到可运行程序':'尚未就绪')+
        ' · Whisper（'+model+'）：'+(whisper.environmentReady&&whisper.modelCached?'环境与模型文件就绪':whisper.installing?'安装中':'尚未全部就绪')+
        '。安装状态不是实际转写成功回执。';
      if(whisper.installing&&setupDepsPoll===null)
        setupDepsPoll=setTimeout(()=>{setupDepsPoll=null;void refreshSetupDependencies().catch(()=>{})},2500);
      const ffmpegReady=ffmpeg.available===true&&ffmpeg.decodeTest?.ok===true;
      const whisperReady=whisper.environmentReady===true&&whisper.modelCached===true;
      for(const [id,ready] of [['fs-install-ffmpeg',ffmpegReady],['fs-install-whisper',whisperReady]]){
        const input=$(id);
        if(ready)input.checked=false;
        input.disabled=ready||mobileViewOnly||whisper.installing===true;
        input.parentElement?.classList.toggle('dependency-check-success',ready);
      }
      $('fs-addons-status').textContent=(ffmpegReady?'✅ 实际 FFmpeg 合成视频帧解码自测通过':'FFmpeg：'+(ffmpeg.available?'程序存在，解码尚未通过':'尚未安装'))+
        ' · '+(whisperReady?'✅ Whisper（'+model+'）环境与模型已就绪':'Whisper（'+model+'）：'+(whisper.installing?'安装中':'尚未全部就绪'))+
        '。模型就绪不代表已进行语音转写。';
      $('fs-addons-status').classList.toggle('dependency-check-success',ffmpegReady&&whisperReady);
      $('fs-addons-install').disabled=mobileViewOnly||whisper.installing===true||(ffmpegReady&&whisperReady);
    }catch(e){
      $('fs-addons-status').textContent='可选视频组件状态暂不可读：'+String(e?.message||e).slice(0,100)+'。不影响主依赖安装与 B站扫码。';
      $('fs-addons-install').disabled=mobileViewOnly;
    }
    return {main,addons,config};
  };
  $('fs-main-deps-refresh').addEventListener('click',()=>run(refreshSetupDependencies));
  $('fs-main-deps-install').addEventListener('click',()=>run(async()=>{
    const existing=await request('/status');
    if(existing.installing){message('主依赖正在安装，请查看日志。');return}
    if(!await confirmAction({title:existing.venvReady?'修复／重装主依赖？':'安装主依赖？',
      description:'使用插件原有安装器准备独立 Python 环境、B站读取、MCP 与二维码依赖。不会自动安装 FFmpeg、Whisper 或修改 B站登录/模型配置。',confirmLabel:'开始安装主依赖'}))return;
    const result=await request('/install',{});
    message(result.hint||'已提交主依赖安装，请查看实时日志和最终检查状态。');
    await refreshSetupDependencies();
  }));
  $('fs-addons-install').addEventListener('click',()=>run(async()=>{
    const addFfmpeg=$('fs-install-ffmpeg').checked,addWhisper=$('fs-install-whisper').checked;
    if(!addFfmpeg&&!addWhisper)throw Error('视频增强组件已就绪，或请先勾选尚未安装的组件。');
    const {config}=await refreshSetupDependencies();
    const model=String(config.asrModel||'small');
    const selections=[addFfmpeg?'FFmpeg（按当前系统选择可信包管理器；可能需要管理权限）':'',
      addWhisper?'Whisper（'+model+' 模型及 Python 依赖，可能需要数百 MB～数 GB）':''].filter(Boolean);
    if(!await confirmAction({title:'安装勾选的视频增强组件？',
      description:'将分别启动：'+selections.join('；')+'。不下载未勾选的组件、不自动启用视频语音识别、不触发视频观看。请确认当前 Whisper 模型已在 AI 模型页保存。',confirmLabel:'安装选中组件'}))return;
    const messages=[];
    if(addFfmpeg){
      try{const r=await request('/video-dependencies/ffmpeg/install',{});
        messages.push('FFmpeg：'+(r.message||'已发起安装，请在完成后重新检测'))}
      catch(e){messages.push('FFmpeg：未启动（'+String(e?.message||e).slice(0,120)+'）')}
    }
    if(addWhisper){
      try{const r=await request('/install-asr',{});
        messages.push('Whisper：'+(r.hint||'已提交安装，请在 AI 模型页查看安装记录'))}
      catch(e){messages.push('Whisper：未启动（'+String(e?.message||e).slice(0,120)+'）')}
    }
    $('fs-addons-detail').textContent=messages.join('；');
    message('安装请求已处理，请核验各组件状态；安装窗口打开不等于成功。');
    await refreshSetupDependencies();
  }));
  const renderFirstStartVision=cfg=>{
    const el=$('fs-vision-state');if(!el)return;
    if(cfg.visionEnabled!==true){el.textContent='当前状态：视频视觉感知未开启。可以跳过；如希望鱼鱼理解画面，请按下方三步配置并人工验收。';return;}
    const mode=cfg.visionMode==='independent_local'?'本地 Ollama 视觉模型':'DSH 视觉模型';
    el.textContent='当前状态：'+mode+'已启用。请在视觉识别模型页核对选中模型的图片验收状态；仅开启开关或完成文字连接不代表图片识别成功。';
  };
  const loadFirstStart=async()=>{const state=await request('/onboarding/status');renderFirstStart(state);await loadFirstStartOwnerUid().catch(e=>{renderFirstStartVision({});$('fs-owner-uid-status').textContent='无法读取主人 UID：'+String(e?.message||e).slice(0,90)});await loadQuickOptions().catch(e=>quickStatus('quick-life-current','无法读取快速设置：'+String(e?.message||e)));await refreshSetupDependencies().catch(e=>{$('fs-main-deps-status').textContent='依赖状态暂时无法读取：'+String(e?.message||e).slice(0,120)});await renderEmbeddingStatus().catch(()=>{if($('quick-embedding-status'))$('quick-embedding-status').textContent='暂时无法读取模型状态；可进入记忆设置页面检查'});return state};
  const loadFirstStartOwnerUid=async()=>{
    const c=(await request('/config')).config||{};
    renderFirstStartVision(c);
    const uid=String(c.dmOwnerUid||'');
    $('fs-owner-uid').value=uid;
    $('fs-owner-uid-status').textContent=uid?'已授权主人 UID：'+uid+'。仅主人身份已保存，其他行为还需独立许可。':'尚未设置唯一授权主人；可选填入并明确保存。';
  };
  $('fs-owner-uid-save').addEventListener('click',()=>run(async()=>{
    const uid=String($('fs-owner-uid').value||'').trim();
    if(!/^[1-9]\d{0,18}$/.test(uid)||!Number.isSafeInteger(Number(uid))||String(Number(uid))!==uid)
      throw Error('主人 UID 必须为安全范围内的有效纯数字，且不能是鱼鱼登录账号 UID');
    const current=(await request('/config')).config||{};
    const account=await request('/account/status');
    if(uid===String(account.activeUid||''))throw Error('主人 UID 不应与鱼鱼登录的 B站 UID 相同');
    const old=String(current.dmOwnerUid||'');
    if(old===uid){$('fs-owner-uid-status').textContent='当前已经是唯一授权主人 UID：'+uid;return}
    if(!await confirmAction({title:'确认唯一授权主人',description:(old?'原主人 UID '+old+' 的身份将被撤销。':'')+'确认将 B站 UID '+uid+' 设为唯一授权主人？此操作不自动授予点赞、私信、评论或关注权限。'}))return;
    const raw=(()=>{try{return JSON.parse(current.friendDirectory||'[]')}catch{return []}})();
    const rows=normalizeFriends(Array.isArray(raw)?raw:[]);
    if(!rows.some(r=>r.uid===uid)){
      if(rows.length>=120)throw Error('好友名册已达到 120 人，请先在社交互动页清理名册');
      rows.push({uid,name:'',dm:false,mention:false,atInvite:false,recommend:'off'});
    }
    const profiles=(()=>{try{const x=JSON.parse(current.mentionProfiles||'{}');return x&&!Array.isArray(x)&&typeof x==='object'?x:{}}catch{return {}}})();
    for(const key of Object.keys(profiles))if(profiles[key]&&typeof profiles[key]==='object'&&profiles[key].role==='owner')profiles[key]={...profiles[key],role:'friend'};
    profiles[uid]={...(profiles[uid]&&typeof profiles[uid]==='object'?profiles[uid]:{}),role:'owner'};
    await request('/config',{friendDirectory:JSON.stringify(rows),mentionProfiles:JSON.stringify(profiles),dmOwnerUid:Number(uid)});
    const saved=(await request('/config')).config||{};
    if(String(saved.dmOwnerUid||'')!==uid)throw Error('保存后主人 UID 回读不一致，未确认授权成功');
    $('fs-owner-uid-status').textContent='已保存唯一授权主人 UID：'+uid+'。其他行为仍需独立授权。';
    message('主人 UID 已保存并回读确认；评论/私信实际发送仍受原权限约束。');
  }));
  $('fs-quick-ack').addEventListener('click',()=>run(async()=>{
    const result=await request('/onboarding/quick/seen',{});
    renderFirstStart(result);
    message('已确认查看当前快速设置与视频视觉引导；原有配置不变。');
  }));
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
    const deps=await request('/status');
    if(!deps.venvReady)throw Error('B站主依赖尚未通过实际检查，请先在本页安装完成再扫码');
    const r=await request('/login/start',{});
    if(!r.qr)throw Error('登录二维码生成失败：请到「快速设置 → 运行依赖」检查或修复，并查看安装日志');
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
          message('扫码凭证已暂存，请直接在「快速设置 → B站登录」确认 UID 并在线核验；随后重启 DSH 复核授权。');
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
    message('快速设置已完成。所有配置以后仍可在管理中心修改。');
  };
  $('fs-complete').addEventListener('click',()=>run(()=>completeFirstStart(false)));
  $('fs-complete-skip').addEventListener('click',()=>run(()=>completeFirstStart(true)));

  // v2.4.86: 保留所有配置键与数据格式。Provider / 模型 ID 改为来自 DSH
  // 实际注册目录的下拉框，不能根据官方名称猜可用模型。
  const modelDefs=[
    ['behaviorDecision','behaviorDecisionModelProvider','behaviorDecisionModelId','behaviorDecisionReasoningEffort'],
    ['video','videoModelProvider','videoModelId','videoReasoningEffort'],
    ['interaction','interactionModelProvider','interactionModelId','interactionReasoningEffort'],
    ['dailyDynamic','dailyDynamicModelProvider','dailyDynamicModelId','dailyDynamicReasoningEffort'],
    ['reflection','mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort'],
    ['vision','visionModelProvider','visionModelId','visionReasoningEffort'],
    ['memeRules','memeRulesModelProvider','memeRulesModelId','memeRulesReasoningEffort'],
  ];
  for(const [group,...keys] of modelDefs){
    const target=$('models-'+group);
    for(let i=0;i<keys.length;i++){
      const wrap=node('div'),lab=node('label',['Provider（下拉选择）','模型（下拉选择）','思考深度（可留空）'][i]);
      const input=node(i<2?'select':'input');input.id='model-'+keys[i];
      if(i>=2){input.maxLength=160;input.placeholder='如 low / medium / high'}
      lab.htmlFor=input.id;add(wrap,lab,input);
      target.appendChild(wrap);
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
  const modelTaskIds=['behaviorDecision','video','interaction','dailyDynamic','reflection','vision','memory','memeRules'];
  // Headless model setup is a privileged, explicit user action. No raw YAML,
  // file path or credentials are ever sent to or accepted from the page.
  let headlessProviders=[];
  let headlessGlobalVerified=false;
  let headlessGlobalOverride=false;
  let dshVisionStatus=null;
  let headlessDefaultModel=null;
  let headlessCurrentCatalog=[];
  let hostObservedModel=null;
  const headlessProfile=()=>$('headless-source-profile').value;
  const resolveVisionRouteConfig=(c={})=>{
    const provider=String(c.visionModelProvider||c.pluginDefaultModelProvider||headlessDefaultModel?.provider||hostObservedModel?.provider||'');
    const model=String(c.visionModelId||c.pluginDefaultModelId||headlessDefaultModel?.model||hostObservedModel?.model||'');
    const effort=String(c.visionReasoningEffort||c.videoReasoningEffort||'');
    const mode=['independent_dsh','independent_local'].includes(c.visionMode)?c.visionMode:'independent_dsh';
    const source=c.visionModelProvider||c.visionModelId?'vision':c.pluginDefaultModelProvider||c.pluginDefaultModelId?'default':hostObservedModel?'host':'missing';
    return {provider,model,effort,source,mode};
  };
  const resolveVisionRouteForm=()=>{
    const defaultProvider=String($('models-default-provider')?.value||headlessDefaultModel?.provider||hostObservedModel?.provider||'');
    const defaultModel=String($('models-default-model')?.value||headlessDefaultModel?.model||hostObservedModel?.model||'');
    const selectedProvider=String($('model-visionModelProvider')?.value||'');
    const selectedModel=String($('model-visionModelId')?.value||'');
    const provider=selectedProvider||defaultProvider,model=selectedModel||defaultModel;
    const effort=String($('model-visionReasoningEffort')?.value||$('model-videoReasoningEffort')?.value||'');
    const mode=String($('models-vision-mode')?.value||'independent_dsh');
    const providerSource=selectedProvider&&selectedProvider!==defaultProvider?'vision':defaultProvider?'default':'host';
    const modelSource=selectedModel&&selectedModel!==defaultModel?'vision':defaultModel?'default':'host';
    const source=providerSource===modelSource?providerSource:'mixed';
    return {provider,model,effort,source,mode};
  };
  const sameVisionRoute=(a,b)=>['provider','model','effort','mode'].every(key=>String(a?.[key]||'')===String(b?.[key]||''));
  const syncMessage=(value,bad=false)=>{
    const el=$('headless-sync-status');el.textContent=value;el.style.color=bad?'var(--bad)':'';
  };
  // Always expose the NEXT required operation. A config sync does not grant
  // Headless access until a real tool-less model probe has succeeded.
  let headlessNextButton=null,headlessNextSyncButton=null,headlessCapabilityTarget=null;
  const capabilityChip=(label,declared)=>{
    const state=declared===true?'declared':'unknown';
    return node('span',(label)+(declared===true?' ✓':' · 未声明'),'headless-capability-chip');
  };
  const renderCapabilityChips=cap=>{
    const wrap=node('div','','headless-capability-chips');
    wrap.append(capabilityChip('文字输入',cap?.textInputDeclared),capabilityChip('图片输入',cap?.imageInputDeclared));
    const efforts=cap?.reasoningEffortsDeclared===true?'思考深度 '+(cap.reasoningEfforts||[]).length+' 档':'思考深度未声明';
    const effort=node('span',efforts,'headless-capability-chip');effort.dataset.state=cap?.reasoningEffortsDeclared===true?'declared':'unknown';
    wrap.appendChild(effort);
    return wrap;
  };
  const renderHeadlessJourney=providers=>{
    const configured=providers.some(p=>(p.models||[]).length);
    const syncNeeded=providers.some(p=>p.kind!=='registered'&&!p.synced&&(p.models||[]).length);
    const synced=providers.some(p=>p.synced&&(p.models||[]).length);
    const verified=(typeof headlessGlobalVerified!=='undefined'&&headlessGlobalVerified)||providers.some(p=>p.synced&&(p.verifiedModels||[]).length);
    const stage=syncNeeded?'sync':verified?'verified':synced?'verify':configured?'sync':'source';
    $('headless-journey').dataset.stage=stage;
    for(const [name,done,current] of [
      ['source',configured,stage==='source'],['sync',synced&&!syncNeeded,stage==='sync'],['verify',verified,stage==='verify']]){
      $('headless-stage-'+name).dataset.state=done?'done':current?'current':'pending';
    }
    $('headless-stage-source').querySelector('strong').textContent=configured?'✓ 检测 Desktop':'① 检测 Desktop';
    $('headless-stage-sync').querySelector('strong').textContent=synced&&!syncNeeded?'✓ 同步模型':'② 同步模型';
    $('headless-stage-verify').querySelector('strong').textContent=verified?'✓ 验证能力':'③ 验证能力';
    const title=$('headless-next-title'),desc=$('headless-next-description'),button=$('headless-next-action');
    button.hidden=true;
    if(stage==='verified'){
      title.textContent='✓ 已有模型通过 Headless 文字连接验证';
      desc.textContent='快速设置所需的文字连接验证已达标。图片输入仍需在当前视觉模型上单独实测；其他模型可按实际使用情况验证。';
    }else if(stage==='verify'){
      title.textContent='③ 下一步：验证一个 Headless 模型';
      desc.textContent='配置同步完成。选择实际要使用的模型执行一次真实文字请求；连接验证不代表图片识别成功。';
      button.hidden=false;button.textContent='③ 验证模型连接 ↗';
    }else if(stage==='sync'){
      title.textContent='② 检测到来源模型，选择需要同步的 Provider';
      desc.textContent='点击左侧对应 Provider 的「同步到 Headless」。每次只同步你选择的 Provider，官方已注册模型无需同步。';
      button.hidden=false;button.textContent='② 定位第一个待同步 Provider ↗';
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
    }else if($('headless-journey').dataset.stage==='sync'&&headlessNextSyncButton){
      headlessNextSyncButton.scrollIntoView({behavior:'smooth',block:'center'});
      headlessNextSyncButton.click();
    }
  });
  const openHeadlessCapabilityWizard=(provider,model,detail)=>{
    const source=detail?.source||{},headless=detail?.headless||source;
    headlessCapabilityTarget={profile:headlessProfile(),provider,model,source,headless,headlessOnlyOverride:detail?.headlessOnlyOverride===true};
    $('headless-capability-route').textContent=provider+' / '+model+' · 仅修改 DSH Headless';
    const sourceInputs=new Set(source.input||[]),targetInputs=new Set(headless.input||[]);
    for(const key of ['text','image']){
      const checkbox=$('headless-capability-'+key);
      const sourceHas=sourceInputs.has(key),targetHas=targetInputs.has(key);
      checkbox.checked=sourceHas||targetHas;
      checkbox.disabled=sourceHas||targetHas;
    }
    const sourceEfforts=new Set(source.reasoningEfforts||[]),targetEfforts=new Set(headless.reasoningEfforts||[]);
    document.querySelectorAll('[data-headless-effort]').forEach(checkbox=>{
      const key=checkbox.dataset.headlessEffort,sourceHas=sourceEfforts.has(key),targetHas=targetEfforts.has(key);
      checkbox.checked=sourceHas||targetHas;
      checkbox.disabled=sourceHas||targetHas;
    });
    $('headless-capability-reset').disabled=!headlessCapabilityTarget.headlessOnlyOverride;
    $('headless-capability-dialog-status').textContent='来源中已声明的能力会锁定并原样保留。新勾选项会作为 Headless 专属声明写入；未声明不等于模型不支持。';
    $('headless-capability-dialog').showModal();
  };
  // The sole source of truth for links is the Provider/model pair from the status API.
  // Lines are only a visual relationship; never a credential/verification signal.
  let headlessLinkResizeObserver=null,headlessLinksScheduled=false;
  const refreshHeadlessLinks=()=>{
    const board=$('headless-sync-board'),overlay=$('headless-sync-links');
    if(!board||!overlay)return;
    overlay.replaceChildren();
    if(window.matchMedia('(max-width: 850px)').matches)return;
    const rect=board.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return;
    overlay.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
    const sources=[...$('headless-source-list').querySelectorAll('[data-headless-pair]')];
    const targets=new Map([...$('headless-target-list').querySelectorAll('[data-headless-pair]')].map(el=>[el.dataset.headlessPair,el]));
    for(const source of sources.slice(0,80)){
      const target=targets.get(source.dataset.headlessPair);
      if(!target||source.dataset.connected!=='true'||target.dataset.connected!=='true')continue;
      const a=source.getBoundingClientRect(),b=target.getBoundingClientRect();
      const start=a.right-rect.left+3,end=b.left-rect.left-3;
      if(end<=start)continue;
      const y1=a.top+a.height/2-rect.top,y2=b.top+b.height/2-rect.top;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      const dx=Math.min(24,(end-start)/3);
      path.setAttribute('d',`M ${start} ${y1} C ${start+dx} ${y1}, ${end-dx} ${y2}, ${end} ${y2}`);
      path.setAttribute('class','headless-pair-link');
      path.dataset.headlessPair=source.dataset.headlessPair;
      overlay.appendChild(path);
    }
  };
  const queueHeadlessLinks=()=>{
    if(headlessLinksScheduled)return;
    headlessLinksScheduled=true;
    requestAnimationFrame(()=>{headlessLinksScheduled=false;refreshHeadlessLinks()});
  };
  const setHeadlessLinkFocus=key=>{
    $('headless-sync-links')?.querySelectorAll('.headless-pair-link').forEach(link=>{
      link.classList.toggle('is-active',Boolean(key)&&link.dataset.headlessPair===key);
      link.classList.toggle('is-muted',Boolean(key)&&link.dataset.headlessPair!==key);
    });
  };
  for(const eventName of ['pointerover','focusin'])$('headless-sync-board').addEventListener(eventName,event=>{
    setHeadlessLinkFocus(event.target.closest?.('[data-headless-pair]')?.dataset.headlessPair||'');
  });
  for(const eventName of ['pointerout','focusout'])$('headless-sync-board').addEventListener(eventName,event=>{
    if(!event.relatedTarget?.closest?.('[data-headless-pair]'))setHeadlessLinkFocus('');
  });
  window.addEventListener('resize',queueHeadlessLinks,{passive:true});
  const renderHeadlessBoard=()=>{
    const sourceList=$('headless-source-list'),targetList=$('headless-target-list');
    sourceList.replaceChildren();targetList.replaceChildren();
    const providers=headlessProviders.filter(p=>Array.isArray(p.models)&&p.models.length);
    const targets=providers.filter(p=>p.synced===true||p.targetExists===true);
    const syncedTargets=providers.filter(p=>p.synced===true);
    $('headless-source-count').textContent=providers.length+' 个 Provider';
    $('headless-target-count').textContent=syncedTargets.length+' 个已同步';
    $('headless-provider-summary').textContent='检测到 '+providers.length+' 个 Provider · '+syncedTargets.length+' 个已同步';
    $('headless-sync-flow-status').textContent=syncedTargets.length?'已同步 '+syncedTargets.length+' 个':'待同步';
    headlessNextButton=null;headlessNextSyncButton=null;
    if(!providers.length){
      sourceList.appendChild(node('p','尚未检测到来源模型；请在 DSH Desktop → Models 中配置。','muted'));
    }
    for(const p of providers){
      const card=node('article','','headless-provider-card'+(p.synced?' is-synced':''));
      const head=node('div','','headless-provider-head');
      const mark=node('span',p.kind==='registered'?'◇':'◈','headless-provider-mark');
      const title=node('div','','headless-provider-title');
      add(title,node('strong',p.id),node('small',(p.api||'DSH 模型 Provider')+(p.baseURL?' · '+p.baseURL:'')));
      const state=node('span',p.kind==='registered'?'DSH 已注册':p.synced?(headlessGlobalOverride?'全局共享 · 已同步':'✓ 已同步'):'待同步','headless-provider-state');
      state.dataset.state=p.kind==='registered'||p.synced?'synced':'pending';
      head.append(mark,title,state);card.appendChild(head);
      const models=node('div','','headless-model-rows');
      for(const model of p.models){
        const detail=p.modelDetails?.find(x=>x.id===model)||{};
        const row=node('div','','headless-model-row');
        row.dataset.headlessPair=p.id+'\u0000'+model;row.tabIndex=0;
        row.dataset.connected=String(p.synced===true);
        add(row,node('div',model,'headless-model-name'),renderCapabilityChips(detail.source));
        models.appendChild(row);
      }
      card.appendChild(models);
      const footer=node('div','','headless-model-actions');
      if(p.kind==='registered'){
        footer.appendChild(node('small','DSH 官方/已注册模型，无需同步','setting-note'));
      }else if(p.synced){
        const done=node('button','✓ 已同步','headless-provider-action');done.type='button';done.disabled=true;footer.appendChild(done);
      }else{
        const syncButton=node('button','同步到 Headless →','headless-provider-action primary');syncButton.type='button';
        syncButton.disabled=mobileViewOnly;syncButton.title=mobileViewOnly?mobileDesktopHint:'预览并确认后，仅同步此 Provider 到 Headless';
        if(!headlessNextSyncButton)headlessNextSyncButton=syncButton;
        syncButton.addEventListener('click',()=>run(async()=>{
          const plan=await request('/headless-model/preview',{profile:headlessProfile(),selected:[p.id]});
          const item=plan.selected?.[0]||{id:p.id,models:p.models||[],overwrite:false};
          const approved=await confirmAction({title:'同步 Provider 到 Headless',
            description:'将同步 '+p.id+' 的 '+(item.models?.length||p.models.length)+' 个模型定义到 Headless。不会复制 API Key、凭据或工具授权，不修改 Desktop 原配置。'+
              (item.routeChanged?' Headless 当前 Provider 路由与 Desktop 来源存在差异，确认后会更新路由；受影响模型的旧验证回执可能失效。':'')+
              (item.headlessCapabilityOverrides?.length?' 会保留这些模型已有的 Headless 专属能力补充：'+item.headlessCapabilityOverrides.join('、')+'；若 Provider 路由有变化，旧验证回执仍会失效。':'')+
              ' 写入后仍需单独验证。',
            confirmLabel:'确认同步此 Provider'});
          if(!approved)return;
          const result=await request('/headless-model/sync',{profile:plan.sourceProfile,selected:[p.id],previewToken:plan.previewToken});
          await loadHeadlessModels();await loadDshVisionStatus();if(onboarding)await loadFirstStart();
          syncMessage('✓ 已同步 '+(result.synced||[p.id]).join('、')+'。接下来请在右侧验证文字连接。');
        }));
        footer.appendChild(syncButton);
      }
      card.appendChild(footer);sourceList.appendChild(card);
    }
    if(!targets.length){
      const empty=node('div','','headless-target-empty');
      add(empty,node('strong','▱'),node('span','同步后会出现在这里'),node('small','Headless 能力声明可在同步后单独补充'));
      targetList.appendChild(empty);
    }
    for(const p of targets){
      const card=node('article','','headless-provider-card'+(p.synced?' is-target-ready':''));
      const head=node('div','','headless-provider-head');
      const mark=node('span','▤','headless-provider-mark');
      const title=node('div','','headless-provider-title');
      add(title,node('strong',p.id),node('small',(p.headlessApi||p.api||'DSH Headless')+(p.headlessBaseURL?' · '+p.headlessBaseURL:'')));
      const verifiedCount=(p.verifiedModels||[]).length;
      const state=node('span',!p.synced?'需重新同步':verifiedCount?'✓ 已同步 · 已验证 '+verifiedCount+'/'+p.models.length:'✓ 已同步','headless-provider-state');
      state.dataset.state=!p.synced?'pending':verifiedCount?'verified':'synced';head.append(mark,title,state);card.appendChild(head);
      const models=node('div','','headless-model-rows');
      for(const model of p.models){
        const detail=p.modelDetails?.find(x=>x.id===model)||{};
        const cap=detail.headless||detail.source||null;
        const verified=(p.verifiedModels||[]).includes(model);
        const row=node('div','','headless-model-row');
        row.dataset.headlessPair=p.id+'\u0000'+model;row.tabIndex=0;
        row.dataset.connected=String(p.synced===true);
        add(row,node('div',model,'headless-model-name'),renderCapabilityChips(cap));
        row.appendChild(node('small',!p.synced?'文字连接验证 · 路由有差异，需重新同步':verified?'文字连接验证 · ✓ 已通过':'文字连接验证 · 待验证','setting-note'));
        if(detail.headlessOnlyOverride===true)row.appendChild(node('small','Headless 专属能力补充 · 不影响 Desktop','setting-note'));
        const actions=node('div','','headless-model-actions');
        const verifyButton=node('button',verified?'重新验证文字':'验证文字连接',verified?'':'primary');verifyButton.type='button';verifyButton.disabled=mobileViewOnly||!p.synced;verifyButton.title=mobileViewOnly?mobileDesktopHint:'执行一次真实 Headless 文字请求';
        if(!headlessNextButton&&!verified&&!headlessGlobalVerified)headlessNextButton=verifyButton;
        verifyButton.addEventListener('click',()=>run(async()=>{
          const accepted=await confirmAction({title:'验证 Headless 文字连接',description:'即将用 '+p.id+' / '+model+' 执行一次真实、无工具的 Headless 请求（文字），可能产生模型费用。文字连接通过不代表图片识别成功。',confirmLabel:'确认验证文字连接'});
          if(!accepted)return;
          syncMessage('正在调用 '+p.id+' / '+model+' 验证 Headless 文字连接…');
          const result=await request('/headless-model/verify',{profile:headlessProfile(),provider:p.id,model});
          await loadHeadlessModels();await loadDshVisionStatus();await loadFirstStart();
          syncMessage('✓ '+result.provider+' / '+result.model+' 的 Headless 文字连接已通过。');
        }));
        actions.appendChild(verifyButton);
        const sourceCap=detail.source||{},sourceInputs=new Set(sourceCap.input||[]),sourceEfforts=new Set(sourceCap.reasoningEfforts||[]);
        const needsCapability=sourceCap.textInputDeclared!==true||sourceCap.imageInputDeclared!==true||sourceCap.reasoningEffortsDeclared!==true||detail.headlessOnlyOverride===true;
        if(p.synced&&p.capabilityEditable===true&&needsCapability){
          const capabilityButton=node('button','补充图片与思考能力');capabilityButton.type='button';
          capabilityButton.disabled=mobileViewOnly;capabilityButton.title=mobileViewOnly?mobileDesktopHint:'仅补充此模型的 Headless 能力声明';
          capabilityButton.addEventListener('click',()=>openHeadlessCapabilityWizard(p.id,model,detail));
          actions.appendChild(capabilityButton);
        }
        const activeVision=savedVisionRoute?.mode==='independent_dsh'&&savedVisionRoute?.provider===p.id&&savedVisionRoute?.model===model;
        if(activeVision&&p.synced){
          const imageState=({approved:'✓ 已人工认可',awaiting_review:'待人工验收',running:'正在实测',failed:'上次实测失败',rejected:'上次结果未认可',route_changed:'路由已变化，需重测',idle:'待验收'})[dshVisionStatus?.status]||'待验收';
          row.appendChild(node('small','图片实测 · '+imageState,'setting-note'));
          const imageButton=node('button','▧ 图片实测','primary');imageButton.type='button';imageButton.disabled=mobileViewOnly||!verified||visionRouteHasUnsavedChanges()||
            dshVisionStatus?.route?.headlessVerified!==true||dshVisionStatus?.status==='running';
          imageButton.title=verified?'启动当前已保存视觉模型的固定图片实测':'先通过此模型的 Headless 文字连接验证';
          imageButton.addEventListener('click',()=>run(async()=>{
            await loadDshVisionStatus();
            const probe=$('vision-probe-verify');
            if(!probe||probe.disabled)throw Error('请先确认当前 DSH 视觉路由已保存，并完成 Headless 文字连接验证');
            probe.scrollIntoView({behavior:'smooth',block:'center'});probe.click();
          }));
          actions.appendChild(imageButton);
        }
        row.appendChild(actions);models.appendChild(row);
      }
      card.appendChild(models);targetList.appendChild(card);
    }
    queueHeadlessLinks();
    if(!headlessLinkResizeObserver&&typeof ResizeObserver!=='undefined'){
      headlessLinkResizeObserver=new ResizeObserver(queueHeadlessLinks);
      headlessLinkResizeObserver.observe(sourceList);
      headlessLinkResizeObserver.observe(targetList);
    }
  };
  const loadHeadlessModels=async()=>{
    headlessNextButton=null;headlessNextSyncButton=null;
    $('headless-source-list').replaceChildren();$('headless-target-list').replaceChildren();
    try{
      const r=await request('/headless-model/status?profile='+encodeURIComponent(headlessProfile()));
      headlessProviders=r.providers||[];
      headlessCurrentCatalog=headlessProviders.filter(p=>Array.isArray(p.models)&&p.models.length);
      hostObservedModel=r.observedHostModel||r.defaultModel||null;
      const found=headlessCurrentCatalog.find(p=>p.id===hostObservedModel?.provider);
      if(hostObservedModel?.provider&&hostObservedModel?.model&&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(hostObservedModel.provider)&&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(hostObservedModel.model)){
        if(found){if(!found.models.includes(hostObservedModel.model)){
          // UI-only: host-selected models missing from listModels are not syncable.
          headlessCurrentCatalog=headlessCurrentCatalog.map(p=>p===found?{...p,models:[...p.models,hostObservedModel.model],discoveryNote:'含宿主当前选中的未枚举模型'}:p);
        }}else headlessCurrentCatalog.push({id:hostObservedModel.provider,models:[hostObservedModel.model],kind:'observed-only',synced:false});
      }
      headlessGlobalVerified=r.anyVerified===true||headlessProviders.some(p=>(p.verifiedModels||[]).length>0);
      headlessGlobalOverride=r.globalOverride===true;
      headlessDefaultModel=r.defaultModel&&r.defaultModel.provider&&r.defaultModel.model?r.defaultModel:null;
      renderHeadlessBoard();renderHeadlessJourney(headlessProviders);
      if(!headlessProviders.length){syncMessage(headlessCurrentCatalog.length?
        '官方模型目录暂时无法枚举；下拉框显示当前宿主所选模型（未验证）。请核对 DSH Models。':
        '没有找到可用的 DSH 模型。请先在 DSH → Models 中配置官方模型或自定义 Provider，再重新检测。',!headlessCurrentCatalog.length);return r;}
      syncMessage((headlessGlobalVerified?'✓ 已有模型通过真实 Headless 文字验证。':'还没有模型通过真实 Headless 文字验证。')+
        ' 已检测到 '+headlessProviders.length+' 个 Provider。'+(r.globalOverride?' 当前采用 DSH 全局共享 Provider，不能单独修改 Headless 能力声明。':''));
      return r;
    }catch(e){
      headlessProviders=[];headlessCurrentCatalog=[];hostObservedModel=null;headlessDefaultModel=null;headlessGlobalVerified=false;headlessGlobalOverride=false;
      renderHeadlessBoard();renderHeadlessJourney([]);
      syncMessage('后台模型检测失败：'+String(e.message||e)+'；下拉框仍保留已保存配置，切勿在未核实时切换模型。',true);return null;
    }
  };
  $('headless-source-profile').addEventListener('change',()=>run(loadHeadlessModels));
  $('headless-sync-refresh').addEventListener('click',()=>run(loadHeadlessModels));
  $('headless-capability-cancel').addEventListener('click',()=>$('headless-capability-dialog').close());
  $('headless-capability-apply').addEventListener('click',()=>run(async()=>{
    const target=headlessCapabilityTarget;if(!target)throw Error('没有选中的 Headless 模型');
    const sourceInputs=new Set(target.source.input||[]),sourceEfforts=new Set(target.source.reasoningEfforts||[]);
    const addInput=['text','image'].filter(key=>$('headless-capability-'+key).checked&&!sourceInputs.has(key));
    const addReasoningEfforts=[...document.querySelectorAll('[data-headless-effort]:checked')]
      .map(x=>x.dataset.headlessEffort).filter(key=>!sourceEfforts.has(key));
    const payload={profile:target.profile,provider:target.provider,model:target.model,addInput,addReasoningEfforts};
    $('headless-capability-dialog').close();
    const preview=await request('/headless-model/capabilities-preview',payload);
    if(!preview.changed){message('当前 Headless 能力声明已经符合所选内容，没有写入。');return;}
    const summary=[preview.addedInput.length?'新增输入：'+preview.addedInput.join('、'):'',
      preview.addedReasoningEfforts.length?'新增思考档位：'+preview.addedReasoningEfforts.join('、'):''].filter(Boolean).join('；');
    const accepted=await confirmAction({title:'仅补充 Headless 能力声明',
      description:summary+'。只修改 '+target.provider+' / '+target.model+' 的 Headless input / reasoningEfforts；不修改 Desktop，不复制 API Key。能力声明不是中转站兼容性证明，修改后需要重新验证文字连接，图片仍须实测。',
      confirmLabel:'确认仅写入 Headless'});
    if(!accepted)return;
    const result=await request('/headless-model/capabilities',{...payload,previewToken:preview.previewToken});
    await loadHeadlessModels();await loadDshVisionStatus();
    syncMessage(result.note||'Headless 能力声明已更新；请重新验证文字连接并单独实测图片。');
  }));
  $('headless-capability-reset').addEventListener('click',()=>run(async()=>{
    const target=headlessCapabilityTarget;if(!target)throw Error('没有选中的 Headless 模型');
    $('headless-capability-dialog').close();
    const payload={profile:target.profile,provider:target.provider,model:target.model,addInput:[],addReasoningEfforts:[],reset:true};
    const preview=await request('/headless-model/capabilities-preview',payload);
    if(!preview.changed){message('Headless 声明已与 Desktop 来源一致。');return;}
    const accepted=await confirmAction({title:'恢复 Desktop 来源能力声明',
      description:'将删除此模型在 Headless 中额外补充的 input / reasoningEfforts 声明，只保留 Desktop 来源原有声明。Desktop 不会修改。',confirmLabel:'恢复来源声明'});
    if(!accepted)return;
    const result=await request('/headless-model/capabilities',{...payload,previewToken:preview.previewToken});
    await loadHeadlessModels();await loadDshVisionStatus();syncMessage(result.note||'已恢复来源能力声明；模型验证回执已失效。');
  }));

  const loadModelUsage=async()=>{
    try {
      const r=await request('/model-usage');
      for(const task of modelTaskIds){
        const v=r.tasks?.[task]||{today:0,lastAt:null};
        const when=v.lastAt?new Date(v.lastAt).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
        $('models-'+task+'-usage').textContent='今日调用次数：'+Number(v.today||0)+' 次 · 上次调用时间：'+when;
      }
      try {
        const d=await request('/model-invocations');
        const rows=Array.isArray(d.entries)?d.entries:[];
        $('models-invocation-recent').textContent=rows.length?rows.slice(-25).reverse().map(x=>
          `${x.at||'?'} · ${x.trigger||'host'} / ${x.scene||'other'} · ${x.provider||'?'}/${x.model||'?'} · ${x.durationMs||0}ms · ${x.result==='failed'?'失败 '+(x.errorKind||'unknown'):'完成'} · Token 未报告`).join('\n')
          :'本账号暂无可核验的宿主模型调用记录。视频 Headless 内部模型次数不包含在此列表。';
      }catch{$('models-invocation-recent').textContent='本地模型调用归因暂不可读（不影响模型使用）'}
    } catch(e) {
      for(const task of modelTaskIds)$('models-'+task+'-usage').textContent='调用统计读取失败';
    }
  };
  for(const task of modelTaskIds){
    $('models-'+task+'-test').addEventListener('click',async()=>{
      const button=$('models-'+task+'-test'),result=$('models-'+task+'-test-result');
      button.disabled=true;result.textContent='正在验证已保存的模型配置…';
      try {
        const r=await request('/model-test',{task})
        result.textContent='✓ 连接正常（'+r.elapsedMs+'ms）· '+r.note;
        result.style.color='var(--action)';
      } catch(e) {
        result.textContent='✗ '+String(e?.message||'测试失败').slice(0,520);
        result.style.color='var(--bad)';
      } finally {button.disabled=false;}
    });
  }
  // 只列出 DSH 实际发现的模型：官方注册目录 + 已同步的自定义 Provider。
  // 选项值仍保持原来的 provider/model 字符串，后端运行逻辑不被改写。
  const modelRouteControls=[...modelDefs.map(([group,provider,model])=>({group,provider,model})),
    {group:'memory',provider:'mainSessionMemoryModelProvider',model:'mainSessionMemoryModelId',memory:true}];
  const option=(value,label)=>{const el=document.createElement('option');el.value=value;el.textContent=label;return el};
  const getGroupProvider=group=>group==='memory'?'main-memory-model-provider':'model-'+modelRouteControls.find(x=>x.group===group).provider;
  const getGroupModel=group=>group==='memory'?'main-memory-model-id':'model-'+modelRouteControls.find(x=>x.group===group).model;
  const setSelect=(el,values,value)=>{el.replaceChildren(...values);if(value&&!values.some(x=>x.value===value))el.appendChild(option(value,'旧配置：'+value));el.value=value||''};
  const renderRouteModelSelect=(entry,chosen='')=>{
    const catalog=headlessCurrentCatalog.find(p=>p.id===$(getGroupProvider(entry.group)).value);
    const models=Array.isArray(catalog?.models)?catalog.models:[];
    setSelect($(getGroupModel(entry.group)),[option('','请选择模型'),...models.map(m=>option(m,m))],chosen);
  };
  const renderDefaultModelSelect=(provider,chosen='')=>{
    const catalog=headlessCurrentCatalog.find(p=>p.id===provider),models=Array.isArray(catalog?.models)?catalog.models:[];
    setSelect($('models-default-model'),[option('','请选择模型'),...models.map(m=>option(m,m))],chosen);
  };
  const updateRouteDescription=group=>{
    const provider=$(getGroupProvider(group)).value,model=$(getGroupModel(group)).value;
    $('models-'+group+'-effective').textContent=provider&&model?'当前选择：'+provider+' / '+model:group==='behaviorDecision'?'未单独指定：继承「社交互动模型」（保留旧用户配置），也可以手动选择独立模型':'尚未选择模型';
  };
  const renderModelDropdowns=c=>{
    const observed=new Map(headlessCurrentCatalog.map(x=>[x.id,{...x,models:[...(x.models||[])]}]))
    const include=(provider,model)=>{
      if(!provider||!model||!/^[^\s\r\n\0]{1,120}$/.test(provider)||!/^[^\r\n\0]{1,200}$/.test(model))return
      const row=observed.get(provider)
      if(row){if(!row.models.includes(model))row.models.push(model)}
      else observed.set(provider,{id:provider,models:[model],kind:'saved-only',synced:false})
    }
    include(c.pluginDefaultModelProvider,c.pluginDefaultModelId)
    for(const x of modelRouteControls)include(c[x.provider],c[x.model])
    if(typeof hostObservedModel!=='undefined'&&hostObservedModel)include(hostObservedModel.provider,hostObservedModel.model)
    headlessCurrentCatalog=[...observed.values()]
    const unverified=headlessCurrentCatalog.filter(x=>['observed-only','saved-only'].includes(x.kind))
    $('models-catalog-diagnostic').textContent=unverified.length?
      '目录不完整：已额外恢复 '+unverified.length+' 个当前宿主选择或历史配置 Provider。它们是已有标识，不代表适配器已注册或连接通过；若测试失败 502，请先检查模型中转站。':
      '下拉框基于已检测模型目录，连接测试会实际请求所选宿主模型；出现 502 时请检查中转站与上游服务。'
    const defaultProvider=String(c.pluginDefaultModelProvider||headlessDefaultModel?.provider||'');
    const defaultModel=String(c.pluginDefaultModelId||headlessDefaultModel?.model||'');
    // DOM <option> nodes have ONE parent: reusing an array across <select>s
    // silently moves every option to the last route and empties the earlier
    // Provider dropdowns. Build fresh DOM nodes for EACH select instead.
    const providerOptions=()=>[option('','请选择 Provider'),...headlessCurrentCatalog.map(p=>option(p.id,p.id+(['saved-only','observed-only'].includes(p.kind)?'（仅历史／宿主选择，未验证）':'')))];
    setSelect($('models-default-provider'),providerOptions(),defaultProvider);renderDefaultModelSelect(defaultProvider,defaultModel);
    $('models-default-summary').textContent=defaultProvider&&defaultModel?'当前默认模型：'+defaultProvider+' / '+defaultModel:'尚未设置默认模型';
    for(const entry of modelRouteControls){
      const provider=String(c[entry.provider]|| (entry.group==='behaviorDecision'?'':defaultProvider));
      const model=String(c[entry.model]||(entry.group==='behaviorDecision'?'':(provider===defaultProvider?defaultModel:'')));
      setSelect($(getGroupProvider(entry.group)),providerOptions(),provider);renderRouteModelSelect(entry,model);updateRouteDescription(entry.group);
    }
  };
  const applyDefaultModelToAllRoutes=()=>{
    const provider=$('models-default-provider').value,model=$('models-default-model').value;
    if(!provider||!model){$('models-default-summary').textContent='请选择默认 Provider 和模型。';return}
    for(const entry of modelRouteControls){
      $(getGroupProvider(entry.group)).value=provider;renderRouteModelSelect(entry,model);updateRouteDescription(entry.group);
      if(entry.group==='memory')$('main-memory-model-effort').value='';
      else{const def=modelDefs.find(x=>x[0]===entry.group);if(def?.[3])$('model-'+def[3]).value=''}
    }
    $('models-default-summary').textContent='已应用到全部 '+modelRouteControls.length+' 项任务：'+provider+' / '+model;
    $('models-recommendation-note').textContent='各项思考深度已恢复默认，保存后生效；仍可分别调整。';
  };
  $('models-default-provider').addEventListener('change',()=>renderDefaultModelSelect($('models-default-provider').value,''));
  $('models-default-model').addEventListener('change',applyDefaultModelToAllRoutes);
  for(const entry of modelRouteControls){
    $(getGroupProvider(entry.group)).addEventListener('change',()=>{renderRouteModelSelect(entry,'');updateRouteDescription(entry.group)});
    $(getGroupModel(entry.group)).addEventListener('change',()=>updateRouteDescription(entry.group));
  }
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
  // One picture and one acceptance panel; only the selected route can touch it.
  let savedVisionRoute={provider:'',model:'',effort:'',source:'missing',mode:'independent_dsh'};
  const visionRouteHasUnsavedChanges=()=>!sameVisionRoute(resolveVisionRouteForm(),savedVisionRoute);
  const visionIsLocal=()=>$('models-vision-mode').value==='independent_local';
  // The visible journey is intentionally separate from the six technical stages:
  // an MCP preflight or a successful CLI exit never counts as visual understanding.
  const updateVisionJourney=({ready=false,running=false,reviewable=false,approved=false,failed=false,previousApproval=false,local=false}={})=>{
    const root=$('vision-journey');
    if(!root)return;
    const step=(key,state)=>{const item=root.querySelector('[data-step="'+key+'"]');if(item)item.dataset.state=state;};
    step('choose',ready?'done':'current');
    step('test',reviewable||approved?'done':ready?'current':'blocked');
    step('review',approved?'done':reviewable?'current':'blocked');
    let next='请先选择识图方式并完成模型配置。';
    if(approved)next=previousApproval?'该模型此前已认可；本次复测还需单独检查。':'图片验收已通过，可以使用已认可的模型。';
    else if(reviewable)next='模型已返回回答。请对照左侧原图，判断是否识别正确。';
    else if(running)next='正在识别图片，请查看模型返回的真实回答。';
    else if(failed)next='本次图片识别未成功；可重新测试，详细原因见下方「技术诊断」。';
    else if(ready)next='模型已准备好。点击「开始识图测试」，再检查模型实际回答。';
    else if(local)next='请先启动 Ollama 并下载所选本地模型。';
    $('vision-journey-next').textContent=next;
    root.dataset.state=approved?'approved':reviewable?'review':failed?'failed':running?'running':ready?'ready':'setup';
  };
  const setVisionStage=(key,state,text)=>{
    const stages=$('vision-probe-stages');
    const row=typeof stages?.querySelector==='function'?stages.querySelector('[data-stage="'+key+'"]'):null;
    if(!row)return;
    row.dataset.state=state;
    const detail=typeof row.querySelector==='function'?row.querySelector('span'):null;
    if(detail)detail.textContent=text;
  };
  const renderVisionDiagnostics=status=>{
    const local=visionIsLocal(),route=status?.route||{},diag=status?.diagnostics||{};
    const caps=$('vision-route-capabilities');
    if(local){
      caps.textContent='当前使用本地 Ollama：DSH Provider、Headless 图片工具和第三方 API 阶段不参与本次识图。实际图片识别结果见下方统一人工验收。';
      setVisionStage('route','unknown','本地 Ollama 路由；DSH Headless 不适用');
      setVisionStage('mcpPreflight','unknown','本地 Ollama 不使用 Headless MCP');
      setVisionStage('mcpImage','unknown','本地模型直接接收原图；不经过 MCP');
      setVisionStage('attachmentBridge','unknown','不经过 DSH 图片附件桥接');
      setVisionStage('providerApi','unknown','本地 Ollama 请求状态见本地验收结果');
      setVisionStage('modelAnswer','unknown','等待本地模型验收');
      return;
    }
    const current=resolveVisionRouteForm();
    const shownRoute=route.provider&&route.model?route:current;
    const sourceLabels={vision:'视觉任务独立指定',default:'继承全局默认模型',host:'继承 DSH 当前模型',mixed:'Provider / 模型分别继承',incomplete:'路由字段不完整',missing:'未配置'};
    const sourceLabel=sourceLabels[shownRoute.source]||sourceLabels[current.source]||'当前表单路由';
    const input=shownRoute.input;
    const imageText=shownRoute.imageInputDeclared===true?'已声明 image':
      shownRoute.imageInputDeclared===false?'未声明 image':'未从当前 Headless 模型定义读取到声明';
    const effortList=Array.isArray(shownRoute.reasoningEfforts)?shownRoute.reasoningEfforts:null;
    const effortText=shownRoute.reasoningEffortsDeclared===true?
      (effortList?.length?effortList.join(' / '):'已声明（未枚举档位）'):'未读取到思考档位声明';
    const api=shownRoute.api||'未知 / 未同步';
    const base=shownRoute.baseURL||'未暴露（可能为 DSH 内置 Provider）';
    const actualEffort=current.effort||'模型默认';
    caps.textContent=[
      '有效路由：'+(shownRoute.provider||'未配置')+' / '+(shownRoute.model||'未配置')+' · '+sourceLabel,
      'Headless 协议：'+api+' · Base URL 主机：'+base+' · 配置同步：'+(shownRoute.headlessSynced===true?'已同步':'尚未确认同步'),
      (shownRoute.headlessSynced===true?'Headless 能力声明：':'源配置能力声明：')+'图片输入 '+imageText+' · 思考档位 '+effortText+' · 本次思考深度 '+actualEffort,
      '独立 Headless 文字连接：'+(shownRoute.headlessVerified===true?'已验证':'尚未验证')+'；文字验证不代表图片识别成功。',
    ].join('\n');
    const preflight=diag.mcpPreflight||{};
    setVisionStage('mcpPreflight',preflight.status==='ready'?'passed':preflight.status==='failed'?'failed':'unknown',
      preflight.status==='ready'?'固定图片 / 工具声明 / 本地依赖通过；不证明 DSH 已启动 MCP':
      preflight.status==='failed'?'本地前置预检失败 · '+(preflight.reason||'unknown'):'尚无独立本地预检回执');
    const composed=diag.headlessConfig||{};
    if(composed.status==='failed'){
      setVisionStage('mcpPreflight','failed','独立 MCP 预检可能成功，但当前 DSH Headless 实际 overlay 合成失败：'+(composed.reason||'unknown'));
    }else if(composed.status==='ready'){
      setVisionStage('mcpPreflight','passed','独立 MCP 预检及当前 DSH Headless 配置合成都通过；实际工具调用及图片回答仍待验证');
    }
    const mcp=diag.mcpImage||{},bridge=diag.attachmentBridge||{},apiStage=diag.providerApi||{},answer=diag.modelAnswer||{};
    const stateFor=value=>['verified','completed','returned'].includes(value)?'passed':
      ['failed','timeout','not_received','mismatch','missing','empty','not_started'].includes(value)?'failed':
      ['pending','not_verified'].includes(value)?'pending':'unknown';
    setVisionStage('route',stateFor(route.headlessVerified===true?'verified':shownRoute.complete?'not_verified':'missing'),
      (shownRoute.provider||'未配置')+' / '+(shownRoute.model||'未配置')+' · '+(route.headlessVerified===true?'Headless 文字连接已验证':'Headless 文字连接未验证'));
    const mcpText=mcp.status==='verified'?
      `MCP 已返回 ${mcp.imageBlocks||1} 个 ${mcp.mimeType||'PNG'} 图片块 · ${Number(mcp.byteLength||0).toLocaleString('zh-CN')} bytes`:
      ({not_received:'没有取得 MCP 图片工具回执',mismatch:'MCP 图片回执与固定原图不一致',not_run:'尚未执行图片工具'}[mcp.status]||'图片工具状态：'+(mcp.status||'未知'));
    setVisionStage('mcpImage',stateFor(mcp.status),mcpText);
    setVisionStage('attachmentBridge','unknown',bridge.note||'MCP 返回 ImageContent 不等于已取得 DSH 内部桥接回执；插件无法直接观察该阶段');
    const apiText=apiStage.status==='completed'?'DSH 子进程正常结束；不代表中转站提供了独立的 HTTP 诊断':
      apiStage.status==='failed'?'请求失败 · 安全分类 '+(apiStage.diagnosticCode||'未分类'):
      apiStage.status==='timeout'?'请求超时':apiStage.status==='not_started'?'未能启动 DSH 请求':'等待请求结果';
    const cli=diag.cliProcess||{};
    const cliText=cli.status==='exited'&&Number.isInteger(cli.exitCode)?
      ` · DSH exit=${cli.exitCode} · stdout ${cli.stdout==='present'?'有输出':'无输出'} · stderr ${cli.stderr==='present'?'有输出':'无输出'}`:'';
    setVisionStage('providerApi',stateFor(apiStage.status),apiText+cliText);
    const answerText=answer.status==='returned'?
      (status?.status==='approved'?'已返回并由你认可':status?.status==='rejected'?'已返回，但你认为结果不满意':'已返回 · 等待你检查是否真的看懂原图'):
      answer.status==='missing'?'模型没有返回最终描述':answer.status==='empty'?'模型最终描述为空':'等待最终回答';
    setVisionStage('modelAnswer',stateFor(answer.status==='returned'&&status?.status!=='approved'?'pending':answer.status),answerText);
  };
  // Model inspection/diagnostics must remain accessible even if autonomous
  // video observation is off: incoming DM/comment images have separate policy.
  // The switch belongs to the VIDEO usage card, not the entire model accordion.
  const visionSection=$('models-vision-settings');
  const updateVisionDisclosure=()=>{
    const on=$('models-vision-enabled').checked;
    visionSection.dataset.videoObservationEnabled=String(on);
    $('models-vision-collapse-hint').textContent=on?
      '视频观察已勾选 · 模型设置与图片验收':'视频观察关闭 · 仍可配置模型和图片识别';
  };
  const syncVisionModeUI=()=>{
    updateVisionDisclosure();
    const local=visionIsLocal();
    const fields=$('models-vision');
    fields.querySelectorAll('input,select,textarea').forEach(el=>{el.disabled=local});
    fields.style.opacity=local?'0.48':'1';
    fields.setAttribute('aria-disabled',String(local));
    $('models-vision-test').disabled=local;
    $('models-vision-test').title=local?'正在使用 Ollama：DSH 连接测试仅在 DSH 模式可用':'';
    $('vision-python-auto-repair').hidden=local;
    $('vision-python-auto-repair-status').hidden=local;
    $('local-vision-controls').hidden=!local;
    $('local-vision-controls').style.display=local?'':'none';
    const activeBadge=$('models-local-vision-active');
    if(activeBadge){
      const configured=$('models-vision-enabled').checked;
      activeBadge.textContent=!configured?'未启用':local?'当前选择 · '+($('local-vision-model').selectedOptions?.[0]?.textContent||'本地模型'):'当前路由 · DSH 视觉模型';
      activeBadge.classList.toggle('pending',!configured);
      activeBadge.classList.toggle('dependency-ready-badge',configured);
    }
    $('vision-probe-source').textContent=local?'Ollama · 本地模型':'DSH · 配置的 Provider';
    const route=resolveVisionRouteForm();
    const sourceLabel=({default:'继承默认模型',vision:'视觉任务独立指定',host:'继承 DSH 当前模型',mixed:'Provider / 模型分别继承'})[route.source]||'路由未完整配置';
    $('vision-probe-route').textContent=local?
      `当前验收：Ollama / ${$('local-vision-model').selectedOptions?.[0]?.textContent||'未选择'} · 无须配置 DSH Provider`:
      `当前有效路由：${route.provider||'未配置 Provider'} / ${route.model||'未配置模型'} · ${sourceLabel} · 思考深度 ${route.effort||'模型默认'}`;
    renderVisionDiagnostics(null);
    updateVisionJourney({local,ready:false});
    $('vision-probe-last-run').textContent='';
    $('vision-probe-result').textContent=(!local&&visionRouteHasUnsavedChanges())?'DSH 模型配置尚未保存，请保存后再验收。':'正在读取当前模型验收状态…';
    $('vision-probe-answer').textContent='尚无结果';
    $('vision-probe-error').textContent='';
    $('vision-probe-approve').disabled=true;
    $('vision-probe-reject').disabled=true;
  };
  const loadLocalVisionThinking=async()=>{
    const id=$('local-vision-model').value;
    const select=$('local-vision-thinking');
    const hint=$('local-vision-thinking-support');
    const modes=new Set(['default','off','on']);
    let reply;
    try{reply=await request('/local-vision/thinking?model='+encodeURIComponent(id));}
    catch(error){reply={known:false,error:String(error?.message||error)};}
    const values=Array.isArray(reply?.values)?reply.values:[];
    for(const option of [...select.options]){
      if(['low','medium','high'].includes(option.value))option.disabled=!values.includes(option.value);
      if(option.value==='on'&&reply?.known===true)option.disabled=values.length===1&&values[0]===false;
      // For named-level models, Ollama still accepts think:false and maps it to the lowest level.
      if(option.value==='off')option.disabled=false;
      if(option.value==='default')option.disabled=false;
    }
    const unavailable=select.selectedOptions[0]?.disabled?select.value:'';
    if(unavailable)select.value='default';
    hint.textContent=(unavailable?'已保存的“'+unavailable+'”在此模型不受支持，请选择兼容设置并保存。':'')+(reply?.known
      ? 'Ollama 已报告支持：'+(values.map(v=>String(v)).join('、')||'模型默认')+'；不支持的等级不能保存。'
      : 'Ollama 未提供可验证的思考等级；可使用模型默认/开/关。具体效果以实际回执为准。');
  };
  $('local-vision-model').addEventListener('change',()=>{syncVisionModeUI();run(loadLocalVisionThinking)});
  $('local-vision-thinking-save').addEventListener('click',()=>run(async()=>{
    const mode=$('local-vision-thinking').value;
    if(!['default','off','on','low','medium','high'].includes(mode)||$('local-vision-thinking').selectedOptions[0]?.disabled)
      throw Error('当前模型不支持所选思考深度');
    const saved=await request('/config',{visionLocalThinking:mode});
    message(localSaveNotice(saved,'本地 Ollama 识图思考方式已保存；下次视频感知使用。'));
  }));
  // One setting / two visible entry points. Explicit toggle changes commit only
  // that one permission, not unrelated unsaved form drafts on either page.
  // Keep the original stored booleans and fail closed on network errors.
  let visionToggleBusy=false;
  const pairedVisionToggles=[
    {key:'visionEnabled',ids:['models-vision-enabled','bili-video-vision-enabled']},
    {key:'incomingImageRecognitionEnabled',ids:['models-incoming-image-enabled','bili-disable-incoming-vision']},
  ];
  for(const item of pairedVisionToggles){
    for(const id of item.ids)$(id).addEventListener('change',()=>run(async()=>{
      if(visionToggleBusy)return;
      visionToggleBusy=true;
      const value=$(id).checked;
      for(const paired of item.ids)$(paired).disabled=true;
      try{
        const saved=await request('/config',{[item.key]:value});
        for(const paired of item.ids)$(paired).checked=value;
        if(item.key==='visionEnabled')syncVisionModeUI();
        if(item.key==='incomingImageRecognitionEnabled'){
          setChoice('bili-interaction-choice','custom');renderBiliPlan();
        }
        message(localSaveNotice(saved,value?'已开启并同步保存':'已关闭并同步保存'));
      }catch(e){
        const c=(await request('/config').catch(()=>({config:{}}))).config||{};
        for(const paired of item.ids)$(paired).checked=c[item.key]===true;
        if(item.key==='visionEnabled')syncVisionModeUI();
        throw e;
      }finally{for(const paired of item.ids)$(paired).disabled=false;visionToggleBusy=false;}
    }));
  }
  $('models-vision-enabled').addEventListener('change',()=>syncVisionModeUI());
  $('models-vision-mode').addEventListener('change',()=>run(async()=>{
    syncVisionModeUI();
    if(visionIsLocal()){ $('vision-runtime-alert').hidden=true;await restoreOllama();}
    else {await loadDshVisionStatus();await checkVisionEnvironmentOnEntry();}
  }));
  let localVisionPoll=null;
  const loadLocalVisionStatus=async()=>{
    const state=await request('/local-vision/status');
    const choice=$('local-vision-model')?.value||'qwen3.5-4b';
    const model=(state.models||[]).find(m=>m.id===choice),progress=state.progress||{};
    const active=state.active===choice;
    const activeBadge=$('models-local-vision-active');
    if(activeBadge&&visionIsLocal()){
      const ready=state.running===true&&active&&model?.verified===true;
      activeBadge.textContent=ready?'正在使用 · '+(model?.name||choice):
        state.running===false?'本地服务未运行':active?'已选 · 待验收':'未启用所选模型';
      activeBadge.classList.toggle('pending',!ready);
      activeBadge.classList.toggle('dependency-ready-badge',ready);
    }
    const belongs=progress.model===choice;
    const downloading=['pulling','checking','deleting'].includes(progress.phase);
    const v=model?.verification;
    if(visionIsLocal()){
      const pendingReview=v?.status==='awaiting_review'&&typeof v.reviewId==='string';
      $('vision-probe-source').textContent='Ollama · 本地模型';
      $('vision-probe-route').textContent=`当前验收：Ollama / ${model?.name||choice}`;
      $('vision-probe-result').textContent=model?.verified?
        (v?.status==='awaiting_review'?'已有人工认可（模型摘要未变），当前复测结果待确认':'已人工验收 · 相同模型版本，重启无需再验'):
        !v?'尚未识别此本地模型':
        v.status==='running'?'正在识别大肥鱼原图…':
        v.status==='awaiting_review'?'识别完成 · 等待人工验收':
        v.status==='approved'?'你已认可本次识图结果':
        v.status==='rejected'?'你对本次结果不满意':'本次识图失败';
      $('vision-probe-answer').textContent=v?.answer||'(无最终回答)';
      $('vision-probe-error').textContent=v?.error||(!v?.answer&&v?.hadThinking?'模型没有返回可供验收的最终回答。':'');
      $('vision-probe-verify').disabled=!state.running||!model?.installed||downloading;
      $('vision-probe-verify').textContent=model?.verified?'重新识图测试':'开始识图测试';
      $('vision-probe-approve').disabled=!state.running||!model?.installed||downloading||!pendingReview;
      $('vision-probe-reject').disabled=!state.running||!model?.installed||downloading||!pendingReview;
      updateVisionJourney({
        local:true,
        ready:state.running===true&&model?.installed===true&&!downloading,
        running:v?.status==='running',
        reviewable:pendingReview,
        approved:model?.verified===true,
        previousApproval:model?.verified===true&&v?.status==='awaiting_review',
        failed:v?.status==='failed'||v?.status==='rejected',
      });
    }
    const size=progress.total?` · ${(Number(progress.completed||0)/1048576).toFixed(1)} / ${(Number(progress.total)/1048576).toFixed(1)} MiB`:'';
    const downloadStatus=progress.phase==='pulling'?(progress.total?`当前文件 ${progress.percent||0}%${size}（非模型总进度）`:'正在获取模型文件'):
      progress.phase==='checking'?'正在验证图片理解能力':progress.phase==='deleting'?'正在删除模型':'';
    const needsReview=state.running===true&&model?.installed===true&&model?.verified!==true;
    const currentReview=needsReview?(model?.approvalStatus==='digest-unavailable'?'尚未人工验收（模型摘要未确认）':'尚未人工验收'):'';
    const statusStart=!state.running?('Ollama 当前未运行，模型安装和验收状态待服务恢复后确认；'+(state.error||'可检查并恢复服务')):
      `${model?.name||choice} · ${model?.installed?'模型已下载':'尚未下载'} · ${needsReview?'':model?.verified?'人工验收已保存（模型摘要一致）':'尚未下载模型'}`;
    $('local-vision-status').textContent=statusStart;
    $('local-vision-review-inline').hidden=!needsReview;
    $('local-vision-review-label').textContent=currentReview;
    $('local-vision-review-jump').hidden=!needsReview;
    $('local-vision-review-jump').textContent='前往人工验收 ↑';
    $('local-vision-status-tail').textContent=`${active?' · 已选为视频视觉模型':''}${downloading&&belongs?' · '+downloadStatus:''}${progress.error&&belongs?' · '+progress.error:''}`;
    $('local-vision-progress').hidden=!downloading;
    $('local-vision-progress').value=downloading?Number(progress.percent)||0:0;
    $('local-vision-ensure').disabled=state.running||downloading;
    $('local-vision-install').hidden=Boolean(model?.installed);
    $('local-vision-install').disabled=!state.running||downloading||model?.installed;
    $('local-vision-select').disabled=!state.running||!model?.installed||!model?.verified||downloading||active;
    $('local-vision-select').textContent=active?'当前正在使用':'启用已认可模型';
    $('local-vision-delete').disabled=!state.running||!model?.installed||downloading;
    $('local-vision-cancel').hidden=!downloading;
    $('local-vision-cancel').disabled=!downloading||progress.phase==='deleting';
    return state;
  };
  const watchLocalVision=()=>{
    clearInterval(localVisionPoll);
    localVisionPoll=setInterval(async()=>{
      try{const state=await loadLocalVisionStatus();
        if(!['pulling','checking','deleting'].includes(state.progress?.phase)){
          clearInterval(localVisionPoll);localVisionPoll=null;
        }
      }catch{clearInterval(localVisionPoll);localVisionPoll=null;}
    },1700);
  };
  const restoreOllama=async()=>{
    const result=await request('/local-vision/ensure',{});
    if(result.ok)message(result.message||'Ollama 服务已可访问');
    await loadLocalVisionStatus();
    return result;
  };
  $('local-vision-review-jump').addEventListener('click',()=>{
    const panel=$('vision-unified-probe-panel');
    panel?.scrollIntoView({behavior:'smooth',block:'center'});
    panel?.classList.remove('vision-approval-flash');
    void panel?.offsetWidth;
    panel?.classList.add('vision-approval-flash');
    setTimeout(()=>panel?.classList.remove('vision-approval-flash'),3000);
  });
  $('local-vision-ensure').addEventListener('click',()=>run(restoreOllama));
  $('local-vision-model').addEventListener('change',()=>run(loadLocalVisionStatus));
  $('local-vision-refresh').addEventListener('click',()=>run(restoreOllama));
  $('local-vision-install').addEventListener('click',()=>run(async()=>{
    const id=$('local-vision-model').value;
    const ready=await request('/local-vision/status');
    if(ready.models?.find(m=>m.id===id)?.installed){message('模型已经下载，无需重复安装；可直接验收或启用。');await loadLocalVisionStatus();return;}
    if(!await confirmAction({title:'下载本地视觉模型？',description:'由本机 Ollama 下载缺失的模型并首次识别大肥鱼图片。结果仍须人工认可；已安装模型无需下载和重验。',confirmLabel:'确认下载'}))return;
    await request('/local-vision/install',{model:id});message('已开始下载缺失模型；完成后查看图片回答并人工认可。');watchLocalVision();await loadLocalVisionStatus();
  }));
  $('local-vision-cancel').addEventListener('click',()=>run(async()=>{await request('/local-vision/cancel',{});await loadLocalVisionStatus()}));
  const reviewLocalVision=async accepted=>{
    const id=$('local-vision-model').value;
    // Fetch the latest review token; stale tabs and concurrent rechecks
    // cannot confirm an earlier model's response.
    const state=await request('/local-vision/status');
    const record=(state.models||[]).find(m=>m.id===id)?.verification;
    if(record?.status!=='awaiting_review'||!record?.reviewId)throw Error('识图记录已失效，请重新识别');
    await request('/local-vision/review',{model:id,reviewId:record.reviewId,accepted});
    message(accepted?'已记录你的人工认可。现在可以手动启用模型。':'已记录本次识图不满意，可重新识别。');
    await loadLocalVisionStatus();
  };
  $('local-vision-select').addEventListener('click',()=>run(async()=>{
    const id=$('local-vision-model').value;
    if(!await confirmAction({title:'启用本地视觉模型？',description:'只有你已经人工认可本轮大肥鱼图片识别结果，才能启用本机 Ollama 视觉模型。原有视频感知方案和外发授权保持不变。',confirmLabel:'启用已认可模型'}))return;
    const selected=await request('/local-vision/select',{model:id});
    if(selected.active!==id||selected.visionEnabled!==true)
      throw Error('模型启用未通过配置回读，不能显示成功');
    $('models-vision-mode').value='independent_local';$('models-vision-enabled').checked=true;syncVisionModeUI();
    message('已启用已认可的本地视觉模型；刷新与重启后会保持该选择。');await loadLocalVisionStatus();
  }));
  $('local-vision-delete').addEventListener('click',()=>run(async()=>{
    const id=$('local-vision-model').value;
    if(!await confirmAction({title:'删除 Ollama 全局模型？',description:'此操作会从 Ollama 中删除该模型，可能影响同一电脑上的其他程序。如果它是鱼鱼当前使用的视觉模型，会同步关闭视频预览识图。',confirmLabel:'确认删除全局模型',danger:true}))return;
    await request('/local-vision/delete',{model:id,confirm:'DELETE_LOCAL_VISION_MODEL'});await loadModels();
    message('已请求删除选中模型。');
  }));
  // One-click repair is optional and runs in the DSH host, not in PowerShell.
  // Polling is read-only; never claim visual understanding from Python readiness.
  let visionRepairPollTimer=null;
  const renderVisionRepair=(repair,runtime)=>{
    const el=$('vision-python-auto-repair-status'),button=$('vision-python-auto-repair');
    if(!el||!button)return;
    const stage={discover:'寻找健康 Python',prepare_temp:'准备视觉专用临时目录',create:'创建独立视觉环境',install:'安装 MCP 依赖',verify:'检查读写与模块',save:'保存已验证路径'};
    const reason={no_healthy_base_python:'没有找到具备普通权限的 Python 3.10–3.13；需要检查本机执行限制',
      vision_venv_creation_failed:'独立环境创建失败',vision_dependencies_install_failed:'依赖安装失败，请检查网络和安装环境',
      vision_environment_unhealthy:'新建视觉环境未通过检查',vision_path_save_failed:'环境已创建，但设置保存失败',
      runtime_permission_error:'视觉 Python 对专用临时目录或插件目录的写入测试未通过',vision_temp_unavailable:'无法安全使用插件专属临时目录（tmp/vision），请检查 Duty Home 权限',missing_mcp_dependencies:'MCP 模块未就绪',
      unsupported_or_missing_installation:'当前系统或插件环境不支持自动修复',healthy_installed:'独立视觉环境准备完成',already_healthy:'已有健康视觉环境，无需重装'};
    button.disabled=mobileViewOnly||repair?.installing===true;
    if(repair?.state==='ready'||runtime?.status==='healthy'){button.classList.remove('vision-repair-attention');$('vision-runtime-alert').hidden=true}
    el.textContent=repair?.installing?'正在'+(stage[repair.stage]||'修复')+'…':
      repair?.state==='ready'?'视觉 Python 已通过读写与 MCP 依赖检查；仍须人工图片验收':
      repair?.state==='failed'?'自动修复失败：'+(reason[repair.reason]||'请检查本机 Python 安全策略'):
      runtime?.status==='healthy'?'视觉运行时已就绪，无需额外安装':'出现运行时错误时可点击一键修复，无需命令行';
    if(repair?.installing&&visionRepairPollTimer===null){
      visionRepairPollTimer=setInterval(()=>{if(visionIsLocal()){clearInterval(visionRepairPollTimer);visionRepairPollTimer=null;return}
        loadDshVisionStatus().catch(()=>{});},2500);
    }else if(!repair?.installing&&visionRepairPollTimer!==null){clearInterval(visionRepairPollTimer);visionRepairPollTimer=null}
  };
  const visualHealthAlert=$('vision-runtime-alert')
  const checkVisionEnvironmentOnEntry=async()=>{
    const repair=$('vision-python-auto-repair')
    visualHealthAlert.hidden=true;repair.classList.remove('vision-repair-attention')
    if(visionIsLocal())return
    visualHealthAlert.hidden=false
    $('vision-runtime-alert-text').textContent='正在进行只读的视觉运行环境检查…'
    $('vision-runtime-alert-open').hidden=true
    try{
      const result=await request('/dsh-vision/runtime-health')
      if(visionIsLocal())return
      if(result.status==='healthy'||result.status==='unsupported'){
        visualHealthAlert.hidden=true;return
      }
      $('vision-runtime-alert-text').textContent='视觉运行环境异常（'+(result.reason||'未找到健康 Python')+'），可能导致图片识别失败。请定位并手动执行自动修复。'
      $('vision-runtime-alert-open').hidden=false
      repair.classList.add('vision-repair-attention')
    }catch{
      $('vision-runtime-alert-text').textContent='视觉运行环境检查暂不可用，请打开视觉识别模型查看诊断。'
      $('vision-runtime-alert-open').hidden=false
    }
  }
  $('vision-runtime-alert-open').addEventListener('click',()=>{
    const section=$('models-vision-settings'),repair=$('vision-python-auto-repair')
    section.open=true
    section.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'})
    repair.classList.add('vision-repair-attention')
    repair.focus({preventScroll:true})
  })
  $('vision-python-auto-repair').addEventListener('click',()=>run(async()=>{
    if(visionIsLocal())throw Error('当前为 Ollama，本操作仅用于 DSH 视觉 Python');
    if(!await confirmAction({title:'自动准备 DSH 视觉环境？',
      description:'插件会在自己的数据目录使用专用视觉临时文件夹，寻找可用 Python，必要时创建隔离环境并联网安装 MCP 依赖。无需 Conda，不修改系统 TEMP、主 .venv、B站登录、Life 数据或授权；最终检查通过才保存。',confirmLabel:'开始修复'}))return;
    const result=await request('/dsh-vision/repair',{});
    message(result.started?'已启动视觉环境修复，请看本页状态；无需运行 PowerShell。':'视觉环境修复正在进行。');
    await loadDshVisionStatus();
  }));
  let dshVisionStatusRequestSeq=0;
  const loadDshVisionStatus=async()=>{
    const seq=++dshVisionStatusRequestSeq;
    const status=await request('/dsh-vision/status');
    if(seq!==dshVisionStatusRequestSeq)return null;
    dshVisionStatus=status;
    if(!visionIsLocal()){
      $('vision-probe-source').textContent='DSH · 配置的 Provider';
      const current=resolveVisionRouteForm(),actual=status.route||{};
      const provider=actual.provider||current.provider||'未配置 Provider';
      const model=actual.model||current.model||'未配置模型';
      const sourceLabels={vision:'视觉任务独立指定',default:'继承全局默认模型',host:'继承 DSH 当前模型',mixed:'Provider / 模型分别继承'};
      const sourceLabel=sourceLabels[actual.source]||sourceLabels[current.source]||'当前有效路由';
      $('vision-probe-route').textContent=visionRouteHasUnsavedChanges()?
        `当前表单路由：${current.provider||'未配置'} / ${current.model||'未配置'}；尚未保存。下方诊断仍对应上一次保存的 ${provider} / ${model}。`:
        `当前验收：DSH / ${provider} / ${model} · ${sourceLabel} · ${actual.reasoningEffort||'模型默认思考深度'}（已保存有效路由）`;
      const labels={idle:'尚未执行 DSH 图片识别',running:'正在启动受限 DSH 视觉会话…',awaiting_review:'识图完成 · 等待人工验收',approved:'你已认可本次识图结果',rejected:'本轮结果不满意',failed:'DSH 图片识别未成功',route_changed:'模型配置已变更，结果失效'};
      $('vision-probe-result').textContent=visionRouteHasUnsavedChanges()?'DSH 模型配置尚未保存，请保存后再验收。':(labels[status.status]||status.status||'未验证');
      $('vision-probe-answer').textContent=status.answer||'(无最终回答)';
      $('vision-probe-error').textContent=(status.error||'')+(status.diagnosticCode?' · 诊断码：'+status.diagnosticCode:'');
      const runtime=status.pythonRuntime||{};
      $('vision-probe-python-runtime').textContent='DSH 视觉 Python：'+(runtime.status==='healthy'?'健康':runtime.status==='unhealthy'?'不可用':'待检查')+(runtime.source==='fallback'?' · 使用已验证的备用运行时':'')+(runtime.status==='unhealthy'?' · '+(runtime.reason||'unknown'):'');
      renderVisionRepair(status.visionRepair||{},runtime);
      renderVisionDiagnostics(status);
      const last=status.lastRun;
      $('vision-probe-last-run').textContent=last?
        `最近持久化诊断：${last.at||'未知时间'} · ${last.status||'unknown'} · ${last.diagnosticCode||'无错误码'}${last.headlessConfig&&last.headlessConfig!=='not_run'?' · Headless 配置 '+last.headlessConfig+(last.headlessConfigReason&&last.headlessConfigReason!=='not_run'?' / '+last.headlessConfigReason:'')+(last.headlessConfigFailureLayer&&last.headlessConfigFailureLayer!=='unknown'?' / 失败层级 '+last.headlessConfigFailureLayer:'')+(last.headlessConfigFailureKind&&last.headlessConfigFailureKind!=='unknown'?' / 原因 '+last.headlessConfigFailureKind:'')+(last.headlessConfigHostRejectCode&&last.headlessConfigHostRejectCode!=='unknown'?' / 宿主拒绝码 '+last.headlessConfigHostRejectCode:''):''}${last.cliProcess==='exited'?' · CLI exit='+last.cliExitCode+' · stderr '+(last.cliStderr||'unknown')+' / '+(last.cliStderrKind||'unknown')+(last.cliNodeExceptionType&&last.cliNodeExceptionType!=='unknown'?' / '+last.cliNodeExceptionType:''):''}（不是跨重启识图认可）`:
        '暂无持久化的 DSH 图片验收诊断';
      $('vision-probe-verify').disabled=status.status==='running'||visionRouteHasUnsavedChanges()||actual.headlessVerified!==true;
      $('vision-probe-verify').title=actual.headlessVerified===true?'验证当前已保存的 DSH 图片路由':'先在上方 Headless 模型同步与检测区完成该 Provider / 模型的真实文字连接验证';
      const reviewable=status.status==='awaiting_review'&&Boolean(status.reviewId)&&!visionRouteHasUnsavedChanges();
      $('vision-probe-approve').disabled=!reviewable;
      $('vision-probe-reject').disabled=!reviewable;
      updateVisionJourney({
        ready:actual.headlessVerified===true&&!visionRouteHasUnsavedChanges(),
        running:status.status==='running',
        reviewable,
        approved:status.status==='approved'&&status.verified===true,
        failed:status.status==='failed'||status.status==='rejected',
      });
    }
    renderHeadlessBoard();
    return status;
  };
  const reviewDshVision=async accepted=>{
    const current=await request('/dsh-vision/status');
    if(current.status!=='awaiting_review'||!current.reviewId)throw Error('DSH 图片验证结果已失效，请重新识别');
    await request('/dsh-vision/review',{reviewId:current.reviewId,accepted});
    await loadDshVisionStatus();
    if(accepted){
      const enabled=$('models-vision-enabled').checked;
      message(enabled?'已认可当前 DSH 图片识别结果。下一步请到「运行诊断」执行全流程视频感知测试；图片验收不等于视频链路通过。':
        '已认可当前 DSH 图片识别结果，但视频感知尚未启用。请开启视频视觉开关并保存，然后运行全流程 Debug。');
      $('vision-journey-next').textContent=enabled?
        '人工识图已认可；还需运行「运行诊断 → 全流程视频感知」确认生产执行路由和实际视频帧回执。':
        '人工识图已认可；视频感知开关仍为关闭，开启并保存后再运行全流程视频 Debug。';
    }else message('已记录本次识图不满意；不会将其视为通过验收。');
  };
  $('vision-probe-verify').addEventListener('click',()=>run(async()=>{
    if(visionIsLocal()){
      const id=$('local-vision-model').value;
      const pending=request('/local-vision/verify',{model:id});
      watchLocalVision();
      await pending;
      message('本地模型已返回识图结果，请查看完整回答后决定是否认可。');
      await loadLocalVisionStatus();
    }else{
      if(visionRouteHasUnsavedChanges())throw Error('请先保存识图方式、DSH 视觉 Provider／模型／思考深度，再执行图片验收');
      if(!await confirmAction({title:'测试已保存的 DSH 视觉模型？',description:'会在独立受限 Headless 会话中调用已配置的 DSH Provider/模型识别原图，可能产生模型费用。普通 Session 能识图不代表 Headless 启动配置也正常。',confirmLabel:'执行 DSH 识图'}))return;
      $('vision-probe-result').textContent='正在识图，请查看返回结果…';
      updateVisionJourney({ready:true,running:true});
      $('vision-probe-verify').disabled=true;
      try{await request('/dsh-vision/verify',{});message('DSH 模型已返回识图结果，请人工验收。');}
      finally{await loadDshVisionStatus();}
    }
  }));
  $('vision-probe-approve').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'认可当前模型的图片理解？',description:'请确认回答确实来自对大肥鱼原图的视觉理解；只认可当前选中方式的本轮结果。',confirmLabel:'认可结果'}))return;
    if(visionIsLocal())await reviewLocalVision(true);else await reviewDshVision(true);
  }));
  $('vision-probe-reject').addEventListener('click',()=>run(async()=>{
    if(visionIsLocal())await reviewLocalVision(false);else await reviewDshVision(false);
  }));
  const setDependencyStyle=(element,ok)=>{
    element.classList.toggle('dependency-check-success',ok===true);
    element.classList.toggle('dependency-check-failed',ok===false);
  };
  let whisperPollTimer=null,whisperPolling=false;
  const stopWhisperPoll=()=>{if(whisperPollTimer!==null){clearTimeout(whisperPollTimer);whisperPollTimer=null;}};
  const startWhisperPoll=()=>{
    stopWhisperPoll();
    whisperPollTimer=setTimeout(async()=>{
      whisperPollTimer=null;
      if(document.hidden){startWhisperPoll();return;}
      if(whisperPolling){startWhisperPoll();return;}
      whisperPolling=true;
      try{
        const {whisper}=await request('/video-dependencies/whisper/status');
        renderWhisper(whisper||{});
      }catch(e){$('models-whisper-progress-label').textContent='状态读取失败：'+String(e?.message||e).slice(0,120);}
      finally{whisperPolling=false;}
    },1500);
  };
  const renderWhisper=whisper=>{
    const enabled=whisper.enabled===true,ready=whisper.environmentReady===true;
    const cached=whisper.modelCached===true,modelReady=ready&&cached;
    $('models-whisper-badge').textContent=modelReady?'模型已就绪':!ready?'依赖缺失':'模型待确认';
    $('models-whisper-badge').classList.toggle('pending',!modelReady);
    $('models-whisper-badge').classList.toggle('dependency-ready-badge',modelReady);
    $('models-whisper-status').textContent=`${enabled?'已授权按需转写':'开关关闭'} · ${ready?'转写环境已安装':'运行环境缺失'} · ${cached?'所选 Whisper 模型文件就绪':'未找到有效的所选模型文件'} · ${whisper.installing?'正在安装中':'未在安装'}${whisper.modelPathError?' · 自定义模型目录校验失败':''}`;
    setDependencyStyle($('models-whisper-status'),modelReady);
    const last=whisper.lastRun;
    $('models-whisper-last').textContent=!last?'最近实际转写：暂无可信回执（安装成功不算实际转写)':
      `最近实际转写：${new Date(last.at).toLocaleString('zh-CN',{hour12:false})} · ${last.model} · ${last.outcome==='success'?'成功，'+last.segments+'段':last.outcome==='started'?'已发起，尚未获完成回执':'失败（'+(last.reason||'未分类')+'）'}`;
    const log=$('models-whisper-log');
    const nearBottom=log.scrollTop+log.clientHeight>=log.scrollHeight-30;
    log.textContent=String(whisper.installLogTail||'').slice(-6000)||'暂无安装日志';
    if(nearBottom)log.scrollTop=log.scrollHeight;
    const progress=whisper.installProgress||{};
    const phaseLabels={idle:'尚无进行中的模型安装',environment:'正在准备 Python 环境…',packages:'正在安装 Python 转写依赖…',
      'download-start':'正在连接模型仓库…',download:'正在下载模型权重',verify:'正在校验并加载模型…',
      finished:'所选模型安装与验证已完成',failed:'安装未完成，请查看安装日志'};
    const current=Number(progress.currentBytes),total=Number(progress.totalBytes);
    const measurable=progress.phase==='download'&&Number.isFinite(current)&&Number.isFinite(total)&&total>1024&&current>=0&&current<=total;
    $('models-whisper-progress-label').textContent=(phaseLabels[progress.phase]||'模型安装状态未知')+
      (measurable?` · 当前文件 ${Math.floor(current*100/total)}%（${(current/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MiB）`:'')+
      (progress.reason?' · '+progress.reason:'');
    const bar=$('models-whisper-progress-bar');bar.style.display=measurable?'block':'none';
    if(measurable)bar.value=Math.floor(current*100/total);
    $('models-whisper-install').dataset.readinessDisabled=String(whisper.installing===true||modelReady);
    $('models-whisper-install').disabled=mobileViewOnly||whisper.installing===true||modelReady;
    $('models-whisper-install').textContent=modelReady?'已安装所选 Whisper 模型':'安装所选 Whisper 模型';
    const installed=$('models-whisper-installed');installed.replaceChildren();
    for(const item of whisper.installedModels?.models||[]){
      const row=node('div','','toolbar');row.style.margin='8px 0';
      const size=Number.isFinite(Number(item.bytes))?(Number(item.bytes)/1048576).toFixed(1)+' MiB':'未知';
      const label=node('span',`${item.model} · ${item.ready?'已安装':'未完整下载'} · 估计占用 ${size}${item.selected?' · 当前选择':''}`);
      const del=node('button','删除 '+item.model);del.type='button';
      del.disabled=mobileViewOnly||item.selected||whisper.installing===true||whisper.installedModels?.externalModelPath===true;
      del.title=item.selected?'请先切换并保存其他模型':whisper.installedModels?.externalModelPath?'使用外部模型目录时不允许删除缓存':'';
      del.addEventListener('click',()=>run(async()=>{
        if(!await confirmAction({title:'删除插件缓存中的 '+item.model+'？',
          description:`仅删除插件内 ${item.model} 的已下载模型文件（估计 ${size}）。不可撤销；当前运行中的模型不可删除。不会删除外部模型目录或 Python 环境。`,
          confirmLabel:'确认删除 '+item.model}))return;
        await request('/video-dependencies/whisper/delete',{model:item.model,confirm:'DELETE_WHISPER_'+item.model});
        message(item.model+' 模型缓存已删除');await loadVideoAux();
      }));
      row.append(label,del);installed.appendChild(row);
    }
    if(whisper.installing===true)startWhisperPoll();else stopWhisperPoll();
  };
  window.addEventListener('beforeunload',stopWhisperPoll);
  const loadVideoAux=async()=>{
    const [{config:c={}},{ffmpeg={},ffmpegInstall={},whisper={}}]=await Promise.all([
      request('/config'),request('/video-dependencies/status')]);
    $('models-transcribe').checked=c.transcribe===true;
    $('models-asr-model').value=['tiny','base','small','medium','large-v3'].includes(c.asrModel)?c.asrModel:'small';
    // Comment meme switches are owned by the Recent Comments page, not this model page.
    const ffmpegReady=ffmpeg.available===true&&ffmpeg.decodeTest?.ok===true;
    const ffmpegText=ffmpegReady?'实际 FFmpeg 合成视频帧解码自测通过':ffmpeg.available?'FFmpeg 已检测到，但实际合成视频帧解码自测未通过：'+(ffmpeg.decodeTest?.reason||'未知原因'):
      '未检测到可运行的 FFmpeg；'+(ffmpegInstall.result||'如刚安装完毕，请重新检测或重启 DSH。');
    $('models-ffmpeg-status').textContent=ffmpegText;
    setDependencyStyle($('models-ffmpeg-status'),ffmpegReady);
    $('models-ffmpeg-badge').textContent=ffmpegReady?'正在使用 · 解码成功':ffmpeg.available?'可运行 · 待修复解码':ffmpegInstall.phase==='installing'?'安装中':'未就绪';
    $('models-ffmpeg-badge').classList.toggle('pending',!ffmpegReady);
    $('models-ffmpeg-badge').classList.toggle('dependency-ready-badge',ffmpegReady);
    $('models-ffmpeg-install').dataset.readinessDisabled=String(ffmpeg.available||ffmpegInstall.phase==='installing');
    $('models-ffmpeg-install').disabled=mobileViewOnly||ffmpeg.available||ffmpegInstall.phase==='installing';
    $('models-ffmpeg-install').textContent=ffmpeg.available?'已安装 FFmpeg':'安装 FFmpeg';
    $('models-ffmpeg-path').value=c.ffmpegPath||'';
    $('models-ffmpeg-test-result').textContent=ffmpegReady?'实际 FFmpeg 合成视频帧解码自测通过':
      ffmpeg.available?'解码自测未通过：'+(ffmpeg.decodeTest?.reason||'未知原因'):'FFmpeg 未就绪，未通过解码自测';
    setDependencyStyle($('models-ffmpeg-test-result'),ffmpegReady);

    renderWhisper(whisper);
    $('models-whisper-model-path').value=c.asrModelPath||'';
    const modelReady=whisper.environmentReady===true&&whisper.modelCached===true;
    $('models-whisper-repo-link').href='https://huggingface.co/Systran/faster-whisper-'+$('models-asr-model').value;
    return {ffmpegReady,modelReady};
  };
  const selectExistingDependency=async(kind,path)=>{
    const saved=await request('/video-dependencies/paths',{kind,path});
    const status=await loadVideoAux();
    const element=$(kind==='ffmpeg'?'models-ffmpeg-path-result':'models-whisper-path-result');
    const label=kind==='ffmpeg'?'FFmpeg':'Whisper 模型目录';
    element.textContent=(path?'已保存本机路径：':'已恢复默认路径：')+label+'。'+
      (kind==='ffmpeg'?(status.ffmpegReady?'实际 FFmpeg 合成视频帧解码自测通过':'当前尚未通过实际解码自测'):
      (status.modelReady?'模型文件和 Python 转写环境已就绪（还需真实转写回执）':'当前尚未完全就绪'));
    setDependencyStyle(element,kind==='ffmpeg'?status.ffmpegReady:status.modelReady);
    message(saved.message||'本机路径设置已保存');
  };
  $('models-ffmpeg-path-save').addEventListener('click',()=>run(()=>selectExistingDependency('ffmpeg',$('models-ffmpeg-path').value.trim())));
  $('models-ffmpeg-path-clear').addEventListener('click',()=>run(()=>selectExistingDependency('ffmpeg','')));
  $('models-whisper-path-save').addEventListener('click',()=>run(()=>selectExistingDependency('whisper',$('models-whisper-model-path').value.trim())));
  $('models-whisper-path-clear').addEventListener('click',()=>run(()=>selectExistingDependency('whisper','')));
  $('models-aux-save').addEventListener('click',()=>run(async()=>{
    const payload={transcribe:$('models-transcribe').checked,asrModel:$('models-asr-model').value};
    const result=await request('/config',payload);
    await loadVideoAux();
    $('models-aux-save-status').textContent=localSaveNotice(result,'辅助能力已保存');
    message(localSaveNotice(result,'辅助能力已保存'));
  }));
  $('models-memes-save').addEventListener('click',()=>run(async()=>{
    const result=await request('/config', {commentMemesEnabled:$('models-comment-memes').checked,
      commentMemesDebug:$('models-comment-memes-debug').checked});
    $('models-memes-save-status').textContent=localSaveNotice(result,'评论梗图设置已保存');
    message(localSaveNotice(result,'评论梗图设置已保存'));
  }));
  $('models-ffmpeg-install').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'安装 FFmpeg？',description:'使用当前操作系统可用的系统包管理器安装 FFmpeg，预计额外下载 40 MB～1 GB 或更多；可能需要权限确认。不会修改代理或安装任何视频模型。',confirmLabel:'确认安装 FFmpeg'}))return;
    const result=await request('/video-dependencies/ffmpeg/install',{});
    message(result.message||'已发起 FFmpeg 安装，请稍后重新检测实际解码能力。');
    await loadVideoAux();
  }));
  $('models-whisper-install').addEventListener('click',()=>run(async()=>{
    const model=$('models-asr-model').value;
    const sizes={tiny:'约 75 MB',base:'约 145 MB',small:'约 485 MB',medium:'约 1.5 GB','large-v3':'约 3 GB'};
    const saved=(await request('/config')).config||{};
    if(saved.asrModel!==model)throw Error('请先保存当前 Whisper 模型选择，再安装；防止安装错误型号。');
    if(!await confirmAction({title:'安装 Whisper '+model+'？',description:'模型权重'+(sizes[model]||'大小未知')+'，还需额外 Python 依赖/缓存；仅安装，不会开启转写，也不会自动观看视频。',confirmLabel:'确认安装 Whisper'}))return;
    const result=await request('/install-asr',{});
    message(result.hint||'已提交 Whisper 安装，请查看日志和最近真实转写记录。');
    await loadVideoAux();
  }));
  $('models-ffmpeg-refresh').addEventListener('click',()=>run(loadVideoAux));
  $('models-whisper-refresh').addEventListener('click',()=>run(loadVideoAux));
  $('models-asr-model').addEventListener('change',()=>{
    $('models-whisper-repo-link').href='https://huggingface.co/Systran/faster-whisper-'+$('models-asr-model').value;
  });
  $('models-ffmpeg-test').addEventListener('click',()=>run(async()=>{
    const response=await request('/video-dependencies/ffmpeg/test',{});
    $('models-ffmpeg-test-result').textContent=response.test?.ok?'实际 FFmpeg 合成视频帧解码自测通过':'解码自测未通过：'+(response.test?.reason||'未知原因');
    setDependencyStyle($('models-ffmpeg-test-result'),response.test?.ok===true);
    await loadVideoAux();
  }));
  const loadModels=async()=>{
    const {config:c={}}=await request('/config');
    await loadHeadlessModels();
    renderModelDropdowns(c);
    for(const key of modelFields.filter(k=>!modelRouteControls.some(x=>x.provider===k||x.model===k)))$('model-'+key).value=String(c[key]||'');
    for(const [id,key] of memoryModelFields.filter(([,key])=>key==='mainSessionMemoryReasoningEffort'))$(id).value=String(c[key]||'');
    $('models-interaction-context-mode').value=c.interactionContextMode==='full'?'full':'compact';
    $('models-vision-enabled').checked=c.visionEnabled===true;
    $('models-incoming-image-enabled').checked=c.incomingImageRecognitionEnabled===true;
    $('models-vision-debug').checked=c.visionDebug===true;
    $('models-vision-mode').value=['independent_dsh','independent_local'].includes(c.visionMode)?c.visionMode:'independent_dsh';
    $('models-vision-python-path').value=String(c.visionPythonPath||'');
    // The select defaults to its first option on every page load. Restore the
    // actual durable model choice before requesting any Ollama status.
    if(['qwen3.5-4b','minicpm-v4.7-1b'].includes(c.visionLocalModel))
      $('local-vision-model').value=c.visionLocalModel;
    $('local-vision-thinking').value=['default','off','on','low','medium','high'].includes(c.visionLocalThinking)?c.visionLocalThinking:'off';
    await loadLocalVisionThinking();
    savedVisionRoute=resolveVisionRouteConfig(c);
    renderHeadlessBoard();
    syncVisionModeUI();
    // Keep optional video observation's saved-on state discoverable, while
    // never preventing manual expansion when video is off.
    if(c.visionEnabled===true)visionSection.open=true;
    await loadModelUsage();
    await loadVideoAux();
    await loadInteractionContextUsage();
    await (visionIsLocal()&&c.visionEnabled===true?restoreOllama():loadLocalVisionStatus()).catch(e=>{$('local-vision-status').textContent=String(e?.message||e).slice(0,160)});
    await loadDshVisionStatus().catch(e=>{if(!visionIsLocal())$('vision-probe-error').textContent=String(e?.message||e).slice(0,200)});
    await checkVisionEnvironmentOnEntry();
  };
  for(const field of ['model-visionModelProvider','model-visionModelId','model-visionReasoningEffort','model-videoReasoningEffort','models-default-provider','models-default-model'])$(field)?.addEventListener('change',()=>{if(!visionIsLocal())syncVisionModeUI()});
  $('models-refresh').addEventListener('click',()=>run(loadModels));
  $('models-save').addEventListener('click',()=>run(async()=>{
    const payload={clear:[]};
    payload.pluginDefaultModelProvider=$('models-default-provider').value.trim();
    payload.pluginDefaultModelId=$('models-default-model').value.trim();
    if(!payload.pluginDefaultModelProvider)payload.clear.push('pluginDefaultModelProvider');
    if(!payload.pluginDefaultModelId)payload.clear.push('pluginDefaultModelId');
    for(const key of modelFields){payload[key]=$('model-'+key).value.trim();if(!payload[key])payload.clear.push(key)}
    for(const [id,key] of memoryModelFields){payload[key]=$(id).value.trim();if(!payload[key])payload.clear.push(key)}
    for(const entry of modelRouteControls){
      const provider=payload[entry.provider],model=payload[entry.model];
      if(provider&&!model)throw Error('「'+entry.group+'」已选择 Provider，请同时选择模型');
    }
    payload.interactionContextMode=$('models-interaction-context-mode').value;
    payload.visionEnabled=$('models-vision-enabled').checked;
    payload.visionDebug=$('models-vision-debug').checked;
    payload.visionMode=$('models-vision-mode').value;
    payload.visionPythonPath=$('models-vision-python-path').value.trim();
    if(!payload.visionPythonPath)payload.clear.push('visionPythonPath');
    const r=await request('/config',payload);await loadModels();
    if(payload.visionMode==='independent_dsh'){
      const verified=dshVisionStatus?.verified===true;
      const enabled=payload.visionEnabled===true;
      const next=verified?
        (enabled?'图片验收仍有效；请到运行诊断执行全流程视频感知，确认正式执行路由。':'图片验收仍有效，但视频视觉未启用。'):
        'DSH 模型选择已保存，但尚未完成当前模型的图片识别验收。请留在本页点击「开始识图测试」并人工认可，之后再到运行诊断测试视频全链路。';
      $('vision-journey-next').textContent=next;
      message(localSaveNotice(r,verified?'AI 模型设置已保存；请到运行诊断测试真实视频链路':
        'DSH 模型已保存，但还不能视为配置完成！请先完成图片识别验收，再运行视频全链路 Debug。'));
    }else message(localSaveNotice(r,'AI 模型配置已保存，下次 Agent 运行生效'));
  }));

  // 方案卡片只预览当前表单；唯一写入点仍是各页面已有的保存接口。
  const setChoice=(group,value)=>{
    const choices=[...document.querySelectorAll('input[name="'+group+'"]')];
    for(const radio of choices)radio.checked=radio.value===value;
  };
  const selectedChoice=group=>[...document.querySelectorAll('input[name="'+group+'"]')].find(x=>x.checked)?.value||'custom';
  // 两组配置分别保存在自己所属的页面，防止视频页保存时覆盖动态页尚未保存的改动。
  const biliFields=[
    ['bili-home-recommend','homeRecommendationsEnabled'],['bili-auto-comment','autoComment'],
    ['bili-auto-like','autoVideoLike'],['bili-auto-collect','autoVideoCollect'],['bili-favorite-delete','autoFavoriteDelete'],['bili-agent-follow','agentFollowEnabled'],['bili-dm-follow','dmFollowAutonomyEnabled'],
  ];
  const biliDynamicFields=[
    ['bili-sync-comment','commentSyncDynamic'],['bili-daily-enabled','dailyDynamicEnabled'],
    ['bili-daily-draft','dailyDynamicDraftOnly'],
  ];
  const biliPlanFields=['autoComment','autoVideoLike','autoVideoCollect','agentFollowEnabled','autoFavoriteDelete'];
  const biliPlans={
    free:{autoComment:true,autoVideoLike:true,autoVideoCollect:true,agentFollowEnabled:true,autoFavoriteDelete:true},
    balanced:{autoComment:false,autoVideoLike:true,autoVideoCollect:true,agentFollowEnabled:false,autoFavoriteDelete:false},
    observe:{autoComment:false,autoVideoLike:false,autoVideoCollect:false,agentFollowEnabled:false,autoFavoriteDelete:false}
  };
  const biliPlanName={free:'自由互动',balanced:'适度互动',observe:'只看不互动',custom:'自定义'};
  const renderBiliPlan=()=>{
    // Keep the existing save flow: this is only a preview of form values.
    const enabledByToggle=$('bili-auto-comment').dataset.invertedPermission==='true'
      ?!$('bili-auto-comment').checked:$('bili-auto-comment').checked;
    const commentStatus=$('bili-proactive-comment-status');
    if(commentStatus)commentStatus.textContent=!enabledByToggle
      ?'当前编辑值：自主原创评论权限关闭；回复别人评论由独立社交链处理。修改后须保存。'
      :'当前编辑值：可自主考虑原创评论；仍须通过视频证据、Life 意愿、评论额度及平台回执。修改后须保存。';
    const choice=selectedChoice('bili-interaction-choice');
    $('bili-interaction-choice-status').textContent=choice==='custom'
      ?'保留逐项设置；修改后点击下方保存。'
      :'已选择「'+biliPlanName[choice]+'」：仅预览，点击保存才生效。自由互动含管理自建收藏夹，仍有限额。';
  };
  document.querySelectorAll('input[name="bili-interaction-choice"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked&&biliPlans[r.value]){
      for(const [id,key] of biliFields)if(Object.hasOwn(biliPlans[r.value],key))$(id).checked=$(id).dataset.invertedPermission==='true'?!biliPlans[r.value][key]:biliPlans[r.value][key];
    }
    $('bili-interaction-advanced').open=r.value==='custom';renderBiliPlan();
  }));
  for(const [id,key] of biliFields)if(biliPlanFields.includes(key))$(id).addEventListener('change',()=>{setChoice('bili-interaction-choice','custom');renderBiliPlan()});
  const loadBili=async()=>{
    const {config:c={}}=await request('/config');
    for(const [id,key] of biliFields)$(id).checked=$(id).dataset.invertedPermission==='true'?c[key]!==true:c[key]===true;
    $('bili-video-vision-enabled').checked=c.visionEnabled===true;
    $('bili-disable-incoming-vision').checked=c.incomingImageRecognitionEnabled===true;
    $('bili-favorite-visibility').value=['auto','private','public'].includes(c.autoFavoriteVisibility)?c.autoFavoriteVisibility:'auto';
    const preset=Object.keys(biliPlans).find(name=>biliPlanFields.every(key=>c[key]===biliPlans[name][key]))||'custom';
    setChoice('bili-interaction-choice',preset);$('bili-interaction-advanced').open=preset==='custom';renderBiliPlan();
    if($('bili-extra-keywords'))$('bili-extra-keywords').value=(c.keywords||[]).join('\n');
    $('quota-vision-frames').value=String([12,24,48].includes(Number(c.visionFrames))?c.visionFrames:24);
    $('bili-vision-board-tiles').value=String([4,6,12].includes(Number(c.visionBoardTiles))?c.visionBoardTiles:12);
    syncVisionFramePlan();
    $('bili-vision-plan-status').textContent='当前已保存的方案：'+($('quota-vision-frames').value==='12'?'轻量':$('quota-vision-frames').value==='48'?'详查':'均衡')+'档（最多 '+$('quota-vision-frames').value+' 个真实采样时刻）。';
    renderBiliPlan();
    $('bili-report-level').value=['full','brief','off'].includes(c.reportLevel)?c.reportLevel:'full';
    try{
      const x=await request('/follow-readiness');
      $('bili-agent-follow-readiness').textContent=x.enabled
        ?`自主关注已授权 · 今天判重表记录 ${x.selectedToday||0} 条明确入选视频（不含旧推荐标签；仅写日报的不计）；${x.opportunity?'可以在视频探索时考虑是否关注，但绝不保证执行':'当前没有满足前置条件的关注机会'}。`
        :'自主关注开关目前关闭，因此鱼鱼不会执行自主关注。';
    }catch{$('bili-agent-follow-readiness').textContent='暂时无法读取自主关注条件，请查看视频探索日志。'}
  };
  $('bili-refresh').addEventListener('click',()=>run(loadBili));
  $('bili-vision-plan-save').addEventListener('click',()=>run(async()=>{
    const frames=Number($('quota-vision-frames').value);
    if(![12,24,48].includes(frames))throw Error('请选择轻量、均衡或详查档');
    const tiles=Number($('bili-vision-board-tiles').value);
    if(![4,6,12].includes(tiles))throw Error('请选择4格、6格或12格低清分镜');
    const saved=await request('/config',{visionFrames:frames,visionBoardTiles:tiles});
    await loadBili();
    $('bili-vision-plan-status').textContent=localSaveNotice(saved,'视频感知方案已保存：最多 '+frames+' 个采样时刻，低清预览每张 '+tiles+' 格（仅上限，不强制观看）');
    message($('bili-vision-plan-status').textContent);
  }));
  $('bili-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of biliFields)payload[key]=$(id).dataset.invertedPermission==='true'?!$(id).checked:$(id).checked;
    payload.autoFavoriteVisibility=$('bili-favorite-visibility').value;
    // Deprecated keyword editor is absent from 2.8.1 UI. Do not rewrite
    // old settings while saving the independent homepage exploration switch.
    if($('bili-extra-keywords')){
      payload.keywords=$('bili-extra-keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,30);
      if(!payload.keywords.length)payload.clear=['keywords'];
    }
    payload.reportLevel=$('bili-report-level').value;
    const previous=(await request('/config')).config||{};
    const newlyAllowed=[['autoComment','原创评论'],['autoVideoLike','点赞'],['autoVideoCollect','收藏'],['agentFollowEnabled','关注／取关'],['dmFollowAutonomyEnabled','长期私信联系人自主关注'],['autoFavoriteDelete','删除自建收藏夹']]
      .filter(([key])=>payload[key]===true&&previous[key]!==true).map(([,name])=>name);
    if(newlyAllowed.length&&!await confirmAction({title:'确认新增自主互动权限',description:'将允许鱼鱼自主执行：'+newlyAllowed.join('、')+'。仍遵守原有账号、限额和发送回执门禁。确定保存？',confirmLabel:'确认授权'}))return;
    const r=await request('/config',payload);await loadBili();
    message(localSaveNotice(r,'视频探索设置已保存'))
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
    message(localSaveNotice(r,'动态创作设置已保存'))
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
      const card=node('article','','record');add(card,node('strong',d.day+' · '+({draft:'待发布草稿',published:'B站接口已接受（未核验公开）',confirmed:'B站独立回查已确认',uncertain:'结果不确定，请勿重复发送',publishing:'正在发布'}[d.status]||d.status)));
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

  // The plugin is authoritative after an independent durable/effective readback.
  // DSH native settings are an optional mirror on desktop profiles without a
  // writable settings form. Never misrepresent a missing mirror as a failed save.
  const localSaveNotice=(result,label)=>{
    if(result?.localVerified!==true)throw Error('插件本地设置未得到回读确认，请刷新并核对，不能报告保存成功');
    return label+(result?.host?.skipped===true?'；已核验插件配置生效（当前 DSH 无可写原生设置表单，无需同步）':result?.host?.ok===false?'；已核验插件本地生效（可选原生镜像同步失败）':'；已核验生效');
  };
  // v2.4.41: 所有数字输入都只在「次数与额度」提交。
  // 将旧评论/私信页的 DOM 控件物理搬迁，保留字段 ID 与原有验证规则，避免双入口覆盖设置。
  const quotaFields=[
    ['quota-comment-daily','commentDailyLimit',0,1000,500],['quota-comment-round','commentPerRound',0,20,5],
    ['quota-bili-read-minute','biliReadMinuteLimit',5,180,30],['quota-bili-read-hour','biliReadHourLimit',30,6000,450],
    ['quota-dynamic-daily','dynamicDailyLimit',0,30,3],
    ['quota-like-daily','autoVideoLikeDailyLimit',0,100,10],
    ['comment-reply-hot-count','commentReplyHotCount',1,30,12],
    ['comment-per-poll','commentReplyPerPoll',1,1000,12],['comment-per-day','commentReplyPerDay',1,1000,1000],
    ['comment-own-top-per-user','commentOwnTopPerUser',1,1000,5],['comment-own-nested-per-user','commentOwnNestedPerUser',1,1000,3],
    ['dm-reply-per-day','dmReplyPerDay',0,1000,200],
    ['dm-context-messages','dmContextMessages',0,80,40],['dm-stranger-max','dmStrangerMaxReplies',1,20,1],
    ['quota-meme-day','commentMemesPerDay',0,10000,2],['quota-meme-round','commentMemesPerRound',0,5,1],
    ['quota-meme-max','memeMemoryMaxEntries',10,2000,300],['quota-vision-frames','visionFrames',12,48,24],
    ['quota-min-views','minVideoViews',0,100000000,1000],['quota-min-likes','minVideoLikes',0,100000000,10],
    ['quota-min-replies','minVideoReplies',0,100000000,3]
  ];
  for (const [target,ids] of [
    ['quota-fields-comment',['comment-per-poll','comment-per-day','comment-own-top-per-user','comment-own-nested-per-user','comment-reply-hot-count']],
    ['quota-fields-dm',['dm-reply-per-day','dm-context-messages','dm-stranger-max']]
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
    const [config,quota,stat,dm,traffic]=await Promise.all([
      request('/config'),request('/comment-quota').catch(()=>({ok:false})),
      request('/status').catch(()=>({ok:false})),request('/dm-quota-usage').catch(()=>({ok:false})),
      request('/video-vision-traffic').catch(()=>({ok:false}))
    ]);
    const c=config.config||{};
    for(const [id,key,,,fallback] of quotaFields)$(id).value=String(c[key]??fallback);
    syncVisionFramePlan();
    // A saved preset is a maintained state, not a one-time button that forgot
    // which plan was selected. Never show a named plan with mismatched fields.
    const savedQuotaPlan=['gentle','natural','active'].includes(c.quotaPreset)&&
      Object.entries(quotaPresetValues[c.quotaPreset]).every(([id,v])=>Number($(id)?.value)===v)
      ?c.quotaPreset:'custom';
    setQuotaPresetChoice(savedQuotaPlan);
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
    const dmCap=Number(c.dmReplyPerDay||0);
    $('quota-usage-summary').textContent=`本机日期 ${stat.today||quota.day||localDay()} · 设置值在下方修改；修改前显示当前真实使用量。`;
    const target=$('quota-usage-tiles');target.replaceChildren();
    quotaTile(target,'公开评论',meter(commentUsed,c.commentDailyLimit??500),'今日 · 发布接口尝试');
    quotaTile(target,'同步动态',meter(dynamic,c.dynamicDailyLimit??3),'今日 · 同步尝试');
    quotaTile(target,'后台评论回复',meter(reply,c.commentReplyPerDay??1000),'滚动 24 小时 · 成功回执');
    quotaTile(target,'自动私信',meter(dmUsed,dmCap===0?'不限':dmCap),'今日 · 普通联系人成功发送（主人独立，不受此额度限制）');
    quotaTile(target,'附图',meter(memeUsed,c.commentMemesPerDay??2),'今日 · 占用的附图尝试');
    const visionMode=!c.visionEnabled?'预览识图未开启':c.visionMode==='independent_dsh'?'DSH 识图模型':c.visionMode==='independent_local'?'本地 Ollama 视觉模型':'DSH 识图模型';
    quotaTile(target,'独立视觉调用（仅统计）',visionUsed===null?'暂不可读':String(visionUsed),`今日 · ${visionMode} · 不设每日次数上限`);
    // These are measured HTTP response-body bytes, not inferred video sizes,
    // operating-system network usage, or earlier historical traffic.
    const fmtTraffic=n=>Number.isSafeInteger(n)&&n>=0?(n/(1024*1024)).toFixed(2)+' MiB':'暂不可读';
    const trafficTracked=traffic?.ok===true&&traffic.tracked===true;
    quotaTile(target,'视频视觉流量 · 今日',traffic?.ok!==true?'暂不可读':trafficTracked?fmtTraffic(traffic.todayBytes):'尚无统计',
      '实际已接收 HTTP 字节（含失败/重试）；不是每日额度，不会按此计数自动停用');
    quotaTile(target,'视频视觉流量 · 累计',traffic?.ok!==true?'暂不可读':trafficTracked?fmtTraffic(traffic.totalBytes):'尚无统计',
      trafficTracked?'自 '+traffic.since+' 启用统计 · 不包含历史、Whisper 音频和其他 B站请求':'只累计启用流量账本后的响应字节，不是实际系统总流量');
    if(trafficTracked){
      const kinds=traffic.categories||{};
      quotaTile(target,'今日视觉流量明细',
        '原视频 '+fmtTraffic(kinds.original?.todayBytes),
        '低清拼图 '+fmtTraffic(kinds.preview?.todayBytes)+' · 相关元数据 '+fmtTraffic(kinds.metadata?.todayBytes));
    }

    quotaReadout('quota-comment-daily',daily(commentUsed,c.commentDailyLimit??500));
    quotaReadout('quota-dynamic-daily',daily(dynamic,c.dynamicDailyLimit??3));
    quotaReadout('comment-per-day',reply==null?'近24小时：暂不可读':`近24小时已成功 ${reply} / ${c.commentReplyPerDay??1000}`);
    quotaReadout('dm-reply-per-day',dmRolling==null?'滚动24小时：暂不可读':`滚动24小时普通自动私信 ${dmRolling} / ${dmCap===0?'不限制':dmCap}；主人不受此上限限制`);
    quotaReadout('quota-meme-day',daily(memeUsed,c.commentMemesPerDay??2));
    const tierDetails=({12:{candidates:4,perBatch:2,windows:2,frames:12,seconds:30,bytes:24},24:{candidates:6,perBatch:3,windows:4,frames:24,seconds:90,bytes:50},48:{candidates:8,perBatch:4,windows:6,frames:48,seconds:180,bytes:100}})[Number(c.visionFrames)||24]||{candidates:6,perBatch:3,windows:4,frames:24,seconds:90,bytes:50};
    quotaReadout('quota-vision-frames',`当前模式：${visionMode}。全片低清概览最多 ${c.visionFrames??24} 个时刻（每张低清分镜 ${[4,6,12].includes(Number(c.visionBoardTiles))?c.visionBoardTiles:12} 格）；Life 自主规划后的局部真实视频复查，每条 Episode 共享上限：可信候选 ${tierDetails.candidates}、单批可选 ${tierDetails.perBatch}、最多 ${tierDetails.windows} 个窗口、累计 ${tierDetails.frames} 帧／${tierDetails.seconds} 秒／${tierDetails.bytes} MiB。局部解码输出最高640×360，若源视频低于此值，不会凭空提升清晰度。今日视觉流量是已接收字节统计，不等于上述预算。`);
  };
  const quotaPresetValues={gentle:{'quota-comment-daily':100,'dm-reply-per-day':50,'comment-per-day':100,'comment-per-poll':8,'quota-dynamic-daily':2,'quota-like-daily':30},natural:{'quota-comment-daily':500,'dm-reply-per-day':200,'comment-per-day':500,'comment-per-poll':20,'quota-dynamic-daily':6,'quota-like-daily':80},active:{'quota-comment-daily':800,'dm-reply-per-day':300,'comment-per-day':800,'comment-per-poll':30,'quota-dynamic-daily':12,'quota-like-daily':100}};
  const quotaPresetButtons=[...document.querySelectorAll('[data-quota-preset]')];
  const quotaPresetName={gentle:'轻松生活',natural:'自然生活',active:'活跃生活',custom:'自定义'};
  let selectedQuotaPlan='custom';
  const setQuotaPresetChoice=choice=>{
    selectedQuotaPlan=Object.hasOwn(quotaPresetValues,choice)?choice:'custom';
    for(const button of quotaPresetButtons)button.setAttribute('aria-pressed',String(button.dataset.quotaPreset===selectedQuotaPlan));
    $('quota-preset-preview').textContent=selectedQuotaPlan==='custom'
      ?'当前为自定义方案：手动填写的额度将单独保存，不再显示为某张预设卡片。'
      :'当前选中「'+quotaPresetName[selectedQuotaPlan]+'」；所选数值将在点击保存后生效，不会开启发送授权。';
  };
  quotaPresetButtons.forEach(button=>button.addEventListener('click',()=>{
    const choice=button.dataset.quotaPreset;
    const selected=quotaPresetValues[choice];
    if(selected)for(const [id,value] of Object.entries(selected))if($(id))$(id).value=String(value);
    setQuotaPresetChoice(choice);
  }));
  for(const [id] of quotaFields)$(id)?.addEventListener('input',()=>setQuotaPresetChoice('custom'));

  function syncVisionFramePlan(){
    const selected=Number($('quota-vision-frames')?.value)||24;
    for(const card of document.querySelectorAll('[data-vision-frame-plan]')){
      card.setAttribute('aria-pressed',String(Number(card.dataset.visionFramePlan)===selected));
    }
  }
  for(const card of document.querySelectorAll('[data-vision-frame-plan]'))card.addEventListener('click',()=>{
    $('quota-vision-frames').value=card.dataset.visionFramePlan;
    syncVisionFramePlan();
    $('bili-vision-plan-status').textContent='已选择 '+card.dataset.visionFramePlan+' 时刻方案，尚未保存；点击「保存视频感知方案」生效。';
    // The budget is independent of social quota presets and never authorizes sending.
  });
  $('quota-refresh').addEventListener('click',()=>run(loadQuotas));
  $('quota-save').addEventListener('click',()=>run(async()=>{
    const payload={};
    for(const [id,key,min,max] of quotaFields)payload[key]=boundedInt(id,min,max,key);
    payload.quotaPreset=selectedQuotaPlan;
    const saved=await request('/config',payload);
    await loadQuotas();
    message(localSaveNotice(saved,'全部次数与额度已保存'))
  }));

  // Unified notification sentinels: fixed 5-minute counters, demand-driven details,
  // 30-minute reconciliation and a separate targeted active-DM lane.
  const pollClock=timestamp=>timestamp?new Date(timestamp).toLocaleString():'暂无';
  const loadPolling=async()=>{
    const data=await request('/status'),c=data.config||{},scheduler=data.interactionSchedulerStatus||{};
    const budget=scheduler.readBudget||{},sentinels=scheduler.sentinels||{},privateSentinel=sentinels.private||{},socialSentinel=sentinels.interaction||{};
    const runs=scheduler.checks||{},fast=scheduler.activeDm||{};
    const reasonName={'platform-cooldown':'B站限流保护中','minute-budget':'分钟预算已满','hour-budget':'小时预算已满',
      'account-auth':'登录状态需要重新核验','network-retry':'网络故障恢复等待','platform-recovery':'平台限制后低频恢复',
      'dm-unread-interval':'私信未读检查间隔','dm-list-interval':'私信列表检查间隔',
      'social-unread-interval':'互动通知检查间隔','social-rate-protection':'互动接口保护间隔',
      'scheduler-stopped':'后台调度已停止','not-enabled':'未启用','account-unavailable':'当前账号未核验',
      'read-budget-unavailable':'读取预算状态未知','read-budget-unknown':'读取保护原因待核对',
      'network-unknown':'网络保护原因待核对'};
    const readAvailability=scheduler.readAvailability?.lanes||{};
    const explainLane=(key,label)=>{
      const lane=readAvailability[key];if(!lane)return label+'：状态尚未就绪';
      if(lane.state==='ready')return label+'：本地已知门禁未阻断（非平台成功保证）';
      const reasons=[...new Set((lane.blockers||[]).map(b=>reasonName[b.code]||'限制原因待核对'))];
      const why=lane.state==='deferred'&&reasons.length?reasons.join('、'):reasonName[lane.reason]||'状态未知';
      return label+'：'+why+(lane.retryAt?' · 已知最早解除 '+pollClock(lane.retryAt):'');
    };
    const lastRestriction=(Array.isArray(budget.rateLimitEvents)?budget.rateLimitEvents:[]).at(-1);
    const incidentText=lastRestriction
      ?`\n最近平台限流／验证：${pollClock(lastRestriction.at)} · 信号 ${String(lastRestriction.signal||'未知').slice(0,35)} · 入口 ${String(lastRestriction.kind||'未知').slice(0,35)}\n限流前 15 分钟已接入门禁 ${Number(lastRestriction.last15Minutes?.total)||0} 次 / 60 分钟 ${Number(lastRestriction.last60Minutes?.total)||0} 次\n15 分钟端点分布：${Object.entries(lastRestriction.last15Minutes?.byKind||{}).map(([kind,n])=>kind+' '+n).join('、')||'无记录'}\n以上是限流时保存的快照，并非 B站所有真实 HTTP 请求。`
      :'\n暂无新版本保存的限流现场快照；升级前的历史无法补录。';
    const nextDm=privateSentinel.nextAt||runs.dm?.nextAt||budget.dmUnreadNextAt||0;
    const nextSocial=socialSentinel.nextAt||runs.replies?.nextAt||budget.socialUnreadNextAt||0;
    $('polling-budget-status').textContent=budget.minuteLimit
      ?`近 1 分钟 ${budget.minuteUsed}/${budget.minuteLimit} · 近 1 小时 ${budget.hourUsed}/${budget.hourLimit}\n${budget.blocked?'⏸ '+(reasonName[scheduler.readAvailability?.global?.reason]||reasonName[budget.reason]||'读取冷却')+'，最早恢复 '+pollClock(budget.retryAt):'✓ 共享额度层未阻断（各通道仍可能退避）'}\n${[explainLane('dmUnread','私信未读'),explainLane('dmList','私信列表'),explainLane('socialUnread','互动未读'),explainLane('replies','评论回复'),explainLane('mentions','@ 与点赞')].join('\n')}\n私信未读哨兵：每 5 分钟 · 下次 ${pollClock(nextDm)}\n互动通知哨兵：每 5 分钟 · 下次 ${pollClock(nextSocial)}${Number(budget.socialSafeUntil)>Date.now()?'\nB站限流后互动通知低频保护至 '+pollClock(budget.socialSafeUntil):''}\n仅显示已接入本地门禁的只读诊断；已知最早解除不代表请求一定成功，也不涉及发送权限。${incidentText}`
      :'尚无请求预算数据';
    const budgetCategories={
      'dm-unread':'私信未读计数哨兵','social-unread':'互动通知计数哨兵','dm-list':'私信会话列表详情',
      'dm-messages':'私信消息详情','mcp:bili_unread_messages':'主 Session 未读计数',
      'mcp:bili_received_replies':'评论回复详情','mcp:bili_received_at_and_likes':'@ 与点赞详情',
      'public-nickname':'公开昵称','uid-lookup':'昵称查询 UID','cover-metadata':'视频封面资料','cover-image':'视频封面图片'
    };
    const budgetRows=$('polling-budget-by-kind');budgetRows.replaceChildren();
    for(const row of (budget.byKind||[]).slice(0,20)){
      const kind=String(row.kind||''),label=budgetCategories[kind]||(kind.startsWith('mcp:')?'主进程只读 · '+kind.slice(4):'其他只读请求');
      budgetRows.appendChild(node('span',label+' · 近 1 分钟 '+(row.minute||0)+' 次 / 近 1 小时 '+(row.hour||0)+' 次'));
    }
    if(!budgetRows.children.length)budgetRows.appendChild(node('span','目前没有记录到已接入的读取请求。'));
    $('dm-active-enabled').checked=c.dmActivePollEnabled!==false;
    $('dm-active-seconds').value=String(c.dmActivePollSeconds??60);
    $('dm-detail-max-sessions').value=String(c.dmDetailMaxSessions??3);
    $('dm-detail-spacing-ms').value=String(c.dmDetailSpacingMs??1500);
    $('dm-active-window').value=String(c.dmActiveWindowSeconds??180);
    showFastLevels();

    const target=$('polling-status-list');target.replaceChildren();
    const addCard=(title,lines)=>{
      const card=node('article','','settings-section');add(card,node('h4',title));
      for(const line of lines)add(card,node('p',line,'muted'));
      target.appendChild(card);
    };
    const privateUnread=privateSentinel.unread===null||privateSentinel.unread===undefined?'未知':String(Number(privateSentinel.unread)||0);
    addCard('私信未读计数哨兵',[
      `状态：${!scheduler.running?'宿主调度已停止':!privateSentinel.enabled?'未启用':privateSentinel.pending?'发现变化，等待详情核对':'运行中'}`,
      `最近计数检查：${pollClock(privateSentinel.lastCheckedAt)} · 下次预计：${pollClock(privateSentinel.nextAt||nextDm)}`,
      `当前会话未读数（关注/未关注/垃圾箱）：${privateUnread} · 最近详情核对：${pollClock(privateSentinel.lastDetailAt)}`,
      privateSentinel.bootstrapped?'已完成安全基线':'尚未完成首次安全基线'
    ]);
    const snap=socialSentinel.snapshot||{};
    const socialCounts=snap.mode==='split'
      ?`评论回复 ${snap.replyCount??'未知'} · @ ${snap.atCount??'未知'} · 点赞 ${snap.likeCount??'未知'}`
      :`回复与 @ 合计 ${snap.replyAtTotal??'未知'} · 点赞 ${snap.likeCount??'未知'}（当前接口返回聚合计数）`;
    addCard('互动通知计数哨兵',[
      `状态：${!scheduler.running?'宿主调度已停止':!socialSentinel.enabled?'未启用':(socialSentinel.pendingCategories||[]).length?'发现变化，等待详情核对':'运行中'}`,
      `最近计数检查：${pollClock(socialSentinel.lastCheckedAt)} · 下次预计：${pollClock(socialSentinel.nextAt||nextSocial)}`,
      `当前计数：${socialCounts}`,
      `评论回复详情：${pollClock(socialSentinel.lastDetailAt?.replies)} · @/点赞详情：${pollClock(socialSentinel.lastDetailAt?.mentions)}`,
      `待核对类别：${(socialSentinel.pendingCategories||[]).join('、')||'无'} · 一致性核对间隔：${Number(sentinels.reconciliationMinutes)||30} 分钟`
    ]);
    addCard('活跃私信快速通道',[
      fast.enabled===false?'当前关闭':`当前活跃会话：${Number(fast.activeCount)||0} 个 · 基础间隔 ${Number(fast.baseIntervalSeconds)||Number(c.dmActivePollSeconds)||60} 秒 · 当前自适应间隔 ${Number(fast.nextIntervalSeconds)||Number(fast.baseIntervalSeconds)||60} 秒`,
      `最近定向检查：${pollClock(fast.lastFastAt)} · 已检查 ${Number(fast.checks)||0} 次`,
      '仅检查已确认活跃联系人，不扫描全部会话；连续无新消息时逐步放缓。'
    ]);
    addCard('详情读取与保护',[
      `私信详情待核对：${privateSentinel.pending?'是':'否'} · 会话列表下次允许：${pollClock(budget.dmListNextAt)}`,
      `互动详情待核对：${(socialSentinel.pendingCategories||[]).length?'是':'否'} · B站共享冷却：${budget.blocked?pollClock(budget.retryAt):'当前无全局冷却'}`,
      '无新增通知时不拉取完整详情；30 分钟一致性核对、Life 技术续办和发送前安全复核仍保留。'
    ]);
  };
  const showFastLevels=()=>{
    const base=Math.max(10,Math.min(60,Number($('dm-active-seconds').value)||60));
    $('dm-fast-levels').textContent=`自适应档位：${base} 秒 → ${base*2} 秒 → ${base*3} 秒（最多 300%）`;
  };
  $('dm-active-seconds').addEventListener('input',showFastLevels);
  $('polling-refresh').addEventListener('click',()=>run(loadPolling));
  $('polling-reload').addEventListener('click',()=>run(loadPolling));
  $('polling-save').addEventListener('click',()=>run(async()=>{
    const payload={
      dmActivePollEnabled:$('dm-active-enabled').checked,
      dmActivePollSeconds:boundedInt('dm-active-seconds',10,60,'活跃私信检查秒数'),
      dmDetailMaxSessions:boundedInt('dm-detail-max-sessions',1,12,'每轮私信详情联系人'),
      dmDetailSpacingMs:boundedInt('dm-detail-spacing-ms',500,5000,'详情读取间隔毫秒'),
      dmActiveWindowSeconds:boundedInt('dm-active-window',60,600,'活跃会话时长'),
    };
    const saved=await request('/config',payload);await loadPolling();
    message(localSaveNotice(saved,'活跃私信定向检查设置已保存；双哨兵固定每 5 分钟运行'))
  }));

  // 显式加载内置默认提示词，旧用户已有非空自定义优先。不存在自动覆盖和自动保存。
  const promptEntries=[
    ['persona','personaPrompt','/persona-prompt-default','18000','大肥鱼人设'],
    ['meme-prompt','commentMemePrompt','/comment-meme-prompt-default','4000','AI 选图提示词'],
    ['vision-prompt','visionPrompt','/vision-prompt-default','4000','视觉观察重点'],
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
      add(nameWrap,add(node('div'),nameL,nameInput));const editorBody=node('div','','friend-editor-body');editorBody.appendChild(nameWrap);
      const checks=node('div','','friend-role-row');
      const dmWrap=node('label','','checkline');const dmCheck=document.createElement('input');dmCheck.type='checkbox';dmCheck.checked=row.dm;
      dmCheck.addEventListener('change',()=>{row.dm=dmCheck.checked});
      add(dmWrap,dmCheck,node('span','允许与这位好友私信往来（互动与手动发送权限）'));checks.appendChild(dmWrap);
      const channelWrap=node('div');const channelLabel=node('label','主动视频推荐渠道');const channelSelect=node('select');
      for(const [value,label] of [['dm','私信优先（推荐）'],['both','私信 + 公开 @（两项都可用）'],['mention','只在公开视频中 @（可选）'],['off','不主动推荐（仍可聊天和学习偏好）']])channelSelect.add(new Option(label,value));
      channelSelect.value=row.recommend;channelSelect.addEventListener('change',()=>{row.recommend=channelSelect.value;row.mention=['mention','both'].includes(row.recommend)});
      add(channelWrap,channelLabel,channelSelect,node('small','「私信优先」只表示允许使用这个渠道；还须在下方「主动视频兴趣推荐」授权自主分享；任何逐条外发都由鱼鱼决定，且须允许与这位好友私信。','muted'));checks.appendChild(channelWrap);
      const atWrap=node('label','','checkline');const atCheck=document.createElement('input');atCheck.type='checkbox';atCheck.checked=row.atInvite;
      atCheck.addEventListener('change',()=>{row.atInvite=atCheck.checked});
      add(atWrap,atCheck,node('span','授权读取这位好友通过 @ 提出的偏好反馈（不限制接收 @ 的回复）'));checks.appendChild(atWrap);
      editorBody.appendChild(checks);
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
      editorBody.appendChild(fields);
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
      add(peers,btn('添加一项好友关系',async()=>{makePeer({uid:'',relationship:''})}));editorBody.appendChild(peers);editor.appendChild(editorBody);
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
    await loadSocialFriends();message(localSaveNotice(saved,'好友互动名册、推荐渠道、@ 意愿监听及画像已保存'));
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
      message(localSaveNotice(saved,label+'已保存'));
    }));
    $(id+'-reset').addEventListener('click',()=>run(async()=>{
      if(!await confirmAction({title:'请确认操作',description:'恢复「'+label+'」为官方默认？当前自定义内容将清除。'}))return;
      const saved=await request('/config',{[key]:'',clear:[key]});
      $(id+'-text').value=promptDefaults[key]||'';
      $(id+'-status').textContent='内置默认';
      message(localSaveNotice(saved,label+'已恢复默认'));
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
    message(localSaveNotice(saved,'诊断开关已保存，后续任务按新开关记录；历史日志保留'));
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
    await refreshVideoDebug();
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
        const nextReview=Math.max(Number(e.retryAt)||0,Number(e.preflightRetryAt)||0);
        if(nextReview>Date.now())meta.appendChild(node('span',' · 等待重新考虑：'+new Date(nextReview).toLocaleString()));
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
          ['model-skip','model-close','legacy-skip'].includes(e.silenceOrigin)
            ?'本轮模型明确选择不回复；已按自主沉默登记。' :
          e.silenceOrigin==='suppressed'
            ?'本轮未发送：输出被安全／契约检查抑制，不能作为模型自主沉默的证据。' :
          e.silenceOrigin==='empty-reply'
            ?'本轮未发送：模型没有给出有效正文，不足以证明它自主选择了沉默。' :
          '本轮未发送；历史版本未记录具体的模型沉默或输出校验来源，不能据此断定模型自主跳过。'
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
    const common={received:'通知已识别，等待处理',first_poll_baseline:'首次启动：旧通知不补发',source_already_processed:'相同评论已被另一通知处理',ai_generation_error:'AI 生成失败',life_authorization_review_required:'Life 授权账本需要复核（不是模型拒绝）',life_authorization_blocked:'Life 授权暂不可用，原通知保留并重试',life_expression_validation_failed:'回复正文未通过 Life 表达校验，原通知保留并重试',manual_ai_generation_error:'手动要求回复：AI 生成失败',manual_ai_skipped:'手动要求回复：AI 仍未生成可发送内容',proactive_at_blocked:'草稿带有未经授权的主动 @，未尝试发布',manual_context_unavailable:'手动要求回复：视频/评论上下文不足',manual_send_uncertain:'手动发送结果不确定，已禁止重复发送',manual_send_failed:'手动发送失败',ai_skipped:'AI 选择不回复（不等于社交意愿低；也可能是话题已结束或没有适合的回应）',sent:'回复接口已接受（公开状态未核实）',reply_limit:'每轮／近24小时限额',per_user_limit:'同一用户回复额度',quota_exhausted:'每日公开评论额度已满',quota_store_blocked:'额度账本暂不可用',stranger_budget:'旧版已跳过：为防意外补发请人工核对',stranger_budget_deferred:'旧版陌生人考虑额度延期（升级后重新核验）',legacy_stranger_hold_released:'已取消旧版隐藏考虑额度，重新判断中',send_uncertain:'发送结果不确定，不自动重发',send_failed:'发送失败，不自动重发'};
    drawHistory('comment-at-fetch','comment-at-events',c.atLastFetch,c.atDiagnostics,{...common,
      dynamic_reference_unverified:'动态 ID 无可信页面链接，未进入回复',not_own_dynamic:'旧版校验未通过：动态归属未被认可',unrelated_dynamic:'未确认回复的是鱼鱼，已安全跳过',waiting_for_dynamic_context:'动态评论正在核验，读取失败会自动重试',dynamic_context_unavailable:'旧版连续核验失败记录（仍在有效期内可恢复）',dynamic_verification_resumed:'旧版技术停止已解除，重新核验中',dynamic_source_mismatch:'已核验评论来源与通知不匹配，禁止发送',parser_upgrade_baseline:'解析器更新：旧通知不补发',video_reference_missing:'缺少视频链接/AID',comment_id_missing:'缺少评论ID',comment_text_missing:'缺少原文',waiting_for_mention_source:'正在核实原评论正文和作者',mention_source_unverified:'原评论或作者无法核实，未进入AI',mention_only_verified:'确认对方只 @ 鱼鱼',mention_text_recovered:'已核实原评论正文',not_video_comment:'不是已支持的评论@',dynamic_not_owned:'不是鱼鱼账本中的已发布动态',dynamic_oid_unresolved:'没有找到匹配的本人动态评论区',dynamic_context_unverified:'动态详情或作者身份未核验',dynamic_target_unverified:'动态目标评论未核验',dynamic_reference_missing:'动态评论区信息缺失',mention_not_for_account:'没有@本账号',account_uid_missing:'无法获取登录 UID',sender_missing_or_self:'来自本账号或UID无效',not_in_whitelist:'旧版记录：曾因回复者白名单跳过（本版已移除）',proactive_at_blocked:'草稿含未经授权的主动 @，已在发送前拦截',out_of_window:'通知已超出24小时处理窗口（按原始发送时间）',waiting_for_video_context:'视频资料读取失败，稍后重试',feedback_only:'被@回复已关闭，仅用于好友反馈观察',disabled:'被@邀请回复监听关闭',video_context_unavailable:'视频上下文多次读取失败'},
      '暂无被 @ 处理记录。请确认后台轮询已开启，并在首次检查完成后发送新的 @。');
    drawHistory('comment-reply-fetch','comment-reply-events',c.replyLastFetch,c.replyDiagnostics,{...common,
      dynamic_reference_unverified:'动态 ID 无可信页面链接，未进入回复',not_own_dynamic:'旧版校验未通过：动态归属未被认可',unrelated_dynamic:'未确认回复的是鱼鱼，已安全跳过',waiting_for_dynamic_context:'动态评论正在核验，读取失败会自动重试',dynamic_context_unavailable:'旧版连续核验失败记录（仍在有效期内可恢复）',dynamic_verification_resumed:'旧版技术停止已解除，重新核验中',dynamic_source_mismatch:'已核验评论来源与通知不匹配，禁止发送',parser_upgrade_baseline:'解析器升级：旧通知不补发',not_video_comment:'不属于已支持的评论类型',dynamic_not_owned:'不是鱼鱼账本中的已发布动态',dynamic_oid_unresolved:'没有找到匹配的本人动态评论区',dynamic_context_unverified:'动态详情或作者身份未核验',dynamic_target_unverified:'动态目标评论未核验',comment_reference_missing:'缺少视频AID或评论ID',sender_missing_or_self:'本人回复或UID缺失',comment_text_missing:'通知未包含评论原文',video_context_partial:'视频上下文不完整，仍按已有真实内容判断'},
      '暂无收到评论回复的诊断。确认「收到评论回复」开关已开启并发生新回复。');
  };
  // Complete read-only video handoff inspection (no synthetic text generated in UI).
  let videoDebugState=null,videoDebugMode='test',videoDebugTimer=null;
  const debugViewPayload=()=>videoDebugMode==='life'?videoDebugState?.lastLife?.lifeInput:
    videoDebugState?.job?.status==='done'?videoDebugState.job.lifeInput:null;
  const debugCard=(title,value)=>{
    const e=node('div','','video-debug-tile');
    add(e,node('strong',title),node('div',value));return e;
  };
  const renderVideoDebug=()=>{
    const job=videoDebugState?.job||videoDebugState?.lastSummary,actual=videoDebugState?.lastLife;
    const progress=$('video-debug-progress'),cards=$('video-debug-summary');
    if(!videoDebugState){progress.textContent='尚未加载视频感知数据';return;}
    const busy=job?.status==='running';
    $('video-debug-run').disabled=busy||mobileViewOnly;
    $('video-debug-run').textContent=busy?'视频感知执行中…':'开始只读视频感知验收';
    const bar=$('video-debug-progressbar');bar.style.display=busy?'block':'none';
    if(busy){
      // The downloader currently reports stages, not exact bytes. Never show a
      // fabricated percentage while FFmpeg / Ollama are working.
      bar.removeAttribute('value');
      bar.setAttribute('aria-valuetext','正在执行第 '+(Number(job.step)||0)+'／6 阶段，下载字节进度暂不可用');
    }
    progress.textContent=job?.status==='running'?'本次试运行 · 阶段 '+(Number(job.step)||0)+'/6：'+(job.stage||'运行中')+' · 已等待 '+Math.max(0,Math.floor((Date.now()-Number(job.at||Date.now()))/1000))+' 秒。模型首次加载可能很慢，超过8分钟将报告超时；此处不代表已取得视觉理解回执。':
      job?.status==='error'?'本次试运行失败：'+String(job.error||job.stage||'未知错误'):
      job?.status==='interrupted'?'上次视频验收被中断：'+String(job.error||job.stage||'插件重启，原始视觉回执不可恢复'):
      job?.status==='done'?(videoDebugState?.lastSummary&&!videoDebugState?.job?'上一轮只读试运行已结束；模型原文和图片不会跨重启保存，不能从状态推定是否识图成功。':job.visionOutcome==='model_answer_returned'?'本次只读试运行已获得真实模型回答；仍需检查具体画面证据。':'本次资料整理已结束，但没有可信视觉模型回答；下方内容不等于已看懂画面。'):
      '暂无试运行；也可以检查真实 Life 最近的观看回执。';
    const payload=debugViewPayload(),handoff=payload?.perceptionHandoff||{},speech=handoff.speech||{};
    cards.replaceChildren();
    cards.appendChild(debugCard('当前查看',videoDebugMode==='life'?'真实 Life 的最后一次观察':'主人启动的只读验收（仅两阶段模式包含 Life 真实二次选择）'));
    if(videoDebugMode!=='life'){
      const requested=job?.sourceMode==='life-two-stage'?'life-two-stage':payload?.debugPerceptionSourceRequested||job?.sourceMode;
      cards.appendChild(debugCard('主人调试请求',requested==='life-two-stage'?'完整两阶段 · Life 自主多候选规划':requested==='adaptive'?'单阶段 · 原视频 FFmpeg 专项':'单阶段 · 官方 videoshot 全局预览'));
    }
    cards.appendChild(debugCard('图像来源',handoff.video?.source||'尚无成功结果'));
    const twoStage=payload?.debugTwoStage||job?.twoStage;
    if(twoStage){
      const meanings={focused:'Life 已自主选择局部，原视频解码和第二次视觉识别均已核验',
        'life-declined':'Life 看过全局后明确选择跳过深入；没有第二次取帧',
        'life-deferred':'Life 选择延期，不代表不感兴趣；没有第二次取帧',
        'no-verified-preview-candidates':'全局预览缺少可信时间候选，没有询问 Life',
        'overview-not-verified':'全局识图尚未核验，禁止开启局部',
        'network-budget-exhausted':'全局读取后无足够网络预算，禁止局部',
        'not-offered':'第二阶段条件不成立，没有请求局部',
        'account-or-job-changed':'账号或调试任务发生变化，本次安全中止',
        'focus-unavailable':'Life 有意补看，但原视频局部证据未通过核验',
        'choice-unavailable':'Life 意愿模型或决策门禁本轮未产生有效选择，不能当成主动拒绝',
        'choice-expired':'Life 选择凭据已过期，没有读取局部',
        'stale-choice':'Life 选择或账户失效，没有读取局部'};
      cards.appendChild(debugCard('Life 看后多候选自主探索', (meanings[twoStage.status]||'第二阶段：'+String(twoStage.status||'未知'))+
        ' · 可信候选 '+(twoStage.candidates?.length||0)+' 个'+
        (twoStage.focusWindows?.length?' · 已核验 '+twoStage.focusWindows.length+' 个窗口':'')));
      for(const [i,p] of (Array.isArray(twoStage.candidates)?twoStage.candidates:[]).slice(0,8).entries()){
        const at=Number(p.atSeconds)||0;
        const caption=typeof p.nearbySpeech==='string'&&p.nearbySpeech?' · 同期'+
          (p.speechSource==='machine-asr'?'机器转写':'字幕')+'：'+p.nearbySpeech:' · 无已核验的同期字幕';
        cards.appendChild(debugCard('可信局部候选 '+(i+1),
          `${Math.floor(at/60)}:${String(Math.floor(at%60)).padStart(2,'0')} · ${p.startSeconds}–${p.endSeconds} 秒`+
          (p.visualCue?' · 视觉模型推测（未核实）：'+p.visualCue:' · 无逐帧视觉说明')+
          caption+
          (p.semanticSuggested?' · 语义候选（视觉模型建议、未确认）':'')+
          (Number.isFinite(p.heat)?' · 观众热度 '+p.heat+'（辅助线索）':'')+
          ' · '+(Number.isFinite(p.pixelChange)?'Python 缩略差异 '+p.pixelChange+'（仅技术线索）':'时间分层选取')+
          ' · '+(p.scanCoverage==='scanned-under-limits'?'已在资源上限内扫描时间线':'可能存在未覆盖区域')));
      }
      for(const [i,window] of (twoStage.focusWindows||[]).entries())cards.appendChild(debugCard('已核验局部 '+(i+1),
        window.startSeconds+'–'+window.endSeconds+' 秒 · 原视频 '+window.frameCount+' 帧 · 取流 '+
        (Number(window.inputBytes||0)/1048576).toFixed(2)+' MiB · 最高360p'));
      if(twoStage.usage)cards.appendChild(debugCard('本轮多局部累计',
        twoStage.usage.windows+' 个窗口 · '+twoStage.usage.frames+' 帧 · '+
        (Number(twoStage.usage.bytes||0)/1048576).toFixed(2)+' MiB（含全局实际流量／可统计部分）'));
      if(twoStage.selectedTargets?.length)cards.appendChild(debugCard('Life 本批自主选择',
        twoStage.selectedTargets.map(t=>t.atSeconds+'s×'+t.durationSeconds+'s').join(' · ')));
    }
    const fallback=payload?.visual?.adaptive_fallback;
    const sourceReasons={
      video_source_scheme_rejected:'视频源不是 HTTPS',
      video_source_authority_rejected:'媒体地址结构校验失败',
      video_source_domain_rejected:'视频源主机名不合法',
      video_source_path_rejected:'媒体路径未通过结构校验',
      video_source_format_rejected:'媒体容器类型不受支持',
      unsafe_video_source:'视频源未通过安全校验',
      video_cdn_connection_failed:'视频 CDN 连接或证书验证失败',
      video_source_dns_unavailable:'视频 CDN DNS 解析失败',
      public_playurl_unavailable:'官方播放地址请求失败',
      video_download_timeout:'原视频完整下载超过本档安全传输时限',
      video_download_failed:'原视频下载连接失败',
      video_http_error:'原视频 CDN 返回 HTTP 错误',
      video_network_budget_exhausted:'单视频真实解码网络预算不足',
      video_sampling_budget_exhausted:'真实视频分段读取时间预算不足',
      video_window_budget_insufficient:'真实视频片段所需字节超过剩余预算',
      video_range_not_supported:'CDN 未正确支持受控 Range 请求',
      video_range_http_error:'Range 请求返回 HTTP 错误',
      video_range_download_failed:'Range 片段下载连接失败',
      dash_range_probe_failed:'DASH 媒体字节探针连接失败',
      dash_range_probe_http_error:'DASH 媒体字节探针 HTTP 错误',
      dash_indexed_video_unavailable:'没有可校验索引的 DASH 视频轨',
      dash_stream_unavailable:'平台未提供可用 DASH 视频轨',
      dash_sidx_unavailable:'DASH 视频缺少可信时间索引',
      video_mp4_index_unavailable:'MP4 随机取帧索引无法读取',
      ffmpeg_not_installed:'缺少本机 FFmpeg'
    };
    if(fallback?.actual_source==='videoshot'){
      const reason=String(fallback.reason||'').slice(0,70);
      const authorityHints={userinfo:'URL 存在用户信息', 'explicit-port':'URL 存在显式端口',
        'url-fragment':'URL 包含片段标识', 'malformed-authority':'URL 地址格式异常'};
      const trackHints={durl:'DURL 视频轨',dash:'DASH 视频轨'};
      const hint=reason==='video_source_authority_rejected'&&Object.hasOwn(authorityHints,fallback.authorityDetail)
        ?' · '+authorityHints[fallback.authorityDetail]:'';
      const track=Object.hasOwn(trackHints,fallback.rejectedTrack)?' · '+trackHints[fallback.rejectedTrack]:'';
      const stageNames={'durl-complete':'DURL 完整下载','durl-mp4-indexed':'MP4 按需分段','dash-indexed':'DASH SIDX 分段'};
      const attempts=Array.isArray(fallback.attemptedStages)?fallback.attemptedStages.filter(x=>Object.hasOwn(stageNames,x)).slice(0,3):[];
      const extra=attempts.length?' · 已尝试：'+attempts.map(x=>stageNames[x]).join(' → '):'';
      cards.appendChild(debugCard('原视频降级原因',
        (sourceReasons[reason]||'真实视频读取未完成：未知错误码')+hint+track+extra+
        '（'+(Object.hasOwn(sourceReasons,reason)?reason:'未收录代码 '+reason.replace(/[^a-z0-9_-]/g,'').slice(0,60))+'），已改用官方低清分镜，不是原视频取帧'));
    }
    const boardReports=Array.isArray(payload?.visual?.visionBoardReceipts)?payload.visual.visionBoardReceipts:[];
    const boardTotal=Number(payload?.visual?.sampling?.storyboard_count)||0;
    const boardDone=boardReports.filter(r=>r.status==='analyzed').length;
    const analyzed=payload?.visual?.status==='analyzed'||payload?.visual?.status==='cached';
    cards.appendChild(debugCard('模型实际视觉回答',
      analyzed&&handoff.video?.modelDescription?
        (boardReports.length?`已完成 ${boardDone}/${boardTotal} 张分镜 · ${handoff.video?.frameCount||0} 个采样时刻；时间-画面语义未经独立逐帧核实`:
          '已取得模型回答 · '+(handoff.video?.frameCount||0)+' 个采样时刻；未经逐帧语义核实'):
        payload?.visual?.status==='vision_incomplete'?
          `识图不完整 · ${boardDone}/${boardTotal} 张分镜收到可用回答；不能算全局识图完成`:'尚无可信回答'));
    for(const r of boardReports.slice(0,12)){
      cards.appendChild(debugCard(`分镜图 ${r.index} · 模型回执`,
        r.status==='analyzed'?`已返回 · ${(r.times||[]).length} 个时刻；内容是模型判断，不代表语义时间已核准`:
          `未完成 · ${String(r.error||'模型回答不可用').slice(0,135)}`));
    }
    cards.appendChild(debugCard('语音／字幕',speech.source==='machine-asr'&&speech.audioCoverage==='representative-windows'
      ?'本地 Whisper：仅抽样语音片段，不代表全片转写':speech.source==='machine-asr'&&speech.audioCoverage==='full-audio-attempt'
      ?'本地 Whisper：已尝试整段音轨转写（不代表逐句准确或真正听音频）':speech.source||'未取得'));
    const diagnostic=payload?.phaseDiagnostics||{};
    if(diagnostic.schema==='life-video-phase-diagnostics/v1'){
      const seconds=v=>Number.isFinite(v)?(v/1000).toFixed(1)+' 秒':'未测量';
      cards.appendChild(debugCard('本轮实际耗时',
        '元数据 '+seconds(diagnostic.metadataMs)+' · 字幕/语音 '+seconds(diagnostic.speechMs)+
        ' · 视觉 '+seconds(diagnostic.visualMs)+' · 汇总 '+seconds(diagnostic.assemblyMs)+
        ' · 总计 '+seconds(diagnostic.totalMs)+
        (diagnostic.visualCompletedBeforeSpeech?' · 视觉先于语音完成':'')));
      const asrTools=[];
      if(Number.isFinite(diagnostic.subtitleToolMs))asrTools.push('字幕工具 '+seconds(diagnostic.subtitleToolMs));
      if(Number.isFinite(diagnostic.asrToolMs))asrTools.push('ASR MCP 调用 '+seconds(diagnostic.asrToolMs));
      const mt=diagnostic.asrMcpTimings;
      if(mt?.schema==='life-asr-mcp-worker-timings/v1'&&Number.isFinite(mt.handlerMs)){
        asrTools.push('MCP 处理 '+seconds(mt.handlerMs));
        asrTools.push('ASR 子进程启动 '+seconds(mt.spawnMs));
        asrTools.push('子进程运行及管道回收 '+seconds(mt.childAndPipeMs));
        if(Number.isFinite(diagnostic.asrToolMs))asrTools.push('MCP 调度/传输等未归属等待 '+
          seconds(Math.max(0,diagnostic.asrToolMs-mt.handlerMs)));
      }
      if(asrTools.length)cards.appendChild(debugCard('字幕与 ASR 外层耗时',asrTools.join(' · ')));
      const asrTimes=payload?.subtitle?.timings||payload?.speechAttempt?.timings;
      if(asrTimes?.schema==='life-asr-phase-timings/v1')cards.appendChild(debugCard('Whisper 耗时拆分',
        '完整音轨下载 '+seconds(asrTimes.audioDownloadMs)+' · 模型加载 '+seconds(asrTimes.modelLoadMs)+
        ' · 音频切片 '+seconds(asrTimes.clipExtractionMs)+' · 推理 '+seconds(asrTimes.inferenceMs)+
        ' · 总计 '+seconds(asrTimes.totalMs)));
    }
    cards.appendChild(debugCard('静帧 OCR',Array.isArray(handoff.ocr)?String(handoff.ocr.length)+' 个时间点':'无结果'));
    cards.appendChild(debugCard('Life 时间轴',String(handoff.timeAlignment?.anchors?.length||0)+' 个锚点，语义互证待 Life 判断'));
    cards.appendChild(debugCard('证据覆盖等级',handoff.coverageAssessment?.level||'无可信视频证据'));
    const imageGallery=$('video-debug-images');
    const imageLightbox=$('video-debug-lightbox');
    const imageReceipts=(videoDebugMode==='life'?videoDebugState?.lastLife?.images:job?.images)||[];
    imageGallery.replaceChildren();
    const validImageReceipts=imageReceipts.filter(r=>/^[a-f0-9]{32}$/.test(String(r.id||''))&&Array.isArray(r.images));
    // Polling every 1.8s must NOT close a user-opened viewer. Only invalidate
    // it if this image disappears from the account/job-scoped receipts.
    if(imageLightbox?.open && !validImageReceipts.some(r=>
      r.images.some(x=>r.id+'/'+x.file===imageLightbox.dataset.imageKey)))imageLightbox.close();
    if(!validImageReceipts.length){imageGallery.textContent='这轮没有可展示的实际 JPEG：可能尚未识图、命中了旧缓存，或原图已超过 30 分钟保留期。';}
    else for(const receipt of validImageReceipts){
      const isLowRes=receipt.images.some(x=>String(x.resolution||'').includes('低清'));
      const heading=node('strong',receipt.kind==='focus'?(isLowRes?'局部复查 · 官方低清预览分镜':'局部复查 · 原视频解码采样帧（最高360p）'):(isLowRes?'全局观察 · 官方低清预览分镜':'全局观察 · 原视频分镜拼图'));
      imageGallery.appendChild(heading);
      const strip=node('div','','video-debug-image-grid');
      for(const item of receipt.images){
        if(!/^(?:storyboard|focus)-\d{2}\.jpg$/.test(item.file))continue;
        const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
        img.src='/api/bili-duty/video-perception-debug/image/'+receipt.id+'/'+item.file;
        img.alt=(String(item.resolution||'').includes('低清')?'官方低清预览分镜':receipt.kind==='focus'?'真实局部复查帧':'真实解码分镜图')+'，采样时刻 '+(item.times||[]).join('、')+' 秒';
        img.loading='lazy';img.decoding='async';
        caption.textContent=(item.times||[]).map(t=>Number(t).toFixed(1)+'s').join(' · ')+' · '+(item.resolution||'实际采样');
        const zoomButton=document.createElement('button');
        zoomButton.type='button';zoomButton.className='video-debug-image-zoom';
        zoomButton.setAttribute('aria-label','放大查看：'+img.alt);
        zoomButton.title='点击放大查看';zoomButton.appendChild(img);
        zoomButton.addEventListener('click',()=>{
          // Only copy the URL generated from a validated same-account image receipt.
          // Keep the user on this same-origin management page; no public image URL.
          if(!imageLightbox||typeof imageLightbox.showModal!=='function')return;
          const enlarged=$('video-debug-lightbox-image');
          imageLightbox.dataset.imageKey=receipt.id+'/'+item.file;
          enlarged.src=img.src;enlarged.alt=img.alt;
          $('video-debug-lightbox-caption').textContent=caption.textContent;
          imageLightbox.showModal();
        });
        figure.append(zoomButton,caption);strip.appendChild(figure);
      }
      imageGallery.appendChild(strip);
    }
    $('video-debug-visual').textContent=payload?JSON.stringify({overviewVisual:payload.visual,overviewEvidence:payload.videoEvidence?.sources?.filter(x=>/visual|frames/.test(x.kind)),overviewPerception:handoff.video,...(twoStage?{postOverviewLifeChoice:twoStage}:{})},null,2):'尚无视觉回执';
    $('video-debug-speech').textContent=payload?JSON.stringify({subtitleOrAsr:payload.subtitle,speech:handoff.speech},null,2):'尚无字幕或语音回执';
    $('video-debug-timeline').textContent=payload?JSON.stringify({ocr:handoff.ocr,perceptionTimeline:payload.perceptionTimeline,review:handoff.review,coverageAssessment:handoff.coverageAssessment},null,2):'尚无 OCR 或时间轴';
    $('video-debug-json').textContent=payload?JSON.stringify(payload,null,2):
      videoDebugMode==='life'?(actual?'真实记录暂不可读取':'最近 30 分钟无真实 Life 观看回执'):'试运行尚未产生成功的 Life 输入';
  };
  $('video-debug-lightbox-close').addEventListener('click',()=>$('video-debug-lightbox').close());
  $('video-debug-lightbox').addEventListener('close',()=>{
    // Images are short-lived diagnostics; avoid retaining an old JPEG after close.
    $('video-debug-lightbox-image').removeAttribute('src');
    $('video-debug-lightbox-image').alt='';
    delete $('video-debug-lightbox').dataset.imageKey;
    $('video-debug-lightbox-caption').textContent='';
  });
  const refreshVideoDebug=async()=>{
    try{videoDebugState=await request('/video-perception-debug');renderVideoDebug();
      if(videoDebugState.job?.status==='running'){
        if(!videoDebugTimer)videoDebugTimer=setTimeout(()=>{videoDebugTimer=null;refreshVideoDebug()},1800);
      }else{clearTimeout(videoDebugTimer);videoDebugTimer=null;}
    }catch(e){$('video-debug-progress').textContent='视频调试暂不可用：'+String(e?.message||e).slice(0,180);
      clearTimeout(videoDebugTimer);videoDebugTimer=null;}
  };
  const explainVideoDebugSource=()=>{
    const mode=$('video-debug-source').value,depth=$('video-debug-depth');
    if(mode==='life-two-stage')depth.value='standard';
    depth.disabled=mode==='life-two-stage';
    const label=$('video-debug-source-explain');
    if(label)label.textContent=mode==='life-two-stage'
      ?'真正的两阶段链路：第一轮按已保存的自适应分镜档位，最多观察12/24/48张官方低清缩略帧（每12帧一张分镜图）；不要求Life在看片前猜测是否深入。之后由真实Life意愿模型自主决定是否局部精查；不写Life经历或公开发送。'
      :'单阶段专项仅运行当前来源，不触发 Life 看后的二次判断。要测试完整链路请切换到「完整两阶段」。';
  };
  $('video-debug-source').addEventListener('change',explainVideoDebugSource);
  explainVideoDebugSource();
  $('video-debug-run').addEventListener('click',()=>run(async()=>{
    const bvid=String($('video-debug-bvid').value||'').trim();
    if(!/^BV[A-Za-z0-9]{10}$/.test(bvid))throw Error('请填写真实有效的 BV 号');
    const sourceMode=$('video-debug-source').value;
    const sourceLabel=sourceMode==='life-two-stage'?'完整两阶段 · Life 真实二次决策':sourceMode==='adaptive'?'单阶段原视频 FFmpeg 取帧专项':'单阶段官方 videoshot 全局概览';
    const proceed=await confirmAction({title:'开始视频感知只读验收',description:'本次验证「'+sourceLabel+'」。'+(sourceMode==='life-two-stage'?'先按所选分镜档位进行官方 videoshot 全局识图，之后调用真实 Life 意愿模型，由她决定是否使用第二次视觉模型识别真实片段；如果拒绝就停止。':'仅执行当前指定的一次视觉识别，不触发 Life 第二次判断。')+' 可能产生视觉模型费用和 B站读取流量。不会创建 Life 观看经历或公开发送。',confirmLabel:'开始只读验收'});
    if(!proceed)return;
    const data=await request('/video-perception-debug/run',{bvid,depth:$('video-debug-depth').value,sourceMode});
    videoDebugMode='test';videoDebugState={ok:true,job:{id:data.id,status:'running',stage:'后台任务已受理',step:0,sourceMode}};renderVideoDebug();message('已启动'+sourceLabel+'只读验收：'+String(data.id||'').slice(0,8));
    await refreshVideoDebug();
  }));
  $('video-debug-refresh').addEventListener('click',()=>run(refreshVideoDebug));
  $('video-debug-show-test').addEventListener('click',()=>{videoDebugMode='test';renderVideoDebug()});
  $('video-debug-show-life').addEventListener('click',()=>{videoDebugMode='life';renderVideoDebug()});
  $('video-debug-copy').addEventListener('click',()=>run(async()=>{
    const payload=debugViewPayload();if(!payload)throw Error('当前没有可复制的完整 Life 输入');
    await navigator.clipboard.writeText(JSON.stringify(payload,null,2));message('已复制当前完整 Life JSON；请谨慎分享第三方文字内容');
  }));
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
    try {
      const r=await request('/meme-learning'),hints=Array.isArray(r.pendingTitleHints)?r.pendingTitleHints:[];
      setLearningState('meme-learning-status',r.enabled===true,'正在收集梗知识','自动收集已关闭');
      $('meme-title-hints').hidden=!hints.length;
      $('meme-title-hints-count').textContent=hints.length?' · '+hints.length+' 类':'暂无';
      const list=$('meme-title-hints-list');list.replaceChildren();
      for(const hint of hints){
        const card=node('article','','record');add(card,node('strong',String(hint.name||'').slice(0,48)));
        for(const source of (hint.sources||[]).slice(0,12)){
          if(!/^BV[0-9A-Za-z]{10}$/.test(String(source?.bvid||'')))continue;
          const line=node('div','','meta-line'),a=node('a',source.bvid);
          a.href='https://www.bilibili.com/video/'+source.bvid;a.target='_blank';a.rel='noopener noreferrer';
          add(line,a,info(String(source.evidence||'公开视频标题').slice(0,140)));card.appendChild(line);
        }
        list.appendChild(card);
      }
    }catch(e){setLearningState('meme-learning-status',false,'','状态暂不可读取');$('meme-title-hints').hidden=true}
    $('meme-stats').textContent='共 '+(data.total||0)+' 条 · 待审核 '+(counts.pending||0)+' · 已批准 '+(counts.approved||0)+' · 已拒绝 '+(counts.rejected||0)+'。待核实通用标题只保留线索，不会直接形成梗知识。最多显示 50 条，支持搜索。';
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
    if(!quiet)message(localSaveNotice(saved,isDefault?'已恢复内置默认提示词':'AI 规则维护提示词已保存'));
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
      const last=recent.at(-1);const labels={done:'已确认回复','partial':'部分气泡已确认，剩余已停止','continuation-muted':'短句已接续已完成任务，不重复回复','reply-reserved':'回执发送中','failed':'未发送','failed-or-uncertain':'处理失败或结果不确定',uncertain:'发送结果不确定',claimed:'正在处理',baseline:'历史消息基线'};
      const todoLabels={'saved':'自主接受并保存待办','already-saved':'待办已存在，未重复添加','candidate':'识别到待办候选','invalid-evidence':'建议证据未通过核实','willingness-defer':'鱼鱼选择延期考虑','willingness-refuse':'鱼鱼选择不接受','model-defer':'鱼鱼不想现在接受','model-refuse':'鱼鱼拒绝这条建议','save-failed':'保存待办失败','read-permission-off':'主人私信只读待办未授权','no-proposal':'本次没有成立的待办候选'};
      $('owner-dm-agent-status').textContent='最近 '+recent.length+' 条记录；最新：'+(labels[last?.status]||last?.status||'暂无记录')+(Number.isFinite(last?.proposedBubbles)?`（气泡 ${Number(last.confirmedBubbles)||0}/${Number(last.proposedBubbles)||0}）`:'')+(last?.sendReason?'（'+String(last.sendReason).slice(0,100)+'）':'')+(last?.reason?'（'+String(last.reason).slice(0,120)+'）':'')+(last?.todoIntake?'；待办：'+(todoLabels[last.todoIntake]||'未成立的候选'):'')+'。';
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
      message(localSaveNotice(saved,'主人私信 Agent 与独立权限已保存。运行中后端会使用新配置'));
    }catch(e){status.textContent='保存或校验失败：'+String(e?.message||e);throw e}
  }));
  const dmPlans={
    free:{dmWatch:true,dmStrangerAutonomyEnabled:true,dmApprovalEnabled:false},
    friends:{dmWatch:true,dmStrangerAutonomyEnabled:false,dmApprovalEnabled:false},
    paused:{dmWatch:false,dmStrangerAutonomyEnabled:false,dmApprovalEnabled:false}
  };
  const dmPlanNames={free:'自由交流',friends:'熟人优先',paused:'暂停交流',custom:'自定义'};
  const renderDmChoice=()=>{
    const choice=selectedChoice('dm-conversation-choice');
    $('dm-conversation-choice-status').textContent=choice==='custom'?'沿用当前已有的自定义授权。修改陌生人回复范围，请重新选择「自由交流」或「熟人优先」，保存前会校验新增授权。'
      :'已选择「'+dmPlanNames[choice]+'」'+(choice==='free'?'（包含陌生人回复授权，新增时保存前需确认）':choice==='friends'?'（只允许已授权联系人回复）':'（停止后台私信监听）')+'。点击保存后生效；不会改动每日额度和已保存的好友名单。';
  };
  document.querySelectorAll('input[name="dm-conversation-choice"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked&&dmPlans[r.value]){
      const p=dmPlans[r.value];
      for(const [id,key] of [['dm-watch','dmWatch'],['dm-stranger-enabled','dmStrangerAutonomyEnabled'],['dm-approval-enabled','dmApprovalEnabled']])$(id).checked=p[key];
    }
    $('dm-conversation-advanced').open=r.value==='custom';renderDmChoice();
  }));
  for(const id of ['dm-watch','dm-stranger-enabled','dm-approval-enabled'])$(id).addEventListener('change',()=>{setChoice('dm-conversation-choice','custom');renderDmChoice()});
  // Independent from the DM recipient-authorisation cards above.
  const dmNaturalPlans={
    gentle:{owner:5,intimate:15,familiar:30,stranger:90,chance:12,enabled:true,bubbles:2},
    balanced:{owner:2,intimate:5,familiar:10,stranger:30,chance:25,enabled:true,bubbles:3},
    lively:{owner:1,intimate:3,familiar:6,stranger:15,chance:40,enabled:true,bubbles:3}
  };
  const naturalFields={owner:'natural-owner-minutes',intimate:'natural-intimate-minutes',familiar:'natural-familiar-minutes',stranger:'natural-stranger-minutes',chance:'natural-chance-percent'};
  const naturalKeys={owner:'naturalThoughtOwnerMinutes',intimate:'naturalThoughtIntimateMinutes',familiar:'naturalThoughtFamiliarMinutes',stranger:'naturalThoughtStrangerMinutes',chance:'naturalThoughtChancePercent'};
  const readNaturalFields=()=>({...Object.fromEntries(Object.entries(naturalFields).map(([key,id])=>[key,Number($(id).value)])),enabled:$('dm-p6-enabled').checked,bubbles:Number($('dm-p6-max-bubbles').value)});
  const fillNaturalFields=profile=>{Object.entries(naturalFields).forEach(([key,id])=>$(id).value=String(profile[key]));$('dm-p6-enabled').checked=profile.enabled;$('dm-p6-max-bubbles').value=String(profile.bubbles)};
  const naturalPlanMatch=values=>Object.entries(dmNaturalPlans).find(([,p])=>Object.keys(p).every(k=>p[k]===values[k]))?.[0]||'custom';
  const showNaturalPlan=()=>{const name=selectedChoice('dm-natural-choice');$('dm-natural-choice-status').textContent=({
    gentle:'安静陪伴：更少额外模型调用。',balanced:'自然适中：主人 2、亲密朋友 5、熟悉朋友 10、其他人 30 分钟；额外思考机会 25%。',
    lively:'更爱分享：冷却较短；不意味着必须主动发言。',custom:'自己设定：只更改自然表达与续想，不改变私信对象授权。'
  })[name]||'';};
  document.querySelectorAll('input[name="dm-natural-choice"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked&&dmNaturalPlans[r.value])fillNaturalFields(dmNaturalPlans[r.value]);
    $('dm-natural-advanced').open=r.value==='custom';showNaturalPlan();
  }));
  for(const id of [...Object.values(naturalFields),'dm-p6-enabled','dm-p6-max-bubbles'])$(id).addEventListener('change',()=>{
    setChoice('dm-natural-choice',naturalPlanMatch(readNaturalFields()));showNaturalPlan();
  });
  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-p6-enabled').checked=cfg.dmP6Enabled!==false;
    const naturalValues={...Object.fromEntries(Object.keys(naturalKeys).map(k=>[k,cfg[naturalKeys[k]]??dmNaturalPlans.balanced[k]])),enabled:cfg.dmP6Enabled!==false,bubbles:Number(cfg.dmP6MaxBubbles??3)};
    fillNaturalFields(naturalValues);const naturalChoice=naturalPlanMatch(naturalValues);
    setChoice('dm-natural-choice',naturalChoice);$('dm-natural-advanced').open=naturalChoice==='custom';showNaturalPlan();
    $('social-rhythm-cooldown').value=String(cfg.socialRhythmCrossChannelMinutes??30);
    $('dm-stranger-enabled').checked=cfg.dmStrangerAutonomyEnabled===true;
    const dmPreset=cfg.dmStrangerOnce===true?'custom':Object.keys(dmPlans).find(k=>Object.entries(dmPlans[k]).every(([key,value])=>(cfg[key]===true)===value))||'custom';
    setChoice('dm-conversation-choice',dmPreset);$('dm-conversation-advanced').open=dmPreset==='custom';renderDmChoice();
    $('dm-stranger-legacy-note').textContent=cfg.dmStrangerOnce===true&&cfg.dmStrangerAutonomyEnabled!==true
      ?'检测到旧版「陌生人首次回复」授权：旧额度仍有效，不会自动升级为多轮自主私信；如需自由交流，请明确勾选上方的新授权并保存。':'';
    $('dm-whitelist').value=cfg.dmWhitelist||'';

    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';

  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const payload={dmWatch:$('dm-watch').checked,dmP6Enabled:$('dm-p6-enabled').checked,
      dmP6MaxBubbles:boundedInt('dm-p6-max-bubbles',1,3,'私信自然续聊每轮条数'),
      naturalThoughtOwnerMinutes:boundedInt('natural-owner-minutes',1,1440,'主人续想冷却'),
      naturalThoughtIntimateMinutes:boundedInt('natural-intimate-minutes',1,1440,'亲密朋友续想冷却'),
      naturalThoughtFamiliarMinutes:boundedInt('natural-familiar-minutes',1,1440,'熟悉朋友续想冷却'),
      naturalThoughtStrangerMinutes:boundedInt('natural-stranger-minutes',1,1440,'普通联系人续想冷却'),
      naturalThoughtChancePercent:boundedInt('natural-chance-percent',0,100,'额外思考机会比例'),
      socialRhythmCrossChannelMinutes:boundedInt('social-rhythm-cooldown',0,1440,'跨渠道冷却'),
      dmStrangerAutonomyEnabled:$('dm-stranger-enabled').checked,
      ...(selectedChoice('dm-conversation-choice')!=='custom'||$('dm-stranger-enabled').checked ? {dmStrangerOnce:false} : {}),
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase};
    const previous=(await request('/config')).config||{};
    if(payload.dmApprovalEnabled===true)throw Error('历史严格审核已停用。请先选择「自由交流」「熟人优先」或「暂停交流」后，再保存自主模式。');
    if(payload.dmWatch&&payload.dmStrangerAutonomyEnabled&&
      (!previous.dmWatch||!previous.dmStrangerAutonomyEnabled)&&
      !await confirmAction({title:'确认开放陌生人私信',description:'鱼鱼将可以考虑回复新的陌生人并自然续聊；不是每条必回，仍受额度、拒联和事务门禁限制。确定开启？',confirmLabel:'确认授权'}))return;
    const saved=await request('/config',payload);await loadDmSettings();await loadDmStatus();await dmList();message(localSaveNotice(saved,'后台私信规则已保存'))
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));
  const loadDmStatus=async()=>{
    const data=await request('/status');const x=data.dmAutoReplyStatus||{};
    const dmScheduler=data.interactionSchedulerStatus?.checks?.dm||{};
    const readBudget=data.interactionSchedulerStatus?.readBudget||{};
    const networkLane=data.interactionSchedulerStatus?.networkBackoff?.dm||{};
    const recovery=networkLane.category==='rate-limit'
      ?`历史平台 -509 限流 · 已完成读取恢复探测 ${Math.min(3,Number(networkLane.recoverySuccesses)||0)}/3 · 下次最早探测 ${pollClock(networkLane.nextAt)}（连续失败 ${Number(networkLane.streak)||1} 为历史限流记录，不代表最后一次私信发送失败）`
      :networkLane.category==='network'?`网络连接退避 · 下次探测 ${pollClock(networkLane.nextAt)}`:'当前没有持久化的私信平台退避';
    const lastChecked=Number(dmScheduler.lastFinishedAt)||0;
    const checkedState=dmScheduler.lastResult==='completed'?'本轮监听任务已结束（不等于回复已发送）':
      dmScheduler.lastResult==='error'?'本轮监听检查发生错误':dmScheduler.lastResult==='skipped'?'本轮监听未运行':'尚无本进程检查记录';
    $('dm-status').textContent=!x.enabled?'私信倾听已暂停。开启后鱼鱼才会查看新的私信。':
      readBudget.blocked?'私信读取暂时受限，预计 '+pollClock(readBudget.retryAt)+' 后重新尝试。':
      `${checkedState} · ${lastChecked?'最近检查 '+pollClock(lastChecked):'尚未检查'}${dmScheduler.nextAt?' · 计划下次 '+pollClock(dmScheduler.nextAt):''}`;
    $('dm-network-recovery-status').textContent=recovery+'。'+checkedState+'。'+(readBudget.dmListNextAt?'普通会话列表最早下次读取 '+pollClock(readBudget.dmListNextAt)+'；':'')+(readBudget.lastDmMessagesAttemptAt?'上次定向详情读取 '+pollClock(readBudget.lastDmMessagesAttemptAt)+'；':'')+'模型做出回复意愿、平台实际发送和真实收到回复是不同阶段；具体以本页最近一次私信决策的“平台确认条数”为准。';
    const fast=data.interactionSchedulerStatus?.activeDm||x.fast||{};
    const life=x.lifeQueue||{},detail=data.dmDetailQueueStatus||{};
    const admission=data.lifeWillingnessStatus?.admission||{};
    const ownerLabels={dm:'私信',comment:'评论',video:'视频',other:'其他行动',unknown:'未分类行动'};
    const admissionLabel=admission.ok!==true?'Life 准入状态待检查':admission.needsReview?'Life 准入需人工核验（不自动解除）':admission.held
      ?`Life 当前占用：${ownerLabels[admission.ownerChannel]||'未分类行动'} · ${Math.max(0,Math.round(Number(admission.ageMs)||0)/1000)} 秒`
      :`Life 准入空闲${admission.lastReleaseReason&&admission.lastReleaseReason!=='none'?' · 上次释放 '+admission.lastReleaseReason:''}`;
    const reviewHint=Number(life.reviewRequired)>0?' · 有消息已暂停自动重试，请到下方最近私信会话先检查平台是否已经回复，再明确确认定向复核':'';
    $('dm-life-queue-status').textContent=`待读取会话 ${Math.max(0,Number(detail.pending)||0)} · 待 Life 决策 ${Math.max(0,Number(life.pending)||0)} · 技术延期 ${Math.max(0,Number(life.technicalDeferred)||0)} · 发送待核验 ${Math.max(0,Number(life.sendUnknown)||0)} · 需人工核查 ${Math.max(0,Number(life.reviewRequired)||0)}。${admissionLabel}。技术延期不等于鱼鱼选择沉默${reviewHint}。`;
    $('dm-fast-status').textContent=!x.enabled?'活跃快通道未运行：普通私信监听已暂停。'
      :fast.enabled===false?'活跃快通道已关闭。'
      :`活跃快通道：当前 ${Number(fast.activeCount)||0} 个会话 · 本进程定向检查 ${Number(fast.checks)||0} 次 · 当前自适应间隔 ${Number(fast.nextIntervalSeconds)||Number(fast.baseIntervalSeconds)||10} 秒${Number(fast.lastFastAt)>0?' · 最近 '+pollClock(fast.lastFastAt):' · 尚未观察到定向检查' }。${Number(fast.activeCount)>0?'':' 当前没有活跃会话，不会定向扫描；新会话仍依赖普通监听。'}`;
    $('dm-p6-status').textContent=x.p6Enabled===false?'自然表达已关闭。':
      '自然多气泡与偶发自主续想按关系冷却运行；旧版延期预约已停止执行。';
    const t=x.p6LastTurn||{};const p6Phase={prepared:'已产生发送计划',confirmed:'平台逐条确认',partial:'部分发送后安全停止',error:'发送失败或结果不确定',skipped:'模型选择沉默',invalid:'模型输出不合法','technical-failure':'模型或服务不可用','technical-deferred':'Life 准入占用，尚未调用模型',deferred:'本轮主动选择延期','defer-unavailable':'本轮延期未发送',reconsidered:'独立续想结束'};
    // Only show bounded enums derived from the receipt ledger; do not display
    // private message text, message IDs, raw provider errors or model prompts.
    $('dm-p6-last-turn').textContent=t.at
      ?`最近一次私信决策 · ${pollClock(t.at)} · ${p6Phase[t.status]||'结果待核查'} · 本轮计划 ${Number(t.planned||t.proposed||0)} 条 / 平台确认 ${Number(t.confirmed||0)} 条`
      :'暂时没有新的私信决策记录。自然多气泡和沉默续聊由模型自主选择，开启开关并不保证发生。';
    $('dm-error').textContent=x.lastError?'最近一次连接有异常，详情请打开「运行诊断」。':'';
  };
  const identityLink=(uid,nickname)=>{const span=node('span');const name=String(nickname||'').trim();const id=String(uid||'');span.appendChild(node('strong',(name||'昵称未获取')+' · '));const a=node('a','UID '+id);if(/^[1-9]\d{0,18}$/.test(id)){a.href='https://space.bilibili.com/'+id;a.target='_blank';a.rel='noopener noreferrer';}span.appendChild(a);return span};
  const loadDmMemoryGovernance=async()=>{
    const data=await request('/dm-memory-governance');
    $('dm-memory-governance-status').textContent=data.ok
      ?`当前普通私信会话 ${data.conversations} 位联系人，近期交流 ${data.historyCount} 条；${data.staleCount?'有 '+data.staleCount+' 条过期内容可清理':'目前无需清理过期内容'}。只处理普通私信临时上下文，不会删除鱼鱼的人生记忆。`
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
      if(c.lastInboundOutcome?.at){
        const labels={'model-skip':'鱼鱼选择暂不回复','model-close':'鱼鱼选择结束对话',
          'model-defer':'鱼鱼选择延期','delivered':'平台已确认回复',
          'model-failed':'模型请求失败','model-invalid':'模型决定无效',
          'send-unknown':'发送结果不确定','send-blocked':'发送被拦截',
          'safety-blocked':'安全核验未通过','permission-denied':'权限阻止回复',
          'approval-pending':'等待申请审批'};
        add(card,info(`最近入站处理 · ${formatLocalTime(c.lastInboundOutcome.at)} · ${labels[c.lastInboundOutcome.status]||'结果待复核'}（不等于平台未读状态）`));
      }
      const checkActions=node('div','','actions');
      const checkNote=info('仅核对这位联系人最近72小时的平台来信与本地回执；检查不发送私信。');
      const checkButton=btn('检查遗漏私信',async()=>{
        checkNote.textContent='正在从 B站 定向读取最近消息…';
        const checked=await request('/dm-contact-check',{uid:c.uid});
        checkNote.textContent=(checked.message||'检查完成')+(checked.state==='eligible'?(checked.alreadySeen?' · 本地已处理但没有确认发送':' · 本地尚未处理'):'');
        if(checked.state!=='eligible')return;
        const agree=await confirmAction({title:'请鱼鱼重新考虑这条未回复的私信？',
          description:'已确认平台近期没有更晚的己方回复。点击继续将再核实一次平台及本地账本，然后把这一条消息交给原私信模型自主决定；鱼鱼可以沉默。不会强制补发，不能绕过授权、额度、账号隔离与限流。'});
        if(!agree)return;
        checkNote.textContent='正在重新核验并请鱼鱼考虑（不会强制回复）…';
        const outcome=await request('/dm-contact-reconsider',{uid:c.uid,token:checked.token,confirm:true});
        const states={'delivered':'已取得平台确认回复','model-skip':'鱼鱼决定暂不回复',
          'model-close':'鱼鱼决定结束对话','model-defer':'鱼鱼决定延期',
          'model-failed':'模型调用失败，未发送','model-invalid':'模型输出无效，未发送',
          'send-unknown':'平台送达未知，已冻结避免重复','send-blocked':'发送前检查阻止',
          'safety-blocked':'安全核验阻止','reserved':'流程未完成，安全保留复核占位'};
        const line=states[outcome.manualStatus]||outcome.message||'已完成本轮重新考虑（没有确认发送）';
        checkNote.textContent=line;
        message('私信复核：'+line);
      });
      // Unified Life owns the same review path for owner, friend and approved DM.
      // The backend still performs identity, current-account and send-receipt checks.
      checkButton.disabled=mobileViewOnly;
      if(c.dmRole==='owner')checkNote.textContent='主人私信也由统一 Life 决策；定向复核只在二次确认后重新考虑，不强制回复或解除未知发送冻结。';
      add(checkActions,checkButton);add(card,checkActions,checkNote);
      add(card,info(`可用近期消息 ${c.contextEntries||0} 条 · 可用旧片段 ${c.olderContextEntries||0} 条${c.staleContextEntries?' · 有 '+c.staleContextEntries+' 条过期内容待清理':''}（不代表长期记忆）`));
      // Privacy by construction: the recent-message text is never placed in
      // the document, including hidden, blurred, aria, title or data attributes.
      // Render a decorative frosted placeholder instead; backend logs/receipts
      // and short-term conversation memory are deliberately unchanged.
      const preview=node('div','','dm-private-preview');
      const lines=node('div','','dm-private-preview-lines');lines.setAttribute('aria-hidden','true');
      for(let i=0;i<3;i++)lines.appendChild(node('span'));
      preview.appendChild(lines);
      const cover=node('div','','dm-private-preview-overlay');
      cover.appendChild(node('span','聊天内容留给鱼鱼与朋友 · 此处只展示会话状态'));
      preview.appendChild(cover);
      card.appendChild(preview);
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
      $('dm-error').textContent=result.deferred===true
        ?`B站限流保护中，本次没有发起请求 · 下次最早 ${pollClock(result.retryAt)}`
        :`连接成功：${result.host} · ${result.sessionCount} 个会话 · ${result.elapsedMs} ms · ${result.checkedAt}`;
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
    $('comments-status').textContent=`后台评论互动：${c.lifeSelectedHotPending?`Life 已阅读的热评待考虑 ${c.lifeSelectedHotPending} 条 · `:''}旧版已跳过的历史评论 ${c.legacyStrangerBudgetCount||0} 条（不自动补发） · ${c.busy?'正在运行':'空闲'} · 上次检查：${c.lastPollAt?new Date(c.lastPollAt).toLocaleString():'暂无'}${c.lastError?' · 错误：'+c.lastError:''}`;
    $('comments-usage').textContent=`近24小时后台回复成功回执：${c.sentLast24Hours??0} / ${c.replyPerDay??1000} 条。我的主评论下：${c.sentOnOwnTop24h??0}；我的楼中楼回复下：${c.sentOnOwnNested24h??0}。这是后台互动自己的滚动24小时上限，不是全局每日额度。`;
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
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus(),loadCommentGlobalQuota(),(async()=>{const {config:c={}}=await request('/config');$('models-comment-memes').checked=c.commentMemesEnabled===true;$('models-comment-memes-debug').checked=c.commentMemesDebug===true})()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:false,
      commentAtEnabled:$('comment-at-enabled').checked,
      commentAllowGeneralTop:false,
};
    const saved=await request('/config',payload);await loadCommentsAll();message(localSaveNotice(saved,'后台评论互动设置已保存'))
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
      // Legacy requests are read-only; no owner approve / reject / resume actions.
$('dm-list').appendChild(card);
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
      const card=node('article','','record');
      // Legacy memory timestamps at UTC midnight encode a date, not 08:00
      // Beijing viewing activity. The API supplies an explicit precision bit.
      const date=e.dateOnly&&/^\d{4}-\d{2}-\d{2}$/.test(String(e.day||''))
        ?e.day+' · 具体时刻未记录':e.at?(e.kind==='watch'?'入选记账于 ':'')+formatLocalTime(e.at):'';
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
  // dev49: 3D perspective is a VIEW of the existing memory index, not a new
  // memory store. Interaction never writes to Life or calls an external model.
  let neuralRequestVersion=0,neuralNodes=[],neuralEdges=[],neuralSelected='',neuralLayoutMode='structured';
  let neuralQueryPosition=null,neuralQueryReady=false,neuralAnimationProgress=1;
  const neuralScene={yaw:-.28,pitch:.18,zoom:1,panX:0,panY:0,dragMode:'rotate',focus:{x:0,y:0,z:0},focusToken:0,dragging:false,moved:false,lastX:0,lastY:0,pointer:null,positions:new Map()};
  const neuralKindColor={experience:'var(--neural-exp)',relationship:'var(--neural-rel)',interest:'var(--neural-int)',fact:'var(--neural-fact)'};
  const neuralKindTitle={experience:'经历',relationship:'人物互动线索',interest:'跨日兴趣',fact:'长期认识'};
  const svgEl=(tag,attrs={})=>{
    const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;
  };
  // Fallback positions are deterministic structural points, NOT semantic
  // clustering and NOT guessed embedding coordinates.
  const neuralFallback=(m,i,total)=>{
    const angle=(i+1)*2.399963229728653,layer=.38+1.23*Math.sqrt((i+1)/(total+1));
    const seed=parseInt(String(m.id||'0').slice(0,7),16)||0;
    return {x:Math.cos(angle)*layer,y:Math.sin(angle)*layer,z:Math.sin(seed*.000017)*.86};
  };
  const neuralPoint=(position)=>{
    const {yaw,pitch,zoom}=neuralScene;
    const a=Math.cos(yaw),b=Math.sin(yaw),c=Math.cos(pitch),d=Math.sin(pitch);
    const rel={x:position.x-neuralScene.focus.x,y:position.y-neuralScene.focus.y,z:position.z-neuralScene.focus.z};
    const x=rel.x*a-rel.z*b,z=rel.x*b+rel.z*a;
    const y=rel.y*c-z*d,depth=rel.y*d+z*c;
    const perspective=3.6/(3.6-depth*.30);
    const scale=zoom*perspective;
    return {x:500+neuralScene.panX+x*172*scale,y:285+neuralScene.panY+y*172*scale,z:depth,scale};
  };
  // Canvas and SVG must share the same letterboxed 1000×570 projection.
  // Independent x/y scaling made round nodes look stretched and fuzzy on
  // tall management panels, and misaligned semantic beams and hit targets.
  const neuralViewportGeometry=(width,height)=>{
    const scale=Math.min(width/1000,height/570);
    return {scale,offsetX:(width-1000*scale)/2,offsetY:(height-570*scale)/2};
  };
  const neuralDetail=id=>{
    neuralSelected=id;
    const m=neuralNodes.find(x=>x.id===id);
    if(!m)return;
    $('neural-memory-detail').textContent=[m.summary,(neuralKindTitle[m.kind]||'记忆')+' · '+(m.time?formatLocalTime(m.time):'时间未记载'),
      '证据来源：'+(m.source||'原有记忆记录'),'清晰程度：'+({clear:'清晰',fuzzy:'模糊',trace:'印象',unmarked:'未标注'}[m.clarity]||'未标注'),
      m.emotion?'当时的同源情绪观察：'+m.emotion+'（不代表现在）':'没有可核验的当时情绪关联',
      Number.isFinite(m.similarity)?'与本次查询向量的真实余弦相似度：'+m.similarity.toFixed(3)+'（高维，非三维距离）':'没有本次查询的向量相似度分数'].join('\n');
    const detail=$('neural-memory-detail');detail.classList.add('is-updated');
    $('neural-memory-results').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.nodeId===id)));
    $('neural-memory-nodes').querySelectorAll('[data-node-id]').forEach(g=>g.dataset.active=String(g.dataset.nodeId===id));
    const button=Array.from($('neural-memory-results').querySelectorAll('button')).find(b=>b.dataset.nodeId===id);
    if(button){
      const list=$('neural-memory-results');
      // Scroll only the result list; do not jump the entire page.
      const top=button.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop;
      const bottom=top+button.offsetHeight;
      if(top<list.scrollTop||bottom>list.scrollTop+list.clientHeight)
        list.scrollTop=Math.max(0,top-list.clientHeight/2+button.offsetHeight/2);
    }
    try{detail.focus({preventScroll:true})}catch{}
    if($('neural-memory-viewport').classList.contains('is-canvas'))renderNeuralScene();
  };
  // Only the authoritative memory stage controls fading; unknown records are never assigned a made-up decay score.
  const neuralClarityOpacity=clarity=>({clear:.97,fuzzy:.66,trace:.34,unmarked:.76})[clarity]??.76;
  const neuralCategories=['experience','relationship','interest','fact','emotion'];
  const neuralCategoryMatches=m=>neuralCategories.some(kind=>{
    if(!$('neural-filter-'+kind).checked)return false;
    return kind==='emotion'?Boolean(m.emotion):m.kind===kind;
  });
  const neuralVisibleNodes=()=>neuralNodes.filter(m=>neuralCategoryMatches(m)&&($('neural-show-all').checked||m.matched!==false));
  const neuralPositionOf=(m,i,n)=>m.position&&['x','y','z'].every(k=>Number.isFinite(m.position[k]))
    ?m.position:neuralFallback(m,i,n);
  // Dense maps use Canvas rather than 10,000 SVG nodes; the SVG remains the
  // accessible keyboard interaction surface for smaller scenes.
  const neuralCanvas=$('neural-memory-canvas'),neuralViewport=$('neural-memory-viewport');
  const renderSemanticConnections=()=>{
    const group=$('neural-semantic-beams');group.replaceChildren();
    if(!neuralQueryReady||!neuralQueryPosition||!$('main-session-history-query').value.trim())return;
    const origin=neuralPoint(neuralQueryPosition);
    // Full embedding cosine, NEVER projected Euclidean distance. The same
    // semantic relationship remains visible even when the nodes look far away.
    const targets=neuralVisibleNodes().filter(m=>m.matched&&Number.isFinite(m.similarity)&&neuralScene.positions.has(m.id))
      .sort((a,b)=>b.similarity-a.similarity).slice(0,320);
    const amount=Math.max(0,Math.min(1,neuralAnimationProgress));
    for(const [i,m] of targets.entries()){
      const pt=neuralScene.positions.get(m.id),sim=Math.max(0,Math.min(1,m.similarity));
      const phase=Math.max(0,Math.min(1,amount*1.55-i/Math.max(20,targets.length)*.5));
      if(!phase)continue;
      const beam=svgEl('line',{x1:origin.x,y1:origin.y,x2:origin.x+(pt.x-origin.x)*phase,y2:origin.y+(pt.y-origin.y)*phase,
        class:'neural-semantic-beam','stroke-width':(.5+sim*5).toFixed(2),'stroke-opacity':(.12+.84*sim).toFixed(3)});
      const title=svgEl('title');title.textContent='真实 Embedding 余弦相似度 '+m.similarity.toFixed(3)+'（与屏幕距离无关）';beam.appendChild(title);
      group.appendChild(beam);
    }
    const anchor=svgEl('circle',{cx:origin.x,cy:origin.y,r:Math.max(6,10*origin.scale),class:'neural-query-anchor'});
    const hint=svgEl('title');hint.textContent='当前搜索词的真实本地查询向量 · PCA 三维位置';anchor.appendChild(hint);group.appendChild(anchor);
  };
  const animateSemanticQuery=version=>{
    neuralAnimationProgress=neuralQueryReady?0:1;
    const label=$('neural-query-stage');
    if(!neuralQueryReady){label.textContent='关键词匹配（未生成可用的本地查询向量；没有语义关联线）';renderSemanticConnections();return}
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||typeof requestAnimationFrame!=='function'){
      neuralAnimationProgress=1;label.textContent='查询词 → 本地 Embedding → PCA 投影 → 高维余弦相似度关联';renderSemanticConnections();return;
    }
    const start=performance.now();
    const tick=at=>{
      if(version!==neuralRequestVersion)return;
      neuralAnimationProgress=Math.min(1,(at-start)/1450);
      label.textContent=neuralAnimationProgress<.18?'查询词 → 本地 Embedding 已完成':neuralAnimationProgress<.40?'查询向量 → 投入 PCA 三维空间':
        neuralAnimationProgress<1?'语义信号 → 按真实余弦相似度点亮命中记忆':'高维语义关联已显示（线粗／亮＝余弦分数，与空间距离无关）';
      renderSemanticConnections();
      if(neuralAnimationProgress<1)requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  };
  const renderNeuralScene=()=>{
    const edges=$('neural-memory-edges'),nodes=$('neural-memory-nodes');
    edges.replaceChildren();nodes.replaceChildren();neuralScene.positions.clear();
    const shown=neuralVisibleNodes(),large=shown.length>400;
    neuralViewport.classList.toggle('is-canvas',large);
    const projected=shown.map((m,i)=>({m,pt:neuralPoint(neuralPositionOf(m,i,shown.length))})).sort((a,b)=>a.pt.z-b.pt.z);
    for(const {m,pt} of projected)neuralScene.positions.set(m.id,pt);
    const selectedEdges=neuralEdges.filter(e=>neuralScene.positions.has(e.from)&&neuralScene.positions.has(e.to));
    const count={interest:0,relationship:0,source:0};
    for(const e of selectedEdges)if(e.type in count)count[e.type]++;
    for(const type of Object.keys(count)){
      const el=$('neural-'+type+'-edge-count');if(el)el.textContent='('+count[type]+')';
      const toggle=$('neural-show-'+type);
      if(toggle)toggle.title=count[type]?'这批记忆里有 '+count[type]+' 条经来源验证的连线':'当前可见节点没有此类来源交集，无法绘制';
    }
    $('neural-evidence-explanation').textContent=selectedEdges.length
      ?`当前视图有 ${selectedEdges.length} 条可信来源连线；勾选会控制相应连线，不会凭主题相似创造新证据。`
      :'当前节点之间没有可核验的共享来源，因此三种连线开关暂时不会改变画面；这不是绘制故障。';
    const showType={interest:$('neural-show-interest').checked,relationship:$('neural-show-relationship').checked,source:$('neural-show-source').checked};
    if(large){
      const ctx=neuralCanvas.getContext?.('2d');if(!ctx)return;
      const rect=neuralViewport.getBoundingClientRect(),dpr=Math.min(3,Math.max(1,window.devicePixelRatio||1));
      const width=Math.max(1,Math.round(rect.width)),height=Math.max(1,Math.round(rect.height));
      if(neuralCanvas.width!==Math.round(width*dpr))neuralCanvas.width=Math.round(width*dpr);
      if(neuralCanvas.height!==Math.round(height*dpr))neuralCanvas.height=Math.round(height*dpr);
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,neuralCanvas.width,neuralCanvas.height);
      const geometry=neuralViewportGeometry(width,height);
      ctx.setTransform(dpr*geometry.scale,0,0,dpr*geometry.scale,dpr*geometry.offsetX,dpr*geometry.offsetY);
      const edgeColors={interest:'#2a9b7c',relationship:'#ca85b3',source:'#789bb6'};
      for(const e of selectedEdges){
        if(!showType[e.type])continue;
        const a=neuralScene.positions.get(e.from),b=neuralScene.positions.get(e.to);
        if(!a||!b)continue;
        ctx.strokeStyle=edgeColors[e.type]||'#8fa1b5';ctx.globalAlpha=.4;
        ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
      const nodeColors={experience:'#3688cf',relationship:'#ca70a7',interest:'#1f9c78',fact:'#d6a04a'};
      const showSheen=projected.length<=2500;
      for(const {m,pt} of projected){
        const active=m.id===neuralSelected,hit=m.matched!==false;
        const opacity=hit?neuralClarityOpacity(m.clarity):.085;
        const radius=Math.max(3.5,Math.min(7.8,5.1*pt.scale));
        ctx.globalAlpha=opacity;ctx.fillStyle=hit?(nodeColors[m.kind]||'#3688cf'):'#8393a7';
        ctx.beginPath();ctx.arc(pt.x,pt.y,radius,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=hit?Math.min(.88,opacity*.9):.12;
        ctx.strokeStyle=hit?'#eef8ff':'#d9e0e8';ctx.lineWidth=.95;ctx.stroke();
        if(hit&&(showSheen||active)){
          ctx.globalAlpha=opacity*.68;ctx.fillStyle='#ffffff';ctx.beginPath();
          ctx.arc(pt.x-radius*.24,pt.y-radius*.27,Math.max(.8,radius*.22),0,Math.PI*2);ctx.fill();
        }
        if(active){
          ctx.globalAlpha=.9;ctx.strokeStyle='#176eaa';ctx.lineWidth=2.2;ctx.beginPath();
          ctx.arc(pt.x,pt.y,radius+3.2,0,Math.PI*2);ctx.stroke();
          ctx.globalAlpha=1;ctx.font='600 13px sans-serif';ctx.fillStyle='#23658f';
          ctx.fillText(String(m.title||'').slice(0,22),pt.x+radius+10,pt.y-9);
        }
        if(hit&&m.emotion&&$('neural-show-emotion').checked){ctx.globalAlpha=opacity*.85;ctx.fillStyle='#9467cc';ctx.beginPath();ctx.arc(pt.x+radius+4,pt.y-radius-4,2.4,0,Math.PI*2);ctx.fill()}
      }
      ctx.globalAlpha=1;renderSemanticConnections();return;
    }
    for(const e of selectedEdges){
      if(!showType[e.type])continue;
      const a=neuralScene.positions.get(e.from),b=neuralScene.positions.get(e.to);
      edges.appendChild(svgEl('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'neural-edge','data-type':e.type,
        'stroke-opacity':Math.max(.15,.55+(a.z+b.z)*.05)}));
    }
    for(const {m,pt} of projected){
      const hit=m.matched!==false;
      const g=svgEl('g',{class:'neural-node',tabindex:0,role:'button','aria-label':'查看回忆：'+m.title,
        'data-node-id':m.id,'data-active':String(m.id===neuralSelected),'data-matched':String(hit),'data-clarity':m.clarity||'unmarked'});
      const radius=Math.max(4,Math.min(11,5.5*pt.scale));
      g.appendChild(svgEl('circle',{class:'neural-dot',cx:pt.x,cy:pt.y,r:radius,
        fill:hit?(neuralKindColor[m.kind]||'var(--neural-exp)'):'var(--muted)',
        opacity:hit?Math.min(1,Math.max(.22,neuralClarityOpacity(m.clarity)*(.94+pt.z*.035))):.12}));
      if(hit)g.appendChild(svgEl('circle',{class:'neural-sheen',cx:pt.x-radius*.24,cy:pt.y-radius*.27,
        r:Math.max(.8,radius*.22),opacity:(neuralClarityOpacity(m.clarity)*.68).toFixed(2)}));
      const tip=svgEl('title');tip.textContent=m.title+' · '+(hit?'检索命中':'当前检索未命中')+' · '+({clear:'清晰',fuzzy:'模糊',trace:'印象',unmarked:'衰减未标注'}[m.clarity]||'衰减未标注');g.appendChild(tip);
      if(m.id===neuralSelected&&hit){const label=svgEl('text',{x:pt.x,y:pt.y+radius+15});label.textContent=String(m.title||'').slice(0,12);g.appendChild(label)}
      g.addEventListener('click',()=>{if(!neuralScene.moved)neuralDetail(m.id)});
      g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();neuralDetail(m.id)}});
      nodes.appendChild(g);
      if(hit&&m.emotion&&$('neural-show-emotion').checked){
        const x=pt.x+radius+14,y=pt.y-radius-15;
        edges.appendChild(svgEl('line',{x1:pt.x,y1:pt.y,x2:x,y2:y,class:'neural-emotion-link'}));
        const echo=svgEl('circle',{cx:x,cy:y,r:6,class:'neural-emotion-echo'});
        const note=svgEl('title');note.textContent='当时的情绪观察：'+m.emotion;echo.appendChild(note);nodes.appendChild(echo);
      }
    }
    renderSemanticConnections();
  };
  const drawNeuralMemory=()=>{
    const results=$('neural-memory-results');results.replaceChildren();
    const visible=neuralVisibleNodes(),hits=visible.filter(m=>m.matched!==false).sort((a,b)=>(Number(b.relevanceScore)||0)-(Number(a.relevanceScore)||0));
    // Result cards are an accessible window into the graph, not a second
    // unbounded 10k-element DOM. Canvas clicks still access ALL node details.
    const listed=(hits.length?hits:(!$('main-session-history-query').value.trim()?visible:[])).slice(0,120);
    for(const [i,m] of listed.entries()){
      const btn=node('button','','neural-memory-result');btn.type='button';btn.dataset.nodeId=m.id;
      btn.setAttribute('aria-pressed',String(neuralSelected===m.id));
      btn.append(node('strong',m.title),node('small',(neuralKindTitle[m.kind]||'记忆')+' · '+(m.source||'证据来源')+
        (Number.isFinite(m.similarity)?' · 余弦 '+m.similarity.toFixed(3):'')));
      if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)btn.style.animationDelay=Math.min(450,i*16)+'ms';
      btn.addEventListener('click',()=>neuralDetail(m.id));results.appendChild(btn);
    }
    if(hits.length>120)results.append(info('结果列表先显示前 120 个命中；三维图中仍可选择其余节点。'));
    renderNeuralScene();
    if(!hits.length){
      results.append(info(visible.length?'没有与关键词匹配的回忆；其余仍作为暗色背景。':'当前没有可显示的可回忆记录。'));
      $('neural-memory-detail').textContent='没有证据支持的匹配结果，不会编造记忆。';
    }else neuralDetail(hits.some(m=>m.id===neuralSelected)?neuralSelected:hits[0].id);
  };
  const focusNeuralHits=version=>{
    const q=$('main-session-history-query').value.trim();
    if(!q||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const hits=neuralVisibleNodes().filter(m=>m.matched!==false).sort((a,b)=>(Number(b.relevanceScore)||0)-(Number(a.relevanceScore)||0)).slice(0,120);
    if(!hits.length)return;
    const points=hits.map(m=>m.position&&['x','y','z'].every(k=>Number.isFinite(m.position[k]))?m.position:neuralFallback(m,neuralNodes.indexOf(m),neuralNodes.length));
    const average=key=>points.reduce((sum,p)=>sum+p[key],0)/points.length;
    const target={x:average('x'),y:average('y'),z:average('z')};
    const spread=Math.max(.2,...points.map(p=>Math.hypot(p.x-target.x,p.y-target.y,p.z-target.z)));
    const zoom=Math.max(1.25,Math.min(3.8,2.3/Math.max(.35,spread)));
    const from={...neuralScene.focus,zoom:neuralScene.zoom},started=performance.now();
    neuralViewport.classList.add('is-focusing');neuralScene.focusToken++;
    const token=neuralScene.focusToken;
    const step=at=>{
      if(version!==neuralRequestVersion||token!==neuralScene.focusToken){neuralViewport.classList.remove('is-focusing');return}
      const t=Math.min(1,(at-started)/850),e=t*t*(3-2*t);
      for(const k of ['x','y','z'])neuralScene.focus[k]=from[k]+(target[k]-from[k])*e;
      neuralScene.zoom=from.zoom+(zoom-from.zoom)*e;
      renderNeuralScene();
      if(t<1)requestAnimationFrame(step);else neuralViewport.classList.remove('is-focusing');
    };
    requestAnimationFrame(step);
  };
  const animateNeuralSignal=version=>{
    const group=$('neural-memory-signals');group.replaceChildren();
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||!neuralNodes.length||neuralVisibleNodes().length>400||typeof requestAnimationFrame!=='function')return;
    const dots=neuralVisibleNodes().filter(m=>m.matched!==false).slice(0,12).map(m=>{
      const c=svgEl('circle',{r:4,class:'neural-signal',cx:500,cy:285});group.appendChild(c);
      return {c,id:m.id};
    });
    const start=performance.now(),tick=at=>{
      if(version!==neuralRequestVersion){group.replaceChildren();return}
      let active=false;
      dots.forEach(({c,id},i)=>{
        const p=Math.min(1,Math.max(0,(at-start-i*42)/680));
        if(p<1)active=true;
        const target=neuralScene.positions.get(id);
        if(!target)return;
        const smooth=p*p*(3-2*p);
        c.setAttribute('cx',500+(target.x-500)*smooth);
        c.setAttribute('cy',285+(target.y-285)*smooth);
        c.setAttribute('opacity',p>=1?'0':'1');
      });
      if(active)requestAnimationFrame(tick);else group.replaceChildren();
    };requestAnimationFrame(tick);
  };
  const sceneSVG=neuralViewport;
  sceneSVG.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==2)return;
    if(e.target.closest?.('button'))return;
    neuralScene.dragMode=e.button===2?'pan':'rotate';
    neuralScene.dragging=true;neuralScene.moved=false;neuralScene.pointer=e.pointerId;
    neuralScene.lastX=e.clientX;neuralScene.lastY=e.clientY;
    sceneSVG.classList.add('is-dragging');
  });
  sceneSVG.addEventListener('pointermove',e=>{
    if(!neuralScene.dragging||neuralScene.pointer!==e.pointerId)return;
    const dx=e.clientX-neuralScene.lastX,dy=e.clientY-neuralScene.lastY;
    if(Math.abs(dx)+Math.abs(dy)>2)neuralScene.moved=true;
    neuralScene.lastX=e.clientX;neuralScene.lastY=e.clientY;
    if(!neuralScene.moved)return;
    if(!sceneSVG.hasPointerCapture?.(e.pointerId))try{sceneSVG.setPointerCapture?.(e.pointerId)}catch{}
    if(neuralScene.dragMode==='pan'){
      const rect=sceneSVG.getBoundingClientRect(),geometry=neuralViewportGeometry(rect.width,rect.height);
      neuralScene.panX+=dx/geometry.scale;neuralScene.panY+=dy/geometry.scale;
    }else{neuralScene.yaw+=dx*.008;neuralScene.pitch+=dy*.008;}
    renderNeuralScene();
  });
  const stopNeuralDrag=e=>{
    if(e.pointerId!==neuralScene.pointer)return;
    neuralScene.dragging=false;neuralScene.pointer=null;sceneSVG.classList.remove('is-dragging');
    try{sceneSVG.releasePointerCapture?.(e.pointerId)}catch{}
    // Delay reset until after the synthetic click generated by pointerup.
    if(neuralScene.moved)setTimeout(()=>{neuralScene.moved=false},0);
  };
  sceneSVG.addEventListener('contextmenu',e=>e.preventDefault());
  sceneSVG.addEventListener('pointerup',stopNeuralDrag);
  sceneSVG.addEventListener('pointercancel',stopNeuralDrag);
  sceneSVG.addEventListener('wheel',e=>{
    e.preventDefault();
    neuralScene.zoom=Math.max(.42,Math.min(4.2,neuralScene.zoom*Math.exp(-Math.max(-180,Math.min(180,e.deltaY))*.0014)));
    renderNeuralScene();
  },{passive:false});
  sceneSVG.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){
      e.preventDefault();
      if(e.key==='ArrowLeft')neuralScene.yaw-=.16;
      if(e.key==='ArrowRight')neuralScene.yaw+=.16;
      if(e.key==='ArrowUp')neuralScene.pitch-=.16;
      if(e.key==='ArrowDown')neuralScene.pitch+=.16;
      if(e.key==='+')neuralScene.zoom=Math.min(4.2,neuralScene.zoom*1.15);
      if(e.key==='-')neuralScene.zoom=Math.max(.42,neuralScene.zoom/1.15);
      renderNeuralScene();
    }
  });
  $('neural-memory-reset').addEventListener('click',()=>{
    neuralScene.focusToken++;neuralScene.yaw=-.28;neuralScene.pitch=.18;neuralScene.zoom=1;neuralScene.panX=0;neuralScene.panY=0;neuralScene.focus={x:0,y:0,z:0};renderNeuralScene();
  });
  sceneSVG.addEventListener('click',event=>{
    if(!neuralViewport.classList.contains('is-canvas')||neuralScene.moved||event.target.closest?.('button'))return;
    const rect=sceneSVG.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const geometry=neuralViewportGeometry(rect.width,rect.height);
    const x=(event.clientX-rect.left-geometry.offsetX)/geometry.scale;
    const y=(event.clientY-rect.top-geometry.offsetY)/geometry.scale;
    let best=null,distance=Infinity;
    for(const m of neuralVisibleNodes()){
      const pt=neuralScene.positions.get(m.id);if(!pt)continue;
      const d=(pt.x-x)**2+(pt.y-y)**2;
      if(d<distance){best=m;distance=d}
    }
    if(best&&distance<18*18){
      neuralDetail(best.id);
      // The selected node can be outside the 120-card results window; the
      // detail pane still displays its actual record and stays focused.
    }
  });
  window.addEventListener?.('resize',()=>{if(neuralNodes.length)renderNeuralScene()});
  const neuralBoard=document.querySelector('#panel-life .neural-recall-board');
  const neuralFullButton=$('neural-memory-fullscreen');
  const syncNeuralFull=()=>{
    const isFull=neuralBoard.classList.contains('is-expanded')||document.fullscreenElement===neuralBoard;
    neuralFullButton.setAttribute('aria-pressed',String(isFull));
    neuralFullButton.textContent=isFull?'⤡ 退出全屏':'⛶ 全屏展开';
    neuralFullButton.setAttribute('aria-label',isFull?'退出神经回忆场全屏':'全屏打开神经回忆场');
  };
  neuralFullButton.addEventListener('click',async()=>{
    const full=neuralBoard.classList.contains('is-expanded')||document.fullscreenElement===neuralBoard;
    if(full){
      neuralBoard.classList.remove('is-expanded');
      if(document.fullscreenElement===neuralBoard&&document.exitFullscreen)try{await document.exitFullscreen()}catch{}
    }else{
      if(neuralBoard.requestFullscreen)try{await neuralBoard.requestFullscreen()}catch{neuralBoard.classList.add('is-expanded')}
      else neuralBoard.classList.add('is-expanded');
    }
    syncNeuralFull();
  });
  document.addEventListener('fullscreenchange',syncNeuralFull);
  // A lexical fallback is still available in the ordinary memory list,
  // but the neural graph/search itself must not pretend to be semantic.
  const syncNeuralEmbeddingMask=(ready,reason='')=>{
    const mask=$('neural-embedding-mask');if(!mask)return;
    mask.hidden=ready===true;
    $('neural-search-input').disabled=ready!==true;
    $('neural-search-apply').disabled=ready!==true;
    if(!ready)$('neural-embedding-mask-hint').textContent=reason||'请先在 AI 模型设置中启用并完成本地 Embedding 索引；普通记忆列表及本地关键词检索仍可使用。';
  };
  const searchInsideNeural=()=>{
    if(!localEmbeddingEnabled)return;
    $('main-session-history-query').value=$('neural-search-input').value.slice(0,120);
    run(renderNeuralMemory);
  };
  $('neural-search-apply').addEventListener('click',searchInsideNeural);
  $('neural-search-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchInsideNeural()}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&neuralBoard.classList.contains('is-expanded')){neuralBoard.classList.remove('is-expanded');syncNeuralFull()}
  });
  const renderNeuralMemory=async()=>{
    const version=++neuralRequestVersion,q=$('main-session-history-query').value.trim(),kind=$('main-memory-kind').value;
    if(!localEmbeddingEnabled){return}
    if(document.activeElement!==$('neural-search-input'))$('neural-search-input').value=q;
    neuralQueryReady=false;neuralQueryPosition=null;neuralAnimationProgress=1;renderSemanticConnections();
    $('neural-query-stage').textContent=q?'正在核验是否有本地查询向量…':'输入关键词可唤起真实回忆';
    const limit=$('neural-node-limit').value;
    $('neural-memory-status').textContent='正在整理当前可回忆节点（不读取封存档案，也不会访问 B站）…';
    $('neural-memory-count').textContent='读取中';
    try{
      const data=await request('/main-session/memory/neural?'+new URLSearchParams({q,kind,limit}).toString());
      if(version!==neuralRequestVersion)return;
      if(data.semanticSearch?.ready!==true){
        syncNeuralEmbeddingMask(false,'已安装的本地模型暂时无法执行语义搜索，请核对运行时和索引状态。');
        return;
      }
      syncNeuralEmbeddingMask(true);
      neuralNodes=Array.isArray(data.nodes)?data.nodes:[];neuralEdges=Array.isArray(data.edges)?data.edges:[];neuralSelected='';
      neuralQueryPosition=data.layout?.queryPosition||null;neuralQueryReady=data.semanticSearch?.queryEmbedded===true&&!!neuralQueryPosition;
      neuralLayoutMode=data.layout?.mode==='embedding-pca-3d'?'embedding-pca-3d':'structured';
      const indexed=Number(data.layout?.matched)||0;
      $('neural-layout-mode').textContent=neuralLayoutMode==='embedding-pca-3d'?'语义回忆 · 自然聚集':'回忆关系 · 相互连接';
      $('neural-layout-mode').title=neuralLayoutMode==='embedding-pca-3d'?`本地向量投影：${indexed}/${neuralNodes.length} 条可用于布局`:'当前没有完整的语义坐标，以真实关系结构展示；位置不表示记忆好坏';
      drawNeuralMemory();
      const hits=Number(data.matched??neuralNodes.filter(m=>m.matched!==false).length);
      $('neural-memory-count').textContent=`${neuralVisibleNodes().length} 个可见 / ${neuralNodes.length} 个真实节点`;
      $('neural-memory-status').textContent=`眼前有 ${neuralVisibleNodes().length} 个可见记忆点（总计 ${neuralNodes.length} 个）${q?'，与搜索有关的 '+hits+' 个':''}${data.truncated?' · 只显示其中一部分':''}。点击点点可以看看具体记忆。`;
      $('neural-memory-status').title=`地图展示 ${neuralEdges.length} 条可信关系连线；${data.semanticSearch?.ready?'可使用本地语义检索':'目前按关键词检索'}。图上位置只是布局，不代表记忆重要程度。`;
      if(q){focusNeuralHits(version);animateSemanticQuery(version)}else animateNeuralSignal(version);
    }catch(e){
      if(version!==neuralRequestVersion)return;
      neuralNodes=[];neuralEdges=[];neuralLayoutMode='structured';neuralQueryReady=false;neuralQueryPosition=null;drawNeuralMemory();
      $('neural-query-stage').textContent='查询失败：没有生成语义关联';
      $('neural-memory-count').textContent='暂不可用';
      $('neural-memory-status').textContent='暂时没能打开回忆地图，下方的记忆列表仍可使用；需要排查时请打开运行诊断。';
    }
  };
  for(const id of ['neural-show-interest','neural-show-relationship','neural-show-source','neural-show-emotion'])
    $(id).addEventListener('change',renderNeuralScene);
  $('neural-show-all').addEventListener('change',drawNeuralMemory);
  for(const kind of neuralCategories)$('neural-filter-'+kind).addEventListener('change',drawNeuralMemory);
  $('neural-node-limit').addEventListener('change',()=>run(renderNeuralMemory));
  const renderFadingMemoryStats=async()=>{
    try{
      const x=await request('/life-memory/status');
      if(x.ok!==true)throw Error('memory unavailable');
      $('neural-fading-total').textContent='衰减副本 '+Number(x.total||0);
      $('neural-fading-new').textContent='今日新增 '+Number(x.todayAdded||0);
      $('neural-fading-forgot').textContent='今日遗忘 '+Number(x.todayForgotten||0);
      $('neural-memory-stats').title='来自可衰减经历账本，不是图上的节点数。今日遗忘只计实际记录的当天衰减事件，历史未知不补算。';
    }catch{
      for(const [id,txt] of [['neural-fading-total','衰减副本 · 暂不可用'],['neural-fading-new','今日新增 · 未知'],['neural-fading-forgot','今日遗忘 · 未知']])$(id).textContent=txt;
    }
  };
  const renderMainSessionHistory=async(override=null,searchMode='')=>{
    const q=$('main-session-history-query').value.trim();
    const data=override===null?await request('/main-session/history?'+new URLSearchParams({q,limit:'30'}).toString()):{rows:override};
    gardenEpisodes=Array.isArray(data.rows)?data.rows:[];gardenRoute=searchMode||'本地检索';
    paintMemoryGarden();
    await renderFadingMemoryStats();
  };
  const renderLifeReflection=async()=>{
    const data=await request('/main-session/reflection?'+new URLSearchParams({status:'pending',limit:'40'}).toString());
    const last=data.lastReflectionAt?formatLocalTime(data.lastReflectionAt):'暂无';
    $('memory-reflection-short').textContent=`${data.pending||0} 条待整理 · 最近 ${last}`;
    const recentFail=data.recentFailure;
    const lastPublic=data.recentPublicRun;
    const publicResult=lastPublic?` · 上次公开反思：${formatLocalTime(lastPublic.at)}，人格模型候选 ${lastPublic.personalityProposed||0} 条、采纳 ${lastPublic.personalityAccepted||0} 条；可验证探索与社交观察 ${lastPublic.personalityObserved||0} 条（弱证据，不是稳定人格）${lastPublic.personalityEnabled?'':'（当时未开启人格成长）'}`:'';
    const reflectionDiagnoses={'model-no-insight':'模型完成分析，但未提出值得长期保存的认识（正常情况下可能为零）','quality-rejected':'模型提出了认识，但未通过严格质量校验','not-committed':'候选通过校验，但未新增长期认识（请查看存储计数）','duplicate-no-new-memory':'已有相同长期认识，不重复新增','source-forgotten':'原始经历已自然遗忘，未调用模型','created':'已新增长期认识'};
    const recentRun=data.recentRunSummary;
    const counts=recentRun?` · 最近批次 [${recentRun.status==='error'?'失败':'已评估'}]：候选 ${recentRun.candidates||0}、选中 ${recentRun.selected||0}、实际送模型 ${recentRun.modelInput||0}、模型提案 ${recentRun.memoryProposed||0}、质量通过 ${recentRun.qualityAccepted||0}、质量拒绝 ${recentRun.qualityRejected||0}、存储去重 ${recentRun.storageDuplicates||0}、未写入 ${recentRun.storageRejected||0}、最终新增 ${recentRun.created||0}${recentRun.failureCode?' · 技术原因 '+recentRun.failureCode:''}`:'';
    const diagnosticResult=lastPublic?.diagnosis?' · 最近公开反思产出判断：'+(reflectionDiagnoses[lastPublic.diagnosis]||'请查看诊断'):'';
    const failureResult=recentFail?` · 最近一次技术失败：${formatLocalTime(recentFail.at)}，${String(recentFail.error||'未知原因').slice(0,160)}`:'';
    const reflectionReadyNotes={interval:'等待反思冷却', 'daily-limit':'今日反思次数已用完',
      'not-enough-or-backoff':'有效经历未成批或失败重试等待中', manual:'自动反思关闭',disabled:'长期记忆关闭',busy:'反思执行中'}
    const availability=data.canAutoReflect===true?' · 当前可自动反思':data.canAutoReflect===false?' · 暂不可自动反思：'+(reflectionReadyNotes[data.autoReflectBlockedReason]||'等待执行条件') :''
    $('main-reflection-status').textContent=`待反思 ${data.pending||0} 条（技术失败重试 ${data.retrying||0}，自动暂停 ${data.retryPaused||0}） · 已关联长期记忆 ${data.reflected||0} 条经历 · 累计评估后未沉淀 ${data.reviewedNoMemory??data.reviewed??0} 条 · 因经历已遗忘跳过 ${data.forgotten||0} 条 · 今日自动 ${data.runsToday||0}/${data.dailyLimit||16} 批（失败 ${data.failedRunsToday||0}）+ 手动 ${data.manualRunsToday||0} 批${availability} · 上次 ${last}${data.lastError?' · 最近错误：'+data.lastError:''}${publicResult}${counts}${diagnosticResult}${failureResult}`;
    const target=$('main-reflection-list');target.replaceChildren();
    for(const e of data.rows||[]){const card=node('article','','record');const retry=e.retryCount?` · 技术失败 ${e.retryCount}/5 次${e.retryPaused?' · 自动重试已暂停':e.nextRetryAt?' · 下次重试 '+formatLocalTime(e.nextRetryAt):''}${e.lastError?' · '+e.lastError:''}`:'';add(card,node('div',e.kind==='watch'?'待反思 · 刷到的视频':'待反思 · '+(e.reply?'评论回复':'顶层评论'),'title-line'),info(`${formatLocalTime(e.time||e.day||e.createdAt)} · ${e.summary||''}${retry}`));target.appendChild(card)}
    if(!target.children.length)target.append(info('目前没有待反思候选。精确经历仍会留在本地档案，不代表发生过的事情被删除。'));
  };
  const renderEmbeddingStatus=async()=>{
    const data=await request('/embedding/status'),phase=String(data.progress?.phase||'missing'),index=data.index||{},busy=['preparing','downloading','extracting-runtime','starting-runtime','importing-model','indexing','syncing','updating'].includes(phase)||['indexing','syncing','updating'].includes(index.phase)
    const phaseLabel={missing:'尚未安装',preparing:'正在准备安装',downloading:'正在下载','extracting-runtime':'正在解压本地运行时','starting-runtime':'正在加载本地模型',ready:'本地模型运行中',stopped:'本地模型已暂停',cancelled:'安装已取消','model-imported':'模型文件已导入','importing-model':'正在导入模型',error:'安装或运行失败'}
    const indexLabel=index.ready?`向量索引 ${index.indexed||0} 条，已就绪`:index.phase==='indexing'?`正在建立向量索引 ${index.processed||0}/${index.total||0}`:index.phase==='syncing'?`正在同步索引 ${index.processed||0}/${index.total||0}`:index.phase==='updating'?`正在补充新记忆向量 ${index.processed||0}/${index.total||0}`:index.phase==='error'?'索引建立失败':'向量索引尚未就绪'
    const server=data.server?.ready===true,model=data.model?.installed===true,runtime=data.runtime?.installed===true
    localEmbeddingEnabled=data.enabled===true&&server&&index.ready===true
    const embeddingReason=!model?'尚未安装本地 Embedding 模型。':
      !data.enabled?'本地 Embedding 已安装，但语义功能处于暂停状态；可在下面点击启动。':
      !server?'本地 Embedding 已安装，运行时尚未就绪；请检查启动状态。':
      !index.ready?'模型运行中，向量索引仍在建立或同步；等待就绪后即可使用。':'';
    syncNeuralEmbeddingMask(localEmbeddingEnabled,embeddingReason);
    const maskTitle=$('neural-embedding-mask')?.querySelector('strong');if(maskTitle)maskTitle.textContent=!model?'🔒 本地语义回忆尚未安装':!data.enabled?'⏸ 模型已安装，语义功能已暂停':!server?'⏳ 模型已安装，等待运行时就绪':'⏳ 正在准备语义索引'
    $('embedding-status').textContent=`${data.enabled?'语义回忆已启用':'语义回忆未启用'} · ${server?'本地模型运行中':'模型 '+(model?'已安装':'未安装')+' · 运行时 '+(runtime?'已安装':'未安装')} · ${indexLabel}${data.progress?.lastError?' · '+String(data.progress.lastError).slice(0,140):index.lastError?' · '+String(index.lastError).slice(0,140):''}${data.supported?'':' · 当前平台暂不支持自动安装'}`
    const indexBusy=['indexing','syncing','updating'].includes(index.phase),percent=indexBusy?Number(index.percent)||0:Number(data.progress?.percent)||0
    // Completed jobs have no ongoing installation progress. Show it only while
    // actively installing or indexing, not forever under a ready status.
    $('embedding-progress').parentElement.hidden=!busy
    $('embedding-progress').value=busy?Math.max(0,Math.min(100,percent)):0
    const bytes=Number(data.progress?.downloadedBytes)||0,total=Number(data.progress?.totalBytes)||0
    const sizeText=total?`${(bytes/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`:`${(bytes/1048576).toFixed(1)} MB`
    $('embedding-progress-label').textContent=indexBusy?`${indexLabel} · ${percent}%`:phase==='downloading'?`${phaseLabel[phase]||phase} ${sizeText} · ${percent}%`:phaseLabel[phase]||phase
    if($('quick-embedding-status')){
      $('quick-embedding-status').textContent=data.enabled&&server&&index.ready?'✓ 本地语义回忆已启用，可正常使用':
        busy?'正在安装或建立索引：'+(phaseLabel[phase]||indexLabel):
        model&&runtime?'模型已在本机，点击启动即可使用':
        data.supported?'尚未安装；推荐安装，也可以跳过，不影响其他设置':'当前设备不支持自动安装，仍可使用词法回忆'
      $('quick-embedding-progress').hidden=!busy
      $('quick-embedding-progress').value=busy?Math.max(0,Math.min(100,percent)):0
      $('quick-embedding-install').disabled=!data.supported||busy
      $('quick-embedding-install').textContent=server?'重新检查本地模型':model&&runtime?'启动本地语义回忆':'推荐 · 启用并安装本地语义回忆'
    }
    $('embedding-install').disabled=!data.supported||busy
    $('embedding-install').textContent=server?'重新检查本地模型':model&&runtime?'启动本地语义回忆':'启用并下载模型'
    $('embedding-cancel').disabled=!['preparing','downloading','extracting-runtime','starting-runtime'].includes(phase)
    $('embedding-disable').disabled=!data.enabled&&!server
    $('embedding-rebuild').disabled=!server||indexBusy
    $('embedding-delete').disabled=!model&&!runtime&&!index.ready&&!(Number(index.indexed)||0)
    $('embedding-import').disabled=!data.supported||busy
    return data
  }
  const pollEmbeddingStatus=()=>{
    clearInterval(embeddingPollTimer)
    embeddingPollTimer=setInterval(async()=>{
      try{const data=await renderEmbeddingStatus(),phase=String(data.progress?.phase||''),indexPhase=String(data.index?.phase||'')
        const busy=['preparing','downloading','extracting-runtime','starting-runtime','importing-model'].includes(phase)||['indexing','syncing','updating'].includes(indexPhase)
        if(!busy){clearInterval(embeddingPollTimer);embeddingPollTimer=null}
      }catch{clearInterval(embeddingPollTimer);embeddingPollTimer=null}
    },1800)
  }
  const renderLongMemory=async(override=null)=>{
    const q=$('main-memory-query').value.trim();const data=await request('/main-session/memory?'+new URLSearchParams({q,limit:'100'}).toString());
    if(override!==null)data.rows=override;
    $('main-memory-half-life').value=String(data.policy?.baseHalfLifeDays??30);$('main-memory-threshold').value=String(data.policy?.threshold??0.35);
    $('main-memory-max-items').value=String(data.policy?.maxItems??6);$('main-memory-max-chars').value=String(data.policy?.maxChars??800);$('main-memory-daily').value=String(data.policy?.dailyQuota??30);$('main-memory-facts').value=String(data.policy?.factsMax??2);
    const cfg=await request('/config');$('main-reflection-min').value=String(cfg.config?.mainSessionReflectionMinCandidates??6);$('main-reflection-batch').value=String(cfg.config?.mainSessionReflectionBatchSize??24);$('main-reflection-hours').value=String(cfg.config?.mainSessionReflectionIntervalHours??1);$('main-reflection-daily').value=String(cfg.config?.mainSessionReflectionDailyBatches??16);
    $('main-memory-semantic').checked=cfg.config?.mainSessionMemorySemanticEnabled===true;
    $('main-memory-consolidation-enabled').checked=cfg.config?.mainSessionMemoryConsolidationEnabled===true;
    const con=data.consolidation||{},dm=data.privateConversationMemory||{};
    const dmLast=dm.lastSummarizedAt?formatLocalTime(dm.lastSummarizedAt):'尚未成功整理';
    $('main-memory-consolidation-status').textContent=`${con.enabled?'自动整理已启用':'自动整理已关闭'} · 合格记忆 ${con.eligible||0} 条 · 同主题候选组 ${con.groups||0} 组 · 待补写 ${data.pendingCandidates||0} 条 · Life Memory 待同步 ${data.lifeCoordinator?.pending||0} 条 · 社交事件待补偿 ${data.socialCoordinator?.pending||0} 条 · 私信待提炼 ${dm.pendingSegments||0} 段（${dm.pendingMessages||0} 条消息） · 已生成衰减经历 ${dm.createdExperiences||0} 条 · 最近提炼 ${dmLast} · 模型空结果 ${dm.emptySummaries||0} 次 · 失败待重试 ${dm.modelFailures||0} 次${dm.expiredDropped?' · 过期丢弃 '+dm.expiredDropped+' 段':''}${dm.bufferRejected?' · 容量拒收 '+dm.bufferRejected+' 条':''}`;
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
    await renderEmbeddingStatus().catch(()=>{});
  };
  // One everyday search: what can she currently recall, and what insights remain?
  // Diagnostics is separate and intentionally never part of ordinary browsing.
  const searchFishMemory=async()=>{
    const query=$('main-session-history-query').value.trim();
    $('main-memory-query').value=query;
    // Browsing recent life remains free/local. Explicit searches may use the
    // existing low-cost memory selector, never a new provider or model route.
    const semantic=query.length>=2&&($('main-memory-semantic').checked||localEmbeddingEnabled);
    if(!semantic){await Promise.all([renderMainSessionHistory(),renderLongMemory()]);await renderNeuralMemory();return}
    try{
      $('main-session-history-status').textContent='正在从鱼鱼仍记得的经历和认识中查找…';
      const result=await request('/main-session/memory/recall',{query});
      const route=result.usedEmbedding?'本地 Embedding 语义回忆':result.reason==='semantic'?'低成本 AI 辅助搜索':result.reason==='fallback'?'模型不可用，已退回本地搜索':'本地词法搜索';
      await Promise.all([renderMainSessionHistory(result.episodes||[],route),renderLongMemory(result.memories||[]),renderNeuralMemory()]);
    }catch(e){
      await Promise.all([renderMainSessionHistory(),renderLongMemory(),renderNeuralMemory()]);
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
    for(const topic of core){const card=node('article','','interest-card interest-emerald');add(card,node('h4',topic,'interest-title'),node('span','主人设定','interest-badge'));coreTarget.appendChild(card)}
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
      const more=node('details','','interest-card-more');more.appendChild(node('summary','查看证据'));more.appendChild(description);
      add(card,header,summary,meter,more);
      const last=String(e.lastSeen||'').slice(0,10);
      if(last)more.appendChild(info('最近证据：'+last));
      const history=(e.history||[]).slice(-3).map(v=>`${String(v.at||'').slice(0,10)}：${interestStageInfo[v.to]?.label||v.to}`).join(' · ');
      if(history)more.appendChild(info('变化轨迹：'+history));
      target.appendChild(card);
    }
    if(!target.children.length){
      const empty=node('div','','interest-empty');
      add(empty,node('strong','还没有形成可展示的后天兴趣'),
        info('需要至少3个不同的真实入选BV，横跨至少2天。兴趣不会凭单次观看被认定，也不会自动覆盖核心人设。'));
      target.appendChild(empty);
    }
  };
  const ownerContactPresets={quiet:{start:10,end:20,cooldown:480,daily:1,silence:120},natural:{start:9,end:22,cooldown:240,daily:2,silence:45},lively:{start:8,end:23,cooldown:120,daily:4,silence:20}};
  const ownerContactFields={start:'owner-contact-start',end:'owner-contact-end',cooldown:'owner-contact-cooldown',daily:'owner-contact-daily',silence:'owner-contact-silence'};
  const ownerContactKeys={start:'ownerContactStartHour',end:'ownerContactEndHour',cooldown:'ownerContactCooldownMinutes',daily:'ownerContactDailyLimit',silence:'ownerContactSilenceMinutes'};
  const updateOwnerContactCards=()=>{
    const enabled=$('owner-spontaneous-chat-enabled').checked;
    $('owner-contact-options').disabled=!enabled;
    $('owner-contact-plan-section').setAttribute('aria-disabled',String(!enabled));
    const picked=selectedChoice('owner-contact-choice')||'natural';
    $('owner-contact-custom').hidden=picked!=='custom';
    const values=ownerContactPresets[picked];
    if(values)for(const [key,id] of Object.entries(ownerContactFields))$(id).value=String(values[key]);
    $('owner-contact-status').textContent='联系策略：'+({quiet:'安静陪伴',natural:'自然相处',lively:'积极交流',custom:'自己设定'}[picked]||'自然相处')+' · '+(enabled?'已开放考虑联系，肥鱼仍可保持沉默':'当前未开放主动联系；请先启用上方总开关');
  };
  $('owner-spontaneous-chat-enabled').addEventListener('change',updateOwnerContactCards);
  document.querySelectorAll('input[name="owner-contact-choice"]').forEach(r=>r.addEventListener('change',updateOwnerContactCards));
  for(const id of Object.values(ownerContactFields))$(id).addEventListener('input',()=>{
    setChoice('owner-contact-choice','custom');$('owner-contact-custom').hidden=false;
  });
  const loadMainSession=async({setupOnly=false}={})=>{
    const data=await request('/main-session'),c=data.config||{};
    const contactConfig=(await request('/config')).config||{};
    const contactPreset=['quiet','natural','lively','custom'].includes(contactConfig.ownerContactPreset)?contactConfig.ownerContactPreset:'natural';
    setChoice('owner-contact-choice',contactPreset);
    $('main-session-silence-enabled').checked=contactConfig.mainSessionSilenceFollowupEnabled===true;
    $('owner-dm-silence-enabled').checked=contactConfig.ownerDmSilenceFollowupEnabled===true;
    if(contactPreset==='custom')for(const [key,id] of Object.entries(ownerContactFields)){
      const raw=contactConfig[ownerContactKeys[key]];if(Number.isSafeInteger(raw))$(id).value=String(raw);
    }
    $('main-session-enabled').checked=c.enabled===true;$('owner-spontaneous-chat-enabled').checked=contactConfig.ownerSpontaneousChatEnabled!==false;
    updateOwnerContactCards();$('main-session-auto').checked=c.auto!==false;$('main-session-minutes').value=String(c.minutes??60);
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
  // One-off sender approval is intentionally not exposed: Life decides every message.
  // No fixed default share quota. Permission and interest still govern each action.
  const socialSharePlans={free:{enabled:true,auto:true},off:{enabled:false,auto:false}};
  const socialShareNames={free:'自主分享',off:'暂不分享',custom:'保留当前授权'};
  const renderSocialShare=()=>{
    const choice=selectedChoice('social-share-choice');
    $('social-share-choice-status').textContent=choice==='custom'?'保留原有权限；旧次数额度不再生效。':'已选择「'+socialShareNames[choice]+'」，尚未保存；接收人仍须独立允许收到推荐。';
  };
  document.querySelectorAll('input[name="social-share-choice"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked&&socialSharePlans[r.value]){
      const p=socialSharePlans[r.value];$('social-life-intent-enabled').checked=p.enabled;$('social-auto-send').checked=p.auto;
    }
    if(r.value==='custom'){$('social-life-intent-enabled').checked=true;$('social-auto-send').checked=true;}
    $('social-share-advanced').open=r.value==='custom';renderSocialShare();
  }));
  for(const id of ['social-life-intent-enabled'])$(id).addEventListener('change',()=>{setChoice('social-share-choice','custom');renderSocialShare()});
  const loadSocialIntents=async()=>{
    const [record,settings,friendState]=await Promise.all([request('/social-intentions'),request('/config'),request('/life-friend-initiatives').catch(()=>({ok:false}))]);
    const c=settings.config||{};
    $('social-life-intent-enabled').checked=c.socialOutreachEnabled===true&&c.socialLifeIntentEnabled===true&&c.socialVideoRecommendationsAuthorizedV2===true;
    $('life-friend-dm-enabled').checked=c.lifeProactiveFriendDmEnabled===true;
    $('life-natural-dm-enabled').checked=c.lifeNaturalDmOutreachEnabled===true;
    $('life-public-interaction-enabled').checked=c.lifePublicInteractionEnabled===true;
    $('life-public-interaction-status').textContent=(c.lifePublicInteractionEnabled===true?'统一公开互动已授权':'公开互动关闭，仍可只读探索')+' · Life 自主决定 · 原作者和目标每次核验';
    $('life-friend-dm-status').textContent=(c.lifeProactiveFriendDmEnabled===true?'已授权：仍需双向私信证据':'原白名单自主联系未授权')+
      (friendState.ok===true?' · 当前可信候选 '+friendState.available+' · 未知结果 '+friendState.uncertain:
        ' · 当前账号关系候选暂不可读取');
    $('social-auto-send').checked=c.socialAutoSend===true;
    const legacyDraftOnly=$('social-life-intent-enabled').checked&&!$('social-auto-send').checked;
    const sharePreset=Object.keys(socialSharePlans).find(name=>{
      const p=socialSharePlans[name];
      return $('social-life-intent-enabled').checked===p.enabled&&$('social-auto-send').checked===p.auto&&
        true;
    })||'custom';
    setChoice('social-share-choice',sharePreset);$('social-share-advanced').open=sharePreset==='custom';renderSocialShare();
    if(legacyDraftOnly)$('social-share-choice-status').textContent='当前保留旧版仅草稿配置，未自动开启发送。请选择自主分享或暂不分享并显式保存。';
    const consent=c.socialVideoRecommendationsAuthorizedV2===true;
    const reasons={'consent-required':'旧配置尚未启用推荐','disabled':'全局权限未开启','no-trusted-friends':'没有允许私信推荐的白名单 UID','no-profile-match':'本轮没有符合权限和兴趣条件的收件人','draft-created':'已产生推荐草稿','model-skipped':'鱼鱼本轮选择不联系'};
    const latest=record.lastScan;
    $('social-status').textContent=(consent?'视频推荐已允许':'此账号的推荐权限仍关闭（保存设置后生效）')+' · 尚未发出的候选 '+(record.items||[]).filter(x=>x.status==='draft'&&x.type==='interest-share').length+' 条 · 今日确认发送 '+(record.sentToday||0)+' 条 · 有资格的私信好友 '+(record.eligibleFriends||0)+' 位 · '+(latest?('最近判断：'+(reasons[latest.reason]||latest.reason)+'（'+new Date(latest.at).toLocaleString()+'）'):'当前进程尚无新入选视频触发判断')+(c.socialAutoSend===true?' · 自主发送已授权':' · 自主发送未授权')+(record.ownerEligible?' · 主人已允许接收推荐':record.ownerConfigured?' · 主人在白名单中尚未允许「私信推荐」':' · 尚未设置主人 UID')+(latest?.delivery?' · 最近投递：'+String(latest.delivery).slice(0,120):'');
    const target=$('social-drafts');target.replaceChildren();
    for(const row of record.items||[]){
      const card=node('article','','record');
      add(card,node('strong',({draft:'暂未发出 · 内部候选',sent:'已发送',uncertain:'发送结果不确定，请勿重试',dismissed:'已结束',skipped:'自主选择不联系',reserved:'发送操作已保留'}[row.status]||row.status)+' · '+(row.type==='interest-share'?'自主分享':'好友推荐回访')+' · BV '+row.bvid),
        info('推荐者 UID '+row.uid+' · '+(row.title||'公开选片')));
      if(row.text)add(card,node('p',row.text));
      if(row.reason)add(card,info('决定原因：'+row.reason));
      // Internal candidates are read-only in management UI: no human approval or dismissal.
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('暂无推荐记录。需有新入选视频，且主人／好友已在白名单中允许私信推荐。主人无须填写兴趣关键词，其他好友仍需兴趣匹配；鱼鱼也可以选择沉默。'));
  };
  $('social-refresh').addEventListener('click',()=>run(loadSocialIntents));
  $('life-friend-dm-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('life-friend-dm-enabled').checked;
    const naturalEnabled=$('life-natural-dm-enabled').checked;
    const cfgNow=(await request('/config')).config||{};
    if(enabled&&cfgNow.lifeProactiveFriendDmEnabled!==true&&
      !await confirmAction({title:'开启熟人自主联系',description:'鱼鱼可在没有视频的情况下，自主私信有真实双向互动记录并授权私信的熟人。不会逐条等待主人审稿；仍执行事实、账号、冷却、平台及防重检查。确认开启？'}))return;
    if(naturalEnabled&&cfgNow.lifeNaturalDmOutreachEnabled!==true&&
      !await confirmAction({title:'允许自然私信关系的主动联系',description:'这是新的独立授权：即使对方不在白名单，只要已经有当前账号持续跨日双向私信历史、没有拒联，而且鱼鱼自己决定主动联系，就可能发出一条私信。评论区熟悉绝不会触发。是否明确允许？'}))return;
    const response=await request('/config',{lifeProactiveFriendDmEnabled:enabled,
      lifeNaturalDmOutreachEnabled:naturalEnabled,
      ...(enabled?{confirmFriendDm:'ENABLE_LIFE_FRIEND_CHAT'}:{}),
      ...(naturalEnabled?{confirmNaturalDm:'ENABLE_ESTABLISHED_PRIVATE_OUTREACH'}:{})});
    if(response.ok!==true)throw Error(response.error||'自主联系配置保存失败');
    const after=(await request('/config')).config||{};
    if(after.lifeProactiveFriendDmEnabled!==enabled||after.lifeNaturalDmOutreachEnabled!==naturalEnabled)throw Error('自主联系配置回读不一致');
    await loadSocialIntents();message('熟人自主联系授权已保存并回读验证');
  }));

  $('life-public-interaction-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('life-public-interaction-enabled').checked;
    const current=(await request('/config')).config||{};
    if(enabled&&current.lifePublicInteractionEnabled!==true&&
      !await confirmAction({title:'开启 Life 统一公开互动',description:'鱼鱼可在了解经过核验的公开动态后，自主选择点赞或发表评论，包括他人被转发的原动态。不自动互动，不以私人分享内容为写入指令；仍执行账号、真实作者、Life 凭据、全局额度与平台回执检查。你确认允许吗？'}))return;
    const response=await request('/config',{lifePublicInteractionEnabled:enabled,
      ...(enabled?{confirmPublicInteraction:'ENABLE_LIFE_PUBLIC_INTERACTION'}:{})});
    if(response.ok!==true)throw Error(response.error||'统一公开互动授权保存失败');
    const after=(await request('/config')).config||{};
    if(after.lifePublicInteractionEnabled!==enabled)throw Error('公开互动授权回读不一致');
    await loadSocialIntents();message('统一公开互动授权已保存并回读验证');
  }));

  $('social-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('social-life-intent-enabled').checked;
    const oldDraftOnly=enabled&&!$('social-auto-send').checked;
    if(oldDraftOnly)throw Error('旧版仅草稿配置不能在此直接保存；请选择「自主分享」或「暂不主动分享」后再保存');
    const auto=enabled; // No review-only mode for autonomous social sharing.
    const previous=(await request('/config')).config||{};
    if(enabled&&auto&&(!previous.socialAutoSend||!previous.socialVideoRecommendationsAuthorizedV2)&&!await confirmAction({title:'请确认操作',description:'这会真实向已授权接收推荐的白名单好友（含主人）发送 B站私信。鱼鱼可以选择不发，保留收件人授权与防重保护，确认开启？'}))return;
    const r=await request('/config',{socialOutreachEnabled:enabled,socialLifeIntentEnabled:enabled,socialAutoSend:enabled&&auto,
      socialVideoRecommendationsAuthorizedV2:enabled,confirm:enabled?'ENABLE_VIDEO_RECOMMENDATIONS':''});
    if(r.localVerified!==true)throw Error('未能回读确认自主视频推荐设置，请刷新复核');
    await loadSocialIntents();message(localSaveNotice(r,'自主视频推荐设置已保存'));
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
      const summary=node('details','','agency-summary');
      const counts=r.decisions||{};
      summary.appendChild(node('summary',`🐟 最近社交意愿 · ${r.total||0} 次考虑`));
      add(summary,node('p',`愿意 ${counts.allow||0} · 等一等 ${counts.defer||0} · 不打扰 ${counts.refuse||0} · 被拦截 ${counts.blocked||0}`,'muted'));
      const names={explore:'探索视频',publish:'公开表达',like:'点赞',collect:'收藏',follow:'关注',chat:'交流',coin:'投币请求'};
      const decisions={allow:'愿意尝试',defer:'暂缓',refuse:'选择拒绝',blocked:'权限或能力限制'};
      const sources={'bili-comment':'评论','bili-dm':'私信'};
      for(const x of (r.recent||[]).slice(0,3)){
        add(summary,node('p',`${new Date(x.at).toLocaleString()} · ${sources[x.source]||'社交'} · ${names[x.intent]||'互动'}：${decisions[x.decision]||'未确定'}`,'muted'));
      }
      if(!(r.recent||[]).length)add(summary,info('暂无记录；不意味着鱼鱼必须去社交。'));
      activity.appendChild(summary);
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
  let lifeTimelineFirstRead=false,lifeTimelineFingerprint='',lifeTimelineKnownIds=new Set();
  const renderLifeTimeline=async()=>{
    const days=Math.max(1,Math.min(90,Number($('life-timeline-days').value)||30));const data=await request('/life-timeline?days='+days);const target=$('life-timeline-list');target.classList.add('life-continuity-layout');
    const cards=data.rows||[];
    const fingerprint=JSON.stringify([days,cards.map(row=>[row.id,row.at,row.label,row.title,row.detail,row.bvid,row.uid,row.relatedVideos,row.continuity?.key])]);
    const changed=fingerprint!==lifeTimelineFingerprint;
    const oldScroll=target.scrollTop;
    if(changed)target.replaceChildren();
    let arrivedCount=0;
    const addCard=(row,parent)=>{
      const card=node('article','','record'),timeLabel=row.dateOnly?'日期记录（时间未知）':new Date(row.at).toLocaleTimeString();
      add(card,node('div',row.label+' · '+timeLabel,'title-line'),node('strong',row.title||''));
      if(row.detail)add(card,info(row.detail));
      const links=node('div','','life-timeline-links');
      if(row.bvid){const a=node('a',row.bvid+' · 打开视频 ↗');a.href=row.url||'https://www.bilibili.com/video/'+row.bvid;a.target='_blank';a.rel='noopener noreferrer';links.appendChild(a)}
      const uid=String(row.creatorUid||row.uid||'');
      if(/^[1-9]\d{0,18}$/.test(uid)){const a=node('a','UID '+uid+' · 打开主页 ↗');a.href=row.creatorUrl||row.profileUrl||'https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';links.appendChild(a)}
      for(const video of (Array.isArray(row.relatedVideos)?row.relatedVideos:[]).slice(0,5)){
        if(!/^BV[0-9A-Za-z]{10}$/.test(String(video?.bvid||'')))continue;
        const a=node('a','相关投稿：'+video.bvid+' ↗');a.href=video.url||'https://www.bilibili.com/video/'+video.bvid;a.target='_blank';a.rel='noopener noreferrer';links.appendChild(a)
      }
      if(links.childNodes.length)card.appendChild(links);
      if(lifeTimelineFirstRead&&!lifeTimelineKnownIds.has(String(row.id))){card.classList.add('is-arriving');card.style.animationDelay=Math.min(arrivedCount++*65,260)+'ms'}
      parent.appendChild(card)
    };
    // A single chronological day view is easier to read than permanently
    // empty continuity panels. Provenance still lives in the original records
    // and developer diagnostics; never infer a story from nearby timestamps.
    if(changed){
      const dates=new Map();
      for(const row of cards){const day=String(row.day||'').slice(0,10)||'日期未记录';if(!dates.has(day))dates.set(day,[]);dates.get(day).push(row)}
      for(const [day,rows] of dates){
        target.appendChild(node('div',day,'life-independent-heading'));
        for(const row of rows)addCard(row,target);
      }
      if(!cards.length)target.appendChild(info('最近没有可展示的真实经历。'));
      target.scrollTop=oldScroll;
      lifeTimelineFingerprint=fingerprint;
    }
    lifeTimelineKnownIds=new Set(cards.map(row=>String(row.id)));lifeTimelineFirstRead=true;
    const indicator=$('life-timeline-update-state');if(indicator){indicator.textContent='已同步 · 每 4 秒对账';indicator.dataset.state='live'}
    const videos=(data.rows||[]).filter(row=>row.type==='video');
    const picked=videos.filter(row=>row.label==='入选视频').length;
    const rounds=(data.rows||[]).filter(row=>row.type==='video-round');
    const summary=$('life-timeline-summary');
    const counts=data.counts||{};
    if(summary)summary.textContent=`最近 ${days} 天：挑选视频 ${picked} 条，视频探索 ${rounds.length} 轮，了解资料 ${counts['life-read']??0} 次，评论 ${counts.comment??0} 条，其他互动 ${counts['life-write']??0} 次，生活自主考虑 ${counts['life-consider']??0} 次，自主休息 ${counts['life-rest']??0} 次，反思 ${counts['life-reflection']??0} 次，心情变化 ${counts.emotion??0} 次。`;

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
    $('friend-relationships-status').textContent='已显示 '+relationRows.length+' 位联系人 · 自然熟悉度不由白名单加分；旧版历史未必能区分账号或渠道';
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
      add(scoreLine,node('b','历史熟悉度 '+row.score+'/100'),node('span',privilege));
      const progress=node('div','','relation-score-track');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','关系熟悉度');progress.setAttribute('aria-valuenow',String(row.score));progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');
      const fill=node('div','','relation-score-fill');fill.style.width=Math.max(0,Math.min(100,Number(row.score)||0))+'%';progress.appendChild(fill);
      const summary=node('p',`历史索引累计 ${row.count} 次互动 · 当前账号：${row.continuity?.seenHere?'有已核验交流':'尚无可信交流记录'} · 对方是否认识当前账号：未核实`,'relation-brief');
      const details=node('details','','relation-details');details.dataset.uid=row.uid;
      add(details,node('summary','展开人物详情 · 交流画像与互动经历'));
      const both=Number(row.incoming)>0&&Number(row.outgoing)>0;
      const backAndForth=both?'有双向交流':Number(row.incoming)>0?'以对方来访为主':Number(row.outgoing)>0?'以鱼鱼主动互动为主':'互动证据有限';
      const recencyDays=row.lastAt?Math.floor(Math.max(0,Date.now()-Number(row.lastAt))/86400000):null;
      const recentLabel=recencyDays===null?'暂无记录':recencyDays<2?'最近有互动':recencyDays<14?'近期接触过':'较久未互动';
      const impressions=both&&row.activeDays>=3?'多次双向交流，有持续交往的迹象':both?'已有双向交流，仍在相互了解':row.activeDays>=2?'在不同日期碰面过，交流深度尚不明确':'接触证据还少，暂不推断个性';
      const traits=node('div','','relation-dimensions');
      const channelNames={ongoing:'有持续双向交流',encountered:'已有交流证据',none:'尚无交流证据',unknown:'旧记录渠道未核实'};
      const privateNames={established:'已建立自然双向私信习惯',not_established:'尚不适合主动私信',restricted:'对方联系边界限制',unknown:'旧记录不足以证明私信关系'};
      for(const [label,value] of [['🌷 自然熟悉度',(row.stageLabel||'刚认识')+' · '+(row.score||0)+'/100'],
        ['🐟 当前账号关系阶段',row.continuity?.stage||'new'],
        ['💬 评论区亲密度',channelNames[row.channels?.public]||'证据未知'],
        ['✉️ 私信渠道亲密度',channelNames[row.channels?.private]||'证据未知'],
        ['🔒 主动私信开放程度',privateNames[row.dmOpenness?.state]||'尚不具备资格'],
        ['🤝 往来方式',backAndForth],['🕒 近期活跃',recentLabel],['🛡️ 管理权限',privilege]]){
        const dim=node('div','','relation-dimension');add(dim,node('small',label),node('b',value));traits.appendChild(dim)
      }
      add(details,traits,info('🐟 互动印象（仅基于次数、日期和方向）：'+impressions),
        info(`往来证据：收到 ${row.incoming||0} 次 · 发出 ${row.outgoing||0} 次。公开社交经历参考半衰期 ${Number(row.publicMemoryHalfLifeDays||0).toFixed(1)} 天；不等于全部遗忘。`),
        info('鱼鱼自己的历史认识可以延续，但旧账号的互动不表示对方认识新账号。当前账号关系只用此账号核实的交流；旧版熟悉度不得作为主动私信资格，未经主人授权也不自动向旧友宣告换号。'),
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
  // Timeline DOM lives under life-agent; it must not depend on visiting the memory tab.
  let lifeNowTimelineLoaded=false;
  let lifeNowTimelinePending=null;
  const loadLifeNowTimeline=()=>{
    if(lifeNowTimelinePending)return lifeNowTimelinePending;
    const status=$('life-timeline-summary'),target=$('life-timeline-list');
    if(!lifeNowTimelineLoaded&&!lifeTimelineFirstRead){
      if(status)status.textContent='正在读取已保存的真实生活记录…';
      if(target)target.replaceChildren(info('正在加载时间线…'));
    }
    lifeNowTimelinePending=renderLifeTimeline().then(()=>{lifeNowTimelineLoaded=true}).catch(e=>{
      lifeNowTimelineLoaded=false;lifeTimelineFingerprint='';
      if(status)status.textContent='时间线读取失败，可以点击“刷新列表”重试。';
      if(target)target.replaceChildren(info('读取失败：'+String(e?.message||e).slice(0,110)));
      throw e;
    }).finally(()=>{lifeNowTimelinePending=null});
    return lifeNowTimelinePending;
  };
  // The timeline is always visible directly beneath the decision tree.

  // S0/S1 audit data is already sanitized server-side; never infer release readiness.
  $('life-release-evidence-export').addEventListener('click',()=>run(async()=>{
    const button=$('life-release-evidence-export');const status=$('life-release-evidence-status');
    const output=$('life-release-evidence-result');button.disabled=true;
    status.textContent='正在采集只读匿名快照…';output.hidden=true;
    try{
      const evidence=await request('/life-agent/release-acceptance-evidence');
      if(evidence?.readOnly!==true||evidence?.releaseReady!==false)throw Error('验收快照安全协议不一致');
      output.textContent=JSON.stringify(evidence,null,2);output.hidden=false;
      status.textContent='已采集匿名只读快照；仍需 Windows 实机与人工发布批准。';
    }catch(e){status.textContent='验收快照未采集：'+String(e?.message||e).slice(0,110);}
    finally{button.disabled=false;}
  }));
  $('life-timeline-refresh').addEventListener('click',()=>run(async()=>{lifeNowTimelineLoaded=false;await loadLifeNowTimeline()}));
  $('life-timeline-days').addEventListener('change',()=>run(async()=>{lifeNowTimelineLoaded=false;await loadLifeNowTimeline()}));$('friend-relationships-refresh').addEventListener('click',()=>run(()=>loadFriendRelationships()));
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
    const todoFlow=$('life-flow-todos');
    if(todoFlow)todoFlow.textContent=String(counts.active??pending.length)+' 项未结束';
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
  const refreshLifeDecisionMeter=async()=>{
    const label=$('life-decision-usage'),progress=$('life-decision-progress'),detail=$('life-decision-next');
    try{
      const [v2,planner]=await Promise.all([request('/life-agent/settings-v2'),request('/autonomous-planner')]);
      const budget=Math.max(0,Math.min(288,Number(v2.settings?.budget?.dailyLimit)||0));
      const used=Math.max(0,Number(planner.lifeRuns)||0),global=Math.max(0,Number(planner.runs)||0),willingness=Math.max(0,Number(planner.willingnessRuns)||0);
      label.textContent=used+' / '+budget+' 次自主规划（合并社交快速预约 '+global+' / '+(planner.dailyGlobalLimit??'?')+'；独立意愿判断 '+willingness+' 次，不计入前述预约）';
      progress.value=budget?Math.min(100,used/budget*100):0;
      const pulse=planner.schedulerPulse||{},active=planner.running===true&&planner.lifeAgentMode!=='off';
      const expected=planner.masterEnabled===true&&planner.plannerEnabled===true&&planner.lifeAgentMode!=='off';
      const lease=planner.runLease||{},leaseBlocked=lease.held&&lease.needsReview;
      const state=leaseBlocked?'⚠️ Life 上次运行未正常结束：调度锁待安全复核':expected&&!planner.running?'⚠️ Life 调度定时器已停止':!active?'调度未运行／已暂停':pulse.stale?'⚠️ 调度心跳超过 150 秒：可能停滞':
        pulse.lastCheckAt?'调度心跳正常（不代表已经调用模型）':'调度已启用，尚未观察到首次心跳';
      const next=planner.nextDecisionAt?formatLocalTime(new Date(planner.nextDecisionAt).toISOString()):'尚未安排';
      const skips={cooldown:'等待考虑冷却',quota:'今日 Life 额度已用尽','global-quota':'共享模型额度已用尽',
        'model-backoff':'模型错误后退避','outside-hours':'当前不在活动时段','nothing-to-do':'本轮无可考虑候选',
        'life-exploration-cooldown':'探索契机在冷却期','planner-already-running':'上次决策仍在执行／锁未释放','planner-lock-review-required':'调度锁异常，自动恢复未通过安全校验','planner-recovery-in-progress':'正在处理上次异常退出的调度锁','planner-recovery-guard-orphaned':'上次锁恢复再次中断，已停止自动处理并保留证据','planner-recovery-guard-review-required':'恢复锁内容不完整，需要安全检查',disabled:'调度已关闭','life-paused':'生活已暂停'};
      const episodeReason=planner.lifeEpisodeStatus?.reason||'';
      const episodeNote=episodeReason==='account-not-ready'
        ?' · 当前账号尚未完成核验，Life Episode 历史暂不可读；调度次数与心跳独立可用'
        :episodeReason&&episodeReason!=='ready'
          ?' · Life Episode 附加诊断暂不可读（'+episodeReason+'）；不影响上方调度次数'
          :'';
      detail.textContent=state+' · 最近检查 '+(pulse.lastCheckAt?formatLocalTime(new Date(pulse.lastCheckAt).toISOString()):'尚无')+
        ' · 下次预计 '+next+'（'+(planner.nextDecisionReason||'未安排')+'）'+
        ' · 最近跳过 '+(skips[pulse.lastSkipReason]||pulse.lastSkipReason||'没有记录')+
        (lease.autoRecovery?.count?' · 已自动恢复异常退出的调度锁 '+lease.autoRecovery.count+' 次':'')+
        (lease.autoRecovery?.lastError?' · ⚠️ 锁恢复未通过校验 '+lease.autoRecovery.lastError:'')+
        (pulse.lastErrorCode?' · ⚠️ 最近模型／调度错误 '+String(pulse.lastErrorCode).slice(0,80):'')+
        episodeNote+
        (pulse.stale?'。若断网后仍超过数分钟无新心跳，请检查插件进程／重载状态；不会凭空补记决策。':'。没有新决策不必然是故障。');
    }catch(e){label.textContent='无法读取决策次数';detail.textContent='⚠️ 当前无法核验调度状态：'+String(e?.message||e).slice(0,100);progress.value=0;}
  };
  $('life-decision-refresh').addEventListener('click',()=>run(refreshLifeDecisionMeter));
  let lifeHoursSaved={start:9,end:23};
  const paintLifeHours=()=>{
    const start=Number($('life-v2-start').value),end=Number($('life-v2-end').value);
    const hour=n=>String(n).padStart(2,'0')+':00';
    $('life-hours-start-value').textContent=hour(start);
    $('life-hours-end-value').textContent=hour(end);
    $('life-hours-display').textContent=hour(start)+' — '+hour(end)+(start>end?' · 跨午夜':'');
    $('life-hours-timeline').setAttribute('aria-label',`活动时段：${hour(start)} 至 ${hour(end)}${start>end?'，跨午夜':''}`);
    const a=Number((start/24*100).toFixed(2)),b=Number((end/24*100).toFixed(2));
    const mint='#51a78f',quiet='#d5e3e7';
    const stops=start<end
      ?`${quiet} 0%,${quiet} ${a}%,${mint} ${a}%,${mint} ${b}%,${quiet} ${b}%,${quiet} 100%`
      :start>end
        ?`${mint} 0%,${mint} ${b}%,${quiet} ${b}%,${quiet} ${a}%,${mint} ${a}%,${mint} 100%`
        :`${quiet} 0%,${quiet} 100%`;
    $('life-hours-timeline').style.background=`linear-gradient(90deg,${stops})`;
    const dirty=start!==lifeHoursSaved.start||end!==lifeHoursSaved.end;
    $('life-hours-pending').classList.toggle('is-dirty',dirty);
    $('life-hours-pending').textContent=dirty?'时段尚未保存 · 点击下方「保存生活设置」':'活动时段已同步 · 调整后需保存';
    for(const btn of document.querySelectorAll('[data-life-hours]')){
      btn.setAttribute('aria-pressed',String(btn.dataset.lifeHours===`${start},${end}`));
    }
  };
  const loadUnifiedLifeSettings=async()=>{
    // Phase 6: an independent, versioned facade over the SAME config.
      // A failed read never hides existing TODOs or changes any permission.
      try{
        const v2=await request('/life-agent/settings-v2');const settings=v2.settings||{};
        $('life-v2-mode').value=settings.mode||'off';
        syncLifeChoiceCards();
        const paceSelect=$('life-v2-pace');
        for(const opt of [...paceSelect.options])if(opt.dataset.legacySelected==='true')opt.remove();
        const savedPace=settings.pace||'custom';
        if(![...paceSelect.options].some(opt=>opt.value===savedPace)){
          const legacy=document.createElement('option');legacy.value=savedPace;
          legacy.textContent='保留当前历史设置（未更改）';legacy.dataset.legacySelected='true';
          paceSelect.appendChild(legacy);
        }
        paceSelect.value=savedPace;syncLifeChoiceCards();
        const profileChoice=({quiet:'gentle',natural:'balanced',lively:'curious'})[savedPace]||'custom';
        const profileRadio=[...document.querySelectorAll('input[name="life-organic-choice"]')].find(x=>x.value===profileChoice);
        if(profileRadio)profileRadio.checked=true;
        $('life-organic-profile').value=profileChoice;
        describeOrganicParameters();
        $('life-organic-custom').hidden=profileChoice!=='custom';
        $('life-organic-preview').disabled=profileChoice==='custom';
        $('life-organic-apply').disabled=profileChoice==='custom';
        $('life-legacy-pace-note').hidden=!savedPace.startsWith('legacy-');
        $('life-v2-mode').dataset.revision=settings.revision||'';
        const budget=settings.budget||{};
        for(const [id,value] of [['life-v2-minutes',budget.minutes??60],['life-v2-limit',budget.dailyLimit??12],
          ['life-v2-start',budget.startHour??9],['life-v2-end',budget.endHour??23],
          ['life-v2-video-min-interval',budget.videoAgentMinIntervalMinutes??30],
          ['life-v2-video-read-target',budget.videoAgentReadTargetPerRound??5],
          ['life-v2-video-pick-target',budget.videoAgentPickTargetPerRound??5]])$(id).value=String(value);
        lifeHoursSaved={start:Number($('life-v2-start').value),end:Number($('life-v2-end').value)};paintLifeHours();
        $('life-settings-advanced').open=settings.pace==='custom';
        const names={off:'暂停',shadow:'观察',active:'自主生活'};
        const driver=settings.driverOwnership?.videoWakeOwner==='life-agent'?'Life Agent':'暂无自动视频驱动';
        void refreshLifeDecisionMeter();
        $('life-v2-status').textContent=`已保存：${names[settings.mode]||'暂停'} · 活跃程度 ${({quiet:'安静',natural:'自然',lively:'活跃',custom:'自定义','legacy-quiet':'历史设置','legacy-natural':'历史设置','legacy-lively':'历史设置'})[settings.pace]||'自定义'}。`+(settings.mode==='off'&&settings.plannerEnabled?'当前仍检测到历史调度，请再次保存「暂停」使其停止。':'社交回复仍遵循单独的授权设置。');
        try{
          const sharing=await request('/social-intentions');
          const shares=(sharing.items||[]).filter(x=>x.type==='interest-share');
          $('life-link-sharing').textContent=(sharing.paused?'暂不可主动推荐':'按已授权朋友与兴趣筛选')+' · 最近草稿 '+shares.filter(x=>x.status==='draft').length+' 条 / 已发 '+shares.filter(x=>x.status==='sent').length+' 条；仍是独立受限发送链路。';
        }catch{$('life-link-sharing').textContent='视频分享状态暂不可用；不代表已获得发送授权';}

      }catch(e){$('life-v2-status').textContent='统一生活设置读取失败：'+String(e?.message||e).slice(0,90)}
  };
  const loadOwnerTodos=async({reset=false}={})=>{
    if(reset){todoPageCursor='';todoPageTrail=[]}
    const data=await request('/owner-todos');
    const page=await request('/owner-todos/page?filter='+encodeURIComponent(ownerTodoFilter)+'&limit=20'+(todoPageCursor?'&cursor='+encodeURIComponent(todoPageCursor):''));
    const intake=(data.socialTodoIntakeRecent||[]).slice(-5).reverse();
    const intakeNames={created:'已建立待办',duplicate:'重复消息未重复建待办','partial-created':'部分入队，另有候选未通过核验','model-revised':'已由模型自行修订回复','suppressed-unverified':'承诺或事实未获核实，已停止外发','model-revision-failed':'模型修订失败，未使用程序代写','no-proposal':'AI 未提出待办','model-defer':'鱼鱼决定延期','model-refuse':'鱼鱼决定拒绝','topic-not-grounded-in-user-evidence':'候选主题缺少用户证据','evidence-not-in-current-user-message':'AI 引用的消息证据未通过','missing-ai-candidate':'AI 接受但未提供候选','unverified-event':'原消息未通过来源/时间校验','willingness-defer':'自主意愿延期','willingness-denied':'自主意愿未通过'};
    $('owner-todo-intake-status').textContent=intake.length?'最近社交 AI 待办判断（仅本次运行）：'+intake.map(x=>`${x.channel==='comment'?'评论':'私信'} ${intakeNames[x.outcome]||x.outcome}`).join('；'):'社交 AI 待办识别：本次运行尚无判断记录；未开启或被额度拦截的消息不会进入 AI。';
    data.allItems=data.items;data.items=page.items;data.page=page;lastOwnerTodos=data;todoNextCursor=page.nextCursor;renderUnifiedLifePlans();
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
      const decisionNote=row.lastDecisionMode==='debug'?' · 最近一次手动重新考虑 '+({reply:'愿意回访',defer:'延期',skip:'保持沉默','reply-without-grounded-text':'没有可发送的可靠文字'}[row.lastDecision]||row.lastDecision)+(row.lastModelInvoked===false?'（模型未成功调用）':''):'';
      line.textContent=`来自待办「${source}」${ids?'（'+ids.slice(0,8)+'）':''} · ${row.uid||'未知UID'} · ${row.channel==='comment'?'原评论':'私信'} · ${state}${row.groupTotal?' · 子待办已完成 '+(row.groupDone||0)+'/'+row.groupTotal:''} · ${why}${row.nextEligibleAt?' · 预计重新考虑 '+formatLocalTime(new Date(row.nextEligibleAt).toISOString()):''} · ${row.eligibility||''}${decisionNote}`;
      if(row.status==='pending'&&row.key){
        const reconsiderButton=btn('重新考虑此条（忽略延期）',async()=>{
          if(!await confirmAction({title:'请确认操作',description:'仅针对待办「'+source+'」询问鱼鱼一次（可能直接发送）；忽略自主延期时间，但仍检查权限、限额、夜间静默、去重和回执。可能产生模型费用。继续？'}))return;
          const result=await request('/owner-todos/followup',{action:'debug-reconsider',key:row.key});
          await loadOwnerTodos();message(followupReconsiderMessage(result));
        });line.appendChild(reconsiderButton);
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
    try{
      const sched=await request('/autonomous-planner');
      const life=sched.lifeEvents||{};
      const readiness=sched.experienceReadiness||{};
      const blockNames={
        'master-off':'生活总开关关闭','planner-off':'自主调度开关关闭','not-life-mode':'当前为传统模式',
        'shadow-no-video':'历史观察模式不允许自动启动真实视频 Agent',
        'model-quota':'每日自主模型决策额度不足','planner-run-lease-held':'Life 决策正在进行或异常中断，需查看运行租约','event-ledger-unavailable':'当前账号生活事件账本不可用',
        'no-video-capability':'原视频 Agent 当前不可委派（可能忙碌、账号或视频额度不允许）',
        'video-day-limit':'平台自身报告限制，不是 Life 每日轮次上限',
        'video-cooldown':`视频 Agent 启动间隔尚未结束（当前最短 ${readiness.videoCooldownMinutes??30} 分钟）`
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
      const homePickedNote=Number.isSafeInteger(lastRound?.homePickedCount)
        ?`，其中真正入选的首页视频 ${lastRound.homePickedCount} 条`
        :(lastRound?.state==='completed'&&lastRound?.homeRead==='candidates'?'，首页来源入选数未核实':'');
      const hasHomeEvidence=lastRound&&(lastRound.entryMode==='home'||lastRound.homeRead!=='not-observed');
      const homeLabel=lastRound?.entryMode==='home'?'首页闲逛':'混合探索中的首页推荐';
      const homeState=hasHomeEvidence
        ?homeLabel+'：'+({candidates:`确实取得 ${lastRound.homeCandidates||0} 条真实首页候选${homePickedNote}`,empty:'已读取首页，但没有符合规则的候选',
          unavailable:'已尝试首页读取，接口不可用或失败','not-observed':'未观察到首页工具读取（不代表已浏览）'}[lastRound.homeRead]||'尚无首页读取证据')+'。'
        :'';
      const funnel=lastRound?.funnel;
      const funnelState=funnel?`本轮工具漏斗：目标内容 ${lastRound.readTarget??'未知'} / 择优 ${lastRound.pickTarget??'未知'}；候选 ${funnel.candidates??'未知'}、成功读取详情 ${funnel.metadataVerified}、取得字幕/非空评论等内容证据 ${funnel.contentRead}、工具入选 ${funnel.selected}；重复 ${funnel.duplicate}、热度不符 ${funnel.heatInsufficient}、详情失败 ${funnel.metadataFailed}、工具错误 ${funnel.toolErrors}、候选未取得内容证据 ${funnel.notDeepRead??'未知'}。不足目标的原因如未由 Agent 实际说明，应标记未知；这是资料读取回执，不等于完整观看，各项可能交叉。`: '本轮尚无可核验的工具漏斗；不能把缺失统计当成零阅读或主动忽略。';
      $('life-actual-proof').textContent=`本账号今日 Life Agent 委派原视频 Agent ${life.videoStartsToday||0} 次（Life 不额外设每日启动轮次上限，最短间隔 ${readiness.videoCooldownMinutes??30} 分钟）；近 7 天记录到委派 ${recentDelegations.length} 次。最近有真实子进程回执：正常结束 ${roundCounts.completed}、失败 ${roundCounts.failed}、中断/待核实 ${roundCounts.interrupted}、启动待结束 ${roundCounts.running}。${roundStatus}${homeState}${funnelState}委派和进程结束均不等于已看完或听过作品。${(life.videoStartsToday||0)===0&&!rounds.length?'目前还没有通过这条新路径启动视频的证据。':''}`;
      await loadUnifiedLifeSettings();
      const wakeReasonNames={'base-interval':'基础考虑间隔','experience-followup':'新经历跟进','episode-due':'生活片段到期','model-retry':'模型故障退避重试','daily-quota-reset':'每日额度重置','allowed-hours':'等待允许活动时段','disabled':'调度未开启','daily-limit-zero':'每日模型额度为零','outside-allowed-hours':'当前不在允许活动时段','schedule-evidence-unavailable':'调度证据暂不可读'};
      const pulse=sched.schedulerPulse||{},heartbeat=pulse.lastCheckAt?new Date(pulse.lastCheckAt).toLocaleString():'尚无检查';
      const lastModel=pulse.lastModelTurnAt?new Date(pulse.lastModelTurnAt).toLocaleString():'尚无已记录的模型决策';
      const runLease=sched.runLease||{};
      const pulseText=`${runLease.held&&runLease.needsReview?'⚠️ 调度锁异常阻塞自动考虑 · ':''}${runLease.autoRecovery?.count?'已自动恢复异常退出的调度锁 '+runLease.autoRecovery.count+' 次 · ':''}Life 调度心跳：${heartbeat} · 累计检查 ${pulse.checks||0} 次 · 最近模型决策：${lastModel} · 最近跳过：${pulse.lastSkipReason||'暂无'}${pulse.stale?' · ⚠️ 调度心跳已超过 150 秒，可能停滞':''}${pulse.lastErrorCode?' · 最近错误：'+pulse.lastErrorCode:''}。`;
      $('autonomous-planner-next').textContent=pulseText+'\n'+ '预计下次自动决策：'+(sched.nextDecisionAt?formatLocalTime(new Date(sched.nextDecisionAt).toISOString()):'未安排（可能尚未开启或今日额度为零）')+' · 主导原因：'+(wakeReasonNames[sched.nextDecisionReason]||sched.nextDecisionReason||'未知')+'。本日生活决策 '+(sched.lifeRuns??sched.runs??0)+'/'+(data.config?.plannerDailyLimit??4)+' 次，社交只读快速关注 '+(sched.socialRuns||0)+'/'+(sched.socialDailyLimit||24)+' 次，总模型预约 '+(sched.runs||0)+'/'+(sched.dailyGlobalLimit||288)+' 次；社交由 Life 统一归属管理，迁移未完成时冻结外发；视频启动另有限制。只表示下一次检查机会，不保证执行。';
    }catch{$('autonomous-planner-next').textContent='预计下次自动决策：暂不可用';$('life-readiness').textContent='真实状态无法核查';$('life-actual-proof').textContent='真实委派结果无法核查'}
    renderTodoList(data);
  };
  for(const filter of ['active','all','finished'])$('owner-todo-filter-'+filter).addEventListener('click',()=>{
    showTodoFilter(filter);run(()=>loadOwnerTodos({reset:true}));
  });
  $('owner-todo-refresh').addEventListener('click',()=>run(()=>loadOwnerTodos({reset:true})));
  const followupReconsiderMessage=result=>{
    if(result.status==='sent')return '手动重新考虑结果：鱼鱼决定回访，平台确认发送成功';
    if(result.status==='uncertain')return '手动重新考虑结果：尝试发送，但回执不确定，禁止自动重试';
    if(result.decision==='skip')return '手动重新考虑结果：鱼鱼决定保持沉默，已结束这条回访';
    if(result.decision==='defer'||result.decision==='reply-without-grounded-text')return '手动重新考虑结果：'+(result.modelInvoked===false?'本轮未成功调用模型；':'已重新询问鱼鱼；')+(result.diagnosticReason||result.skipped||'鱼鱼选择稍后考虑');
    return '手动重新考虑结果：'+(result.skipped||result.error||'没有发送，查看对应待办的检查原因');
  };
  $('owner-todo-followup-reconsider').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'请确认操作',description:'这会跳过延期时间，让鱼鱼重新决定一次；如果有多条待回访，请使用每条记录旁的「重新考虑」按钮指定对象。不是模拟测试：确认安全校验后可能真正发消息。继续？'}))return;
    const result=await request('/owner-todos/followup',{action:'debug-reconsider'});
    await loadOwnerTodos();message(followupReconsiderMessage(result));
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
      revision:$('life-v2-mode').dataset.revision||'',previewOnly,
      videoAgentMinIntervalMinutes:boundedInt('life-v2-video-min-interval',1,1440,'视频 Agent 最短启动间隔'),
      videoAgentReadTargetPerRound:boundedInt('life-v2-video-read-target',1,30,'每轮阅读视频数'),
      videoAgentPickTargetPerRound:boundedInt('life-v2-video-pick-target',0,12,'每轮挑选视频数'),
      schedule:{startHour:boundedInt('life-v2-start',0,23,'每日开始时段'),endHour:boundedInt('life-v2-end',1,24,'每日结束时段')}};
    if(body.pace==='custom'&&body.mode!=='off')body.advanced={
      minutes:boundedInt('life-v2-minutes',5,1440,'最短考虑间隔'),
      dailyLimit:boundedInt('life-v2-limit',1,288,'每日模型额度')};
    if(!previewOnly)body.confirm='APPLY_LIFE_SETTINGS_V2';
    return request('/life-agent/settings-v2',body);
  };
  const describeLifeDiff=changes=>Object.entries(changes||{}).map(([k,v])=>`${k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`).join('；')||'配置没有变化';
  const lifeVideoPacePresets=Object.freeze({quiet:[60,3,3],natural:[30,5,5],lively:[15,8,5]});
  const fillLifeVideoPreset=pace=>{
    const values=lifeVideoPacePresets[pace];if(!values)return;
    for(const [id,value] of [['life-v2-video-min-interval',values[0]],['life-v2-video-read-target',values[1]],['life-v2-video-pick-target',values[2]]])$(id).value=String(value);
  };
  const chooseLifePace=pace=>{
    $('life-v2-pace').value=pace;fillLifeVideoPreset(pace);
    $('life-settings-advanced').open=pace==='custom';syncLifeChoiceCards();
  };
  const syncLifeChoiceCards=()=>{
    for(const [name,id] of [['life-mode-card','life-v2-mode'],['life-pace-card','life-v2-pace']]){
      const value=$(id).value;
      document.querySelectorAll('input[name="'+name+'"]').forEach(r=>{r.checked=r.value===value});
    }
  };
  document.querySelectorAll('input[name="life-mode-card"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked){$('life-v2-mode').value=r.value;syncLifeChoiceCards()}
  }));
  document.querySelectorAll('input[name="life-pace-card"]').forEach(r=>r.addEventListener('change',()=>{
    if(r.checked)chooseLifePace(r.value)
  }));
  $('life-v2-mode').addEventListener('change',syncLifeChoiceCards);
  $('life-v2-pace').addEventListener('change',()=>chooseLifePace($('life-v2-pace').value));
  for(const id of ['life-v2-minutes','life-v2-limit'])$(id).addEventListener('change',()=>{$('life-v2-pace').value='custom';$('life-settings-advanced').open=true;syncLifeChoiceCards()});
  for(const id of ['life-v2-start','life-v2-end'])$(id).addEventListener('input',paintLifeHours);
  document.querySelectorAll('[data-life-hours]').forEach(btn=>btn.addEventListener('click',()=>{
    const [start,end]=String(btn.dataset.lifeHours||'').split(',').map(Number);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return;
    $('life-v2-start').value=String(start);$('life-v2-end').value=String(end);paintLifeHours();
  }));
  paintLifeHours();
  for(const id of ['life-v2-video-min-interval','life-v2-video-read-target','life-v2-video-pick-target'])$(id).addEventListener('change',()=>{chooseLifePace('custom');$('life-settings-advanced').open=true});
  // 整体生活方式：只组合已有字段，不新增第二套记忆/兴趣/人格账本。
  // 每次显式预览+确认；旧用户不自动迁移，任何平台发送权限都不在组合中。
  const organicProfiles=Object.freeze({
    gentle:{pace:'quiet',mainSessionMemoryHalfLifeDays:24,mainSessionMemoryThreshold:.45,mainSessionMemoryMaxItems:5,mainSessionMemoryMaxChars:800,mainSessionReflectionMinCandidates:8,mainSessionReflectionBatchSize:16,mainSessionReflectionIntervalHours:6,mainSessionReflectionDailyBatches:4},
    balanced:{pace:'natural',mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:8,mainSessionMemoryMaxChars:1200,mainSessionReflectionMinCandidates:6,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16},
    curious:{pace:'lively',mainSessionMemoryHalfLifeDays:45,mainSessionMemoryThreshold:.3,mainSessionMemoryMaxItems:10,mainSessionMemoryMaxChars:1600,mainSessionReflectionMinCandidates:4,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16}
  });
  const organicParameterNames={pace:'生活活跃度',mainSessionMemoryHalfLifeDays:'普通记忆半衰期',
    mainSessionMemoryThreshold:'召回证据门槛',mainSessionMemoryMaxItems:'每轮召回上限',
    mainSessionMemoryMaxChars:'每轮召回字数',mainSessionReflectionMinCandidates:'反思候选门槛',
    mainSessionReflectionBatchSize:'反思单批上限',mainSessionReflectionIntervalHours:'反思最短间隔',
    mainSessionReflectionDailyBatches:'每日反思批数'};
  const organicParameterUnits={mainSessionMemoryHalfLifeDays:'天',mainSessionMemoryMaxItems:'条',
    mainSessionMemoryMaxChars:'字',mainSessionReflectionMinCandidates:'条',
    mainSessionReflectionBatchSize:'条',mainSessionReflectionIntervalHours:'小时',
    mainSessionReflectionDailyBatches:'批'};
  const describeOrganicParameters=()=>{
    const target=$('life-organic-parameters');target.replaceChildren();
    const profile=organicProfiles[$('life-organic-profile').value];
    if(!profile){target.appendChild(info('自定义：生活参数在「鱼鱼正在做」设置，记忆与检索参数在本折叠栏直接编辑。'));return}
    for(const [key,value] of Object.entries(profile)){
      const row=node('div');row.appendChild(node('span',organicParameterNames[key]||key));
      row.appendChild(node('strong',key==='pace'?({quiet:'安静（80 分 / 50 次）',natural:'自然（30 分 / 100 次）',lively:'活跃（10 分 / 200 次）'}[value]||value):String(value)+(organicParameterUnits[key]||'')));
      target.appendChild(row);
    }
  };
  describeOrganicParameters();
  document.querySelectorAll('input[name="life-organic-choice"]').forEach(radio=>radio.addEventListener('change',()=>{
    $('life-organic-profile').value=radio.value;describeOrganicParameters();
    $('life-organic-custom').hidden=radio.value!=='custom';
    $('life-organic-preview').disabled=radio.value==='custom';
    $('life-organic-apply').disabled=radio.value==='custom';
  }));
  $('life-organic-custom-open').addEventListener('click',()=>{
    void Promise.resolve(switchTab('life-agent')).then(()=>{
      $('life-v2-pace').value='custom';$('life-settings-advanced').open=true;syncLifeChoiceCards();
      revealTarget($('life-settings-advanced'));
    });
  });
  const organicPlan=async()=>{
    const choice=$('life-organic-profile').value,profile=organicProfiles[choice];
    if(!profile)throw Error('自定义方案请直接修改生活与记忆设置');
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
    chooseLifePace(profile.pace);
    const currentMode=$('life-v2-mode').value;
    try{await proposedLifeSettings(true)}catch(e){chooseLifePace(prior);throw e}
    if(!await confirmAction({title:'应用这套生活方式？',description:'更新生活活跃度，并调整 '+changes.length+' 项记忆/反思参数。不会删除记忆、恢复遗忘内容或打开社交发送权限。',confirmLabel:'确认应用'})){chooseLifePace(prior);return}
    try{
      await proposedLifeSettings(false);
    }catch(e){chooseLifePace(prior);throw e}
    try{
      if(changes.length)await request('/config',Object.fromEntries(changes));
    }catch(e){$('life-organic-status').textContent='生活档位已保存，但记忆设置未确认成功；请检查记忆页再决定是否重试。';throw e}
    $('life-organic-status').textContent='已应用。生活'+(currentMode==='off'?'仍是暂停状态':'按原状态运行')+'；记忆只改变今后的召回与反思节奏。';
    await loadUnifiedLifeSettings();
    message('已应用生活与记忆搭配，社交权限不变。');
  }));
  $('life-v2-preview-btn').addEventListener('click',()=>run(async()=>{
    const r=await proposedLifeSettings(true);
    $('life-v2-status').textContent='预览：'+describeLifeDiff(r.plan?.changed)+'。视频 Agent 最短启动间隔同时约束自动和手动启动；目前尚未保存。';
  }));
  $('life-v2-save-btn').addEventListener('click',()=>run(async()=>{
    const plan=(await proposedLifeSettings(true)).plan;
    const diff=describeLifeDiff(plan?.changed);
    if(!await confirmAction({title:'保存生活设置？',description:(Object.keys(plan?.changed||{}).length+' 项设置变化；生活额度可能增加模型费用。社交授权不变。'),confirmLabel:'保存设置'}))return;
    const btn=$('life-v2-save-btn');btn.disabled=true;
    try{
      const r=await proposedLifeSettings(false);
      message(r.unchanged?'生活设置没有变化（运行配置不变）':
        r.localVerified===true?localSaveNotice(r,'生活设置及视频 Agent 启动间隔已保存；旧视频定时器已退出'):
        '生活设置已提交；请读取当前生效值确认，原生设置镜像状态不代表保存失败');
      await loadOwnerTodos();
      await loadUnifiedLifeSettings();
      await loadLifeIntegration();
    }finally{btn.disabled=false}
  }));
  $('life-readiness-refresh').addEventListener('click',()=>run(async()=>{
    await loadOwnerTodos();
    message('已重新读取真实门禁和最近委派记录；未调用模型、未启动视频。');
  }));
  $('life-video-agent-test-run').addEventListener('click',()=>run(async()=>{
    const button=$('life-video-agent-test-run');button.disabled=true;
    try{
      const accepted=await confirmAction({title:'手动启动一轮真实视频 Agent？',
        description:'这会立即启动原 B站视频 Agent，读取真实首页候选并由 Agent 自主决定探索和是否评论。不会强制评论。若 Agent 自主提出评论、点赞、收藏或关注，仍须通过原 Life 统一意愿审批、账号/隐私/平台门禁及真实回执；当前账号的原有授权保持不变。每次只启动一轮，并受上方配置的最短启动间隔、模型/平台额度和进程忙碌限制。',
        confirmLabel:'启动一轮真实视频探索'});
      if(!accepted)return;
      const result=await request('/life-agent/video-agent-test-run',{confirm:'START_ONE_REAL_VIDEO_AGENT_ROUND'});
      $('life-video-agent-test-result').textContent=result.started===true
        ?'已确认启动一轮真实视频 Agent。它可以挑选、继续探索或结束，也可以自主决定不评论；请稍后刷新「大肥鱼的一天」和「鱼鱼的决策全过程」查看开始、结束及评论诊断。启动成功不代表已经观看或发表评论。'
        :'本轮没有启动：'+({disabled:'Life 未处于 active 模式或自主调度已暂停','account-not-ready':'账号或首次设置未就绪','video-busy':'视频 Agent 正在运行','video-launch-cooldown':'视频启动冷却尚未结束','daily-video-quota':'平台视频额度已用完','report-off-one-round':'报告关闭时本日单轮限制已达到','home-recommendations-disabled':'首页推荐读取未开启'}[result.reason]||result.error||result.reason||'技术门禁未通过');
      await loadLifeIntegration();await loadLifeNowTimeline().catch(()=>{});
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
        'social-signal-considered':'Life 仅关注到社交事件；回复 Agent 独立处理，未触发发送，不代表已回复',
        'social-shadow-reply':'仅观察到回复倾向，未发送',
        'social-shadow-defer':'仅观察到延期倾向，未发送',
        'social-shadow-silent':'仅观察到沉默倾向，未发送',
        'social-shadow-invalid':'社交观察未获得合规模型输出',
        'search-failed':'公开搜索未成功（技术失败，已按线索冷却）','metadata-read-failed':'元数据读取失败（不是鱼鱼不想了解）',
        'creator-read-failed':'作者公开空间核验未成功',
        'reflection-not-available':'缺少可反思的可信经历',
        'willingness-recheck-blocked':'执行前意愿复核未通过'};
      const noOptionReasons={'video-launch-cooldown':'视频 Agent 启动冷却尚未结束；请在生活状态页查看当前冷却设置',
        'video-daily-limit':'平台自身策略暂不允许启动',
        'video-technical-backoff':'视频启动此前出现技术故障，正在退避；本轮未向 Life 模型提供可执行动作，不代表鱼鱼选择休息',
        'video-agent-busy':'视频 Agent 正忙，本轮没有可执行的视频动作',
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
    await loadOwnerTodos();message('待办回访设置已保存；生活节奏请在「Life 自主生活」中管理。');
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

  // The behavior tree is a read-only visualization of the existing Life action
  // contract. Never infer availability from this catalog; an offered menu is
  // target-specific and exists only within that decision turn.
  const lifeTreeGroups=[
    {title:'生活与待办',items:[['execute_read','完成只读待办'],['defer','决定稍后'],['dismiss','放下机会'],['skip','自由休息']]},
    {title:'发现与探索',items:[['browse_home','逛首页'],['begin_exploration','形成好奇'],['inspect_exploration','核实视频'],['observe_video','正在看视频画面'],['inspect_creator_space','看原作者投稿']]},
    {title:'公开互动',items:[['inspect_opportunity','核实契机'],['inspect_shared_link','查看私信分享链接'],['inspect_related_content','探索关联的原动态/视频'],['like_shared_dynamic','自主点赞公开动态'],['comment_shared_dynamic','自主评论公开动态'],['review_public','回顾公开互动'],['inspect_public_person','看交流对象投稿'],['consider_social','留意社交']]},
    {title:'继续与回忆',items:[['resume_episode','继续一段经历'],['abandon_exploration','结束探索'],['review_video_feedback','回顾视频体验'],['reflect','整理体会']]},
    {title:'自主交流',items:[['review_friend','想起熟人'],['reach_out_friend','适当主动私信'],['talk_to_owner','联系主人'],['video_comment','视频评论意愿']]},
    {title:'专业能力',items:[['use_capability','委托视频 Agent'],['share_video','分享作品意愿'],['like_video','点赞／收藏／关注¹'],['other_write','评论与私信发送¹']]}
  ];
  // ¹ Professional Agent writes are downstream, separately authorized actions.
  const treeSvgNS='http://www.w3.org/2000/svg';
  const makeTreeSvg=(tag,attrs={},content='')=>{const x=document.createElementNS(treeSvgNS,tag);for(const [k,v] of Object.entries(attrs))x.setAttribute(k,String(v));if(content)x.textContent=content;return x};
  // Read only persisted, anonymized origin codes. Older turns had no such
  // fields; a source guessed from the action name would mislead the owner.
  const lifeOriginLabel=(plan)=>{
    if(!plan||!Object.hasOwn(plan,'origin'))return '历史决策未记录来源（升级后新轮次才会显示）';
    const names={
      'self-choice':'鱼鱼自主选择','owner-todo':'主人待办','social-todo':'接受的社交推荐待办',
      'life-cue':'真实生活线索','life-opportunity':'已核验生活契机','life-episode':'已有经历的续行',
      'social-event':'新社交提醒','friend-relationship':'熟人关系线索','reflection':'已有经历触发的反思',
      'video-round':'视频轮次回执','life-event':'已核验生活事件','owner-conversation':'主人对话状态',
      'unknown':'来源无法确认'
    };
    const detail={
      'rest':'选择休息','homepage':'B站首页漫游','owner-chat':'主动找主人聊天','silence':'主人暂时没有新消息',
      'owner-created':'主人添加','dm-recommendation':'私信推荐','accepted-recommendation':'社交建议',
      'discussion-read':'公开讨论中的疑问','interest-milestone':'兴趣趋势','selection-curiosity':'自主选片的好奇',
      'public-person-observation':'跨日公开交流','episode-carryover':'前一章节的新证据',
      'home-browse':'之前的首页探索','inspected-opportunity':'已核实的生活契机',
      'completed-video-todo':'已完成的视频待办','comment-reply-receipt':'公开交流回执',
      'verified-relationship':'真实双向互动','dm-received':'新的私信提醒','comment-received':'新的评论提醒',
      'experience-ready':'新完成的可信读取','eligible-experiences':'待反思经历','confirmed-round-receipt':'已完成的视频轮次',
      'target-unavailable':'目标证据无法关联','unbound-capability-event':'专业能力未绑定单一契机',
      'ambiguous-target':'目标关联有歧义','unattributed-action':'缺少可验证的对应证据',
      'unmatched-owner-event':'主人对话事件未能对应','invalid-decision':'模型输出不合规，不能视为主动休息','other-evidence':'具体来源未细分',
      'unrecognized-todo-source':'待办来源未被识别'
    };
    const title=names[plan.origin]||'来源无法确认';
    const sub=detail[plan.layer]||'';
    const ref=typeof plan.sourceRef==='string'&&/^[a-f0-9]{16}$/.test(plan.sourceRef)?' · 来源指纹 '+plan.sourceRef.slice(0,8):'';
    return title+(sub?' · '+sub:'')+ref;
  };
  let lastLifeTreeId='',lastLifeTreeFingerprint='',lifeTreeRendered=false;
  const loadLifeBehaviorTree=async()=>{
    const svg=$('life-behavior-tree'),status=$('life-behavior-status');if(!svg||!status)return;
    try{
      const [snapshot,liveSnapshot]=await Promise.all([request('/life-agent/decision-traces'),request('/live-activity').catch(()=>({ok:false,active:[]}))]);
      const latest=(snapshot.runs||[])[0];
      const liveRows=Array.isArray(liveSnapshot?.active)?liveSnapshot.active:[];
      const liveVideoObserve=liveRows.find(x=>x.kind==='video-observe');
      const liveOwnerVideoDebug=liveRows.find(x=>x.kind==='video-observe-debug');
      const currentVideoObservation=liveVideoObserve||liveOwnerVideoDebug;
      const videoTarget=$('life-tree-video-target'),videoLink=$('life-tree-video-link');
      const targetBv=/^BV[0-9A-Za-z]{10}$/.test(String(currentVideoObservation?.bvid||''))?currentVideoObservation.bvid:'';
      if(videoTarget&&videoLink){videoTarget.hidden=!targetBv;if(targetBv){videoLink.href='https://www.bilibili.com/video/'+targetBv;videoLink.textContent=targetBv+' · 打开视频 ↗'}}
      const liveActivityTag=$('life-timeline-live-activity');
      if(liveActivityTag){
        const current=liveRows.find(x=>['video-observe','video-observe-debug','video','life','dm','comment'].includes(x.kind));
        const recent=(Array.isArray(liveSnapshot?.recent)?liveSnapshot.recent:[]).slice().reverse().find(x=>
          ['video-observe','video-observe-debug'].includes(x.kind)&&Date.now()-Date.parse(x.at)<5*60_000);
        liveActivityTag.hidden=!current&&!recent;
        if(current){liveActivityTag.textContent='● '+current.title+' · '+new Date(current.since).toLocaleTimeString('zh-CN')+' · '+current.detail;liveActivityTag.dataset.kind=current.kind}
        else if(recent){liveActivityTag.textContent='○ '+recent.text+' · '+new Date(recent.at).toLocaleTimeString('zh-CN')+' · 不是模型成功识图的证据';liveActivityTag.dataset.kind=recent.kind}
        else liveActivityTag.removeAttribute('data-kind');
      }
      let selected='';const steps=latest?.steps||[];
      const plan=steps.find(x=>x.type==='execution-plan');
      const actionStep=steps.find(x=>x.type==='action-start');
      const originNode=$('life-action-origin');
      const sourceText=liveOwnerVideoDebug?'主人手动只读视频调试（非 Life 自主行动）':
        liveVideoObserve?'Life 自主观看画面（回执待确认）':latest?lifeOriginLabel(plan):'还没有可关联的行动来源';
      if(originNode){const text=originNode.querySelector('span');if(text)text.textContent=sourceText;}
      // A candidate is not a chosen action. Highlight only a real execution
      // plan or an actual action-start record; use kind when plan.action='act'.
      const actions=[plan?.action,plan?.kind,actionStep?.action,actionStep?.kind];
      selected=String(actions.find(action=>action&&action!=='act'&&action!=='none'&&
        lifeTreeGroups.some(group=>group.items.some(([id])=>id===action)))||'');
      const known=lifeTreeGroups.some(group=>group.items.some(([a])=>a===selected));
      if(!known)selected='';
      // A live, account-scoped visual read outranks an older decision trace.
      // It is only an in-flight state, not a claim that the model understood it.
      if(liveVideoObserve)selected='observe_video';
      const result=steps.slice().reverse().find(x=>x.type==='action-result'||x.type==='execution-result'||x.type==='finish');
      const now=Date.now(),age=Number(latest?.updatedAt||latest?.at||0),fresh=age>0&&now-age<45000;
      const hasReceipt=steps.some(x=>x.type==='action-result'||x.type==='execution-result');
      const running=(!!latest&&latest.state==='running'&&fresh&&!hasReceipt)||!!currentVideoObservation;
      const considering=running&&!selected;
      const executing=running&&!!selected;
      const finished=!!latest&&latest.state!=='running'&&hasReceipt;
      const stageMap={candidate:'可信候选',choice:'鱼鱼自己的选择',execute:'执行或交给专业能力',receipt:'独立核验结果'};
      const rail=$('life-choice-rail');
      if(rail){
        const hasCandidates=steps.some(x=>x.type==='candidate-scan'||x.type==='candidate-detail');
        const choice=steps.find(x=>x.type==='model-choice');
        const started=steps.some(x=>x.type==='action-start'||x.type==='execution-plan');
        const completed=steps.slice().reverse().find(x=>x.type==='action-result'||x.type==='execution-result');
        const finalResult=String(completed?.result||'');
        const statusMap={
          'not-sent':'未发送','verified':'已核验回执','platform-verified':'平台已核验',
          'capability-launched':'已启动，未证实完整执行',
          'no-actionable-options':'暂时没有可执行机会',
          'voluntary-rest':'鱼鱼选择休息',
          'result-uncertain':'回执不确定，不自动重发'};
        const explanation=latest?.explanation;
        const lifeChoice=choice&&['valid','model-accepted'].includes(choice.code);
        const receiptExplanation={
          'platform-verified':'平台回执已核验','action-verified':'已核验动作回执（非平台送达证明）',
          'voluntary-rest':'鱼鱼本轮自主休息','voluntary-defer':'鱼鱼本轮自主延期',
          'no-opportunity':'本轮无可执行机会','invalid-decision':'模型选择未通过校验',
          'result-uncertain':'结果未知，不能自动重发','host-queued':'已交给主会话，未证实送达',
          'delegated-unconfirmed':'已委派，未证实完成','local-result-unverified':'已有本地结果，尚无独立平台回执',
          'model-unavailable':'模型调用或退避阻断','permission-blocked':'当前权限阻断',
          'budget-deferred':'读取或模型预算延期','platform-rate-limit':'平台限流延期',
          'network-deferred':'网络故障延期','reservation-held':'执行预约占用',
          'approval-pending':'已批准，等待执行回执','approval-review-required':'批准未结算，需核查'};
        const stageDetails={
          candidate:[hasCandidates?'已识别候选来源':'本轮未观察到候选',hasCandidates?'finished':''],
          choice:[!choice?'尚未观察到决定':!lifeChoice?'模型选择未通过校验':choice.action==='skip'?'鱼鱼选择暂不行动':choice.action==='defer'?'鱼鱼选择延期':'鱼鱼已选择行动',choice?'finished':''],
          execute:[started?(running?'正在执行':hasReceipt?'已有执行记录':'已选择，待回执'):'尚无执行计划',running?'live':started?'finished':''],
          receipt:[explanation?(receiptExplanation[explanation.category]||'结果尚未独立核验'):completed?(statusMap[finalResult]||'本轮结果请查看诊断'):'尚无本轮回执',explanation?.proof==='platform-receipt'?'finished':explanation?.category==='voluntary-rest'?'unsent':explanation?.category==='result-uncertain'?'blocked':'']
        };
        for(const stage of rail.querySelectorAll('[data-stage]')){
          const info=stageDetails[stage.dataset.stage]||[stageMap[stage.dataset.stage],''];
          stage.querySelector('strong').textContent=info[0];stage.dataset.state=info[1];
        }
      }
      const firstSeen=latest?.id!==lastLifeTreeId;lastLifeTreeId=latest?.id||'';
      const treeFingerprint=JSON.stringify([latest?.id,latest?.state,latest?.updatedAt,selected,result?.result,considering,executing,finished,currentVideoObservation?.since||'',currentVideoObservation?.kind||'',targetBv]);
      const redraw=!lifeTreeRendered||treeFingerprint!==lastLifeTreeFingerprint;
      if(!redraw)return;
      lastLifeTreeFingerprint=treeFingerprint;lifeTreeRendered=true;
      svg.dataset.phase=currentVideoObservation?'executing':considering?'thinking':executing?'executing':finished?'settled':selected?'chosen':'idle';
      svg.replaceChildren();
      svg.classList.remove('is-new-action');
      if(firstSeen&&latest){void svg.offsetWidth;svg.classList.add('is-new-action')}
      const overlay=makeTreeSvg('g',{class:'life-tree-links'});svg.appendChild(overlay);
      const nodeGroup=makeTreeSvg('g');svg.appendChild(nodeGroup);
      // Compact action tree: only five stable branches. The concrete action
      // leaf enters when observed, never display every possible tool by default.
      const branches=[
        {title:'生活安排',ids:['execute_read','defer','dismiss','skip','inspect_opportunity']},
        {title:'发现与观看',ids:['browse_home','begin_exploration','inspect_exploration','observe_video','inspect_creator_space','inspect_shared_link','inspect_related_content']},
        {title:'交流互动',ids:['review_public','inspect_public_person','consider_social','review_friend','reach_out_friend','talk_to_owner','video_comment','like_shared_dynamic','comment_shared_dynamic','share_video','like_video','other_write']},
        {title:'记忆与体会',ids:['resume_episode','abandon_exploration','review_video_feedback','reflect']},
        {title:'专业协助',ids:['use_capability']}
      ];
      const focusedAction=currentVideoObservation?'observe_video':selected;
      const focusBranch=branches.findIndex(branch=>branch.ids.includes(focusedAction));
      svg.setAttribute('viewBox','0 0 970 400');
      const path=(fromX,fromY,toX,toY,chosen=false)=>{
        const d=`M ${fromX} ${fromY} C ${(fromX+toX)/2} ${fromY}, ${(fromX+toX)/2} ${toY}, ${toX} ${toY}`;
        overlay.appendChild(makeTreeSvg('path',{d,class:'life-tree-edge'+(chosen?' is-selected':'')+(chosen&&running?' is-executing':chosen&&finished?' is-completed':'')}));
      };
      const rect=(x,y,w,h,chosen=false)=>nodeGroup.appendChild(makeTreeSvg('rect',{x,y,width:w,height:h,rx:13,class:'life-tree-node'+(chosen?' is-selected':'')+(chosen&&running?' is-executing':'')}));
      const label=(x,y,text,secondary=false)=>nodeGroup.appendChild(makeTreeSvg('text',{x,y,'text-anchor':'middle',class:secondary?'life-tree-subtext':'life-tree-text'},text));
      rect(20,161,188,76,true);label(114,192,liveOwnerVideoDebug?'主人只读调试':'🐟 Life 自主生活');label(114,213,liveOwnerVideoDebug?'仅供诊断 · 非 Life 选择':'真实选择 · 不预设动作',true);
      for(const [i,branch] of branches.entries()){
        const y=18+i*76,active=i===focusBranch;
        path(208,199,330,y+30,active);rect(330,y,210,60,active);label(435,y+26,branch.title);label(435,y+45,active?'本轮有实际行为':'行为类型',true);
        if(active){
          path(540,y+30,640,y+30,true);rect(640,y+3,300,54,true);
          const title=currentVideoObservation?currentVideoObservation.title:
            (lifeTreeGroups.flatMap(g=>g.items).find(([a])=>a===focusedAction)?.[1]||'已选行动');
          label(790,y+25,title.slice(0,18));
          label(790,y+43,currentVideoObservation?(targetBv?'当前视频 '+targetBv:(liveOwnerVideoDebug?'主人只读验收 · 非 Life 决策':'真实画面读取 · 回执待确认')):
            (executing?'执行中':finished?'本轮已经结算':'最近一次选择'),true);
        }
      }
      const tr=latest?new Date(Number(latest.at)).toLocaleTimeString('zh-CN',{hour12:false}):'';
      const outcome=String(result?.result||'');
      const selectedStatus=outcome==='not-sent'?'is-unsent':
        outcome==='verified'||outcome==='platform-verified'?'is-confirmed':
        outcome?'is-pending':'';
      if(!currentVideoObservation&&selected&&selectedStatus){for(const box of svg.querySelectorAll('.life-tree-node.is-selected'))box.classList.add(selectedStatus)}
      if(considering){const rootBox=svg.querySelector('.life-tree-node.is-selected');rootBox?.classList.add('is-thinking')}
      if(!currentVideoObservation&&finished&&selected){for(const box of svg.querySelectorAll('.life-tree-node.is-selected'))box.classList.add('is-completed')}
      const receiptMessage={'not-sent':'未发送','verified':'动作已核验','platform-verified':'平台已核验','capability-launched':'专业 Agent 已启动，不代表观看完成','no-actionable-options':'本轮没有可执行机会','voluntary-rest':'鱼鱼选择休息','video-feedback-considered':'已回顾真实视频反馈','episode-step-limit':'生活片段本轮已到上限'};
      const actionName=lifeTreeGroups.flatMap(g=>g.items).find(x=>x[0]===selected)?.[1];
      const nextStatus=currentVideoObservation?`${liveOwnerVideoDebug?'主人只读视频验收':'Life 正在看视频画面'} · 开始于 ${new Date(currentVideoObservation.since).toLocaleTimeString('zh-CN')} · 等待真实视觉回执（不代表已理解）`:
        latest?`最近决策 ${tr} · ${actionName||'尚未选中执行动作'} · ${receiptMessage[outcome]||(!outcome?'尚无执行回执':'具体结果见运行诊断')}${running?' · 执行中':''}`:'还没有可展示的真实决策；下方节点仅是已接线的能力类别。';
      const statusChanged=status.textContent!==nextStatus;
      status.textContent=nextStatus;
      if(statusChanged&&latest){status.classList.remove('is-arriving');void status.offsetWidth;status.classList.add('is-arriving')}
      if(firstSeen&&selected)svg.setAttribute('data-latest-action',selected);
    }catch(e){const target=$('life-tree-video-target');if(target)target.hidden=true;status.textContent='暂时无法取得真实决策轨迹，行动树不会模拟活动。';const span=$('life-action-origin')?.querySelector('span');if(span)span.textContent='来源暂时无法取得';svg.replaceChildren()}
  };
  $('life-behavior-refresh')?.addEventListener('click',()=>run(loadLifeBehaviorTree));
  const loadLifeDecisionTraces=async()=>{
    const status=$('life-traces-status'),list=$('life-traces-list');list.replaceChildren();
    try{
      const data=await request('/life-agent/decision-traces');
      const runs=data.runs||[];
      status.textContent=`当前账号最近 7 天 ${runs.length} 轮（最多保留 60 轮）。每轮只读归类 Life 选择、执行阻断与真实回执；模型选择不等于执行成功。无私信原文、完整提示词、模型原始理由或目标 ID；无法推断模型内部思维链。`;
      const explanations={
        'decision-in-progress':'正在考虑，尚无可核验决定','execution-in-progress':'已选中动作，执行尚未结算','choice-awaiting-result':'Life 已选择，等待执行结果','decision-review-required':'决策记录长时间未结算，需核查',
        'approval-pending':'Life 已批准，等待独立执行回执','receipt-unsettled':'已有执行回执，但本轮尚未结算，需核查','approval-review-required':'已批准但未结算，需核查原事务，禁止自动补发',
        'platform-verified':'已有平台核验成功回执','action-verified':'有动作核验回执，但不能据此声称平台已送达',
        'delegated-unconfirmed':'已委派专业能力，尚未证实完成','host-queued':'主会话已排队，尚未证实送达',
        'invalid-decision':'模型输出或选择未通过校验，不能视为鱼鱼主动放弃',
        'voluntary-rest':'Life 本轮明确选择休息／不行动','voluntary-defer':'Life 本轮明确选择延期',
        'no-opportunity':'本轮没有可执行机会，不能视为鱼鱼拒绝',
        'evidence-insufficient':'关键证据不足，技术侧未提供完整行动依据',
        'permission-blocked':'当前授权或权限阻断，未执行','budget-deferred':'共享预算或模型额度不足，技术延期',
        'platform-rate-limit':'平台限流，技术延期','network-deferred':'网络退避，技术延期',
        'reservation-held':'已有执行预约或锁占用，技术等待','resource-deferred':'Life 资源调度繁忙，未形成有效执行',
        'account-unavailable':'账号未核验或已切换，拒绝执行','model-unavailable':'模型失败或退避，不是鱼鱼主动沉默',
        'read-unavailable':'平台只读未取得可信结果','technical-blocked':'技术或安全门禁阻断，具体原因见下方步骤',
        'technical-error':'本轮发生技术错误，不能冒充完成','execution-failed':'执行失败或未发送，不能当作成功',
        'result-uncertain':'外部结果未知，保持安全冻结，不自动重发',
        'mixed-outcomes':'本轮包含成功与失败／阻断，无法按单一动作确认整体结果；不自动重发',
        'local-only':'仅本地考虑或处理，未发生平台发送','local-result-unverified':'只有本地结果分类，没有独立平台成功证明',
        'choice-without-receipt':'Life 已选择，但没有对应执行回执','candidates-only':'仅有候选记录，未观察到 Life 决定',
        'evidence-unresolved':'当前记录不足，无法判断本轮最终原因'};
      const commentExplanations={
        'offered':'评论曾出现在本轮可选菜单','no-verified-public-evidence':'评论未提供：缺少可信公开视频证据',
        'comment-permission-off':'评论未提供：主人未开启授权','comment-quota-off':'评论未提供：额度限制',
        'missing-verified-title':'评论未提供：缺少核验标题','episode-or-write-aftercare':'评论未提供：本轮处于片段续行或写入后处理'};
      const labels={start:'开始本轮', 'candidate-scan':'可信候选筛选','candidate-detail':'候选事件详情（匿名类型）','model-input':'模型实际输入范围（摘要／指纹）','model-output':'模型调用返回（长度与耗时）','execution-plan':'执行计划与目标（脱敏）','execution-result':'动作执行结果（不代表平台送达）','event-resolution':'单条事件结算','quota-reserved':'模型额度预约','video-round-feedback':'视频轮次回执（非观看证明）','video-comment-summary':'视频 Agent 原创主评论诊断（非观看证明）','unknown-stage':'未识别诊断阶段（不代表动作失败）','model-call':'调用生活模型','model-choice':'模型决策校验','preflight':'执行前核验','action-start':'开始执行能力','action-result':'执行结果／回执','read-result':'平台只读结果（脱敏分类）','memory-projection':'已核验经历写入记忆队列','experience-yield':'本轮只读是否产生新证据','next-wake':'后续自主考虑机会','event-settlement':'事件账本结算',journal:'保存本轮记录',finish:'本轮结束',error:'技术错误',blocked:'安全门禁阻止'};
      for(const [i,item] of runs.entries()){
        const details=node('details','','record');if(i===0)details.open=true;
        const actionResult=(item.steps||[]).slice().reverse().find(step=>step.type==='action-result');
        const onlyShadow=/^social-shadow-/.test(String(actionResult?.result||''));
        const traceLabels={'approval-pending':'Life 已同意 · 等待动作执行与回执','approval-unsettled':'Life 已同意 · 回执超时未结算（需核查）','decision-running':'模型／决策仍在处理','decision-unsettled':'决策记录长时间未结算（需核查）',failed:'本轮技术失败',blocked:'本轮被安全门禁阻止','platform-verified':'平台发送已核验','action-verified':'动作回执已核验', 'result-uncertain':'回执不确定，禁止自动重发','decision-finished':'本轮结束（不等于发送成功）'};
        const turnStatus=onlyShadow?'历史影子记录（旧版、未发送）':
          explanations[item.explanation?.category]||traceLabels[item.presentation]||'状态未识别（需核查）';
        const summary=node('summary',`${formatLocalTime(new Date(item.at).toISOString())} · ${item.trigger==='manual'?'手动考虑':item.trigger==='social'?'社交快速考虑':item.trigger==='video-agent-result'?'视频 Agent 完成回执':item.mode==='willingness'?'Life 意愿判断':'自动生活'} · ${turnStatus} · 调试号 ${item.id.slice(0,8)}`);
        details.appendChild(summary);
        if(item.explanation){
          const x=item.explanation;
          const proofNames={'none':'尚无结果证据','model-choice':'仅有模型选择','local-receipt':'仅有本地执行分类／回执','platform-receipt':'平台回执已核验','technical-status':'技术状态／阻断证据'};
          details.appendChild(node('p',`本轮归类：${explanations[x.category]||'尚无法解释'} · 依据：${proofNames[x.proof]||'未核实'}。这是脱敏轨迹归类，不是对模型内心原因的证明。`,'muted'));
          if(commentExplanations[x.commentOpportunity])details.appendChild(node('p',commentExplanations[x.commentOpportunity]+'；是否发表评论还取决于 Life 选择和实际执行回执。','muted'));
          const restReasonNames={'need-rest':'想休息','not-now':'暂时不想行动','not-interested':'暂时不感兴趣','need-evidence':'认为证据不足','avoid-disturb':'不想打扰','no-priority':'暂时没有优先事项'};
          if(x.actor==='life'&&restReasonNames[x.restReason])details.appendChild(node('p',`Life 提供的可公开休息类别：${restReasonNames[x.restReason]}（不是独立验证的内心因果）。`,'muted'));
        }
        for(const step of item.steps||[]){
          const restReasonNames={'need-rest':'想休息一会儿','not-now':'暂时不想继续','not-interested':'对当前机会没有兴趣','need-evidence':'觉得证据不足','avoid-disturb':'不想打扰别人','no-priority':'暂时没有想优先做的事'};
          const fields=Object.entries(step).filter(([k])=>!['type','at'].includes(k)).map(([k,v])=>k==='restReasonCode'?`鱼鱼给出的休息原因类别=${restReasonNames[v]||'未提供安全类别'}`:`${k}=${Array.isArray(v)?v.join(','):v}`).join(' · ');
          const shadowHints={'social-shadow-reply':'只读影子倾向回复，实际没有发送','social-shadow-defer':'只读影子选择延期，实际没有发送','social-shadow-silent':'只读影子选择沉默，实际没有发送','social-shadow-quota':'影子额度不足，实际没有发送','social-shadow-invalid':'影子结果不合规，实际没有发送','social-shadow-revoked':'影子授权已撤销，实际没有发送'};
          const hint=step.type==='action-result'?shadowHints[step.result]:'';
          const stepLabel=step.type==='error'&&!step.code?'旧版未识别诊断步骤（不能作为技术错误证据）':labels[step.type]||step.type;
          const line=node('p',`${formatLocalTime(new Date(step.at).toISOString())} · ${stepLabel}${fields?' · '+fields:''}${hint?' · '+hint:''}`,'muted');details.appendChild(line);
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

  // The owner-facing board is the primary view. Secondary management reads remain
  // available in exactly one opt-in pane; no duplicate read-only cards on load.
  const showLifePlanTool=(tool,open=true)=>{
    const panel=$('life-plan-admin');
    const normalized=tool==='source'?'source':'todo';
    const todo=$('life-todo-section'),source=$('life-opportunities-section');
    if(!panel||!todo||!source)return;
    todo.hidden=normalized!=='todo';source.hidden=normalized!=='source';
    document.querySelectorAll('[data-life-plan-tool]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.lifePlanTool===normalized));
    });
    if(open){panel.open=true;panel.scrollIntoView?.({block:'nearest',behavior:'smooth'});}
  };
  document.querySelectorAll('[data-life-plan-tool]').forEach(button=>{
    button.addEventListener('click',()=>showLifePlanTool(button.dataset.lifePlanTool,false));
  });
  document.querySelectorAll('[data-life-plan-open]').forEach(button=>{
    button.addEventListener('click',()=>showLifePlanTool(button.dataset.lifePlanOpen,true));
  });
  // A record's historical decision and this round's eligibility are distinct facts.
  // Provenance links must be derived only from verified BV/UID fields.
  let lifePlansSource=null, lifePlansFilter='all';
  const planSourceLinks=(row,kind)=>{
    const validBV=bv=>/^BV[0-9A-Za-z]{10}$/.test(String(bv||''));
    const validUID=uid=>/^[1-9]\d{0,18}$/.test(String(uid||''));
    const links=[],seen=new Set();
    const push=(url,label)=>{if(!seen.has(url)){seen.add(url);links.push({url,label})}};
    if(validBV(row?.bvid))push('https://www.bilibili.com/video/'+row.bvid,'来源视频');
    if(validBV(row?.origin?.commentBvid))push('https://www.bilibili.com/video/'+row.origin.commentBvid,'来源评论所在视频');
    if(kind==='opportunity'&&validBV(row?.selectedBvid))push('https://www.bilibili.com/video/'+row.selectedBvid,'本次已选视频');
    if(kind==='opportunity')for(const video of (Array.isArray(row?.videos)?row.videos:[]).slice(0,2)){
      if(validBV(video?.bvid))push('https://www.bilibili.com/video/'+video.bvid,'有核验来源的候选视频');
    }
    // The author of an accepted task is not automatically its original source.
    if(kind==='todo'&&validUID(row?.uid)&&['inspect_creator_videos','unfollow_creator'].includes(row?.type))
      push('https://space.bilibili.com/'+row.uid,'待查看的主页');
    return links.slice(0,3);
  };
  const planOpportunityState=e=>{
    const s=String(e.status||'pending'),eligible=e.eligible===true,at=Number(e.nextAt)||0;
    const nextTime=at>Date.now()?'预计 '+formatLocalTime(new Date(at).toISOString())+' 后可重新考虑':'到下一次符合条件的自主轮次可再考虑';
    if(s==='inspect')return {stage:'已决定核实',next:'历史记录显示鱼鱼曾决定核实；是否真正取得资料以动作回执为准，本次不会重复提交。',tone:'done'};
    if(s==='review')return {stage:'公开证据已复核',next:'这次公开交流证据复核已结束，记录保留供后续回顾。',tone:'done'};
    if(s==='dismiss')return {stage:'鱼鱼已经放下',next:'这是鱼鱼明确结束的决定，不因页面刷新自动重开。',tone:'closed'};
    if(s==='skip'||s==='defer')return {stage:s==='skip'?'本轮暂不继续':'鱼鱼选择稍后',next:eligible?'延期已过；仍需新一轮真实候选筛选，不代表必须采取行动':nextTime,tone:eligible?'ready':'waiting'};
    if(s==='error')return {stage:'读取暂未成功',next:eligible?'可在新一轮核实来源后重新考虑':nextTime,tone:'waiting'};
    if(s==='pending')return {stage:'尚未决定',next:eligible?'等待 Life 从合格菜单自主选择':'来源或条件未满足；此记录尚未成为可选动作',tone:eligible?'ready':'waiting'};
    return {stage:'已有历史决定',next:eligible?'可进入新的候选筛选':'此轮不可重复执行，历史仍保留',tone:'waiting'};
  };
  const renderUnifiedLifePlans=()=>{
    const list=$('life-plan-hub-grid'),badge=$('life-plan-hub-total');if(!list||!badge)return;
    const items=[];
    for(const e of lifePlansSource?.opportunities||[]){
      const state=planOpportunityState(e);
      items.push({kind:['discussion-read','interest-milestone','public-person-observation'].includes(e.source)?'cue':'opportunity',
        title:String(e.topic||e.title||e.question||'从真实经历发现的生活线索').slice(0,120),
        origin:({'discussion-read':'来自评论阅读','interest-milestone':'来自跨日选片','public-person-observation':'来自公开交流'})[e.source]||'已核实的公开资料',
        ...state,links:planSourceLinks(e,'cue'),at:Number(new Date(e.lastAt||e.at||0))||0,createdAt:e.at||e.createdAt,lastAt:e.lastAt||e.updatedAt,nextAt:e.nextAt});
    }
    for(const x of lifePlansSource?.intentions||[]){
      const state=String(x.status||'');
      items.push({kind:'opportunity',title:String(x.goal||x.selectedTitle||'继续一次自主探索').slice(0,120),
        origin:'来自鱼鱼自己产生的探索意愿',
        stage:({'ready':'准备继续','inspected':'已核实资料','completed':'已经结束','abandoned':'鱼鱼已经放下','paused':'等待技术恢复'})[state]||'正在整理',
        next:['ready','inspected'].includes(state)&&x.episodeStatus!=='review'?'具备后续考虑可能；是否继续仍由 Life 决定':state==='completed'?'探索片段已经结束；不等于所有视频都完整看过':state==='abandoned'?'鱼鱼已经结束这段探索':'当前不自动推进，可在详细记录核对',
        tone:['ready','inspected'].includes(state)?'ready':'done',links:planSourceLinks(x,'opportunity'),at:Number(new Date(x.at||x.episodeStartedAt||0))||0,createdAt:x.at||x.episodeStartedAt,lastAt:x.updatedAt||x.lastAt,nextAt:x.nextAt});
    }
    for(const row of lastOwnerTodos?.allItems||[]){
      items.push({kind:'todo',title:String(row.title||row.topic||todoTypeNames[row.type]||'已接下的一件事').slice(0,120),
        origin:'已接受的待办 · '+(todoTypeNames[row.type]||'只读任务'),
        stage:todoStatusNames[row.status]||'待核实',
        next:row.status==='uncertain'?'结果待核对，不会自动重试':row.status==='done'?'已有完成状态；可在详情核对回执':row.status==='deferred'?'到期后才会重新成为可选行动':row.status==='open'?'可以进入 Life 规划，但不保证本轮选择':'在详情中查看下一步',
        tone:row.status==='done'?'done':row.status==='open'?'ready':'waiting',links:planSourceLinks(row,'todo'),at:Number(new Date(row.updatedAt||row.createdAt||0))||0,createdAt:row.createdAt,lastAt:row.updatedAt,completedAt:row.completedAt,nextAt:row.dueAt});
    }
    const count={cue:0,opportunity:0,todo:0};for(const x of items)count[x.kind]++;
    badge.textContent=items.length+' 条记录 · '+count.cue+' 线索 / '+count.opportunity+' 契机 / '+count.todo+' 待办';
    document.querySelectorAll('[data-life-plan-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lifePlanFilter===lifePlansFilter)));
    list.replaceChildren();
    const filtered=items.filter(x=>lifePlansFilter==='all'||x.kind===lifePlansFilter).sort((a,b)=>b.at-a.at).slice(0,36);
    if(!filtered.length){list.appendChild(node('div',items.length?'该分类暂时没有记录。':'目前还没有可展示的生活线索或待办。','life-plan-empty'));return}
    const kindNames={cue:'💡 生活线索',opportunity:'🧭 生活契机',todo:'📝 已接受待办'};
    for(const item of filtered){
      const card=node('article','','life-plan-item');card.dataset.kind=item.kind;card.dataset.tone=item.tone||'waiting';
      const head=node('div','','life-plan-item-head');add(head,node('span',kindNames[item.kind],'life-plan-kind'),node('span',item.stage,'life-plan-stage'));
      add(card,head,node('h4',item.title),node('p',item.origin,'life-plan-sub'));
      const times=node('div','','life-plan-times');
      const stamp=(label,value)=>{if(value&&Number.isFinite(new Date(value).getTime())&&new Date(value).getTime()>0)
        times.appendChild(node('span',label+'：'+formatLocalTime(value),'life-plan-time'))};
      stamp('发现',item.createdAt);
      if(item.lastAt&&new Date(item.lastAt).getTime()!==new Date(item.createdAt).getTime())stamp('最近更新',item.lastAt);
      stamp('完成',item.completedAt);
      if(item.nextAt&&new Date(item.nextAt).getTime()>Date.now())stamp('下次可考虑',item.nextAt);
      if(!times.childElementCount)times.appendChild(node('span','原始记录未提供可信时间','life-plan-time'));
      add(card,times,node('div',item.next,'life-plan-next'));
      if(item.links?.length){
        const sources=node('div','','life-plan-sources');
        for(const x of item.links){const a=node('a',x.label+' ↗','life-plan-source-link');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';sources.appendChild(a)}
        card.appendChild(sources);
      }else add(card,node('span','暂无可核实的原始链接','life-plan-no-source'));
      list.appendChild(card);
    }
  };
  document.querySelectorAll('[data-life-plan-filter]').forEach(button=>button.addEventListener('click',()=>{
    lifePlansFilter=button.dataset.lifePlanFilter;renderUnifiedLifePlans();
  }));
  const loadLifeOpportunities=async()=>{
    const status=$('life-opportunities-status'),list=$('life-opportunities-list');list.replaceChildren();
    try{
      const data=await request('/life-opportunities');
      if(!data.accountReady){lifePlansSource=null;renderUnifiedLifePlans();status.textContent='当前 B站账号尚未就绪，无法安全读取契机';if($('life-flow-cues'))$('life-flow-cues').textContent='需先确认账号';if($('life-flow-opportunities'))$('life-flow-opportunities').textContent='需先确认账号';return}
      lifePlansSource=data;renderUnifiedLifePlans();
      const intentions=data.intentions||[];
      const affinity=Array.isArray(data.privateLifeAffinity)?data.privateLifeAffinity:[];
      const affinityDiagnostics=data.privateLifeAffinityDiagnostics||{};
      const intentReady=intentions.filter(x=>['ready','inspected'].includes(x.status)&&x.episodeStatus!=='review'&&Number(x.episodeSteps||1)<Number(x.episodeMaxSteps||5)).length;
      const entries=data.opportunities||[];
      const sharedLinks=Array.isArray(data.sharedBiliLinks)?data.sharedBiliLinks:[];
      const sharedHistory=Array.isArray(data.sharedBiliLinksHistory)?data.sharedBiliLinksHistory:sharedLinks;
      const publicPermission=data.publicInteractionPermission||{};
      const warnings=data.sourceWarnings||[];
      const cueFailures=data.explorationReadFailures||[];
      const ready=entries.filter(x=>x.eligible).length;
      const cueCell=$('life-flow-cues'),opportunityCell=$('life-flow-opportunities');
      if(cueCell)cueCell.textContent='最近 '+String(entries.length)+' 条来源记录';
      if(opportunityCell)opportunityCell.textContent=String(ready)+' 条合格线索 · '+sharedLinks.length+' 条好友分享链接 · '+intentReady+' 条探索续接';
      status.textContent=`当前账号 · 生活线索可考虑 ${ready} 条 · 好友分享 B站 链接 ${sharedLinks.length} 条 · 自主探索进行中 ${intentReady} 条 · 自主探索记录 ${intentions.length} 条 · 独立线索读取冷却 ${cueFailures.filter(x=>!x.paused).length} 条、暂停 ${cueFailures.filter(x=>x.paused).length} 条 · 有可信熟悉好友共同兴趣参考 ${affinity.length} 组（仅内部参考，不代表实际使用或外发许可）。`+(warnings.length?' · 注意：'+warnings.join('、'):'');
      if(sharedHistory.length){
        add(list,info('Life 公开内容探索：只存已经验证的官方对象引用与有限的读取回执，不保存私信原文；原动态、关联视频和作者空间都需要新一轮自主选择。公开互动：'+(publicPermission.enabled?'已明确授权（仍需独立决策）':'关闭（只读探索不受影响）')+'；全局评论额度 '+(publicPermission.commentDailyLimit||0)+'。'));
        for(const link of sharedHistory){
          const item=node('div','','record');
          const state=link.status==='pending'?'等待 Life 自主考虑是否查看':link.status==='inspected'?'已核验公开内容，后续操作需独立 Life 决策':link.status==='error'?'安全链接读取失败，等待退避后再考虑':link.status==='deferred'?'Life 已选择稍后再看':link.status==='dismissed'?'Life 已选择结束，不会继续抓取':link.status==='uncertain'?'公开互动结果未知，已冻结禁止重试':link.status==='interacted'?'已有公开互动回执':'等待独立 Life 判断';
          add(item,node('strong',(link.source==='related-public-content'?'已发现关联内容':link.source==='public-discovery-content'?'自主探索的公开视频':link.kind==='dynamic'?'分享动态':link.kind==='video'?'分享视频':link.kind==='profile'?'分享空间':'分享链接')+' · '+state));
          if(link.title)add(item,info('已核实标题：'+link.title));
          if(link.authorName)add(item,info('核验的公开作者：'+link.authorName));
          if(link.parentId)add(item,info('来源：先前已经核验的公开内容 · '+(link.relation==='reposted-original'?'转发原动态':link.relation==='embedded-video'?'关联视频':'作者空间')+'；本条仍需独立阅读。'));
          if(link.relatedCount)add(item,info('从此内容发现 '+link.relatedCount+' 条可信关联目标（尚未代表已阅读）'));
          if(link.failureCode)add(item,info('最近读取失败：'+link.failureCode));
          if(link.commentable)add(item,info('平台确认此动态支持文字/图文评论；是否互动仍由 Life 自己决定'));
          if(link.summary)add(item,info('公开内容摘要（外部不可信资料）：'+link.summary));
          if(link.imageObservations?.length)add(item,info('图片理解：'+link.imageObservations.join('；')));
          if(link.interactions?.length)add(item,info('互动回执：'+link.interactions.map(x=>x.action==='like_shared_dynamic'?'点赞 '+x.status:'评论 '+x.status).join('；')));
          list.appendChild(item);
        }
      }
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
        const item=node('div','','record');const title=node('div');
        const episodeSteps=Math.max(1,Number(x.episodeSteps||1)),episodeMax=Math.max(1,Number(x.episodeMaxSteps||5));
        const sourceName=({'home-browse':'首页闲逛','discussion-read':'评论阅读后的好奇','interest-milestone':'跨日兴趣趋势',
          'selection-curiosity':'自主选片后的好奇','public-person-observation':'真实公开交流对象'}[x.source]||'自主探索来源');
        const stateName=x.episodeStatus==='review'?'写入结果待复核，已冻结后续':x.status==='ready'?'等待鱼鱼继续':
          x.status==='inspected'?'已有核实结果，可继续探索':x.status==='paused'?'连续读取失败，已暂停等待排查':
          ['completed','abandoned'].includes(x.status)?'本次探索已结束':x.status;
        add(title,node('strong',`🐟 Life Episode · ${stateName} · ${episodeSteps}/${episodeMax} 步`));
        add(item,title,info('探索来源：'+sourceName+' · 自己的探索目的：'+(x.goal||'未记录')));
        add(item,info('最近回执：'+(x.receipt||'未知')+(x.episodeStartedAt?' · 开始 '+formatLocalTime(new Date(x.episodeStartedAt).toISOString()):'')));
        if(x.videos?.length)add(item,info((x.source==='home-browse'?'首页本轮真实入选候选：':x.source==='discussion-read'?'原评论对应 BV：':'可信公开候选 BV：')+x.videos.map(v=>v.bvid).join('、')+'（候选/元数据不等于完整观看）'));
        if(x.visitedBvids?.length)add(item,info('本 Episode 已核实过 '+x.visitedBvids.length+' 条 BV；后续菜单会排除这些重复目标。'));
        if(x.discussionReadBvids?.length)add(item,info('已独立读取 '+x.discussionReadBvids.length+' 条视频的真实评论区；并不代表必须发表评论。'));
        if(Number(x.homeRefreshCount||0)>0)add(item,info('本次 Episode 已自主额外刷新首页推荐一次；不再重复请求。'));
        if(x.writeAftercare==='read-or-rest')add(item,info('上次已核验写操作后：现在只能继续真实只读探索或选择休息，不能马上连续发第二个写操作。'));
        if(x.writeAftercare==='resting')add(item,info('鱼鱼已主动休息：到达下次允许时间且所有原授权仍有效后，才能重新考虑另一种写入。'));
        if(x.writeAftercare==='read-verified'&&Number(x.writeNextEligibleAt||0)>Date.now())
          add(item,info('上次写操作后已完成只读核实，仍需遵守最短冷却至 '+formatLocalTime(new Date(x.writeNextEligibleAt).toISOString())+'。'));
        if(x.episodeHistory?.length)add(item,info('已核验动作序列：'+x.episodeHistory.map(h=>({
          'browse-home':'逛首页','browse-home-more':'继续逛首页','search':'可信搜索',
          'inspect-public-person':'查看公开人物','inspect-video':'核实视频',
          'inspect-creator-space':'查看作者作品','inspect-video-discussion':'阅读评论区',
          'life-write-verified':'已核验写入'}[h.action]||'已完成动作')).join(' → ')+'；这是本次行动证据，不代表视频完整观看。'));

        if(x.selectedBvid)add(item,info('最近核实：'+x.selectedBvid+' · '+(x.selectedTitle||'')+'（仅公开视频元数据）'));
        if(x.creatorExplored)add(item,info('已真实读取当前 BV 作者的公开投稿列表；可选作品 '+(x.creatorVideos||[]).map(v=>v.bvid).join('、')+'（列表不等于观看，也不授予关注／私信权限）'));
        if(x.metadataFailures)add(item,info('元数据读取：'+(metadataFailures[x.metadataFailureCode]||'核验未成功')+' · 连续失败 '+x.metadataFailures+'/3'+
          (x.status==='paused'?' · 已停止自动尝试':' · 将按退避规则重试')+'；没有记为已观看。'));
        if(x.nextAt&&x.nextAt>Date.now()&&x.status!=='paused')add(item,info('下一次最早可继续：'+formatLocalTime(new Date(x.nextAt).toISOString())));
        if(x.reason)add(item,info('决定放下：'+x.reason));
        list.appendChild(item);
      }
      // Planner status shows search errors before a life intention is saved.
      try{
        const plan=await request('/autonomous-planner');
        const history=(plan.recent||[]).filter(x=>['begin_exploration','inspect_exploration','inspect_creator_space','inspect_public_person','abandon_exploration','reconciled'].includes(x.action)).slice(-5).reverse();
        for(const r of history){
          add(list,info('最近自主行动：'+({begin_exploration:'自主发起只读探索',inspect_exploration:'核实公开视频 BV',inspect_creator_space:'查看作者公开投稿',inspect_public_person:'了解交流对象的公开作品',abandon_exploration:'自己结束探索',reconciled:'同动作去重，未调用模型或执行'}[r.action]||r.action)+
            ' · '+(r.result==='held-overlap'?'同一只读动作被待办或进行中的生活意愿覆盖，未重复执行':r.result==='held-by-accepted-todo'?'与已接受只读待办动作重合，已阻止重复搜索':r.result==='held-by-ongoing-intention'?'已有自主意愿在继续，已阻止重复读取':(r.result||'未有成功回执'))+
            (r.coordination?.heldCues||r.coordination?.heldOpportunities?' · 本轮同动作线索暂缓 '+((r.coordination.heldCues||0)+(r.coordination.heldOpportunities||0))+' 条（不等于完成或取消）':'')+
            (r.affinityMatched?' · 本轮选择的公开探索与可信共同兴趣相交（不代表因果或联系）':'')+' · '+formatLocalTime(new Date(r.at).toISOString())));
        }
      }catch{/* 额外的只读诊断不可影响原页面 */}
      if(!entries.length&&!intentions.length&&!sharedLinks.length)add(list,info('当前账号还没有符合条件的线索：评论阅读临时观察、账号证据完整的跨日自主选片或跨日公开交流偏好；无记录不代表鱼鱼拒绝。'));
    }catch(e){status.textContent='读取生活契机失败：'+String(e.message||e).slice(0,150);if($('life-flow-cues'))$('life-flow-cues').textContent='来源暂不可读';if($('life-flow-opportunities'))$('life-flow-opportunities').textContent='候选暂不可读'}
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
  const loadLifeMemory=async()=>{await loadMainSession();await Promise.all([renderMemoryFlow(),renderInterests(),renderLifeTimeline(),loadLifeOpportunities(),renderNeuralMemory()]);};
  $('main-life-refresh').addEventListener('click',()=>run(loadLifeMemory));
  $('main-memory-kind').addEventListener('change',()=>{document.querySelectorAll('[data-memory-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.memoryKind===$('main-memory-kind').value)));paintMemoryGarden();run(async()=>{await Promise.all([renderLongMemory(),renderNeuralMemory()])})});
  document.querySelectorAll('[data-memory-kind]').forEach(b=>b.addEventListener('click',()=>{$('main-memory-kind').value=b.dataset.memoryKind;document.querySelectorAll('[data-memory-kind]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));paintMemoryGarden();run(async()=>{await Promise.all([renderLongMemory(),renderNeuralMemory()])})}));
  $('main-session-refresh').addEventListener('click',()=>run(()=>loadMainSession({setupOnly:onboarding?.completed!==true})));
  $('main-session-save').addEventListener('click',()=>run(async()=>{
    const id=$('main-session-id').value.trim();const contactPreset=selectedChoice('owner-contact-choice')||'natural';
    if(!['quiet','natural','lively','custom'].includes(contactPreset))throw Error('主人联系卡片选择不合法');
    const custom=contactPreset==='custom'?{
      ownerContactStartHour:boundedInt('owner-contact-start',0,23,'允许联系开始小时'),
      ownerContactEndHour:boundedInt('owner-contact-end',0,24,'允许联系结束小时'),
      ownerContactCooldownMinutes:boundedInt('owner-contact-cooldown',30,10080,'联系冷却分钟'),
      ownerContactDailyLimit:boundedInt('owner-contact-daily',1,24,'每日联系上限'),
      ownerContactSilenceMinutes:boundedInt('owner-contact-silence',5,1440,'沉默续聊阈值'),
    }:{};
    if(contactPreset==='custom'&&custom.ownerContactStartHour===custom.ownerContactEndHour)throw Error('联系开始与结束时间不能相同');
    const body={mainSessionBridgeEnabled:$('main-session-enabled').checked,
      ownerSpontaneousChatEnabled:$('owner-spontaneous-chat-enabled').checked,
      ownerContactPreset:contactPreset,...custom,
      mainSessionSilenceFollowupEnabled:$('main-session-silence-enabled').checked,
      ownerDmSilenceFollowupEnabled:$('owner-dm-silence-enabled').checked,
      mainSessionId:id,mainSessionAutoSync:$('main-session-auto').checked};
    if(!id)body.clear=['mainSessionId'];const r=await request('/config',body);await loadMainSession({setupOnly:onboarding?.completed!==true});message(localSaveNotice(r,'主 Session 设置已保存，可返回快速设置继续完成必需步骤'));
  }));
  $('main-session-sync-save').addEventListener('click',()=>run(async()=>{
    const body={mainSessionSyncMinutes:boundedInt('main-session-minutes',15,720,'同步间隔'),mainSessionDailyBatches:boundedInt('main-session-daily',1,24,'每日同步批次'),mainSessionBatchSize:boundedInt('main-session-batch',1,20,'每批经历数'),mainSessionIncludeComments:$('main-session-comments').checked};
    const r=await request('/config',body);await loadMainSession({setupOnly:onboarding?.completed!==true});message(localSaveNotice(r,'主 Session 同步频率已保存'));
  }));
  $('main-session-test').addEventListener('click',()=>run(async()=>{await request('/main-session/test',{});message('连接测试已送到主 Session；它应该只回复“连接正常”')}));
  $('main-session-sync').addEventListener('click',()=>run(async()=>{const r=await request('/main-session/sync',{force:true});await loadMainSession();message(r.sent?`已把 ${r.sent} 条经历告诉主 Session，还有 ${r.pending} 条等待汇报`:'目前没有要告诉主 Session 的新经历')}));
  $('main-session-backfill').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'把过去 7 天尚未汇报的已选视频及已发评论加入本地队列？这不是等待 7 天，也不会立即发送。开启自动同步后会按设置的间隔尝试发送；未开启则可以手动发送。'}))return;const r=await request('/main-session/backfill',{days:7});await loadMainSession();message(`已从过去 7 天补入 ${r.added||0} 条经历，目前 ${r.pending||0} 条待汇报；本次未发送消息`)}));
  $('main-session-history-search').addEventListener('click',()=>run(searchFishMemory));
  $('main-session-history-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run(searchFishMemory)}});
  $('main-memory-search').addEventListener('click',()=>run(renderLongMemory));
  $('main-reflection-refresh').addEventListener('click',()=>run(renderLifeReflection));
  $('main-reflection-run').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'现在让大肥鱼对当前待处理经历做一次人生反思？这会产生一次受限模型调用，但不会给模型 B站发送、文件、Shell 或任意网络工具。'}))return;const r=await request('/main-session/reflection/run',{});await renderLifeReflection();await renderLongMemory();await renderMemoryFlow();if(!sandboxActive&&!aiDebugActive)await loadPersonalityEvolution(false);const domainLabel=({'public-event':'公开经历','owner-private':'主人私有经历','friend-private':'好友私有经历'})[r.domain]||'经历';const reasonText=({'model-no-insight':'模型没有提出值得长期保存的新领悟，这可能是正常筛选结果','quality-rejected':'模型提案未通过质量校验，可在已评估候选中查看拒绝原因','not-committed':'已有合格提案，但未新增保存，需查看去重与未写入计数','duplicate-no-new-memory':'认识已存在，未重复保存','source-forgotten':'原始经历已自然遗忘','created':'已形成新的长期认识'})[r.diagnosis]||'';const growth=r.personalityEnabled?`；人格模型候选 ${r.personalityProposed||0} 条，采纳 ${r.personalityAccepted||0} 条；真实探索／社交弱观察 ${r.personalityObserved||0} 条${r.domain==='public-event'?'':'（仅匿名低权重特质，不公开私密内容）'}`:'；这次未开启人格成长';message(`${domainLabel}：候选 ${r.candidates??0}、选中 ${r.selected??0}、送模型 ${r.modelInput??0} 条，模型提案 ${r.memoryProposed??0}、质量通过 ${r.qualityAccepted??0}、质量拒绝 ${r.qualityRejected??0}、存储去重 ${r.storageDuplicates??0}、未写入 ${r.storageRejected??0}、最终新增 ${r.created||0} 条${growth}${reasonText?'；'+reasonText:''}`)}));
  $('main-memory-test').addEventListener('click',()=>run(async()=>{
    const query=$('main-memory-test-query').value.trim();if(!query)throw Error('请输入检索主题');
    $('main-memory-test-result').textContent='正在检索…';
    const result=await request('/main-session/memory/recall',{query});
    const diag=result.diagnostic?.last||{};
    $('main-memory-test-result').textContent=`路径：${result.reason||'local'} · 候选：${diag.candidateCount||0} · 命中：${(result.ids||[]).length} 条 · ${result.usedEmbedding?'使用本地 Embedding':result.usedModel?'使用了独立模型':'未调用独立模型'}\n${result.context||'没有相关记忆'}`;
  }));
  $('main-memory-consolidation-run').addEventListener('click',()=>run(async()=>{if(!await confirmAction({title:'请确认操作',description:'现在尝试凝练同主题的主人聊天普通记忆？将调用受限记忆模型，保留来源 ID；稳定事实与人生经历不参与。'}))return;const r=await request('/main-session/memory/consolidate',{confirm:'CONSOLIDATE_OWNER_CHAT'});await renderLongMemory();message(r.added?`已凝练 ${r.added} 组，原记忆保留可追溯的替代记录。`:`没有生成新凝练记忆（${r.skipped||r.reason||'证据或质量条件不足'}）。`)}));
    const confirmEmbeddingInstall=async()=>{
      if(!await confirmAction({title:'启用本地语义回忆？',description:'推荐安装的本地模型大小约 639 MB，还将下载平台对应的 llama.cpp CPU 运行时。原始记忆不会上传；没有模型也可以继续使用词法检索。确认后才开始下载。',confirmLabel:'确认安装并启用'}))return
      await request('/embedding/install',{});message('已开始安装本地语义回忆；可继续使用其他功能，模型状态会在此页更新。');pollEmbeddingStatus();await renderEmbeddingStatus()
    }
    const inspectOrEnableEmbedding=async()=>{
      const status=await request('/embedding/status')
      // Never show the ~639 MB install confirmation for an already-running model.
      if(status.server?.ready===true){await renderEmbeddingStatus();message('已重新检查本地模型：'+
        (status.enabled===true&&status.index?.ready===true?'模型与语义索引均已就绪。':'本地模型正在运行；请查看索引状态。'));return}
      if(status.model?.installed===true&&status.runtime?.installed===true){
        await request('/embedding/install',{});message('已请求启动本机已安装的模型；不会重复下载安装完整模型。');
        pollEmbeddingStatus();await renderEmbeddingStatus();return
      }
      await confirmEmbeddingInstall()
    }
    $('embedding-install').addEventListener('click',()=>run(inspectOrEnableEmbedding))
    $('quick-embedding-install').addEventListener('click',()=>run(inspectOrEnableEmbedding))
    $('quick-embedding-later').addEventListener('click',()=>{
      $('quick-embedding-status').textContent='已选择暂不安装；继续使用原有词法回忆。以后仍可在记忆设置中启用。'
      message('已跳过可选模型安装，没有修改记忆或社交设置。')
    })
    $('embedding-cancel').addEventListener('click',()=>run(async()=>{await request('/embedding/cancel',{});await renderEmbeddingStatus()}))
    $('embedding-disable').addEventListener('click',()=>run(async()=>{
      if(!await confirmAction({title:'暂停本地语义回忆？',description:'将停止本地 Embedding 进程，并保留已下载模型与向量索引。后续记忆召回继续使用原有本地词法方式。',confirmLabel:'暂停'})){message('已取消');return}
      await request('/embedding/disable',{});await renderEmbeddingStatus()
    }))
    $('embedding-rebuild').addEventListener('click',()=>run(async()=>{
      if(!await confirmAction({title:'重建本地语义索引？',description:'将重新为当前仍有效、当前可访问的长期记忆和可衰减经历生成向量。不会读取封存档案，也不会修改原始记忆。',confirmLabel:'重建索引'})){message('已取消');return}
      await request('/embedding/rebuild',{});message('已开始重建索引；期间继续使用词法检索。');pollEmbeddingStatus();await renderEmbeddingStatus()
    }))
    $('embedding-delete').addEventListener('click',()=>run(async()=>{
      if(!await confirmAction({title:'删除本地模型与向量索引？',description:'将删除约 639 MB 的模型文件、llama.cpp 运行时和本地向量索引，并关闭语义回忆。原始长期记忆、可衰减经历、遗忘状态和 B站数据不会删除。',confirmLabel:'删除本地模型',danger:true})){message('已取消');return}
      await request('/embedding/delete',{confirm:'DELETE_LOCAL_EMBEDDING_MODEL'});await renderEmbeddingStatus()
    }))
    $('embedding-import').addEventListener('click',()=>run(async()=>{
      const file=$('embedding-import-file').files?.[0];if(!file)throw Error('请先选择官方 Qwen3 Q8_0 GGUF 文件')
      if(file.size!==639150592)throw Error('文件大小不匹配；需要 639,150,592 字节的 Qwen3-Embedding-0.6B-Q8_0.gguf')
      if(!await confirmAction({title:'校验并导入本地模型？',description:'将所选 GGUF 文件上传到 DSH 本机服务，并校验固定 SHA-256。上传只发生在当前管理页面与本机 DSH 之间，不会发送到云端。',confirmLabel:'导入模型'})){message('已取消');return}
      const indicator=$('request-indicator');indicator.hidden=false
      try{
        const response=await fetch(API+'/embedding/import-model',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file})
        const data=await response.json().catch(()=>({ok:false,error:'服务器未返回 JSON'}))
        if(!response.ok||data?.ok!==true)throw Error(String(data?.error||'模型导入失败').slice(0,220))
        message('模型文件已通过校验，正在安装本地运行时并建立索引。');pollEmbeddingStatus();await renderEmbeddingStatus()
      }finally{indicator.hidden=true}
    }))
    $('main-memory-save').addEventListener('click',()=>run(async()=>{const body={mainSessionMemorySemanticEnabled:$('main-memory-semantic').checked,mainSessionMemoryCandidates:boundedInt('main-memory-candidates',12,80,'候选条数'),mainSessionMemorySearchDailyLimit:boundedInt('main-memory-search-daily',0,500,'检索每日调用'),mainSessionReflectionMinCandidates:boundedInt('main-reflection-min',2,30,'反思候选阈值'),mainSessionReflectionBatchSize:boundedInt('main-reflection-batch',4,24,'反思批次大小'),mainSessionReflectionIntervalHours:Math.max(1,Math.min(48,Number($('main-reflection-hours').value)||1)),mainSessionReflectionDailyBatches:boundedInt('main-reflection-daily',1,16,'每日反思批次'),mainSessionMemoryHalfLifeDays:Number($('main-memory-half-life').value)||30,mainSessionMemoryThreshold:Number($('main-memory-threshold').value)||0.35,mainSessionMemoryMaxItems:boundedInt('main-memory-max-items',1,12,'召回条数'),mainSessionMemoryMaxChars:boundedInt('main-memory-max-chars',200,3000,'记忆字数'),mainSessionMemoryDailyQuota:boundedInt('main-memory-daily',1,100,'每日记忆数'),mainSessionMemoryConsolidationEnabled:$('main-memory-consolidation-enabled').checked,mainSessionMemoryFactsMax:boundedInt('main-memory-facts',0,6,'长期事实条数')};const r=await request('/config',body);await renderLongMemory();await renderLifeReflection();message(localSaveNotice(r,'记忆与反思设置已保存'))}));
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
  const localBackupDate=value=>{
    if(!value)return '未知时间';
    const timestamp=Date.parse(value);
    if(!Number.isFinite(timestamp))return '日期格式不正确';
    return new Date(timestamp).toLocaleString('zh-CN',{
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
    })+'（本机时间）';
  };
  $('backup-import-file').addEventListener('change',()=>run(async()=>{
    selectedBackup=null;$('backup-restore').disabled=true;
    const file=$('backup-import-file').files?.[0];
    if(!file){$('backup-inspect').textContent='尚未选择文件';return}
    if(file.size>90_000_000)throw Error('备份文件超过 90 MB 限制');
    const backup=JSON.parse(await file.text());
    const r=await request('/data-backup/inspect',{backup});
    selectedBackup=backup;
    const legacy=r.summary.integrity==='legacy-unsealed';
    const authenticity=legacy?'旧版无原始校验清单：仅完成格式、结构和安全检查，无法证明文件未被篡改':'SHA-256 完整性校验通过';
    $('backup-inspect').textContent=`备份创建于 ${localBackupDate(r.summary.createdAt)} · ${r.summary.configKeys} 项设置 · ${r.summary.count} 个业务文件 · ${r.summary.databases} 个 SQLite 库 · 永久档案 ${r.summary.archiveMonths??0} 个月 · ${r.summary.memeRules===null||r.summary.memeRules===undefined?'无自定义表情检索规则':r.summary.memeRules+' 条表情检索规则'}。${authenticity}。恢复将覆盖同名的本地数据，并先保存恢复前快照。${r.summary.legacyUnscoped?'此备份没有角色身份标签：请只在同一条鱼、同一账号资料目录下恢复。':''}`;
    $('backup-restore').disabled=false;
  }));
  $('backup-restore').addEventListener('click',()=>run(async()=>{
    if(!selectedBackup)throw Error('请先选择并校验备份文件');
    if(!await confirmAction({title:'请确认操作',description:'即将覆盖当前设置、成长经验、梗知识、评论与私信状态！恢复前会自动保存当前数据快照。请先暂停后台自动任务。确定继续？'}))return;
    if(!await confirmAction({title:'请确认操作',description:'最后确认：要以选中的备份恢复大肥鱼数据吗？恢复成功后必须完全重启 DSH。'}))return;
    const button=$('backup-restore');button.disabled=true;$('backup-progress').textContent='正在保存当前数据安全快照并执行恢复…';
    try{
      if(!Object.hasOwn(selectedBackup.files||{},'character-identity.json') && !await confirmAction({title:'旧备份缺少身份标记：请再次确认',description:'该备份没有可靠的角色身份标签，无法自动判断是否属于当前这条鱼。第一代备份还没有原始 SHA-256 签名。请确认只用于原来的账号资料目录，并已备份当前数据。确定继续吗？',danger:true,confirmLabel:'确认同一条鱼并继续'}))return;
      const result=await request('/data-backup/restore',{backup:selectedBackup,confirm:Object.hasOwn(selectedBackup.files||{},'character-identity.json')?'RESTORE_VERIFIED_DATA':'RESTORE_LEGACY_UNSCOPED_DATA'});
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
    if(onboarding && !onboarding.completed){await loadMainSession({setupOnly:true});await loadSystemHealth();return;}
    await loadSystemHealth();
    await Promise.all([loadMainSession(),loadHomeOverview()]);
  };
  const loadSocial=async()=>{await Promise.all([loadSocialFriends(),loadSocialIntents(),loadOwnerDmAgentSettings(),loadCommentSettings(),renderEmotion()])};
  // One read-only Life integration view over the existing stores: no second
  // personality/interest/todo/experience database and no model API calls.
  const loadSystemHealth=async()=>{
    const banner=$('life-system-health');if(!banner)return;
    try{
      const data=await request('/life-agent/system-health');const issues=Array.isArray(data.issues)?data.issues:[];
      banner.hidden=false;
      const channels=$('life-health-channels');channels.replaceChildren();
      const clear=$('life-health-clear-model-backoff')
      const networkClear=$('life-health-clear-network-backoff')
      const model=issues.find(x=>x.id==='model'&&x.inBackoff===true&&Number(x.retryAt)>Date.now())
      clear.hidden=!model||mobileViewOnly;clear.disabled=!model||mobileViewOnly;clear.dataset.retryAt=model?String(model.retryAt):''
      clear.title='仅取消 Life 模型失败退避，不会立即调用模型，也不解除 B站风控、发送冷却或每日额度。'
      const network=issues.find(x=>x.id==='network')
      const expectedNetwork=Object.fromEntries((network?.channels||[])
        .filter(x=>x?.canClear===true&&x.category==='network'&&Number.isSafeInteger(Number(x.retryAt))&&Number(x.retryAt)>Date.now())
        .map(x=>[x.id,Number(x.retryAt)]))
      networkClear.hidden=!Object.keys(expectedNetwork).length||mobileViewOnly
      networkClear.disabled=!Object.keys(expectedNetwork).length||mobileViewOnly
      networkClear.dataset.expected=JSON.stringify(expectedNetwork)
      networkClear.title='只清除 DNS／连接失败产生的评论、@ 或私信轮询退避；绝不清除 B站 -509 限流、读取预算或发送权限。'
      const liveChannels=Array.isArray(data.channels)?data.channels:[];
      const stateLabel={ok:'上次成功',failed:'上次失败',running:'进行中',backoff:'退避中',disabled:'未启用',unknown:'待观察'};
      for(const item of liveChannels){
        const chip=node('span','','health-channel-chip');
        chip.dataset.state=item.state||'unknown';
        chip.append(node('strong',item.label||'运行状态'),node('small',stateLabel[item.state]||'未知'));
        const detail=[item.detail,item.model?'模型：'+item.model:'',item.lastAt?'最近执行：'+formatLocalTime(item.lastAt):'',
          item.streak?'连续失败：'+item.streak:'',item.retryAt?'预计恢复：'+formatLocalTime(item.retryAt):''].filter(Boolean).join(' · ');
        chip.title=detail;chip.setAttribute('aria-label',(item.label||'运行状态')+'：'+detail);
        channels.appendChild(chip);
      }
      if(!issues.length){
        banner.dataset.level='ok';
        $('life-health-title').textContent='后台运行状态 · 暂无本地退避记录';
        $('life-health-detail').textContent='下方是每个渠道和视觉模型最近的真实运行状态，鼠标悬停可查看时间及退避详情；不额外探测网络或启动识图。';
        $('life-health-retry').textContent='';
        return;
      }
      const first=issues.find(x=>x.id==='network')||issues[0];
      $('life-health-title').textContent='后台运行状态 · '+issues.length+' 项需关注';
      $('life-health-detail').textContent=issues.map(x=>x.detail||x.title||'原因未知').join('；')
      const retry=Number(first.retryAt)||0;
      $('life-health-retry').textContent=retry?'最早预计重试：'+formatLocalTime(retry):'查看诊断了解详情';
      banner.dataset.level=issues.some(x=>x.severity==='critical')?'critical':'warning';
      // Persistent status chips above already include channel backoff and hover detail.

    }catch{
      $('life-health-clear-model-backoff').hidden=true;
      $('life-health-clear-network-backoff').hidden=true;
      banner.hidden=false;banner.dataset.level='critical';
      $('life-health-title').textContent='本地运行状态暂不可读取';
      $('life-health-detail').textContent='不能确认后台是否正常，请检查插件状态或诊断日志。';$('life-health-retry').textContent='';
      $('life-health-channels').replaceChildren();
    }
  };
  $('life-health-clear-model-backoff').addEventListener('click',()=>run(async()=>{
    const button=$('life-health-clear-model-backoff')
    const expectedRetryAt=Number(button.dataset.retryAt)
    if(!Number.isSafeInteger(expectedRetryAt)||expectedRetryAt<=Date.now())return loadSystemHealth()
    if(!await confirmAction({title:'取消 Life 模型失败退避',confirmLabel:'确认取消退避',
      description:'只清除当前 Life 规划模型的失败退避计时。不立即重试模型，不解除社交发送/B站风控冷却，不修改任何额度或发布权限。若中转站仍故障，下次调用会重新退避。'}))return
    button.disabled=true
    try{await request('/life-agent/model-backoff/clear',{confirm:true,expectedRetryAt});message('已取消 Life 模型失败退避；没有立即调用模型。')}
    finally{await loadSystemHealth()}
  }))
  $('life-health-clear-network-backoff').addEventListener('click',()=>run(async()=>{
    const button=$('life-health-clear-network-backoff')
    let expected={}
    try{expected=JSON.parse(button.dataset.expected||'{}')}catch{}
    if(!expected||typeof expected!=='object'||Array.isArray(expected)||!Object.keys(expected).length)return loadSystemHealth()
    if(!await confirmAction({title:'恢复后台网络监听',confirmLabel:'确认恢复监听',
      description:'只清除已确认的 DNS／连接失败退避，让后台在下一次调度 tick 重新尝试读取。不会清除 B站 -509/429 限流、共享读取预算、账号门禁、发送冷却或任何发送授权；若网络仍不可用，会重新进入退避。'}))return
    button.disabled=true
    try{
      const result=await request('/interaction-backoff/clear-network',{confirm:true,expected})
      message(result?.ok?'已恢复网络监听；等待后台下一轮安全读取。':'网络退避状态已变化，请刷新诊断。')
    }finally{await loadSystemHealth()}
  }))
  $('life-health-details').addEventListener('click',()=>{document.querySelector('[data-tab="diagnostics"]')?.click()});
  // Life growth dashboard consumes existing, account-scoped read-only projections.
  // A bar is an absolute evidence count relative to the largest visible count,
  // never a personality score, preference strength or probability.
  const renderLifeGrowthEvidence=(growth,audit)=>{
    const status=$('life-growth-status'),kpis=$('life-growth-kpis'),interests=$('life-growth-interests'),traits=$('life-growth-personality');
    const chain=$('life-growth-chain'),diagnosis=$('life-growth-diagnosis');
    for(const target of [kpis,interests,traits,chain])target.replaceChildren();
    if(!growth||growth.scope!=='current-account-public-evidence-only'){
      status.textContent='成长证据暂不可用；不会用零值或缓存结果伪装成功。';
      diagnosis.textContent='当前缺少可核验的成长归因。请查看诊断页或账号状态。';return;
    }
    const clamp=value=>Number.isSafeInteger(value)&&value>=0?Math.min(9999,value):0;
    const yields=growth.exploration||{};
    const metrics=[['探索片段',yields.episodes],['新视频资料',yields.verifiedVideoMetadata],['评论信息条目',yields.verifiedDiscussionItems],['作者公开作品',yields.verifiedCreatorPosts]];
    for(const [label,value] of metrics){const tile=node('div','','growth-kpi');tile.appendChild(node('strong',String(clamp(value))));tile.appendChild(node('small',label));kpis.appendChild(tile)}
    const meter=(container,label,value,max,muted=false)=>{
      const line=node('div','','growth-measure'),head=node('div','','growth-measure-head');
      head.appendChild(node('span',label));head.appendChild(node('b',String(clamp(value))));
      const track=node('div','','growth-meter'),bar=node('span','',muted?'growth-muted':'');
      bar.style.width=(max>0?(100*clamp(value)/max):0).toFixed(1)+'%';
      track.appendChild(bar);line.appendChild(head);line.appendChild(track);container.appendChild(line);
    };
    const milestones=Array.isArray(growth.independentInterestMilestones)?growth.independentInterestMilestones:[];
    const names={emerging:'萌芽',growing:'发展',stable:'稳定'};
    if(milestones.length){
      const group=node('div','','growth-milestones');
      for(const item of milestones.slice(0,8))group.appendChild(node('span',`${names[item.stage]||'阶段未知'} · ${clamp(item.evidenceCount)} 条独立证据 · ${clamp(item.evidenceDays)} 天`));
      interests.appendChild(group);
    }else interests.appendChild(node('p','目前没有达到跨日独立证据要求的兴趣阶段，不能解释为鱼鱼没有兴趣。','muted'));
    const reflection=growth.reflection;
    if(reflection){const max=Math.max(1,clamp(reflection.personalityObserved),clamp(reflection.personalityProposed),clamp(reflection.personalityAccepted));
      meter(traits,'已处理的公开观察',reflection.personalityObserved,max);
      meter(traits,'提出的人格成长建议',reflection.personalityProposed,max,true);
      meter(traits,'原成长机制已采纳',reflection.personalityAccepted,max);
      traits.appendChild(node('p',`本轮反思处理 ${clamp(reflection.processed)} 项；计数不表示一次行动造成特质改变。`,'muted'));
    }else traits.appendChild(node('p','目前没有开启且记录完整的公开人格反思批次；不展示猜测值。','muted'));
    const reportOk=audit&&audit.scope==='current-account-recent-traces';
    const steps=[
      ['① 决策前提供的背景',reportOk?`${clamp(audit.inspectedRuns)} 轮诊断中，${clamp(audit.lifeVoiceOffered)} 轮记录了 Life Voice 输入；${clamp(audit.interestCueCandidates)} 轮存在好奇线索候选；${clamp(audit.publicInterestEvidenceOffered)} 轮明确提供公开兴趣证据，${clamp(audit.publicMemoryEvidenceOffered)} 轮明确提供可回忆公开经历。`:'近期决策诊断暂不可读。'],
      ['② 真实行动与回执',reportOk?`${clamp(audit.modelDecisions)} 轮有已解析模型选择；${clamp(audit.newEvidenceReadSteps)} 次新增证据、${clamp(audit.noNoveltyReadSteps)} 次无增量读取；${clamp(audit.memoryProjectionsQueued)} 项记忆排队。`:'无法确认单次行动与回执的关联。'],
      ['③ 未来成长可用的证据',`${milestones.length} 组跨日兴趣阶段，${reflection?clamp(reflection.personalityAccepted)+' 项人格采纳记录':'人格采纳未获得有效记录'}。尚不能归因于具体一次决策。`]
    ];
    for(const [title,description] of steps){const item=node('div','','growth-chain-item');item.appendChild(node('b',title));item.appendChild(node('p',description));chain.appendChild(item)}
    status.textContent=`当前账号的只读证据 · 近七天 ${clamp(yields.episodes)} 段探索 · 决策轨迹 ${reportOk?clamp(audit.inspectedRuns)+' 轮':'不可用'}（最近至多 30 轮）`;
    diagnosis.textContent=reportOk?`审计：${clamp(audit.episodeStepLimits)} 次 Episode 步数上限，${clamp(audit.unsettledRuns)} 轮未结算。模型可能看到兴趣线索与人格背景，但日志无法证明它实际依据哪个特质做出选择；记忆排队不等于已召回，跨日兴趣证据不等于人格变化。`:
      '决策诊断不可用；探索统计和成长记录仍可独立查看，但不能形成完整双向证据链。';
  };
  const renderLifeActionRecords=data=>{
    const list=$('life-action-records-list'),status=$('life-action-records-status');list.replaceChildren();
    if(data?.ok!==true){status.textContent='当前账号的行动状态暂不可读，不能推断已发送。';return}
    const rows=Array.isArray(data.rows)?data.rows:[];
    const names={dm_reply:'私信回复',dm_follow:'私信联系人关注',dm_unfollow:'私信联系人取关',comment_reply:'评论回复',video_comment:'视频原创评论',video_like:'视频点赞',video_collect:'视频收藏',video_follow:'视频作者关注',video_unfollow:'视频作者取关'};
    const states={selected:'已自主选择',queued:'等待执行',executing:'平台执行中 / 需核验',verified:'已核验',blocked:'执行被阻断',uncertain:'结果未知，不自动重发',system_deferred:'系统延期',fish_deferred:'自主延期',declined:'自主拒绝'};
    // The backend already returns one redacted record per decision. The same
    // category often appears dozens of times, so aggregate for human scanning;
    // do not merge distinct records in the audit ledger or imply recipient IDs.
    const grouped=new Map();
    for(const entry of rows){
      const key=[entry.kind,entry.state,entry.reviewRequired===true,entry.hasVerifiedReceipt===true].join('|');
      const current=grouped.get(key);
      if(current)current.count++;else grouped.set(key,{...entry,count:1});
    }
    status.textContent=rows.length?`最近 ${rows.length} 条脱敏行动记录 · 归并为 ${grouped.size} 类状态（原账本保持逐条）`:'暂无登记的行动记录。无记录不等于鱼鱼没有兴趣。';
    for(const entry of [...grouped.values()].slice(0,20)){
      const line=node('div','','growth-measure-head');line.style.padding='6px 0';
      line.appendChild(node('span',(names[entry.kind]||'其他行动')+(entry.count>1?` · ${entry.count} 次`:'')));
      line.appendChild(node('b',(states[entry.state]||'状态未知')+(entry.reviewRequired?' · 待核验':'')));
      list.appendChild(line);
    }
  };
  const loadLifeIntegration=async()=>{
    await loadSystemHealth();
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
      const rs=r.resourceCoordination;
      if(rs?.ok===true){
        const waits=rs.pending||{},active=rs.active||{};
        put('life-resource-snapshot','资源协调 · 模型 '+(active.model||0)+'/'+(rs.capacity?.model||1)+
          '，读取 '+(active.biliRead||0)+'/'+(rs.capacity?.biliRead||1)+
          '，视频 '+(active.video||0)+'，视觉 '+(active.vision||0)+
          ' · 等待：社交 '+(waits.social||0)+'、续办 '+(waits.continuation||0)+
          '、探索 '+(waits.exploration||0)+'、后台 '+(waits.background||0)+
          ' · 延期 '+(rs.deferred||0)+'（仅当前插件进程）');
      }else put('life-resource-snapshot','资源协调状态不可用；不表示各系统空闲。');
      renderLifeGrowthEvidence(r.growthAttribution,r.growthAudit);
      renderLifeActionRecords(r.actionRecords);
      put('life-link-social',r.social?.decisionOwner==='life'?'两渠道已记录 Life 决策归属 · 真实平台仍待验收':
        r.social?.decisionOwner==='mixed'?'部分渠道处于 Life 维护试点 · 其他仍由旧聊天处理器负责':
        '当前由原有聊天系统回复 · 新 Life 尚未接管');
      const gaps=[['记忆协调',r.memory?.coordinator],['人生记忆',r.memory?.state],['反思',r.reflection?.state],['人格',r.personality?.state],['待办',r.todos?.state],['兴趣',r.interests?.state],['关系',r.relationships?.state]].filter(x=>x[1]!=='connected');
      put('life-integration-warning',gaps.length?'部分数据尚未就绪：'+gaps.map(x=>x[0]).join('、')+'。可以在诊断页查看详情。':'数据连接正常。生活经历、回忆和成长仍分别以各自记录为准。');
    }catch(e){
      renderLifeGrowthEvidence(null,null);
      renderLifeActionRecords(null);
      put('life-resource-snapshot','资源协调状态读取失败。');
      put('life-integration-warning','Life 接线状态读取失败：'+String(e?.message||e).slice(0,120)+'。不能据此宣称各系统运行正常。');
      for(const id of ['life-link-planner','life-link-memory','life-link-todos','life-link-interests','life-link-personality','life-link-social'])put(id,'读取失败');
    }
  };
  $('life-growth-refresh').addEventListener('click',()=>run(async()=>{await loadLifeIntegration();message('已重新核对当前账号的探索与成长只读证据；没有调用模型或平台写入。')}));
  $('life-integration-refresh').addEventListener('click',()=>run(async()=>{await Promise.all([refreshLiveNow(),loadLifeIntegration(),loadUnifiedLifeSettings()]);message('已刷新实时动作与 Life 总览；不调用模型或平台发送接口。')}));
  if(typeof setInterval==='function')setInterval(()=>{if(!document.hidden){
    loadSystemHealth().catch(()=>{});
    if(active==='life-agent')refreshLifeDecisionMeter().catch(()=>{});
  }},30_000);
  const loaders={firststart:loadFirstStart,models:loadModels,bili:loadBili,dynamic:loadDailyDynamic,backup:async()=>{await loadBackupDirectory();await loadLifeMemoryHealth()},diagnostics:loadDiagnostics,reports:loadReport,quotas:loadQuotas,polling:loadPolling,persona:loadPersona,social:loadSocial,home:loadHome,'life-agent':async()=>{await Promise.all([loadUnifiedLifeSettings(),loadLifeIntegration(),renderEmotion(),refreshLiveNow(),loadLifeNowTimeline().catch(()=>{}),loadLifeBehaviorTree()])},plans:async()=>{await Promise.all([loadOwnerTodos(),loadLifeOpportunities()])},life:loadLifeMemory,relationships:async()=>{await loadRelationshipSettings();await loadFriendRelationships()},dm:loadDmAll,comments:loadCommentsAll,growth:growthList,personality:async()=>{if(aiDebugActive&&aiDebugPreview){await loadPersonalityEvolution(true,aiDebugHistory.length,aiDebugPreview)}else if(sandboxActive){await loadPersonalityEvolution(true,sandboxStep);startSandboxTimer()}else await loadPersonalityEvolution(false)},'open-platform':async()=>{},meme:async()=>{await memeList();await loadMemeLearning()},stickers:loadStickers};
  // SSE provides low-latency hints. A visible-only four-second snapshot
  // reconciliation covers lost events, proxies blocking SSE and reconnect gaps.
  // These endpoints are read-only and never trigger B站 actions or model calls.
  let lifeStream=null,lifeStreamDebounce=null;
  const pendingLifeChanges=new Set();
  const flushLifeChanges=async()=>{
    lifeStreamDebounce=null;
    if(document.hidden)return;
    const kinds=new Set(pendingLifeChanges);pendingLifeChanges.clear();
    if(active==='life-agent'){
      const tasks=[];
      if(kinds.has('life')||kinds.has('timeline'))tasks.push(refreshLiveNow(),loadLifeBehaviorTree());
      if(kinds.has('timeline'))tasks.push(loadLifeNowTimeline());
      await Promise.allSettled(tasks);
    }else if(active==='plans'&&(kinds.has('plans')||kinds.has('timeline'))){
      await Promise.allSettled([loadOwnerTodos(),loadLifeOpportunities()]);
    }
  };
  const scheduleLifeChange=(kind)=>{
    if(!['life','plans','timeline'].includes(kind))return;
    pendingLifeChanges.add(kind);
    if(document.hidden)return;
    if(lifeStreamDebounce!==null)clearTimeout(lifeStreamDebounce);
    lifeStreamDebounce=setTimeout(()=>{void flushLifeChanges()},260);
  };
  let lifeReconcileBusy=false;
  const reconcileVisibleLife=async()=>{
    if(document.hidden||active!=='life-agent'||lifeReconcileBusy)return;
    lifeReconcileBusy=true;
    try{await Promise.allSettled([refreshLiveNow(),loadLifeBehaviorTree(),loadLifeNowTimeline()]);}
    finally{lifeReconcileBusy=false;}
  };
  const lifeReconcileTimer=typeof setInterval==='function'?setInterval(()=>{void reconcileVisibleLife()},4000):null;
  if(typeof EventSource==='function'){
    try{
      lifeStream=new EventSource(API+'/life-management/stream',{withCredentials:true});
      lifeStream.addEventListener('life-change',event=>{
        try{scheduleLifeChange(JSON.parse(event.data).kind)}catch{}
      });
      lifeStream.addEventListener('ready',()=>{
        // Reconnect may have missed events, so reconcile once, not every 4s.
        scheduleLifeChange('life');scheduleLifeChange('plans');scheduleLifeChange('timeline');
      });
      lifeStream.addEventListener('error',()=>{
        const status=$('life-behavior-status');
        if(status&&active==='life-agent'&&lifeStream?.readyState!==1)
          status.dataset.connection='reconnecting';
        const indicator=$('life-timeline-update-state');if(indicator)indicator.dataset.state='reconnecting';
      });
      lifeStream.addEventListener('open',()=>{const status=$('life-behavior-status');if(status)delete status.dataset.connection;const indicator=$('life-timeline-update-state');if(indicator)indicator.dataset.state='live'});
    }catch{lifeStream=null}
  }
  if(typeof document.addEventListener==='function')document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){scheduleLifeChange('life');scheduleLifeChange('plans');scheduleLifeChange('timeline')}
  });
  if(typeof window.addEventListener==='function')window.addEventListener('pagehide',()=>{
    lifeStream?.close();if(lifeReconcileTimer!==null&&typeof clearInterval==='function')clearInterval(lifeReconcileTimer);if(lifeStreamDebounce!==null)clearTimeout(lifeStreamDebounce);
  },{once:true});
  // 直接刷新或复制管理页链接时仍回到当前子页面；非法 tab 安全回退到默认页。
  let initialTab=null;
  let legacySettingsTarget=null;
  try{
    const url=new URL(location.href),saved=url.searchParams.get('tab');
    if(saved==='settings'){
      // 旧书签向后兼容：原插件设置三个区块仍有稳定锚点。
      legacySettingsTarget=url.hash==='#settings-sync'?'home-sync-settings':url.hash==='#settings-todo'?'settings-todo':'life-memory-settings';
      initialTab=legacySettingsTarget==='home-sync-settings'?'home':legacySettingsTarget==='settings-todo'?'plans':'life';
    }else if(saved==='todos')initialTab='plans';
    else if(tabNames.includes(saved))initialTab=saved;
  }catch{}
  (async()=>{
    try{
      const state=await loadFirstStart();
      if(!state.welcomeSeen)await request('/onboarding/welcome',{});
      const needsSetup=!state.completed||!state.requiredReady||!state.quickSetupSeen;
      const startupNavigation=needsSetup?switchTab('firststart'):switchTab(initialTab||'home');
      showRelease281IfNeeded(state);
      if(location.hash==='#fs-deps-card'&&(needsSetup||initialTab==='firststart')){
        void Promise.resolve(startupNavigation).then(()=>{
          if(active==='firststart')revealTarget($('fs-deps-card'));
        },()=>{});
      }
    }catch(e){renderFirstStart(null);switchTab('firststart');message('快速设置状态未就绪：'+String(e?.message||e),true)}
  })();
  if(legacySettingsTarget){
    const target=$(legacySettingsTarget);
    if(target){target.open=true;target.scrollIntoView({behavior:'auto',block:'start'})}
  }
})();
