/**
 * Verified, read-only video exploration evidence for Life Memory 2.0.
 * A title, a transcript, and an observed frame are different experiences.
 * Never claim the player was watched or a public action was performed.
 */
import {summarizeOwnerVideoExploration} from './owner-social-exploration.mjs'
import {safeExperienceOrigin} from './life-experience-continuity.mjs'
import {buildVideoEvidenceBundle,videoEvidenceFlags} from './video-evidence-bundle.mjs'
import {deriveVideoObservationNotes,deriveAIVideoSummaryNotes,safeVideoObservationNotes} from './video-scene-cues.mjs'

const clean=(v,n=160)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBV=v=>/^BV[A-Za-z0-9]{10}$/.test(String(v||''))
const validTitle=v=>{const s=clean(v,140);return s&&!/^(?:BV[A-Za-z0-9]{10}|无标题|unknown|undefined|null)$/i.test(s)?s:''}
const safeSource=v=>['bili-life','main-session','autonomous','owner-todo'].includes(v)?v:'bili-life'

export function buildVideoExplorationEvent({bvid,info,subtitle,comments,danmaku,visual,source='bili-life',operationId='',purpose='',autonomousSelected=false,accountTag='',focusReview=null,integratedVisualNotes=[],at=Date.now()}={}){
 if(!validBV(bvid)||!operationId||!/^[A-Za-z0-9_-]{8,90}$/.test(operationId))return null
 if(info?.ok===false||info?.error||info?.data?.code&&info.data.code!==0)return null
 const reviewed=summarizeOwnerVideoExploration({info,subtitle,comments,danmaku,visual},bvid)
 if(!reviewed.ok)return null
 const title=validTitle(reviewed.video.title)
 if(!title)return null
 // A read-only provenance summary cannot be forged into a Life write proof.
 const bundle=buildVideoEvidenceBundle({bvid,info,subtitle,comments,danmaku,visual,at})
 if(!bundle)return null
 const flags=videoEvidenceFlags(bundle)
 const visualSource=(flags.vision && flags.decoded)?'decoded-public-video':
   (flags.vision && flags.preview)?'low-resolution-preview':null
 const rawTimes=visualSource?bundle.sources.find(x=>x.kind===(visualSource==='decoded-public-video'?
   'decoded_visual_analysis':'preview_visual_analysis'))?.timePointsMs:null
 const timePointsMs=Array.isArray(rawTimes)&&rawTimes.length>=1&&rawTimes.length<=48&&
   rawTimes.every(x=>Number.isSafeInteger(x)&&x>=0)?rawTimes:[]
 // Preserve bounded, semantically useful free-language observations, never
 // issue authority to the image/model text. The memory gateway revalidates.
 const overviewNotes=visualSource?deriveVideoObservationNotes(visual?.description):[]
 const focusNotes=visualSource&&focusReview?.reviewStatus==='model-observation-not-independent-semantic-proof'&&
   Array.isArray(focusReview.frameTimesMs)&&focusReview.frameTimesMs.length>0?
   deriveVideoObservationNotes(focusReview.description):[]
 const synthesisNotes=visualSource==='decoded-public-video'?safeVideoObservationNotes(integratedVisualNotes):[]
 const mergedNotes=synthesisNotes.length?synthesisNotes:[...new Set([...overviewNotes,...focusNotes])].slice(0,4)
 const usedAiSummary=visualSource&&(deriveAIVideoSummaryNotes(visual?.description).length>0||
   (focusNotes.length>0&&deriveAIVideoSummaryNotes(focusReview?.description).length>0))
 const trustedAccount=/^[a-f0-9]{16}$/.test(String(accountTag||''))?accountTag:''
 const visualReceipt=visualSource&&timePointsMs.length?{
   source:visualSource,frameCount:timePointsMs.length,firstAtMs:timePointsMs[0],lastAtMs:timePointsMs[timePointsMs.length-1],
   // A persisted provenance footprint, not the model's raw answer or a claim
   // that the sampled stills contain a particular real event.
   interpretation:'model-observation-not-semantic-proof'}:null
 return {kind:'watch' ,key:`video-explore:${operationId}`,bvid,title,at,
  ...(visual?.status==='cached'?{visualObservationState:'cached'}:visual?.status==='analyzed'&&visualReceipt?{visualObservationState:'fresh'}:{}),
  ...(autonomousSelected===true&&safeSource(source)==='bili-life'&&Number.isFinite(at)?{time:new Date(at).toISOString()}:{}),
  autonomousSelected:autonomousSelected===true&&safeSource(source)==='bili-life',
  ...(trustedAccount?{accountTag:trustedAccount}:{}),
  experience:{source:safeSource(source),...flags,purpose:safeExperienceOrigin(purpose),
   ...(visualReceipt?{visualReceipt}:{}),
   ...(visualReceipt&&mergedNotes.length?{visualSceneNotes:mergedNotes,
     visualNotesMethod:synthesisNotes.length?'text-model-focus-merge':usedAiSummary?'vision-model-same-call':'extractive-fallback'}:{}),
   ...(visualReceipt&&focusReview?.reviewStatus==='model-observation-not-independent-semantic-proof'&&
     Number.isSafeInteger(focusReview.startMs)&&Number.isSafeInteger(focusReview.endMs)&&
     focusReview.endMs>focusReview.startMs?{focusWindow:{startMs:focusReview.startMs,endMs:focusReview.endMs,
       frames:Array.isArray(focusReview.frameTimesMs)?Math.min(48,focusReview.frameTimesMs.length):0,
       source:'decoded-public-video-focus'}}:{}),evidenceSchema:bundle.schema},
  // No raw third-party comments, UIDs, private messages or transcripts are
  // persisted here. The bounded, public title identifies the experience.
  note:visualReceipt?(visualReceipt.source==='decoded-public-video'?
    `公开视频离线采样 ${visualReceipt.frameCount} 帧；已取得视觉模型描述`:
    `B站低清预览采样 ${visualReceipt.frameCount} 帧；已取得视觉模型描述`):
    '读取过的公开资料',visibility:'public-event'}
}

/** Fresh, independently verified sampling only. Retain bounded scene notes from
 * each actual board, not the shallow AI summary or reconstructed history. A
 * range is a sampling envelope, not a claim of continuous playback. */
// Shared validation for both durable evidence and the transient gallery. A
// labelled but malformed board must never be converted into per-frame text.
export function verifiedStoryboardCellTexts(board){
 if(board?.status!=='analyzed'||!Array.isArray(board.times)||!board.times.length||board.times.length>12||board.times.some(t=>typeof t!=='number'||!Number.isFinite(t)||t<0))return null
 const raw=String(board.description||'').slice(0,16000)
 const cells=[...raw.matchAll(/^[ \t]*(?:[-*][ \t]+|[0-9]{1,2}[.)][ \t]+)?(?:\*\*)?R(\d{1,2})C(\d{1,2})(?:\*\*)?[ \t]*\[([0-9]{1,3}):([0-5][0-9])\](?:\*\*)?(?:[ \t]*[：:][ \t]*|[ \t]+)(\S[^\r\n]*)/gmi)]
 if(!cells.length)return []
 const cols=board.gridCols
 if(!Number.isSafeInteger(cols)||cols<1||cols>4||cells.length!==board.times.length||cells.some((m,j)=>Number(m[1])!==Math.floor(j/cols)+1||Number(m[2])!==j%cols+1||Number(m[3])*60+Number(m[4])!==Math.floor(board.times[j])))return null
 return cells.map(m=>m[5].trim())
}

export function buildFreshVideoDetails({bvid,info,visual,event,sourceRef}={}){
 if(visual?.status!=='analyzed'||event?.kind!=='watch'||event.bvid!==bvid||
    !['bili-life','main-session'].includes(event.experience?.source)||!/^(?:observation|focus):[a-f0-9]{32}$/.test(String(sourceRef||'')))return []
 const bundle=buildVideoEvidenceBundle({bvid,info,visual})
 const proof=bundle?.sources?.find(x=>['decoded_visual_analysis','preview_visual_analysis'].includes(x.kind)&&x.status==='analyzed')
 const times=proof?.timePointsMs,receipt=event.experience?.visualReceipt
 if(!receipt||!Array.isArray(times)||!times.length||times.length!==receipt.frameCount||
    times[0]!==receipt.firstAtMs||times.at(-1)!==receipt.lastAtMs||
    times.some((t,i)=>!Number.isSafeInteger(t)||t<0||i>0&&t<=times[i-1]))return []
 const notes=description=>deriveVideoObservationNotes(String(description||'').split(/\r?\n/).filter(line=>!/^\s*(?:视觉记忆摘要|【视觉记忆摘要】)\s*[：:]/u.test(line)).join('\n'))
 const boards=Array.isArray(visual.visionBoardReceipts)?visual.visionBoardReceipts:[]
 const result=[]
 const fragment=(index,content,start,end)=>({fragmentId:'observation-'+sourceRef.slice(-24)+'-'+index,
  type:'observed-scene',sourceRef,certainty:'model-observation',content,timeAnchorMs:[start,end],
  uncertainties:['仅为实际采样画面的模型观察，未独立核验语义；不代表连续观看或逐秒覆盖']})
 // The Python receipt uses RnCn [mm:ss] lines, validated against the actual
 // tile order. Revalidate before attaching each line to its precise ms anchor.
 // Legacy board prose may lack per-cell lines; only use its verified board envelope.
 if(boards.length){
  if(boards.length>12)return []
  let offset=0
  for(const [i,board] of boards.entries()){
   const bt=board?.times
   if(board?.index!==i+1||board.status!=='analyzed'||!Array.isArray(bt)||!bt.length||bt.length>12||
      bt.some((t,j)=>typeof t!=='number'||!Number.isFinite(t)||offset+j>=times.length||Math.abs(t*1000-times[offset+j])>=150))return []
   const raw=String(board.description||'').slice(0,16000)
   const cells=verifiedStoryboardCellTexts(board)
   if(cells===null)return []
   if(cells.length){
    for(const [j,cell] of cells.entries()){
     const text=notes(cell).map(n=>n.replace(/[；;。]+$/u,'')).join('；')
     if(text)result.push(fragment(offset+j,text,times[offset+j],times[offset+j]))
    }
   }else{
    // Old verified board receipt with no individually labeled lines: do not
    // invent cell-level alignment or treat its shallow summary as deep evidence.
    const text=notes(raw).join('；')
    if(text)result.push(fragment(offset,text,times[offset],times[offset+bt.length-1]))
   }
   offset+=bt.length
  }
  if(offset!==times.length)return []
 }else{
  const text=notes(visual.description).join('；')
  if(text)result.push(fragment(0,text,times[0],times.at(-1)))
 }
 return result
}

const stopWords=/^(?:你|鱼鱼|大肥鱼|以前|之前|上次|是不是|是否|还|有没有|看过|记得|那条|那个|这条|这个|视频|的|吗|嘛|呀|啊|了|呢|我|说|提到|讲|关于|里面|在|过|曾经|一下|还记得|记不记得)+$/
export function videoRecallQueries(input='',{currentBvid=''}={}){
 const text=clean(input,1100),hints=[]
 const push=v=>{const x=clean(v,140);if(x.length>=2&&!hints.includes(x))hints.push(x)}
 const explicit=[...text.matchAll(/BV[A-Za-z0-9]{10}/g)].map(x=>x[0])
 for(const id of explicit)push(id)
 for(const m of text.matchAll(/(?:《([^》]{2,100})》|“([^”]{2,100})”|「([^」]{2,100})」|"([^"\n]{2,100})")/g))push(m[1]||m[2]||m[3]||m[4])
 // A referenced video, as opposed to a specific *other* video, can use the
 // platform-verified BV. It is never guessed from the current comment's text.
 const deictic=/(?:这个|这条|本条|当前|这里|这视频|该视频)(?:.{0,4})(?:视频|片|内容)?/.test(text)
 if(!explicit.length&&hints.length===0&&deictic&&validBV(currentBvid))push(currentBvid)
 // Strip question scaffolding only for a genuinely descriptive phrase; do not
 // convert general "看过什么视频" questions into misleading title matches.
 const phrase=text.replace(/@[^\s，。！？；：,!?;:]{1,45}/g,' ')
  .replace(/(?:以前|之前|上次|曾经|还记得|记不记得|是不是|是否|看过|有没有|那个|那条|这个|这条|关于|里面|讲的|视频|吗|嘛|呀|啊|呢|了|过)/g,' ')
  .replace(/[\s，。！？；：,!?;:《》“”「」"']/g,' ').trim()
 if(phrase.length>=3&&!stopWords.test(phrase))push(phrase)
 push(text)
 return hints.slice(0,5)
}
