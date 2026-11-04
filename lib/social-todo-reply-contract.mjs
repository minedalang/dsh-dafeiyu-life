/**
 * Outbound consistency assessment, NOT recommendation intent recognition.
 * Never generates or rewrites a user-facing sentence. The single social model
 * owns willingness, TODO proposals and all outward wording; a verified ledger
 * receipt owns the fact that a recommendation was actually saved.
 */
const affirmative=/(?:记下(?:来|啦|了|咯|喽)?|记住(?:啦|了|了哈)?|收进(?:待办|清单)|加入(?:待办|清单)|放(?:进|入)(?:待办|清单|列表)|(?:已经|都)?安排(?:上|进|好)(?:啦|了)?|已存(?:进|入)(?:待办|清单)|存(?:到|进)(?:待办|清单))/u
const negating=/(?:还没|尚未|没有|并没|未能|没能|不能|无法|尚不能|未成功|不敢说|没)(?:真正|成功|全部|完全)?(?:记下|记住|加入|放进|安排|存入|存到)/u
const quantity=/(?<!第)([一二两三123])\s*(?:首|条|个|项|部|份)(?:歌|曲|作品|视频|推荐|链接|待办)?/gu
const numberOf={一:1,二:2,两:2,三:3,'1':1,'2':2,'3':3}
const BV=/BV[0-9A-Za-z]{10}/g

function positiveCommitments(texts){
  // A negated first clause must not cancel a later affirmative clause:
  // “之前还没记下，现在记下了” is a claim about a successful write.
  return (Array.isArray(texts)?texts:[texts])
    .flatMap(value=>String(value||'').split(/[，,。；;！!？?\n]/u))
    .filter(clause=>affirmative.test(clause)&&!negating.test(clause))
}
function explicitClaimedCount(clause){
  const matches=[...clause.matchAll(quantity)]
  if(!matches.length)return 0
  return Math.max(...matches.map(m=>numberOf[m[1]]||0))
}
function verifiedSavedCount(result){
  if(Array.isArray(result?.items))return result.items.length
  return Math.max(0,Number(result?.createdCount)||0)+Math.max(0,Number(result?.duplicateCount)||0)
}

export function assessTodoReply({texts=[],todoDisposition='none',intakeResult,sourceText=''}={}){
  const commitments=positiveCommitments(texts)
  if(!commitments.length)return {ok:true,reason:'no-unverified-commitment'}
  if(todoDisposition!=='accept'||intakeResult?.complete!==true)
    return {ok:false,reason:'unverified-todo-commitment'}
  const saved=verifiedSavedCount(intakeResult)
  const claimed=Math.max(0,...commitments.map(explicitClaimedCount))
  if(claimed>saved)return {ok:false,reason:'unsupported-todo-quantity'}
  // For an explicit “all/全部/都已记下” promise, two distinct BV references
  // in the verified incoming message cannot be covered by just one saved task.
  // This is a conservative factual gate, not recommendation classification:
  // the model still decides which suggestions (if any) it wishes to accept.
  const sourceBvs=new Set(String(sourceText||'').match(BV)||[])
  const claimsAll=commitments.some(c=>/(?:都|全部|全都|统统)/u.test(c))
  if(claimsAll&&sourceBvs.size>saved)return {ok:false,reason:'unsupported-all-todos-claim'}
  return {ok:true,reason:'verified-durable-todo'}
}
