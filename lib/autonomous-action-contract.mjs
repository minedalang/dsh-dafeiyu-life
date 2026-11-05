/**
 * 2.7.1-dev.3: shared read-only action identity for the autonomous scheduler.
 * This is deliberately NOT a new task ledger, memory store, send gate or agent.
 * Source stores retain responsibility for their own transitions and receipts.
 *
 * An action identity means "same read-only operation on the same public target".
 * Reading BV metadata is NOT equivalent to watching a video, and finding a
 * search result is NOT equivalent to fulfilling an accepted TODO.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const normalizeTopic=value=>String(value??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().toLowerCase()
const key=(operation,target)=>target?operation+':'+target:''

export function readActionIdentity(row,kind){
  if(!row||typeof row!=='object')return ''
  if(kind==='todo'){
    if(row.type==='search_videos')return key('public-search',normalizeTopic(row.topic))
    if(row.type==='watch_video'&&BV.test(row.bvid))return key('video-content',row.bvid)
    if(row.type==='inspect_creator_videos'&&UID.test(String(row.uid||'')))return key('creator-portfolio',String(row.uid))
    if(row.type==='inspect_my_space')return 'account-own-space'
    if(row.type==='check_notifications')return 'account-notifications'
    return '' // In particular, NO identity for external write actions.
  }
  if(kind==='cue'){
    if(row.source==='interest-milestone')return key('public-search',normalizeTopic(row.topic))
    if(row.source==='discussion-read'&&BV.test(row.bvid))return key('video-metadata',row.bvid)
  }
  if(kind==='opportunity'){
    if(row.source==='public-person-observation')return '' // Private/public evidence review is NOT a platform read.
    if(BV.test(row.bvid))return key('video-metadata',row.bvid)
  }
  return ''
}

/** Keep ongoing exploration ahead of another one-shot metadata read.
 * Never hide accepted promises, change their statuses or claim one receipt for
 * a different source. The existing privacy/account adapters MUST prefilter all
 * source data before invoking this pure function.
 */
export function reconcileAutonomousActions({todos=[],cues=[],intentions=[],opportunities=[]}={}){
  const accepted=new Set(todos.map(x=>readActionIdentity(x,'todo')).filter(Boolean))
  const heldCues=[],heldOpportunities=[]
  const liveCues=[]
  for(const row of cues){
    const identity=readActionIdentity(row,'cue')
    // The accepted search is an obligation; this curiosity may be considered
    // later, but must not launch a competing same-topic search now.
    if(identity&&accepted.has(identity)){heldCues.push('accepted-read');continue}
    liveCues.push(row)
  }
  const continuingBvs=new Set()
  for(const intent of intentions){
    if(!['ready','inspected'].includes(intent?.status))continue
    for(const video of [...(Array.isArray(intent.videos)?intent.videos:[]),...(Array.isArray(intent.creatorVideos)?intent.creatorVideos:[])]){
      if(BV.test(video?.bvid))continuingBvs.add(video.bvid)
    }
    if(BV.test(intent?.selectedBvid))continuingBvs.add(intent.selectedBvid)
  }
  const seenMetadata=new Set(),liveOpportunities=[]
  for(const row of opportunities){
    const identity=readActionIdentity(row,'opportunity')
    if(identity&&(continuingBvs.has(row.bvid)||seenMetadata.has(identity))){heldOpportunities.push('ongoing-or-duplicate-read');continue}
    if(identity)seenMetadata.add(identity)
    liveOpportunities.push(row)
  }
  return {todos,cues:liveCues,intentions,opportunities:liveOpportunities,
    diagnostic:{heldCues:heldCues.length,heldOpportunities:heldOpportunities.length,
      // Fixed category names only: never persist topics, BV, UID, prompts or private text.
      reasons:[...(heldCues.length?['accepted-read']:[]),...(heldOpportunities.length?['ongoing-or-duplicate-read']:[])]}}
}

/** Re-evaluate at execution time, because TODOs/intentions can change while
 * the model is running. Same action identity, not merely same subject/BV.
 */
export function isActionCoveredByAcceptedTodo(cue,todos=[]){
  const identity=readActionIdentity(cue,'cue')
  return Boolean(identity&&todos.some(row=>
    ['open','deferred','running','uncertain','blocked'].includes(row?.status||'open')&&
    readActionIdentity(row,'todo')===identity))
}
export function isOpportunityCoveredByIntention(opportunity,intentions=[]){
  if(!readActionIdentity(opportunity,'opportunity'))return false
  return intentions.some(intent=>['ready','inspected'].includes(intent?.status)&&
    ([...(Array.isArray(intent.videos)?intent.videos:[]),...(Array.isArray(intent.creatorVideos)?intent.creatorVideos:[])].some(v=>v?.bvid===opportunity.bvid)||intent.selectedBvid===opportunity.bvid))
}
