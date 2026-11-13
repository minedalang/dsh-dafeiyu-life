/**
 * dev.12: evidence novelty is a deterministic resource signal, NOT a second
 * agency decision. No model text, private data or inferred preference enters it.
 * It may avoid a redundant immediate model call, never veto a valid action.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
export function verifiedEpisodeYield(action,{before=null,after=null,receipt=null}={}){
  if(receipt?.ok!==true)return {kind:'unverified',novel:false,observations:0}
  if(action==='inspect_exploration'){
    const bvid=String(after?.selectedBvid||'')
    return {kind:'video-metadata',novel:BV.test(bvid)&&bvid!==before?.selectedBvid,observations:1}
  }
  if(action==='inspect_creator_space'){
    const old=new Set((before?.creatorVideos||[]).map(x=>x?.bvid).filter(x=>BV.test(String(x))))
    const count=(after?.creatorVideos||[]).filter(x=>BV.test(String(x?.bvid))&&!old.has(x.bvid)).length
    return {kind:'creator-posts',novel:count>0,observations:count}
  }
  if(action==='inspect_video_discussion'){
    const already=(before?.discussionReadBvids||[]).includes(before?.selectedBvid)
    const count=Math.max(0,Number(receipt.count)||0)
    return {kind:'discussion',novel:!already&&count>0,observations:count}
  }
  if(action==='browse_home_more')return {kind:'home-recommendations',novel:Number(receipt.added)>0,observations:Number(receipt.added)||0}
  if(action==='abandon_exploration')return {kind:'voluntary-stop',novel:false,observations:0}
  return {kind:'other',novel:false,observations:0}
}

/** At most one automatic Life wake per genuinely new verified observation.
 * The episode itself stays available for future independent planner choices.
 */
export function shouldWakeAfterVerifiedRead(signal){
  return signal?.novel===true&&Number(signal?.observations)>0
}
