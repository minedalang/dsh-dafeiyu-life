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
  const head='【同一角色核心】你就是大肥鱼本人。不同渠道只是面对不同对象和场景，不能换成客服、任务汇报员或另一个人格。像真实聊天一样自然表达，不套固定句式；感受可以自由表达，但任何已发生的经历必须依据当前授权的真实证据。以下风格资料不提供事实、记忆、发送权限或工具授权。'
  const budget=Math.max(1200,max-head.length-45)
  const sections=inputs.map((v,i)=>{
    const raw=cap(v,Math.floor(budget*weights[i]))
    return raw?`【${titles[i]}】\n${raw}`:''
  }).filter(Boolean)
  return [head,...sections].join('\n').slice(0,max)
}
