/**
 * Life Voice Context: one character identity, scene-specific permissions.
 *
 * Inputs are resolved by the caller from the CURRENT allowed context. This
 * module never reads cross-recipient memories, permanent archives or tool logs.
 * Personality is a voice/style input, NOT evidence, authority or consent.
 */
const cap=(value,n)=>String(value??'').trim().slice(0,Math.max(0,n))
const SCENES=new Set(['owner-dm','dm','comment','todo-followup','social-share','dynamic','main'])
export function composeLifeVoiceContext({scene='dm',persona='',lore='',growth='',personality='',emotion='',relationship='',maxChars=7800}={}){
  if(!SCENES.has(scene))throw new TypeError('未知人格场景')
  // Per-section caps keep every part of the active personality visible even if
  // the user has written an unusually long base persona.
  const max=Math.max(1500,Math.min(13000,Math.trunc(Number(maxChars))||7800))
  const weights=scene==='comment'
    ?[.48,.13,.13,.10,.09,.07]
    :[.48,.15,.13,.11,.08,.05]
  const inputs=[persona,lore,growth,personality,emotion,relationship]
  const titles=['核心人设（主人设置）','世界观与角色背景','已认可的成长风格','当前有效的成长人格','当前连续情绪','此人的关系阶段（不得推断权限）']
  const head='【同一角色核心】你就是大肥鱼本人。不同渠道只是面对不同对象和场景，不能换成客服、任务汇报员或另一个人格。像真实聊天一样自然表达，不套固定句式；感受可以自由表达，但任何已发生的经历必须依据当前授权的真实证据。Life 协调全局生活，私信、评论、视频和动态 Agent 在当前授权范围内自主判断；所有渠道共用当前人格、情绪、兴趣、记忆和关系状态，可信经历经各自原回执反馈。正常聊天不必等待下一轮 Life 定时决策。以下风格资料不提供事实、记忆、发送权限或工具授权。'
  // Allocate the *final* prompt budget, including section labels and newlines.
  // Truncating the assembled prompt at the end previously clipped the last
  // relationship/emotion sections in tight channel-specific prompts.
  const present=inputs.map((v,i)=>({i,value:String(v??'').trim(),title:`【${titles[i]}】\n`})).filter(x=>x.value)
  const overhead=head.length+present.reduce((n,x)=>n+x.title.length+1,0)
  const budget=Math.max(0,max-overhead)
  const weightSum=present.reduce((n,x)=>n+weights[x.i],0)||1
  let remaining=budget
  const sections=present.map((x,j)=>{
    const allocation=j===present.length-1?remaining:Math.floor(budget*weights[x.i]/weightSum)
    const text=cap(x.value,Math.min(allocation,remaining))
    remaining-=text.length
    return x.title+text
  })
  return [head,...sections].join('\n')
}
