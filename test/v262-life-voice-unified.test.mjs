import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs'
import {safeSocialReply} from '../lib/comment-social-ai.mjs'
import {parseDmContinuationReply} from '../lib/dm-progressive-expression.mjs'
import {dynamicContentIssue} from '../lib/daily-dynamic.mjs'
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
test('统一人格装配保留所有主动设定、成长、情绪、关系，且不把人格当事实权限',()=>{
  const x=composeLifeVoiceContext({scene:'todo-followup',persona:'主人设：有点傲娇',lore:'世界观：小鲸鱼',growth:'已经认可的风格',personality:'新长出的性格',emotion:'今天心情好',relationship:'与此人认识不久',maxChars:4500})
  for(const phrase of ['主人设：有点傲娇','世界观：小鲸鱼','已经认可的风格','新长出的性格','今天心情好','与此人认识不久','不提供事实'])assert.ok(x.includes(phrase),phrase)
  assert.ok(x.includes('不同渠道只是面对不同对象和场景'))
})
test('长人设不能挤掉成长人格与连续情绪；场景和最大长度受限',()=>{
  const x=composeLifeVoiceContext({scene:'comment',persona:'设'.repeat(16000),growth:'记住的风格',personality:'成长的性格',emotion:'模拟情绪',maxChars:2400})
  assert.ok(x.length<=2400)
  for(const v of ['记住的风格','成长的性格','模拟情绪'])assert.ok(x.includes(v),v)
  assert.throws(()=>composeLifeVoiceContext({scene:'untrusted'}),/未知人格场景/)
})
test('所有主要自动对外语言入口共用人格装配，而不是各自只用一句你是大肥鱼',()=>{
  const main=src('index.js')
  const owner=src('lib/owner-dm-agent.mjs')
  const social=src('lib/social-intentions.mjs')
  const daily=src('lib/daily-dynamic.mjs')
  assert.match(main,/composeLifeVoiceContext\(\{scene,maxChars/)
  for(const scene of ['todo-followup','owner-dm','dm','main','social-share','dynamic'])assert.ok(main.includes("scene:'"+scene+"'"),scene)
  assert.match(main,/scene==='comment'\?2700:2900/)
  assert.match(owner,/scrub\(getPersona\(\),2600\)/)
  // Social outreach retains the shared Life Voice, with an explicit context budget.
  assert.match(social,/const voice=boundedText\(getVoiceContext\(\{uid:c\.uid,query:c\.title\}\),7000\)/)
  assert.match(daily,/boundedText\(getVoiceContext\(\),6500\)/)
})


test('dev79 all role voice scenes carry one expression contract within original budget',()=>{
 for(const scene of ['main','owner-dm','dm','comment','todo-followup','social-share','dynamic']){
  const prompt=composeLifeVoiceContext({scene,persona:'鱼鱼',emotion:'心情平静',maxChars:1500});assert.ok(prompt.length<=1500);assert.match(prompt,/角色表达/);assert.match(prompt,/work: 只是普通文字/);assert.match(prompt,/心情平静/)
 }
})

test('dev79 comment, progressive DM and dynamic reject private technical report but allow ordinary speech',()=>{
 const report='私密读取的意愿检查结果是暂不披露，工具没有读取到私信正文'
 const ordinary='那些话我想自己留着。'
 assert.equal(safeSocialReply(report),'');assert.equal(safeSocialReply(ordinary),ordinary)
 assert.equal(parseDmContinuationReply(JSON.stringify({action:'continue',reply:report})), '')
 assert.equal(parseDmContinuationReply(JSON.stringify({action:'continue',reply:ordinary})),ordinary)
 assert.match(dynamicContentIssue(report),/内部流程/)
 assert.equal(dynamicContentIssue(ordinary),'')
})
