/** Channel-specific identity/authority. This is NOT an AI decision engine. */
import {socialTier} from './social-tier.mjs'
import {normalizeFriendDirectory} from './friend-directory.mjs'
const UID=/^[1-9]\d{0,18}$/
export function createSocialPolicyGate({getConfig=()=>({})}={}){
 const current=()=>getConfig()||{}
 const actor=uid=>{const c=current(),id=String(uid||'');const role=UID.test(id)?socialTier(id,c.dmOwnerUid,c.friendDirectory):'unverified';
   let friend=null;try{friend=JSON.parse(normalizeFriendDirectory(c.friendDirectory)).find(f=>f.uid===id)||null}catch{}
   return {uid:id,role,friend:role==='friend'?friend:null}}
 const canTrustComment=({uid,kind})=>{const {role,friend}=actor(uid),c=current();return role==='owner'?c.ownerCommentAgentEnabled===true:
   role==='friend'&&(kind==='at'?c.commentAtEnabled===true&&friend?.atInvite===true:c.commentWatchReplies===true)}
 const canLearn=({uid,kind})=>{const {role,friend}=actor(uid);return role==='friend'&&(kind!=='at'||friend?.atInvite===true)}
 const memoryScope=({uid,kind})=>actor(uid).role==='owner'&&kind==='dm'?'owner-private':'public-social'
 const canViewRelationship=({uid,kind})=>actor(uid).role==='friend'&&kind==='comment'
 const canViewIdentity=({uid,kind})=>['owner','friend'].includes(actor(uid).role)&&kind==='dm'
 const shouldReadHot=({kind})=>kind==='at' // all valid @ invitations, not only friends
 return {actor,canTrustComment,canLearn,memoryScope,canViewRelationship,canViewIdentity,shouldReadHot}
}
