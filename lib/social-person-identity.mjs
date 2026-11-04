/**
 * Platform-separated person references for relationship UI and future adapters.
 * Identity is (platform, platform-local ID), inside the existing account runtime.
 * Similar names, profiles, or claims MUST NOT link accounts automatically.
 * At dev.5 only Bilibili is connected to verified observation/relationship data.
 */
const PLATFORM=/^[a-z][a-z0-9-]{1,31}$/
const ID=/^[a-zA-Z0-9_:.@-]{1,80}$/
const BILI_UID=/^[1-9]\d{0,18}$/
export function socialPersonRef(platform,platformUserId){
 const p=String(platform||'').toLowerCase(),id=String(platformUserId||'')
 if(!PLATFORM.test(p)||!ID.test(id)||(p==='bilibili'&&!BILI_UID.test(id)))throw TypeError('无效的平台身份')
 return Object.freeze({platform:p,platformUserId:id,personKey:p+':'+id,
   platformLabel:p==='bilibili'?'哔哩哔哩':p,linkedAccounts:[],linkStatus:'unverified-unlinked'})
}
export function bilibiliPerson(uid){return socialPersonRef('bilibili',uid)}
export function relationshipPortraitDepth(stage,{whitelisted=false}={}){
 // A stage is a display and evidence-budget hint, not an identity claim or permission.
 const order={new:0,known:1,familiar:2,friend:3,owner:3}
 const level=Object.hasOwn(order,String(stage))?order[stage]:0
 const cap=whitelisted?Math.max(2,[0,2,5,8][level]):[0,2,5,8][level]
 return {level,cap,label:['相遇摘要','初步了解','逐渐丰富','有证据的深入了解'][level],
   note:level===0&&!whitelisted?'仅显示真实相遇与往来，不推断私人的特点':'仅呈现对方明确表达的交流偏好和边界，不凭熟悉度编造性格'}
}
