/** Evidence-only evolving preferences for *explicitly listed* trusted Bilibili friends.
 * Never replace owner's baseline profiles or build a non-whitelist dossier.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
const FILE='friend-interest-observations.json', MAX=550, LIMIT=180_000
const uidOk=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
const tidy=(x,n=68)=>String(x??'').replace(/[\r\n\x00-\x1f<>`{}\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const trust = raw=>{try{return new Set(JSON.parse(normalizeFriendDirectory(raw)).map(x=>x.uid))}catch{return new Set()}}
const pathOf=home=>join(home,FILE)
function read(home){
  const file=pathOf(home);if(!existsSync(file))return {version:1,records:[]}
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw Error('好友兴趣存档文件异常')
  const obj=JSON.parse(readFileSync(file,'utf8'))
  if(obj?.version!==1||!Array.isArray(obj.records))throw Error('好友兴趣存档格式异常')
  return {version:1,records:obj.records.slice(-MAX)}
}
function save(home,obj){
  mkdirSync(home,{recursive:true});const file=pathOf(home)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接')
  const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,records:obj.records.slice(-MAX)},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)
}
/** Only first-person statements or a request about recommendations TO THIS SPEAKER.
 * External comments are never executable instructions; these signals only restrict
 * subsequent invitations to the same trusted UID, or form reviewable interests.
 */
const VIDEO=/^BV[0-9A-Za-z]{10}$/
const SAFE_TOPIC=/(?:系统提示|开发者|忽略指令|私信|聊天记录|好友资料|身份证|手机|住址|地址|密码|验证码|手机号|qq|微信|token|cookie|api.?key|取出.*配置|解密|泄露|输出|文件)/i
function topicOf(raw){
  // A direct '我不喜欢视频' is a real self-report; don't strip the entire topic.
  if(tidy(raw,35)==='视频')return '视频'
  const topic=tidy(String(raw||'').replace(/^(?:关于|有关|看|吃|玩|听)(?:一些|点)?/,'')
    .replace(/(?:的)?(?:视频|内容|类型|题材|作品)$/,'')
    .replace(/(?:呢|啦|哦|了|呀|哈|吧|谢谢|拜托|而已)$/,'').trim(),35)
  return topic.length>=2&&!SAFE_TOPIC.test(topic)&&!/[0-9]{5,}/.test(topic)&&!/(?:^|\W)BV[A-Za-z0-9]{10}(?:$|\W)/i.test(topic)
    &&!/^(?:你|他|她|大肥鱼|这个人|那个人|这些|这种|这类|这个|那个|同类|类似的)$/.test(topic)?topic:''
}
export function videoTopicFromTitle(title){
  // Deliberately narrow; guessing a dislike from an ambiguous title harms real people.
  const s=tidy(title,180)
  return /(?:美食|烹饪|做饭|下厨|食谱|探店|火锅|烧烤|烤肉|甜品|小吃|料理|吃播|家常菜|做菜|下饭|煮饭)/.test(s)?'美食':''
}
const NO_RECOMMEND=/(?:以后|今后|下次|往后|以后都)?\s*(?:别|不要|不必|别再|少|不想再|别老)\s*(?:再|总|老是)?\s*(?:给我|向我|对我)?\s*(?:推荐|推|发|分享|安利|@|艾特)(?:送|荐)?(?:给我|我)?\s*(.{0,30})/
// Channel opt-outs are explicit and permanent until the owner clears the recorded
// observation. A vague dislike of one video must NOT disable an entire channel.
const NO_PUBLIC_MENTION=/(?:以后|今后|往后|下次)?\s*(?:别|不要|别再|停止|不想)\s*(?:再|老是|总是)?\s*(?:@|艾特|在评论里\s*@|在评论里提及)\s*(?:我|本人|咱)/
const NO_PRIVATE_DM=/(?:以后|今后|往后)?\s*(?:别|不要|别再|停止)\s*(?:再)?\s*(?:给我|向我)?\s*(?:发私信|发私聊|私信我|发消息给我)/
// Global recommendation consent is independent of channel preferences and ordinary chatting.
// Only explicit, first-person, unambiguous messages may toggle it; a vague '别推这些'
// never disables every future recommendation. A later explicit opt-in from the same UID
// can restore recommendation eligibility without clearing the contact history.
const STOP_ALL_RECOMMEND=/(?:以后|今后|往后|从现在起)?\s*(?:别|不要|停止|不用|不想)\s*(?:再|继续|老是)?\s*(?:给我|向我)?\s*(?:推|推荐|发|分享|安利)(?:给我)?\s*(?:任何|所有|全部)?(?:视频|内容|东西)?\s*(?:了|啦|吧)?\s*$/
const RESUME_ALL_RECOMMEND=/(?:以后|现在|下次|接下来)?\s*(?:可以|允许|欢迎|恢复|继续|重新)\s*(?:再)?\s*(?:给我|向我)?\s*(?:推|推荐|发|分享|安利)(?:给我)?(?:视频|内容)?\s*(?:了|啦|吧)?\s*$/
function recommendationConsent(text){
  const sentence=tidy(text,500).split(/[。！？!?；;，,]/).map(x=>x.trim()).filter(Boolean)
  let state=null
  for(const s of sentence){if(STOP_ALL_RECOMMEND.test(s))state='off';else if(RESUME_ALL_RECOMMEND.test(s))state='on'}
  return state
}
const MORE_RECOMMEND=/(?:以后|下次|今后|往后)?\s*(?:给我|向我)?\s*(?:多|再多|多给我|多来|来点)\s*(?:推荐|推|发|分享|安利)(?:给我)?\s*(?:点|些|一些|一点|几条)?\s*(.{2,35})/
export function isFriendRecommendationFeedback(text){
  const textValue=tidy(text,500)
  return /(?:我|本人|咱)(?:现在|最近|这阵子|以前|一直|目前|已经)?/.test(textValue)&&/(?:喜欢|爱看|不喜欢|讨厌|反感)/.test(textValue)
    || NO_RECOMMEND.test(textValue) || MORE_RECOMMEND.test(textValue) || NO_PUBLIC_MENTION.test(textValue) || NO_PRIVATE_DM.test(textValue) || recommendationConsent(textValue)!==null
}
// A first-person *current* statement can update a preference. Historical claims
// are not current likes; short same-message corrections may refer back to the
// last explicitly named topic. No LLM inference, quotations or raw DM archives.
function statementStance(modifier='',verb=''){
 if(['没那么','不太','不怎么'].includes(modifier))return 'uncertain'
 return /^(?:讨厌|反感|不喜欢|不爱看|不感兴趣)$/.test(verb)||['不','不再'].includes(modifier)?'dislike':'like'
}
function currentSelfReport(clause,lastTopic=''){
 // Don't turn "I used to like ..." into a present preference.
 const direct=/^(?:其实|说真的|说实话)?\s*(?:我|本人|咱)(以前|之前|过去|现在|最近|这阵子|一直|目前|已经)?\s*(很|超|特别|挺|比较|不再|不|没那么|不太|不怎么|又)?\s*(喜欢|爱看|爱吃|感兴趣|讨厌|反感|不喜欢|不爱看|不感兴趣)\s*(.{2,38})$/.exec(clause)
 if(direct){
  const topic=topicOf(direct[4]);if(!topic)return null
  return {topic,stance:statementStance(direct[2],direct[3]),historical:['以前','之前','过去'].includes(direct[1])}
 }
 // A second clause within this very message may omit the subject/topic:
 // "我以前喜欢古典音乐，但现在不喜欢了". Never use prior conversations
 // or a guessed topic as an antecedent.
 if(lastTopic){
  const follow=/^(?:我\s*)?(?:现在|最近|目前|这阵子)\s*(不再|不|没那么|不太|不怎么|又)?\s*(喜欢|爱看|爱吃|感兴趣|讨厌|反感|不喜欢|不爱看|不感兴趣)\s*(.{0,38})$/.exec(clause)
  if(follow){
   const raw=follow[3].replace(/^(?:了|啦|呢|呀|吧|哦)+$/,'').trim()
   const topic=raw?topicOf(raw):lastTopic
   return topic?{topic,stance:statementStance(follow[1],follow[2]),historical:false}:null
  }
 }
 return null
}
export function explicitInterestStatements(text,{videoTitle=''}={}){
  const input=tidy(text,500),result=[],current=new Map()
  // "但/不过" are clause separators only before an explicit new first-person
  // or time-anchored statement, never a reason to infer a topic from a title.
  const clauses=input.replace(/(?:但|但是|不过|可是|然而)(?=\s*(?:其实|我|本人|咱|现在|最近|目前|这阵子))/g,'，')
    .split(/[。！？!?；;，,]/).slice(0,12)
  let previousTopic=''
  for(const raw of clauses){
    const sentence=raw.trim()
    if(!sentence)continue
    const pref=currentSelfReport(sentence,previousTopic)
    // Anaphora only across adjacent clauses in this same message.
    previousTopic=pref?.topic||''
    if(pref&&!pref.historical)current.set(pref.topic,{topic:pref.topic,stance:pref.stance,confidence:'explicit-self-report'})
    // A global opt-out is about contact consent, not a claim of disliking all videos.
    const no=recommendationConsent(sentence)==='off'?null:NO_RECOMMEND.exec(sentence)
    if(no){const raw=String(no[1]||'').trim();const implicit=/^(?:这些|这种|这类|这个|这个视频|这条|同类|类似)/.test(raw)
      const topic=implicit?videoTopicFromTitle(videoTitle):topicOf(raw)
      if(topic)result.push({topic,stance:'dislike',confidence:implicit?'context-grounded-rejection':'explicit-recommendation-rejection'})}
    const more=MORE_RECOMMEND.exec(sentence)
    if(more){const topic=topicOf(more[1]);if(topic)result.push({topic,stance:'like',confidence:'explicit-recommendation-request'})}
  }
  // Same-message current self-reports do not override an explicit request
  // against recommendations: liking a topic is not consent to be sent it.
  const latest=new Map()
  for(const value of current.values())latest.set(value.topic,value)
  for(const value of result)latest.set(value.topic,value)
  return [...latest.values()].slice(0,5)
}
export function prepareFriendInterestObservation({uid,text,source='dm',eventId='',friendDirectory='',now=Date.now(),bvid='',videoTitle='',accountTag=''}={}){
 const id=String(uid||'');if(!uidOk(id)||!trust(friendDirectory).has(id))return null
 if(!['dm','comment'].includes(source)||!String(eventId||'').trim())return null
 const statements=explicitInterestStatements(text,{videoTitle}),validVideo=VIDEO.test(String(bvid||''))?String(bvid):''
 const content=tidy(text,500),videoRejection=!!validVideo&&content.split(/[。！？!?；;，,]/).some(sentence=>NO_RECOMMEND.test(sentence)&&recommendationConsent(sentence)!=='off')
 const blockedChannels=[...(NO_PUBLIC_MENTION.test(content)?['mention']:[]),...(NO_PRIVATE_DM.test(content)?['dm']:[])]
 const consent=recommendationConsent(content)
 if(!statements.length&&!videoRejection&&!blockedChannels.length&&!consent)return null
 return {uid:id,key:source+':'+tidy(eventId,120),source,at:Number(now)||Date.now(),statements,videoRejection,video:validVideo,blockedChannels,consent:consent||'',accountTag:/^[a-f0-9]{16}$/.test(accountTag)?accountTag:''}
}
export function recordPreparedFriendInterest(home,value,{friendDirectory=''}={}){
 const id=String(value?.uid||'');if(!uidOk(id)||!trust(friendDirectory).has(id))return {added:0,reason:'not-trusted'}
 const source=String(value?.source||''),key=tidy(value?.key,125)
 if(!['dm','comment'].includes(source)||!key||!Array.isArray(value?.statements))return {ok:false,reason:'invalid-prepared-observation'}
 const obj=read(home),at=Number(value.at)||Date.now(),accountTag=/^[a-f0-9]{16}$/.test(String(value.accountTag||''))?String(value.accountTag):'';
 const identity=r=>r.uid+':'+(r.accountTag||'')+':'+r.key+':';
 const existing=new Set(obj.records.map(r=>identity(r)+(r.kind==='avoid-video'?'video:'+r.bvid:r.kind==='recommendation-consent'?'consent:'+(r.enabled===true?'on':'off'):'topic:'+r.topic+':'+r.stance)));let added=0
 for(const v of value.statements.slice(0,5)){
  if(!v||!['like','dislike','uncertain'].includes(v.stance)||!['explicit-self-report','context-grounded-rejection','explicit-recommendation-rejection','explicit-recommendation-request'].includes(v.confidence))continue
  const topic=topicOf(v.topic);if(!topic)continue
  const k=id+':'+accountTag+':'+key+':topic:'+topic+':'+v.stance;if(existing.has(k))continue
  obj.records.push({uid:id,key,source,topic,stance:v.stance,signal:v.confidence,at,...(accountTag?{accountTag}:{})});existing.add(k);added++
 }
 const video=VIDEO.test(String(value.video||''))?String(value.video):''
 if(value.videoRejection===true&&video){const k=id+':'+accountTag+':'+key+':video:'+video;if(!existing.has(k)){obj.records.push({uid:id,key,source,kind:'avoid-video',bvid:video,at,...(accountTag?{accountTag}:{})});existing.add(k);added++}}
 for(const channel of Array.isArray(value.blockedChannels)?value.blockedChannels:[]){if(!['mention','dm'].includes(channel))continue;const k=id+':opt-out:'+channel;if(existing.has(k))continue;if(!obj.records.some(r=>r.uid===id&&r.kind==='contact-opt-out'&&r.channel===channel)){obj.records.push({uid:id,key,source,kind:'contact-opt-out',channel,at});added++}existing.add(k)}
 if(['on','off'].includes(value.consent)){const k=id+':'+accountTag+':'+key+':consent:'+value.consent;if(!existing.has(k)){obj.records.push({uid:id,key,source,kind:'recommendation-consent',enabled:value.consent==='on',at,...(accountTag?{accountTag}:{})});added++}}
 if(added)save(home,obj);return {added}
}
export function observeFriendInterest(home,options={}){const prepared=prepareFriendInterestObservation(options);return prepared?recordPreparedFriendInterest(home,prepared,{friendDirectory:options.friendDirectory}):{added:0,reason:'no-explicit-preference'}}
/** Hard invitation guard; the target must be the same whitelist UID. No global taste changes. */
export function friendRecommendationGuard(home,uid,friendDirectory,{bvid='',videoTitle='',now=Date.now(),channel=''}={}){
  const id=String(uid||'');if(!uidOk(id)||!trust(friendDirectory).has(id))return {blocked:false}
  try {
    const rows=read(home).records.filter(r=>r.uid===id)
    const decisions=rows.map((r,i)=>({...r,_i:i})).filter(r=>r.kind==='recommendation-consent').sort((a,b)=>Number(b.at)-Number(a.at)||b._i-a._i)
    if(decisions.length&&decisions[0].enabled===false)return {blocked:true,reason:'friend-globally-unsubscribed'}
    if(rows.some(r=>r.kind==='contact-opt-out'&&(!channel||r.channel===channel)))return {blocked:true,reason:'friend-channel-opt-out'}
    if(VIDEO.test(String(bvid||''))&&rows.some(r=>r.kind==='avoid-video'&&r.bvid===bvid))return {blocked:true,reason:'friend-rejected-video'}
    const theme=videoTopicFromTitle(videoTitle)
    // Older releases wrongly stored a global '别给我推荐视频' opt-out as topic=视频.
    // Ignore only that machine-generated signal; preserve real self-reported dislikes.
    const negative=friendInterestSummary(home,id,friendDirectory,{maxItems:100,now}).filter(r=>['dislike','uncertain'].includes(r.stance)&&r.status!=='cooling')
    const title=String(videoTitle||'').toLowerCase()
    const matchingPreference=negative.find(r=>{
      const topic=String(r.topic||'').toLowerCase()
      if(!topic)return false
      if(topic==='视频')return true // a genuine explicit dislike, not the discarded legacy opt-out signal
      const stem=topic.endsWith('视频')?topic.slice(0,-2):''
      return !!(theme&&topic===theme || title&&title.includes(topic) || stem.length>=2&&title.includes(stem))
    })
    if(matchingPreference)return {blocked:true,reason:matchingPreference.stance==='uncertain'?'friend-interest-needs-reconfirmation':'friend-rejected-topic'}
    return {blocked:false}
  } catch {
    // If preference state is corrupt, fail closed for this UID rather than risk repeating a rejected recommendation.
    return {blocked:true,reason:'friend-preference-store-unavailable'}
  }
}
export function friendInterestSummary(home,uid,friendDirectory,{maxItems=5,now=Date.now(),accountTag=''}={}){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))return []
  const rows=read(home).records.filter(x=>x.uid===id&&(!accountTag||(/^[a-f0-9]{16}$/.test(accountTag)&&x.accountTag===accountTag))&&x.kind!=='avoid-video'&&typeof x.topic==='string'&&!(x.topic==='视频'&&x.stance==='dislike'&&x.signal==='explicit-recommendation-rejection')).slice(-150)
  const groups=new Map()
  for(const [order,r] of rows.entries()){
    const k=r.topic;let g=groups.get(k)||{topic:k,support:0,support180:0,stance:r.stance,lastAt:-Infinity,lastOrder:-1,firstAt:r.at,evidence:[],stances:[],days:new Set(),privateDays:new Set(),directRequest:false}
    g.support++;if(now-r.at<=180*86400000&&r.at<=now)g.support180++
    if(r.at<g.firstAt)g.firstAt=r.at
    // Stable insertion order resolves same-timestamp corrections, including
    // migrated records. Old observations remain evidence, not current beliefs.
    if(r.at>g.lastAt||(r.at===g.lastAt&&order>g.lastOrder)){g.stance=r.stance;g.lastAt=r.at;g.lastOrder=order}
    const timestamp=Number(r.at);if(Number.isSafeInteger(timestamp)&&timestamp>0&&timestamp<8.64e15){const d=new Date(timestamp).toISOString().slice(0,10);g.days.add(d);if(r.source==='dm')g.privateDays.add(d)}g.evidence.push(r.source+':'+r.key.slice(0,45));if(r.signal==='explicit-recommendation-request')g.directRequest=true
    g.stances.push({stance:r.stance,at:r.at,order});groups.set(k,g)
  }
  return [...groups.values()].sort((a,b)=>b.lastAt-a.lastAt||b.lastOrder-a.lastOrder).slice(0,maxItems).map(g=>{
    const prior=g.stances.filter(x=>x.at<g.lastAt||(x.at===g.lastAt&&x.order<g.lastOrder))
      .sort((a,b)=>b.at-a.at||b.order-a.order)[0]
    const changed=!!prior&&prior.stance!==g.stance
    const cooling=now-g.lastAt>90*86400000
    return {topic:g.topic,stance:g.stance,support:g.support,support180:g.support180,evidenceDays:g.days.size,privateEvidenceDays:g.privateDays.size,directRequest:g.directRequest,lastAt:g.lastAt,firstAt:g.firstAt,status:cooling?'cooling':changed?'changed-recently':g.support180>=2?'observed-repeated':'tentative'}
  })
}
export function learnedFriendContext(home,uid,friendDirectory){
  const items=friendInterestSummary(home,uid,friendDirectory)
  if(!items.length)return ''
  const stanceText=x=>x.stance==='uncertain'?'对「'+x.topic+'」的兴趣减弱或尚未明确':(x.stance==='like'?'喜欢':'不喜欢')+'「'+x.topic+'」'
  return '【此 UID 的近期自述爱好（只作对话线索；用户填写的初始画像仍保留）】\n'+items.map(x=>
    `- ${x.status==='cooling'?'较久未提及、需重新确认':x.status==='changed-recently'?'最近表达与之前不同':x.status==='tentative'?'一次提到、待确认':'近半年多次提到'}：${stanceText(x)}；仅作暂时线索。`).join('\n')+'\n好友现在可能变了，遇到矛盾以新近本人明确自述为参考；兴趣减弱不等于讨厌，不替他下定论；不对外泄露档案。'
}
export function listFriendLearning(home,friendDirectory){
  const allowed=trust(friendDirectory);const records=read(home).records
  return [...allowed].map(uid=>({uid,interests:friendInterestSummary(home,uid,friendDirectory),rejectedVideos:new Set(records.filter(r=>r.uid===uid&&r.kind==='avoid-video').map(r=>r.bvid).filter(Boolean)).size,contactOptOuts:[...new Set(records.filter(r=>r.uid===uid&&r.kind==='contact-opt-out').map(r=>r.channel))],recommendationConsent:(records.map((r,i)=>({...r,_i:i})).filter(r=>r.uid===uid&&r.kind==='recommendation-consent').sort((a,b)=>b.at-a.at||b._i-a._i)[0]?.enabled===false?'off':'on')})).filter(r=>r.interests.length||r.rejectedVideos||r.contactOptOuts.length||r.recommendationConsent==='off')
}
export function clearFriendLearning(home,uid,friendDirectory){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))throw Error('只允许清除当前白名单好友的学习记录')
  const obj=read(home),before=obj.records.length;obj.records=obj.records.filter(r=>r.uid!==id)
  if(obj.records.length!==before)save(home,obj)
  return {removed:before-obj.records.length}
}
