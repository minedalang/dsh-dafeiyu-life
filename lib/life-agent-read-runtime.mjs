/** Shared turn-local read tool contract. Host capabilities are the authority;
 * the model chooses the order. No permission, scheduling or external writes
 * originate here. Same-kind rereads require a future target-aware protocol. */
export const LIFE_READ_LIMITS=Object.freeze({rounds:6,total:8,perRequest:4})
const descriptors=Object.freeze({
  todo:'读取当前联系人相关的既有待办回执',recommendation:'读取已核验推荐入账',
  memory:'按自主 recallQueries 检索当前允许域的活体记忆，可附时间或细节范围',
  portrait:'读取当前联系人获准画像线索',meme:'核对当前话题的本地梗知识',
  video:'展开本评论来源的真实视频上下文',history:'展开当前会话历史',
  public_person:'查看当前真实评论者的获准公开投稿',hot_comments:'查看当前真实 BV 的公开热评',
  shared_link:'核验当前已提供的分享候选，多个候选须选择准确 ID',
  shared_original:'读取已核验分享的唯一原动态',shared_video:'观察获准分享视频的代表性画面或语音',
  recent_observations:'主人专属：查看当前账号现有观察清单',
  observation_detail:'主人专属：从已核验清单选择精确分镜，核验字节和旧描述',
  owner_todos:'主人专属：查看当前账号开放待办状态'
})
export const isLifeReadKind=kind=>typeof kind==='string'&&Object.hasOwn(descriptors,kind)
export const lifeReadDescription=kind=>isLifeReadKind(kind)?descriptors[kind]:''
export function lifeReadKinds(value){return Array.isArray(value)?[...new Set(value.filter(isLifeReadKind))]:[]}
export function validateLifeReadRequest(requested,menu){
  if(!Array.isArray(requested)||!Array.isArray(menu)||requested.length>LIFE_READ_LIMITS.perRequest)return null
  const offered=new Set(menu.filter(x=>x.risk==='read').map(x=>x.action))
  if(requested.some(kind=>!isLifeReadKind(kind)||!offered.has('read_'+kind)))return null
  return lifeReadKinds(requested)
}
/** Project unused current capabilities, not static workflows. Budget is per
 * conversation item; the existing host still checks shared platform budgets. */
export function remainingLifeReads(offered,used=[],rounds=0){
  const consumed=new Set(used)
  if(rounds>=LIFE_READ_LIMITS.rounds||consumed.size>=LIFE_READ_LIMITS.total)return []
  return lifeReadKinds(offered).filter(kind=>!consumed.has(kind))
}
export function createLifeReadRuntime(){
  const used=new Set();let rounds=0
  return {
    get used(){return [...used]},get rounds(){return rounds},
    available:offered=>remainingLifeReads(offered,used,rounds),
    validate(requested,menu){
      const kinds=validateLifeReadRequest(requested,menu)
      if(!kinds?.length||rounds>=LIFE_READ_LIMITS.rounds||used.size+kinds.length>LIFE_READ_LIMITS.total||kinds.some(k=>used.has(k)))return null
      return kinds
    },
    record(kinds){for(const k of kinds)used.add(k);rounds++}
  }
}
