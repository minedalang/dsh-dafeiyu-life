import {verifyLifeOutbound,lifeFactFromReceipt} from './verified-life-facts.mjs'
/** Evidence-bound, opt-in autonomous Bilibili social outreach. Never send based on mere BV sharing. */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
import {friendInterestSummary,friendRecommendationGuard} from './friend-learning.mjs'
import {unsupportedVideoExperience} from './claim-provenance.mjs'
const FILE='social-intentions.json',MAX=220,DAY=86400_000
const validUid=v=>/^[1-9]\d{0,18}$/.test(String(v||''))
const validBv=v=>/^BV[0-9A-Za-z]{10}$/.test(String(v||''))
const trim=(v,n=180)=>String(v??'').replace(/[\r\n\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const blank=()=>({version:1,items:[],sent:[],lastGenerationAt:0})
function read(home){const file=join(home,FILE);if(!existsSync(file))return blank()
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>400_000)throw Error('社交意图账本异常')
  const d=JSON.parse(readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.items)||!Array.isArray(d.sent))throw Error('社交意图账本格式不兼容')
  return {...blank(),...d,items:d.items.slice(-MAX),sent:d.sent.slice(-MAX)} }
function save(home,data){mkdirSync(home,{recursive:true});const file=join(home,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入社交意图符号链接')
  const temp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(temp,JSON.stringify({...data,version:1,items:data.items.slice(-MAX),sent:data.sent.slice(-MAX)},null,2)+'\n',{mode:0o600});renameSync(temp,file)
}
const whitelist=cfg=>{try{return JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).filter(r=>r.dm===true&&['dm','both'].includes(r.recommend)).map(r=>r.uid)}catch{return []}}
function getRecommendations(home){const file=join(home,'video-recommendations.json')
  try{const st=lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>200_000)return []
    const x=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(x.entries)?x.entries:[] }catch{return []}}
function parseDecision(raw){const txt=String(raw||'').slice(0,3000);const a=txt.indexOf('{'),b=txt.lastIndexOf('}');if(a<0||b<a)throw Error('社交模型未返回 JSON')
  const x=JSON.parse(txt.slice(a,b+1));if(!['draft','skip'].includes(x.action))throw Error('社交模型未给出有效决定')
  const message=trim(x.message,230),reason=trim(x.reason,100)
  if(x.action==='draft'&&(message.length<6||message.length>230))throw Error('社交草稿长度无效')
  // A small deterministic safety net in addition to prompt restrictions.
  // This workflow is for spontaneous conversation about a public BV, never for
  // exporting private messages, memories or credentials in a model draft.
  if(/(?:别人的私信|聊天记录|后台(?:数据|配置)|记忆库|用户画像|系统提示词|api.?key|cookie|token|密码|验证码|账号凭证|秘密|隐私信息)/i.test(message))throw Error('社交草稿涉及私密信息，已拒绝')
  if(x.action==='draft'&&unsupportedVideoExperience(message))return {action:'skip',message:'',reason:'模型混淆了选片、听歌与本人创作或发布，已拒绝草稿'}
  return {action:x.action,message,reason}
}
const quoted=(v)=>JSON.stringify(trim(v,140))
function profileTopics(cfg,uid){
 let profiles={};try{profiles=JSON.parse(String(cfg.mentionProfiles||'{}'))}catch{}
 const p=profiles?.[uid]||{};const raw=String(p.personalityInterests||p.interests||'')
 return raw.split(/[、，,；;|/\n\t]+/).map(x=>trim(x.replace(/^(?:我)?(?:喜欢|爱看|爱玩|爱听|感兴趣于|偏好)\s*/,''),40)).filter(x=>x.length>=2&&!/(密码|私信|聊天记录|地址|手机|token|cookie|密钥|凭据)/i.test(x)).slice(0,12)
}
function matchedFriendTopic(home,cfg,uid,title,now){
 const learned=(()=>{try{return friendInterestSummary(home,uid,cfg.friendDirectory,{maxItems:20,now}).filter(x=>x.stance==='like'&&(x.status==='observed-repeated'||x.directRequest===true)&&x.status!=='cooling'&&now-x.lastAt<=180*DAY).map(x=>x.topic)}catch{return []}})()
 const topics=[...profileTopics(cfg,uid),...learned].map(x=>trim(x,40)).filter(x=>x.length>=2)
 const text=trim(title,180).toLowerCase()
 return topics.find(t=>{const q=t.toLowerCase();return q.length>=2&&(text.includes(q)||(q.length>=4&&q.includes(text)&&text.length>=4))})||''
}
export function createSocialIntentEngine({dataDir,getConfig,invokeModel,sendMessage,getEmotionState=()=>null,getVoiceContext=()=>'',getSelectedVideos=()=>[],authorizeDraft=async()=>({ok:false,reason:'life-decision-required'}),now=Date.now,logger=console,paused=false,videoRecommendationsOnly=false}){
  if(!dataDir||typeof getConfig!=='function'||typeof invokeModel!=='function'||typeof sendMessage!=='function')throw TypeError('social intent dependencies missing')
  let busy=false,lastScan=null
  // Production may enable only profile-matched video recommendations; all historic
  // recommendation-followup and emotional outreach remain suspended for P6.
  const authorized=cfg=>!videoRecommendationsOnly||cfg.socialVideoRecommendationsAuthorizedV2===true
  const status=()=>{const d=read(dataDir),cfg=getConfig(),canUse=paused!==true&&authorized(cfg),eligibleFriends=whitelist(cfg).length;return {ok:true,paused:paused===true,scope:videoRecommendationsOnly?'interest-video-dm':'legacy',consentRequired:videoRecommendationsOnly&&!authorized(cfg),
    enabled:canUse&&cfg.socialOutreachEnabled===true,lifeIntentEnabled:canUse&&cfg.socialOutreachEnabled===true&&cfg.socialLifeIntentEnabled===true,autoSend:canUse&&cfg.socialOutreachEnabled===true&&cfg.socialLifeIntentEnabled===true&&cfg.socialAutoSend===true,
    eligibleFriends,ownerConfigured:/^[1-9]\d{0,18}$/.test(String(cfg.dmOwnerUid||'')),ownerEligible:whitelist(cfg).includes(String(cfg.dmOwnerUid||'')),lastScan,items:d.items.slice(-40).reverse().map(x=>({...x,uid:x.uid.slice(0,18)})),sentToday:d.sent.filter(x=>new Date(x.at).toDateString()===new Date(now()).toDateString()).length}}
  async function send(id,{confirm=false,automatic=false}={}){
    if(paused)return {ok:false,paused:true,error:'2.6.0 已暂停主动回访，草稿不会发送；计划于 2.6.1 重构'}
    if(videoRecommendationsOnly&&!authorized(getConfig()))return {ok:false,error:'请先在管理中心重新授权兴趣视频推荐'}
    if(videoRecommendationsOnly&&!automatic)return {ok:false,error:'自主社交不允许人工代发草稿'}
    if(busy)return {ok:false,error:'另一社交操作进行中'}
    busy=true
    try {
      const cfg=getConfig(),d=read(dataDir),item=d.items.find(x=>x.id===id)
      if(!item||item.status!=='draft')return {ok:false,error:'没有等待发送的草稿'}
      if(videoRecommendationsOnly&&item.type!=='interest-share')return {ok:false,error:'旧版待办完成回访仍暂停，当前只允许兴趣视频推荐'}
      // Legacy unsent drafts may predate the outbound claim guard. Never send them.
      if(item.type==='interest-share'&&unsupportedVideoExperience(item.text))return {ok:false,error:'草稿把选片误写为创作、发布或完整观看，已禁止发送'}
      if(!automatic&&!confirm)return {ok:false,error:'人工发送需要明确确认'}
      if(automatic&&(!cfg.socialOutreachEnabled||!cfg.socialAutoSend))return {ok:false,error:'自动社交未授权'}
      if(cfg.masterEnabled!==true)return {ok:false,error:'总开关已暂停'}
      if(cfg.socialOutreachEnabled!==true)return {ok:false,error:'自主社交权限已关闭'}
      if(!whitelist(cfg).includes(item.uid))return {ok:false,error:'推荐者不再属于允许私信的白名单'}
      if(friendRecommendationGuard(dataDir,item.uid,cfg.friendDirectory,{bvid:item.bvid,videoTitle:item.title,now:now(),channel:'dm'}).blocked)return {ok:false,error:'该好友已表示不希望收到此视频或此类推荐，草稿已阻止发送'}
      if(item.type==='interest-share'&&cfg.socialLifeIntentEnabled!==true)return {ok:false,error:'自主分享权限已关闭，这条草稿不能发送'}
      // No default daily or fourteen-day per-person cap. Each recommendation still
      // has a stable (recipient, BV) ID, a Life decision and one send transaction.
      if(d.sent.some(r=>r.id===item.id))return {ok:false,error:'这条视频已经推荐给该好友，不重复发送'}
      // The source is the current, authenticated B站选片记录, NEVER an old
      // model-authored draft or its unverified title. Confirm the selected BV
      // is still present and recent before allowing the actual recommendation URL.
      let sourceSelected=false
      try{sourceSelected=(getSelectedVideos()||[]).some(x=>x?.picked===true&&x?.bvid===item.bvid&&
        /^\d{4}-\d{2}-\d{2}$/.test(String(x.day||''))&&
        now()-new Date(String(x.day)+'T00:00:00').getTime()>=0&&
        now()-new Date(String(x.day)+'T00:00:00').getTime()<14*DAY)}catch{}
      const event=sourceSelected?lifeFactFromReceipt({type:'video_selected',operation:'public-video-selection',
        ok:true,sourceId:'selected:'+item.bvid,at:now(),bvid:item.bvid,scope:'public',channel:'dm'}):null
      const factual=verifyLifeOutbound(item.text,{channel:'dm',uid:item.uid,events:event?[event]:[],at:now()});
      if(!factual.ok)return {ok:false,error:'主动分享草稿事实未经核验：'+factual.reason};
      // The earlier interest model prepares a candidate only. A separate Life
      // choice is mandatory for AUTONOMOUS delivery, before any send reservation.
      // Model errors and SKIP never become platform attempts. An explicit human
      // send keeps its original confirmation and authorization gates.
      let lifeWillingnessProof=null
      if(automatic){
        let approved
        try{approved=await authorizeDraft({uid:item.uid,text:item.text,bvid:item.bvid,
          itemId:item.id,automatic:true})}
        catch{return {ok:false,skipped:true,reason:'life-social-decision-unavailable'}}
        if(approved?.ok!==true)return {ok:false,skipped:true,
          reason:String(approved?.reason||'life-chose-rest').slice(0,80)}
        lifeWillingnessProof=approved.proof||null
        if(!lifeWillingnessProof)return {ok:false,skipped:true,reason:'life-willingness-proof-missing'}
        // Consent, relationship boundary and account context may change while
        // the model considers; recheck before entering the irreversible lane.
        const latest=getConfig()
        if(latest.masterEnabled!==true||latest.socialOutreachEnabled!==true||
           latest.socialLifeIntentEnabled!==true||latest.socialAutoSend!==true||
           !whitelist(latest).includes(item.uid)||
           friendRecommendationGuard(dataDir,item.uid,latest.friendDirectory,{bvid:item.bvid,
             videoTitle:item.title,now:now(),channel:'dm'}).blocked)
          return {ok:false,skipped:true,reason:'life-share-authorization-changed'}
      }
      // Reserve *before* sending. An uncertain network receipt must never cause an automatic resend.
      item.status='reserved';item.attemptAt=now();save(dataDir,d)
      try {
        const r=await sendMessage({uid:item.uid,text:item.text,eventId:'social-intent:'+item.id,
          automatic,lifeWillingnessProof})
        if(r!==true&&r?.ok!==true)throw Error(String(r?.error||'远端未确认收到私信').slice(0,100))
        item.status='sent';item.sentAt=now();d.sent.push({uid:item.uid,at:item.sentAt,id:item.id});save(dataDir,d)
        return {ok:true,status:'sent',id:item.id}
      } catch(e) {item.status='uncertain';item.error=trim(e?.message||e,120);save(dataDir,d);return {ok:false,status:'uncertain',error:'结果可能不确定，已阻止自动重发：'+item.error}}
    } finally {busy=false}
  }
  async function reflectOnWatched(watched=[]){
    if(paused)return {ok:true,paused:true,skipped:'paused-for-2.6.1'}
    if(busy)return {ok:false,reason:'busy'}
    const cfg=getConfig()
    const finish=(skipped,extra={})=>{lastScan={at:now(),pickedCount:Array.isArray(watched)?watched.filter(v=>v?.picked===true).length:0,reason:skipped};return {ok:true,...extra,skipped}}
    if(!authorized(cfg))return finish('consent-required')
    if(cfg.masterEnabled!==true||cfg.socialOutreachEnabled!==true||(videoRecommendationsOnly&&cfg.socialLifeIntentEnabled!==true))return finish('disabled',{created:0})
    const allowed=new Set(whitelist(cfg));if(!allowed.size)return finish('no-trusted-friends')
    const recommendations=getRecommendations(dataDir),d=read(dataDir),choices=[]
    const friends=(()=>{try{return JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).filter(x=>x.dm===true&&['dm','both'].includes(x.recommend))}catch{return []}})()
    for(const video of (Array.isArray(watched)?watched:[]).slice(0,20)){
      if(!video.picked||!validBv(video.bvid))continue
      for(const r of (videoRecommendationsOnly?[]:recommendations)){
        const uid=String(r.uid||'')
        if(!validUid(uid)||!allowed.has(uid)||r.bvid!==video.bvid)continue
        if(now()-r.at>14*DAY || Number(r.at)>now())continue
        const id='recommend:'+uid+':'+video.bvid
        if(friendRecommendationGuard(dataDir,uid,cfg.friendDirectory,{bvid:video.bvid,videoTitle:video.title,now:now(),channel:'dm'}).blocked)continue
        if(d.items.some(x=>x.id===id)||d.sent.some(x=>x.id===id)||choices.some(x=>x.id===id))continue
        choices.push({id,uid,bvid:video.bvid,title:trim(video.title,90),sourceAt:r.at,type:'recommendation',topic:''})
      }
      // Consider a real selected public video with an authorized
      // friend when it plausibly matches their owner-configured or repeatedly self-stated interest.
      if(cfg.socialLifeIntentEnabled===true){
        for(const f of friends){
          const uid=String(f.uid||'');if(!validUid(uid)||!allowed.has(uid))continue
          if(friendRecommendationGuard(dataDir,uid,cfg.friendDirectory,{bvid:video.bvid,videoTitle:video.title,now:now(),channel:'dm'}).blocked)continue
          const isOwner=uid===String(cfg.dmOwnerUid||'');
          const topic=matchedFriendTopic(dataDir,cfg,uid,video.title,now());if(!topic&&!isOwner)continue
          const id='life-share:'+uid+':'+video.bvid
          if(d.items.some(x=>x.id===id)||d.sent.some(x=>x.id===id)||choices.some(x=>x.id===id))continue
          choices.push({id,uid,bvid:video.bvid,title:trim(video.title,90),sourceAt:now(),type:'interest-share',topic,isOwner})
        }
      }
    }
    if(!choices.length)return finish('no-profile-match',{created:0})
    // The owner is the primary private recipient, never crowded out by the two-candidate cap.
    choices.sort((a,b)=>Number(b.isOwner===true)-Number(a.isOwner===true))
    busy=true;let created=0;const createdDraftIds=[]
    try{
      // One bounded reflection call per run; never auto-chat merely because a recommendation exists.
      for(const c of choices.slice(0,2)){
        let result
        try{
          const evidence=c.type==='interest-share'
            ?(c.isOwner?`当前账号近期在浏览公开视频时选中了 BV ${c.bvid}，标题（不可信）=${quoted(c.title)}。这不是本账号的投稿、制作或发布记录。对方是已明确允许私信推荐的主人。这只是你发现的公开视频，没有对方兴趣匹配证据，请根据自己的兴趣、心情与这条真实经历自主判断是否值得分享；没有具体分享理由就 skip。不能声称完整观看或听过音轨，更不能把选中别人的视频说成自己制作、发布、投稿或作品入选推荐。`:`当前账号近期在浏览公开视频时选中了 BV ${c.bvid}，标题（不可信）=${quoted(c.title)}。这不是本账号的投稿、制作或发布记录。它与该好友可能感兴趣的主题有一个弱匹配（仅供你自己判断，不要在消息里透露画像、私信内容或说“你以前告诉过我”：${quoted(c.topic)}）。没有证据证明完整看过所有画面/字幕，也不能保证对方现在仍喜欢该主题。`)
            :`已核实证据：这位熟人推荐过 BV ${c.bvid}；此视频在推荐之后的一轮新刷视频任务中被真正入选，标题（不可信）=${quoted(c.title)}。入选表示确实有视频经历，但不保证完整看过全部画面、字幕或每一个细节。`
          const voice=String(getVoiceContext({uid:c.uid,query:c.title})||'').slice(0,7000)
          const prompt=`${voice}\n你是大肥鱼，在想要不要主动找一位已允许私信的熟人聊聊。这是 B站社交意图草稿生成，不执行任何网络工具。\n${evidence}\n自主联系意愿请根据上面唯一的 Life Voice 当前连续情绪及真实经历判断；疲惫或不想说时可以 skip，不要另设情绪阈值或假装必发。你可以自然决定不联系，不得机械汇报；没有具体感受或分享价值时应 skip。即使决定联系，只聊公开可见的标题和真实选片经历，必须区分看见/选中与本人制作/发布/投稿，不得说自己做的作品入选推荐，不编故事、不承诺再行动、不问强迫对方回复的问题，不提后台权限、UID、内部记录、私人画像或私信来源。\n仅返回 JSON：{"action":"draft或skip","message":"最多230字的自然私信","reason":"一句简短理由"}。`;
          result=parseDecision(await invokeModel(prompt,1700,{requireMasterEnabled:true}))
        }catch(e){logger.warn?.('社交意图反思失败：'+trim(e?.message||e,120));break}
        const doc={id:c.id,uid:c.uid,bvid:c.bvid,title:c.title,sourceAt:c.sourceAt,type:c.type||'recommendation',
          status:result.action==='draft'?'draft':'skipped',text:result.action==='draft'?result.message:'',reason:result.reason,
          createdAt:now(),attemptAt:0}
        d.items.push(doc);save(dataDir,d)
        if(doc.status==='draft'){created++;createdDraftIds.push(doc.id)}
      }
    }finally{busy=false}
    let delivery=''
    if(cfg.socialAutoSend===true){
      // Separate call avoids reentrancy; auto-send is opt-in and uses same hard quotas as manual.
      const first=read(dataDir).items.find(x=>createdDraftIds.includes(x.id)&&x.status==='draft')
      if(first){const result=await send(first.id,{automatic:true});delivery=result.ok?'已向平台提交私信':String(result.error||result.status||'未发送').slice(0,100)}
    }
    lastScan={at:now(),pickedCount:Array.isArray(watched)?watched.filter(v=>v?.picked===true).length:0,reason:created?'draft-created':'model-skipped',delivery}
    return {ok:true,created}
  }
  const dismiss=id=>{const d=read(dataDir),item=d.items.find(x=>x.id===id)
    if(!item||item.status!=='draft')return {ok:false,error:'草稿不可忽略'}
    item.status='dismissed';save(dataDir,d);return {ok:true}}
  return {status,reflectOnWatched,send,dismiss}
}
