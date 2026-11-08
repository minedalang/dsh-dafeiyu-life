/** dev.30: verified actions become ordinary fading Life episodes, never a
 * parallel permanent 'recommended videos' memory or an outbound permission.
 * A callback must only run AFTER the canonical source verified its result.
 */
import {createHash} from 'node:crypto'
const SCOPE=/^[a-f0-9]{16}$/
const UID=/^[1-9]\d{0,18}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const ACTIONS=new Set(['share_video','video_like','video_collect','video_follow','video_unfollow',
 'video_folder_delete','video_comment','dm_reply','comment_reply','followup','owner_care',
 'friend_outreach','dynamic_post','read_public_search','read_video_metadata',
 'inspect_creator_space','inspect_public_person','review_public','todo_read'])
const clean=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
export function verifiedLifeActionEvent({action='',accountTag='',sourceId='',bvid='',title='',recipientUid='',at=Date.now(),verified=false}={}){
 if(verified!==true||!ACTIONS.has(action)||!SCOPE.test(accountTag)||
   typeof sourceId!=='string'||sourceId.length<6||sourceId.length>200||
   !Number.isSafeInteger(at)||at<946684800000||at>Date.now()+60_000)return null
 if(action==='share_video'&&(!BV.test(bvid)||!UID.test(recipientUid)))return null
 if(['video_like','video_collect','video_follow','video_comment','read_video_metadata','inspect_creator_space'].includes(action)&&!BV.test(bvid))return null
 const digest=createHash('sha256').update(accountTag+'\0'+action+'\0'+sourceId).digest('hex').slice(0,32)
 return {kind:'action',key:`life-action:${accountTag}:${digest}`,verified:true,action,accountTag,at,
   ...(BV.test(bvid)?{bvid}:{}),...(BV.test(bvid)&&title?{title:clean(title,140)}:{}),
   ...(action==='share_video'?{recipientUid}:{} )}
}
