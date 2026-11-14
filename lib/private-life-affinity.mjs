/**
 * dev.3: narrow, read-only relationship-aware bridge into the EXISTING life planner.
 * Friend evidence never becomes a search query, contact proposal or public memory.
 * Only a topic independently verified by the fish's public LifeInterests can match.
 * Legacy friend-interest records without a source account tag are intentionally excluded.
 */
import {normalizeFriendDirectory} from './friend-directory.mjs'

const ACCOUNT=/^[a-f0-9]{16}$/
const UID=/^[1-9]\d{0,18}$/
const DAY=86_400_000
const TOPIC=/^[\p{L}\p{N}／ _-]{2,36}$/u
const sensitive=/(?:私信|聊天记录|姓名|密码|手机号|邮箱|验证码|cookie|token|api.?key|身份证|家庭住址|\d{8,})/i

export function createPrivateLifeAffinity({getAccountTag=()=>'',getFriendDirectory=()=>'',getRelationship=()=>null,getFriendInterests=()=>[],now=Date.now}={}){
  function inspect(cues=[]){
    const account=String(getAccountTag()||'')
    if(!ACCOUNT.test(account)||!Array.isArray(cues))return {signals:[],checkedFriends:0,unavailable:0,reason:'account-not-ready'}
    let friends=[]
    try{friends=JSON.parse(normalizeFriendDirectory(getFriendDirectory()))}
    catch{return {signals:[],checkedFriends:0,unavailable:1,reason:'friend-directory-error'}}
    const source=cues.filter(x=>x?.source==='interest-milestone'&&
      /^[a-f0-9]{24}$/.test(String(x.id||''))&&TOPIC.test(String(x.topic||''))&&!sensitive.test(x.topic))
      .slice(0,4)
    // Read each allowed friend's verified evidence at most once per tick, not
    // once per public topic. This is a bounded hint source, not a friend crawl.
    const matchedTopics=new Set()
    let checkedFriends=0,unavailable=0
    for(const friend of friends.slice(0,50)){
      if(!UID.test(String(friend.uid||'')))continue
      let r=null,items=[]
      try{r=getRelationship(friend.uid);items=getFriendInterests(friend.uid,account);checkedFriends++}
      catch{unavailable++;continue}
      if(!r||!['familiar','friend'].includes(r.stage)||
        Number(r.activeDays)<3||Number(r.incoming)<1||Number(r.outgoing)<1||
        now()-Number(r.lastAt)<0||now()-Number(r.lastAt)>30*DAY||!Array.isArray(items))continue
      for(const x of items){
        if(x?.stance==='like'&&x.privateEvidenceDays>=2&&x.support180>=2&&
          x.status==='observed-repeated'&&Number(x.lastAt)<=now()&&
          now()-Number(x.lastAt)<=30*DAY&&source.some(c=>c.topic===x.topic))matchedTopics.add(x.topic)
      }
    }
    const signals=[]
    for(const cue of source){
      if(matchedTopics.has(cue.topic)){
        // No target ID, raw text, name, private topic, private event ID, or send
        // authority is placed in the model prompt, diagnostics or life ledger.
        signals.push({cueId:cue.id,relationshipStage:'familiar-or-friend'})
      }
      if(signals.length>=3)break
    }
    return {signals,checkedFriends,unavailable,reason:unavailable?'partial-unavailable':'ok'}
  }
  return {forCues:cues=>inspect(cues).signals,inspect}
}
