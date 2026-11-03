import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildTrustedSocialPrompt} from '../lib/comment-social-ai.mjs'
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs'

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('可信评论最终模型输入只出现一次 Life Voice 情绪，不再追加第二份数值快照',()=>{
 const marker='本轮真实连续情绪：目前有点疲倦'
 const style=composeLifeVoiceContext({scene:'comment',persona:'鱼鱼是一条有连续人格的鱼',emotion:marker,maxChars:2700})
 const prompt=buildTrustedSocialPrompt({row:{text:'你想选什么颜色？',bvid:'BV1EYxt6yE7P'},role:'friend',style,
   // Legacy callers may still pass an emotion object for diagnosis/decision.
   // It must NOT become a second model-facing mood channel.
   emotion:{sociality:99,energy:13,mood:'tired',state:'__DUPLICATE_EMOTION_SENTINEL__'}})
 assert.ok(prompt.includes('【同一角色核心】'))
 assert.equal(prompt.split(marker).length-1,1)
 assert.ok(!prompt.includes('__DUPLICATE_EMOTION_SENTINEL__'))
 assert.ok(!prompt.includes('"sociality":99'))
 assert.doesNotMatch(prompt,/情绪状态（仅供参考）/)
})

test('自主评论邀请不在 Life Voice 之后再次追加局部 styleHint',()=>{
 const index=source('index.js')
 assert.match(index,/style:buildInteractionPersona\(\[\{kind:'comment'/)
 assert.ok(!index.includes('style:[buildInteractionPersona'), '禁止在已有 Life Voice 后叠加另一份 styleHint')
 assert.match(index,/getLifeStateContext:\(\)=>''/,'原私信生命上下文不能再次注入情绪和成长人格')
})

test('开发规范明确统一人格、事实、记忆、意愿、权限的归属和编码门禁',()=>{
 const agents=source('AGENTS.md')
 const contract=source('docs/architecture/2.6.2-unified-layer-change-gate.md')
 for(const word of ['统一层归属检查','Life Voice Context','SocialContextAssembler','SocialPolicyGate'])
   assert.ok(agents.includes(word),word)
 for(const word of ['lib/verified-life-facts.mjs','lib/life-voice-context.mjs','LifeMemoryGateway','跨渠道回归'])
   assert.ok(contract.includes(word),word)
})
