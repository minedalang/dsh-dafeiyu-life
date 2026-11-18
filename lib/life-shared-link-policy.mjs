/** Current permission for a previously offered private share link.
 * Intake permission is not a permanent read grant: revoke/disable changes must
 * be honored again when Life later chooses to inspect the saved reference.
 */
const ROLES=new Set(['owner','friend','stranger','known','public'])
export function canReadSharedLinkFromSender({senderRole='',senderUid='',ownerUid='',currentRole='',dmEnabled=false,
  strangerEnabled=false,friendCanLearn=false}={}){
  if(!ROLES.has(senderRole)||!/^\d{1,19}$/.test(String(senderUid||'')))return false
  if(senderRole==='public')return true
  if(senderRole==='owner'&&!/^\d{1,19}$/.test(String(ownerUid||'')))return false
  if(dmEnabled!==true)return false
  if(senderRole==='owner')return String(senderUid)===String(ownerUid)
  if(senderRole==='friend')return currentRole==='friend'&&friendCanLearn===true
  if(['stranger','known'].includes(senderRole))
    return currentRole==='friend'?friendCanLearn===true:strangerEnabled===true&&currentRole==='stranger'
  return false
}
