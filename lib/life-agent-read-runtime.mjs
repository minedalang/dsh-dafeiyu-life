import {executeChosenLifeRead} from './life-willingness.mjs'
import {normalizeRecallRequest} from './recall-request.mjs'
import {normalizeVisualDetailSelection} from './active-recall-contract.mjs'
/** Shared turn-local read tool contract. Host capabilities are the authority;
 * the model chooses the order. No permission, scheduling or external writes
 * originate here. Only memory has a verified parameter contract for rereads. */
export const LIFE_READ_LIMITS=Object.freeze({rounds:6,total:8,perRequest:4,memory:3})
const descriptors=Object.freeze({
  todo:'读取当前联系人相关的既有待办回执',recommendation:'读取已核验推荐入账',
  memory:'按自主 recallQueries 检索当前允许域的活体记忆，可附时间或细节范围；不同参数可再次检索',
  portrait:'读取当前联系人获准画像线索',meme:'核对当前话题的本地梗知识',
  video:'展开本评论来源的真实视频上下文',history:'展开当前会话历史',
  public_person:'查看当前真实评论者的获准公开投稿',hot_comments:'查看当前真实 BV 的公开热评',
  shared_link:'核验当前已提供的分享候选，多个候选须选择准确 ID',
  shared_original:'读取已核验分享的唯一原动态',shared_video:'观察获准分享视频的代表性画面或语音',
  recent_observations:'主人专属：查看当前账号现有观察清单',
  observation_detail:'主人专属：从已核验清单选择精确分镜，核验字节和旧描述',
  owner_todos:'主人专属：查看当前账号开放待办状态'
})
// One registry of the actual read routes, not a permission source. An alias
// identifies a host adapter, not interchangeable access to its target/domain.
const episodeDescriptors=Object.freeze({
  recall_public_experience:{kind:'memory',description:'检索当前账号活体公开旧观察，不是新观看'},
  inspect_exploration:{kind:'video',description:'核验当前 Episode 提供的准确 BV 元数据'},
  inspect_creator_space:{kind:'public_person',description:'查看当前已核验作品作者的公开投稿'},
  browse_home_more:{kind:'home_feed',description:'读取当前 Episode 获准的真实首页推荐'},
  inspect_commenter_works:{kind:'public_person',description:'查看当前菜单内具备独立证据的评论者公开投稿'},
  inspect_video_discussion:{kind:'hot_comments',description:'查看当前已核验 BV 的真实公开讨论'}
})
export function registeredLifeRead(scene,action){
  if(typeof action!=='string')return null
  if(scene==='social'&&action.startsWith('read_')){
    const kind=action.slice(5)
    return Object.hasOwn(descriptors,kind)?{action,kind,description:descriptors[kind]}:null
  }
  return scene==='episode'&&Object.hasOwn(episodeDescriptors,action)?{action,...episodeDescriptors[action]}:null
}
/** Only host-validated actions reach this gateway. Registration is not a
 * capability grant; the original adapter still owns permissions and receipts.
 * Scope is checked on both sides of I/O by the existing willingness helper. */
export async function executeRegisteredLifeRead({scene,actions,isCurrent,read}={}){
  if(!Array.isArray(actions)||!actions.length||new Set(actions).size!==actions.length||
    actions.some(action=>!registeredLifeRead(scene,action))||scene==='episode'&&actions.length!==1)
    return {ok:false,reason:'life-read-not-registered'}
  return executeChosenLifeRead({chosen:true,isCurrent,read})
}
export const isLifeReadKind=kind=>typeof kind==='string'&&Object.hasOwn(descriptors,kind)
export const lifeReadDescription=kind=>isLifeReadKind(kind)?registeredLifeRead('social','read_'+kind).description:''
export function lifeReadKinds(value){return Array.isArray(value)?[...new Set(value.filter(isLifeReadKind))]:[]}
export function validateLifeReadRequest(requested,menu){
  if(!Array.isArray(requested)||!Array.isArray(menu)||requested.length>LIFE_READ_LIMITS.perRequest)return null
  const offered=new Set(menu.filter(x=>x.risk==='read').map(x=>x.action))
  if(requested.some(kind=>!isLifeReadKind(kind)||!offered.has('read_'+kind)))return null
  return lifeReadKinds(requested)
}
/** Project unused current capabilities, not static workflows. Budget is per
 * conversation item; the existing host still checks shared platform budgets. */
/** Normalize the effective recall parameters, never a model-supplied scope.
 * Order/case changes alone cannot manufacture a new search. */
export function lifeMemoryReadKey(queries,recall={},now=Date.now()){
  const extra=recall&&typeof recall==='object'&&!Array.isArray(recall)?recall:{}
  const normalized=normalizeRecallRequest({queries,intent:extra.intent,time:extra.time,kinds:extra.kinds},{now})
  const detail=normalizeVisualDetailSelection(extra.detail)
  if(!normalized||detail===false||detail&&(normalized.time||normalized.kinds.length||normalized.intent!=='topic_recall'))return null
  return JSON.stringify({queries:normalized.queries.map(q=>q.toLowerCase()).sort(),intent:normalized.intent,
    kinds:[...normalized.kinds].sort(),time:normalized.time?{fromDay:normalized.time.fromDay,toDay:normalized.time.toDay}:null,detail})
}
export function remainingLifeReads(offered,used=[],rounds=0,{total=new Set(used).size,memoryCount=0,allowMemoryRepeat=false}={}){
  const consumed=new Set(used)
  if(rounds>=LIFE_READ_LIMITS.rounds||total>=LIFE_READ_LIMITS.total)return []
  return lifeReadKinds(offered).filter(kind=>!consumed.has(kind)||kind==='memory'&&allowMemoryRepeat&&memoryCount<LIFE_READ_LIMITS.memory)
}
export function createLifeReadRuntime({allowMemoryRepeat=false}={}){
  const used=new Set(),memoryKeys=new Set();let rounds=0,total=0
  return {
    get used(){return [...used]},get rounds(){return rounds},get total(){return total},get memoryCount(){return memoryKeys.size},
    available:offered=>remainingLifeReads(offered,used,rounds,{total,memoryCount:memoryKeys.size,allowMemoryRepeat}),
    validate(requested,menu,{memoryKey=null}={}){
      const kinds=validateLifeReadRequest(requested,menu)
      if(!kinds?.length||rounds>=LIFE_READ_LIMITS.rounds||total+kinds.length>LIFE_READ_LIMITS.total||kinds.some(k=>used.has(k)&&k!=='memory'))return null
      if(kinds.includes('memory')&&(!memoryKey||used.has('memory')&&(!allowMemoryRepeat||memoryKeys.has(memoryKey)||memoryKeys.size>=LIFE_READ_LIMITS.memory)))return null
      return kinds
    },
    record(kinds,{memoryKey=null}={}){for(const k of kinds)used.add(k);if(kinds.includes('memory'))memoryKeys.add(memoryKey);total+=kinds.length;rounds++}
  }
}
