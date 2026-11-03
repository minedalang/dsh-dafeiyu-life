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
 // DM willingness is decided by the model, but sending permission is not.
 // Relationship/familiarity never grants DM write access: trusted DM allow-list,
 // an explicit approval, or the owner's stranger-DM consent is required.
 const canSendDm=({uid,trusted=false,approved=false,strangerEnabled=false,approvalEnabled=false,
   approvalPending=false,strangerReplies=0,strangerMaxReplies=1,legacyStrangerOnce=false}={})=>{
   const id=String(uid||''),role=actor(id).role,c=current()
   if(!UID.test(id))return {allowed:false,reason:'invalid-uid',role:'unverified'}
   if(c.masterEnabled!==true)return {allowed:false,reason:'master-disabled',role}
   if(c.dmWatch!==true)return {allowed:false,reason:'dm-watch-disabled',role}
   if(trusted===true||approved===true)return {allowed:true,reason:approved?'approved':'trusted-dm',role}
   if(strangerEnabled!==true)return {allowed:false,reason:'stranger-dm-not-authorized',role}
   if(approvalEnabled===true&&approvalPending===true)return {allowed:false,reason:'strict-approval-pending',role}
   if((approvalEnabled===true||legacyStrangerOnce===true)&&Number(strangerReplies)>=Math.max(1,Number(strangerMaxReplies)||1))
     return {allowed:false,reason:legacyStrangerOnce?'legacy-stranger-reply-limit':'strict-approval-reply-limit',role}
   return {allowed:true,reason:'stranger-autonomy-consented',role}
 }
 const memoryScope=({uid,kind})=>actor(uid).role==='owner'&&kind==='dm'?'owner-private':'public-social'
 // Relationship familiarity is public, UID-scoped metadata, not friend authorization.
 const canViewRelationship=({uid,kind})=>kind==='comment'&&actor(uid).role!=='unverified'
 const canViewIdentity=({uid,kind})=>['owner','friend'].includes(actor(uid).role)&&kind==='dm'
 const shouldReadHot=({kind})=>kind==='at' // all valid @ invitations, not only friends
 return {actor,canTrustComment,canLearn,canSendDm,memoryScope,canViewRelationship,canViewIdentity,shouldReadHot}
}
