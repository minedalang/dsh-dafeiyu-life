/** dev.30: verified actions become ordinary fading Life episodes, never a
 * parallel permanent 'recommended videos' memory or an outbound permission.
 * A callback must only run AFTER the canonical source verified its result.
 */
import {createHash} from 'node:crypto'
const SCOPE=/^[a-f0-9]{16}$/
const UID=/^[1-9]\d{0,18}$/
const BV=/^BV[0-9A-Za-z]{10}$/
/** One vocabulary for verified Life experiences, wake receipts and fading
 * episodes. This is a descriptive contract, NOT a platform send authority. */
export const LIFE_ACTION_NAMES=Object.freeze({
 share_video:'向已授权的收件人推荐公开视频',video_like:'给视频点赞',
 video_collect:'收藏视频',video_follow:'关注视频作者',video_unfollow:'取关视频作者',
 video_folder_delete:'删除自己创建的收藏夹',video_comment:'发表原创主评论',
 dm_reply:'回复私信',dm_follow:'自主关注长期私信联系人',comment_reply:'回复公开评论',followup:'完成待办回访',
 owner_care:'主动关心主人',friend_outreach:'联系已授权好友',dynamic_post:'发表生活动态',
 read_public_search:'检索公开作品并获得真实结果',read_video_metadata:'核实公开视频的元数据',
 inspect_creator_space:'查看视频作者的公开投稿',inspect_public_person:'查看已核验交流对象的公开作品',
 review_public:'复核已有公开互动证据',todo_read:'处理一个已接受的只读待办'
})
export const LIFE_VERIFIED_WRITE_ACTIONS=Object.freeze([
 'dm_reply','dm_follow','comment_reply','share_video','video_like','video_collect','video_follow',
 'video_unfollow','video_folder_delete','video_comment','followup','owner_care','friend_outreach','dynamic_post'
])
export const LIFE_PRIVATE_ACTIONS=Object.freeze(['share_video','dm_reply','dm_follow','followup','owner_care','friend_outreach'])
const ACTIONS=new Set(Object.keys(LIFE_ACTION_NAMES))
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
