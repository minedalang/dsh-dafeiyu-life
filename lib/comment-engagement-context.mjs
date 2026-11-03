/** A small, evidence-only view of a single public comment exchange.
 * Past replies must be confirmed public-send receipts, never AI drafts or skips.
 * Emotion is accepted for diagnostics ONLY; the actual prompt receives the
 * authoritative emotion, personality and relationship through Life Voice.
 * It does not decide whether DaFeiYu replies, and does not store a new profile.
 */
export function commentEngagementContext({uid='',dynamicId='',threadKey='',replyRecords=[],emotion=null,nowMs=Date.now()}={}) {
  const now=Number.isFinite(Number(nowMs))?Number(nowMs):Date.now();
  const incomingUid=String(uid||'');
  const recent=(Array.isArray(replyRecords)?replyRecords:[]).filter(r=>
    incomingUid&&String(r?.uid||'')===incomingUid&&
    (dynamicId?String(r?.dynamicId||'')===String(dynamicId):String(r?.threadKey||'')===String(threadKey))&&
    Number(r?.at)>now-120*60_000&&Number(r?.at)<=now
  );
  const last30m=recent.filter(r=>Number(r.at)>now-30*60_000).length;
  const last2h=recent.length;
  const lastReplyAt=recent.length?Math.max(...recent.map(r=>Number(r.at))):0;
  const allowedMood=new Set(['开心','好奇','温暖','平静','疲惫','低落','烦躁','平稳']);
  const moodEnabled=emotion?.enabled===true&&allowedMood.has(String(emotion?.label||''));
  const mood=moodEnabled?String(emotion.label):'';
  const intensity=moodEnabled&&Number.isFinite(Number(emotion.intensity))?Math.max(0,Math.min(100,Math.round(Number(emotion.intensity)))):0;
  const sociality=moodEnabled&&Number.isFinite(Number(emotion.sociality))?Math.max(0,Math.min(100,Math.round(Number(emotion.sociality)))):0;
  const energy=moodEnabled&&Number.isFinite(Number(emotion.energy))?Math.max(0,Math.min(100,Math.round(Number(emotion.energy)))):0;
  const parts=[
    '【本条公开评论的连续交流判断】先看这条评论是不是在认真回应鱼鱼刚刚提出的问题、选择或玩笑。简短不代表无意义；如果对方正在回答鱼鱼提出的选择题，即使只有几个字，也可能值得自然接一句。',
    `同一用户在${dynamicId?'同一条动态':'同一评论串'}：近30分钟已确认回复 ${last30m} 次；近2小时 ${last2h} 次。${lastReplyAt?'最近一次确认回复已发生。':'没有近期已确认回复。'}`,
    '看同一个人是否已收到回应、话题是否有新进展，避免为了接话无止境地接话。最近回复次数仅作连续性证据，不是强制跳过的阈值。',
    '当前情绪、成长人格、关系与表达风格必须从本轮【同一角色核心】读取；本段只记录同一评论串的真实互动进度，不另造一份情绪或角色提示。当前心情影响回复意愿与表达节奏，但不等于固定回复概率。',
    '如果决定回复，要针对这条评论与原帖的真实关系自然说话；如果决定沉默，可以 SKIP。不要固定套用某句台词，也不要透露内部评分与审核流程。'
  ];
  return {text:parts.join('\n'),recent30m:last30m,recent2h:last2h,lastReplyAt,
    mood,moodIntensity:intensity,energy,sociality,moodEnabled};
}
