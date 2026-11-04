/**
 * Outbound consistency assessment, NOT recommendation intent recognition.
 * Never generates or rewrites a user-facing sentence. The single social model
 * owns willingness, TODO proposals and all outward wording; a verified ledger
 * receipt owns the fact that a recommendation was actually saved.
 */
// This lexical gate is deliberately a conservative *negative* guard. It does
// not decide whether fish wants to accept a recommendation, and cannot prove
// every possible Chinese sentence true. Opaque/ambiguous claims are sent back
// to the same model, never rewritten into preset outward sentences.
const affirmative=/(?:记下(?:来|啦|了|咯|喽)?|记住(?:啦|了|了哈)?|收(?:进|入|好|下)(?:了|啦|到)?|加入(?:待办|清单)|放(?:进|入)(?:待办|清单|列表|小本本)|(?:已经|都)?安排(?:上|进|好)(?:啦|了)?|(?:已|已经)?存(?:好|了|到|进|入)|收入(?:待办|清单|小本本))/u
const negating=/(?:还没|尚未|没有|并没|未能|没能|不能|无法|尚不能|未成功|不敢说|没)(?:真正|成功|全部|完全)?(?:记下|记住|加入|放进|安排|存入|存到|收好|收进|存好|收入)/u
const quantity=/(?<!第)([一二两三123])\s*(?:首|条|个|项|部|份)(?:歌|曲|作品|视频|推荐|链接|待办)?/gu
const numberOf={一:1,二:2,两:2,三:3,'1':1,'2':2,'3':3}
const BV=/BV[0-9A-Za-z]{10}/g
const ordinal=/(?:第[一二三123]首|另一首)/gu
const conjunction=/(?:第[一二三123]首)\s*(?:和|与|及|、|还有)\s*(?:另一首|第[一二三123]首)/u

function positiveCommitments(texts){
  // A negated first clause must not cancel a later affirmative clause:
  // “之前还没记下，现在记下了” is a claim about a successful write.
  return (Array.isArray(texts)?texts:[texts])
    .flatMap(value=>String(value||'').split(/[，,。；;！!？?\n]/u))
    .filter(clause=>affirmative.test(clause)&&!negating.test(clause))
}
function explicitClaimedCount(clause){
  const matches=[...clause.matchAll(quantity)]
  const bound=matches.length?Math.max(...matches.map(m=>numberOf[m[1]]||0)):0
  return conjunction.test(clause)?Math.max(2,bound):bound
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
  const claimsAll=commitments.some(c=>/(?:都|全部|全都|统统|全(?:记下|收好|存好|放进|加入|收入))/u.test(c))
  if(claimsAll&&sourceBvs.size>saved)return {ok:false,reason:'unsupported-all-todos-claim'}
  const items=Array.isArray(intakeResult?.items)?intakeResult.items:[]
  const savedBvs=new Set(items.map(x=>String(x?.bvid||'')).filter(Boolean))
  for(const clause of commitments){
    // Naming a particular BV is an object claim: the durable receipt must be
    // about THAT BV, not merely some other task saved in the same model turn.
    for(const bv of new Set(clause.match(BV)||[]))
      if(!savedBvs.has(bv)&&!items.some(x=>String(x?.topic||'').includes(bv)))return {ok:false,reason:'unsupported-specific-todo'}
    // Natural titles are harder: only check exact source-derived titles, not
    // untrusted free-form semantic matches or the model's own invented titles.
    const sourceParts=String(sourceText||'').split(/[：:，,、]|(?:\s+和\s+)/u)
      .map(x=>x.trim()).filter(x=>x.length>=4&&x.length<=60)
      .filter(x=>!/(?:^推荐|^请看|^你听|^这两首)/u.test(x))
    for(const title of sourceParts){
      if(clause.includes(title)&&!items.some(x=>String(x?.topic||x?.title||'').includes(title)))
        return {ok:false,reason:'unsupported-specific-todo'}
    }
    // If two source objects are explicit and only one was saved, a bare
    // "all"/"both" statement is not true even when it avoids a numeral.
    if(claimsAll&&items.length===1&&sourceParts.length>=2)return {ok:false,reason:'unsupported-all-todos-claim'}
    // Don't treat "第二首" by itself as the number two. When source order
    // can be verified by two BV IDs, compare the ordinal to the saved BV.
    if(sourceBvs.size>=2&&savedBvs.size>0){
      const ordered=[...sourceBvs],m=clause.match(/第([一二三123])首/u)
      if(m){const index=numberOf[m[1]]-1
        if(index>=0&&index<ordered.length&&!savedBvs.has(ordered[index]))
          return {ok:false,reason:'unsupported-specific-todo'}
      }
    }
  }
  return {ok:true,reason:'verified-durable-todo'}
}
