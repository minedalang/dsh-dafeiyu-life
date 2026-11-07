import {extractBiliPicture} from './incoming-image-vision.mjs'
/** Background reply context. Reuse bounded evidence saved by the original video Agent;
 * refresh hot comments for the current conversation. Never infer unseen frames. */
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {validBv,validId} from './comment-inbox.mjs';
const str=(v,n=450)=>String(v??'').replace(/[\x00-\x08\x0b-\x1f]/g,' ').slice(0,n);
function safeList(body){return Array.isArray(body?.comments)?body.comments:[];}
export function createCommentVideoContext({stateDir,getInfo,getHot,getHotLimit=()=>12,getSubtitle=async()=>({}),getThread=async()=>({error:"unavailable"}),logger=console,now=Date.now}){
  const live=new Map(),threads=new Map(),infos=new Map(),subtitles=new Map();
  async function snapshot(bvid){
    try { const file=join(stateDir,'comment-video-context',bvid+'.json');const data=JSON.parse(await readFile(file,'utf8'));return data?.version===1?data:{}; }
    catch{return {};}
  }
  async function report(bvid){
    const dir=join(stateDir,'out');let names=[];
    try{names=(await readdir(dir)).filter(x=>/^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort().reverse().slice(0,20)}catch{return '';}
    for(const name of names){
      let text='';try{text=await readFile(join(dir,name),'utf8')}catch{continue;}
      // This is an Agent-authored report, not independent proof of watching full frames.
      const marker=text.indexOf('### '+bvid);
      if(marker<0)continue;
      const section=text.slice(marker,marker+950).split(/\n(?=#{2,3}\s+BV[\da-zA-Z]{10}\b)/)[0];
      return str(section,600);
    }
    return '';
  }
  async function forReply(bvid,details={}){
    const includeHot=details.includeHot!==false; // @ loads evidence before the first AI decision
    if(!validBv(bvid))return {usable:false,text:'',summary:'视频 BV 无效',counts:{hot:0,thread:0}};
    if(details.unresolvedNested===true)return {usable:false,text:'',summary:'楼层根评论 ID 尚未验证，拒绝猜测 target_id',counts:{hot:0,thread:0},sources:[]};
    const old=await snapshot(bvid),sources=[];
    let info=old.info&&typeof old.info==='object'?old.info:null;
    if(!info?.title){
      const memo=infos.get(bvid);
      if(memo&&now()-memo.at<120_000)info=memo.data;
      else try{const data=await getInfo(bvid);if(data?.title){info=data;infos.set(bvid,{data,at:now()});}}
      catch(e){logger.warn?.('视频详情读取失败 '+bvid+': '+str(e?.message,110));}
    }
    let subtitle=old.subtitle?.text?str(old.subtitle.text,2000):'';
    let subtitleSource=subtitle?'本地缓存字幕':'';
    if(!subtitle){
      const memo=subtitles.get(bvid);
      if(memo&&now()-memo.at<10*60_000){subtitle=memo.text;subtitleSource=subtitle?'近期读取字幕':'';}
      else {
        try{const result=await getSubtitle(bvid);if(result?.text){subtitle=str(result.text,2000);subtitleSource='本轮读取字幕';}}
        catch(e){logger.warn?.('字幕读取失败 '+bvid+': '+str(e?.message,110));}
        subtitles.set(bvid,{at:now(),text:subtitle});
      }
    }
    const note=await report(bvid);
    const earlier=Array.isArray(old.comments?.items)?old.comments.items:[];
    const rootId=validId(details.root),targetId=validId(details.rpid),parentId=validId(details.targetId);
    // B站通知已给出 root_id。优先用 root_id 读取该楼层并获取接口直接返回的
    // root_comment；与热门评论的排序、页数和样本容量无关。
    let rootComment=null,rootSource='',threadAvailable=false,threadCount=0,threadRows=[],threadSelection=[];
    if(rootId){
      try{
        const key=bvid+':'+rootId;
        const cached=threads.get(key);
        const cachedHasTarget=!!(cached&&(!targetId&&!parentId||cached.data?.target_found||
          Array.isArray(cached.data?.replies)&&cached.data.replies.some(c=>[targetId,parentId].filter(Boolean).includes(validId(c?.rpid)))));
        let related;
        if(cached&&now()-cached.at<90_000&&cachedHasTarget)related=cached.data;
        else {related=await getThread(bvid,rootId,targetId||parentId);threads.set(key,{at:now(),data:related});}
        if(!related?.error){
          if(related.root_comment && validId(related.root_comment.rpid)===rootId &&
             (String(related.root_comment.content||'').trim() || extractBiliPicture(related.root_comment))){
            rootComment=related.root_comment;
            rootSource='楼中楼接口按 root_id 直接返回的主评论';
          }
          if(Array.isArray(related.replies)){
            threadAvailable=true;
            threadRows=related.replies;
            threadCount=threadRows.length;
          }
        }
      }catch(e){logger.warn?.('相关评论读取失败 '+bvid+': '+str(e?.message,110));}
    }
    // 热评只提供额外背景，不参与按 root_id 定位楼层。
    // 获取与提供给 AI 使用同一个用户配置，不再次调用 AI 做选取。
    // 数量改变后不再复用之前按较小数量获得的两分钟缓存。
    const hotLimit=Math.max(1,Math.min(30,Math.floor(Number(getHotLimit())||12)));
    let hot=live.get(bvid);
    if(includeHot && (!hot||hot.limit!==hotLimit||now()-hot.at>120_000)){
      try{const data=await getHot(bvid,hotLimit);if(!Array.isArray(data?.comments)||data?.error)throw Error(str(data?.error||'热门评论数据缺失',120));
        hot={at:now(),limit:hotLimit,data};live.set(bvid,hot);
      }catch(e){logger.warn?.('最新热评不可用 '+bvid+': '+str(e?.message,110));hot=null;}
    }
    if(live.size>150)live.delete(live.keys().next().value);
    if(threads.size>200)threads.delete(threads.keys().next().value);
    if(infos.size>150)infos.delete(infos.keys().next().value);
    if(subtitles.size>150)subtitles.delete(subtitles.keys().next().value);

    const current=includeHot&&hot?safeList(hot.data):[];
    const snippets=[];
    if(info?.title){
      snippets.push('视频资料（标题/简介）：'+str(info.title,130)+'；简介：'+str(info.description,260));
      sources.push('视频标题与简介');
    }
    // 这里的日报片段可能包含视频 Agent 的高能帧/内容观察，是文本摘要而非重新上传原始帧。
    if(note){snippets.push((info?.title?'此前视频 Agent 分析记录（文本摘要，未独立复核）：':'此前本地视频报告（文本摘要，未独立复核）：')+str(note,360));sources.push('历史视频分析记录');}
    if(subtitle){snippets.push((subtitleSource||'已保存字幕')+'（节选）：'+str(subtitle,360));sources.push(subtitleSource||'已保存字幕');}

    // 仅当 root_id 直接查询失败时，才尝试缓存/热评中的精确 rpid 匹配。
    // 不能把子回复的 target rpid 冒充成楼层主评论。
    if(!rootComment){
      const fallback=rootId
        ? current.find(c=>validId(c?.rpid)===rootId)||earlier.find(c=>validId(c?.rpid)===rootId)
        : details.kind==='at'&&targetId
          ? current.find(c=>validId(c?.rpid)===targetId)||earlier.find(c=>validId(c?.rpid)===targetId)
          : null;
      if(fallback){rootComment=fallback;rootSource='热评或历史快照按 rpid 精确匹配';}
    }
    if(rootComment){
      snippets.push('当前楼层主评论（'+rootSource+'）：'+str(rootComment.user||rootComment.name||rootComment.member?.uname||'对方',50)+'：'+str(rootComment.content,170));
      sources.push('当前楼层主评论：'+rootSource);
    }
    // 直接父评论与本次目标是回复判断的核心信息，优先放入上下文，避免长热评挤掉它们。
    if(details.context){snippets.push('通知附带的直接上文：'+str(details.context,260));sources.push('通知中的直接上文');}
    if(details.text)snippets.push('本次需要回应的原评论：'+str(details.text,300));

    const excluded=new Set([rootId,targetId,parentId].filter(Boolean));

    if(threadAvailable){
      // 同一楼层最多读取三页，先定位目标回复/直接父评论再截取邻近片段。
      let center=threadRows.findIndex(c=>validId(c?.rpid)===targetId);
      if(center<0)center=threadRows.findIndex(c=>validId(c?.rpid)===parentId);
      if(center<0)center=threadRows.length-1;
      const from=Math.max(0,center-3),to=Math.min(threadRows.length,Math.max(center+3,Math.min(threadRows.length,6)));
      const selected=threadRows.slice(from,Math.min(to,from+6));
      threadSelection=selected;
      if(selected.length){
        snippets.push('当前楼中楼上下文（优先目标附近，共读取'+threadRows.length+'条）：'+selected.map(c=>str((c.name||c.user||'网友')+'：'+str(c.content,82),105)).join(' / '));
        sources.push('当前楼中楼 '+threadRows.length+' 条（展示 '+selected.length+' 条）');
      }else sources.push('已读取当前楼中楼（暂无回复条目）');
    }
    // 已取回的非当前楼层热评全部提供，不机械截取前6条，也不调用第二次AI筛选。
    // 除去当前楼层精确 rpid 对应的重复条目，以免误当其他楼层。
    const samples=current.filter(c=>!excluded.has(validId(c?.rpid)) && (!rootId||validId(c?.rpid)!==rootId)).slice(0,hotLimit);
    if(samples.length){
      snippets.push('当前最新其他热门评论（配置最多'+hotLimit+'条，本轮实际'+samples.length+'条）：'+samples.map(c=>str((c.user||c.member?.uname||'网友')+'：'+str(c.content,72),98)).join(' / '));
      sources.push('最新其他热门评论 '+samples.length+' 条（配置 '+hotLimit+' 条）');
    }
    if(!threadAvailable&&details.kind==='at'&&!rootId&&targetId&&String(details.text||'').trim()){
      snippets.push('本次 @ 位于视频顶层评论，邀请原文见当前通知；该评论没有父楼层，不要求取得楼中楼。');
      sources.push('顶层 @ 通知');
    }
    if(includeHot&&!hot&&earlier.length){
      const oldSamples=earlier.filter(c=>!excluded.has(validId(c?.rpid))).slice(0,4);
      if(oldSamples.length){snippets.push('历史热门评论快照（可能已变化）：'+oldSamples.map(c=>str(c.content,90)).join(' / '));sources.push('历史热门评论快照');}
    }
    snippets.push('只依据以上实际取得的资料作答；未获得的视频画面不能编造。');
    const counts={hot:current.length,hotProvided:samples.length,hotLimit,thread:threadCount,subtitle:!!subtitle,rootComment:!!rootComment};
    const summary=[info?.title?'视频标题/简介':'无视频元数据',note?'有历史视频分析记录':'无历史视频分析记录',subtitle?'有字幕':'无字幕',rootComment?'已取得主评论':'未找到主评论',hot?`最新热评取回 ${current.length} 条 / 额外提供 ${samples.length} 条（设置 ${hotLimit}）`:'最新热评读取失败',threadAvailable?`楼中楼 ${threadCount} 条`:'楼中楼未完整读取'].join(' · ');
    // Reuse already-fetched text for diagnostics: no additional B站 request or AI call.
    const rootPreview=rootComment
      ?str((rootComment.user||rootComment.name||rootComment.member?.uname||'原评论作者')+'：'+String(rootComment.content||''),600):'';
    const threadPreview=threadSelection.map(c=>str((c.name||c.user||'网友')+'：'+String(c.content||''),180)).join('\n').slice(0,900);
    const hasNotificationContext=!!String(details.text||'').trim()&&!!String(details.context||'').trim();
    const topLevelInvite=details.kind==='at'&&details.topLevel===true&&!!String(details.text||'').trim() || details.kind==='at'&&!rootId&&!!targetId&&!!String(details.text||'').trim();
    const verifiedSource=[rootComment,...threadRows].filter(c=>validId(c?.rpid)===targetId&&String(c?.mid||c?.member?.mid||'')===String(details.uid||''))
    const imageUrl=verifiedSource.length===1?extractBiliPicture(verifiedSource[0]):''
    return {imageUrl,text:snippets.join('\n').slice(0,8500),usable:!!(info?.title||subtitle||note)&&(!includeHot||!!hot)&&(threadAvailable||topLevelInvite||hasNotificationContext),
      fromCache:!!old.info||!!old.subtitle,hotFresh:!!hot&&now()-hot.at<120_000,summary,sources,counts,rootPreview,threadPreview};
  }
  return {forReply};
}
