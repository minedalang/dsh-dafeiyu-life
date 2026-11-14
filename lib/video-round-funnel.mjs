/** Read-only, account-bound video-tool receipts from one headless round.
 * A metadata or text-tool receipt is not proof of full video watching.
 * The Python side writes bounded tool outcomes, never titles, comments,
 * subtitles, prompts, account identifiers or credentials.
 */
import {existsSync,lstatSync,readFileSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'

const ROUND=/^[a-f0-9]{24}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const TOOLS=new Set(['bili_search','bili_home_recommendations','bili_video_info','bili_subtitle',
  'bili_comments','bili_transcribe_safe','bili_ledger_mark'])
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:0

export function summarizeVideoFunnel(events,{views=1000,likes=10,replies=3}={}){
  const byVideo=new Map(),candidates=new Set()
  let searches=0,homeReads=0,toolErrors=0
  const get=bv=>{
    if(!byVideo.has(bv))byVideo.set(bv,{bvid:bv,metadata:false,content:false,subtitle:false,
      comments:false,selected:false,skipped:false,duplicate:false,metadataError:false,heatInsufficient:false})
    return byVideo.get(bv)
  }
  for(const e of (Array.isArray(events)?events:[]).slice(0,240)){
    if(!e||!TOOLS.has(e.tool))continue
    const ok=e.ok===true
    if(!ok)toolErrors++
    if(e.tool==='bili_search'||e.tool==='bili_home_recommendations'){
      if(ok){if(e.tool==='bili_search')searches++;else homeReads++}
      for(const bv of Array.isArray(e.candidates)?e.candidates.slice(0,50):[])
        if(BV.test(String(bv)))candidates.add(String(bv))
      continue
    }
    if(!BV.test(String(e.bvid||'')))continue
    const row=get(e.bvid)
    if(e.tool==='bili_video_info'){
      if(ok){
        row.metadata=true
        const stats=e.stat||{}
        row.heatInsufficient=(integer(views)>0&&integer(stats.view)<integer(views))||
          (integer(likes)>0&&integer(stats.like)<integer(likes))||
          (integer(replies)>0&&integer(stats.reply)<integer(replies))
      }else row.metadataError=true
    }else if(e.tool==='bili_subtitle'&&ok&&e.content===true){row.content=true;row.subtitle=true}
    else if(e.tool==='bili_comments'&&ok&&e.content===true){row.content=true;row.comments=true}
    else if(e.tool==='bili_transcribe_safe'&&ok&&e.content===true)row.content=true
    else if(e.tool==='bili_ledger_mark'&&ok){
      if(e.status==='picked')row.selected=e.recorded===true||row.selected
      if(e.status==='skipped')row.skipped=true
      if(e.duplicate===true)row.duplicate=true
    }
  }
  const rows=[...byVideo.values()]
  return {
    source:'tool-receipts-not-complete-watching',searches,homeReads,
    candidates:candidates.size||null,metadataVerified:rows.filter(r=>r.metadata).length,
    contentRead:rows.filter(r=>r.content).length,
    subtitleRead:rows.filter(r=>r.subtitle).length,
    commentRead:rows.filter(r=>r.comments).length,
    selected:rows.filter(r=>r.selected).length,
    skipped:rows.filter(r=>r.skipped).length,
    duplicate:rows.filter(r=>r.duplicate).length,
    heatInsufficient:rows.filter(r=>r.metadata&&r.heatInsufficient).length,
    metadataFailed:rows.filter(r=>r.metadataError&&!r.metadata).length,
    notDeepRead:candidates.size?Math.max(0,[...candidates].filter(bv=>!byVideo.get(bv)?.content).length):null,
    toolErrors,
    // BV alone is public; do not persist any title or user-generated text.
    rows:rows.filter(r=>r.selected||r.skipped||r.duplicate||r.heatInsufficient||r.metadataError).slice(0,40)
  }
}

export function consumeVideoFunnel({stateDir,roundId,config={}}={}){
  if(!ROUND.test(String(roundId||''))||!stateDir)return null
  const folder=join(stateDir,'video-round-observations'),file=join(folder,roundId+'.jsonl')
  try{
    if(!existsSync(folder)||lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())return null
    if(!existsSync(file))return null
    const stat=lstatSync(file)
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>96_000)return null
    const data=readFileSync(file,'utf8')
    const events=data.split('\n').filter(Boolean).slice(0,240).map(line=>{
      try{return JSON.parse(line)}catch{return null}
    }).filter(Boolean)
    // The exact round ID was created by the host; consume only this file.
    const result=summarizeVideoFunnel(events,{
      views:config.minVideoViews,likes:config.minVideoLikes,replies:config.minVideoReplies})
    try{unlinkSync(file)}catch{}
    return result
  }catch{return null}
}

export function videoFunnelReport(funnel,{targetRead=8,targetPick=4}={}){
  if(!funnel)return ''
  const value=n=>n===null?'未观测到':String(n)
  const lines=[`#### 本轮视频探索漏斗（工具真实回执，不等于完整观看）`,
    `参考范围（不用于要求补齐或判断是否完成）：内容深入阅读约 ${targetRead} 条、择优入选约 ${targetPick} 条；实际：搜索 ${funnel.searches} 次、首页读取 ${funnel.homeReads} 次、候选 ${value(funnel.candidates)} 条、详情核实 ${funnel.metadataVerified} 条、取得字幕/非空评论等内容证据 ${funnel.contentRead} 条、入选工具回执 ${funnel.selected} 条。`,
    `可核验分类：热度未达标 ${funnel.heatInsufficient} 条、手动跳过 ${funnel.skipped} 条、重复记录 ${funnel.duplicate} 条、详情读取失败 ${funnel.metadataFailed} 条、工具失败 ${funnel.toolErrors} 次、候选未取得内容证据 ${value(funnel.notDeepRead)} 条。`,
    `注意：候选只是平台搜索/首页返回；详情/字幕/评论回执不代表看过画面或听过音频。跳过原因仅统计有工具证据的类别；缺少证据时不能推断鱼鱼的内心判断。`]
  // These numbers are only the owner's approximate exploration budget. Never
  // turn a model's voluntary stop into a deficit or unfinished assignment.
  lines.push('参考范围不是完成条件；无论是否达到参考值，均不能由工具统计推断鱼鱼想继续、想评论或为什么停止。')
  for(const r of funnel.rows.slice(0,20)){
    const states=[]
    if(r.selected)states.push('已入选')
    if(r.skipped)states.push('标记跳过')
    if(r.duplicate)states.push('重复')
    if(r.heatInsufficient)states.push('热度未达标')
    if(r.metadataError&&!r.metadata)states.push('详情核实失败')
    lines.push(`- [${r.bvid}](https://www.bilibili.com/video/${r.bvid})：${states.join('、')}`)
  }
  return lines.join('\n')
}
