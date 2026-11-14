import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ownerDmAwaitsAnswer, ownerDmReciprocityInstruction, ownerDmLimitBackToBackQuestions, dmContinuationPrompt} from '../lib/dm-progressive-expression.mjs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const owner=readFileSync(new URL('../lib/owner-dm-agent.mjs',import.meta.url),'utf8')
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
test('主人聊天可以接过对方话题自主展开，但不强迫反问或捏造吃饭经历',()=>{
 assert.match(ownerDmReciprocityInstruction(),/自然的下一话题/)
 assert.match(ownerDmReciprocityInstruction(),/不能为了出题编造/)
 assert.match(owner,/ownerDmReciprocityInstruction\(\)/)
 assert.match(dmContinuationPrompt({first:'我答完啦',owner:true}),/引出下一话题/)
 assert.equal(ownerDmAwaitsAnswer('那你吃了什么？'),true)
 assert.equal(ownerDmAwaitsAnswer('你中午吃的是饺子? 🐟'),true)
 assert.equal(ownerDmAwaitsAnswer('原来是排骨米饭！'),false)
 assert.match(owner,/!ownerDmAwaitsAnswer\(replyMessages\.at\(-1\)\)/)
 assert.deepEqual(ownerDmLimitBackToBackQuestions(['那我猜饺子？','那我猜面条？']),['那我猜饺子？'])
 assert.deepEqual(ownerDmLimitBackToBackQuestions(['原来是排骨米饭！','那轮到你猜，如果我点餐会挑什么？']),['原来是排骨米饭！','那轮到你猜，如果我点餐会挑什么？'])
 assert.match(owner,/ownerDmLimitBackToBackQuestions\(normalizeMessageBurst/)
})
test('顶部搜索位于刷新当前页左侧且旧设置搜索功能保留',()=>{
 const start=html.indexOf('<header class="top">'),end=html.indexOf('</header>',start)
 const header=html.slice(start,end)
 assert.ok(header.indexOf('id="settings-finder-input"')<header.indexOf('id="refresh"'))
 assert.match(html,/top-actions \.settings-finder\{width:clamp\(180px,21vw,258px\)/)
 assert.match(script,/buildSettingsIndex/)
})
test('Life 匿名状态以动作与状态聚合，原始账本不参与改写',()=>{
 assert.match(script,/const grouped=new Map\(\)/)
 assert.match(script,/current\.count\+\+/)
 assert.match(script,/原账本保持逐条/)
 assert.doesNotMatch(html,/主人明确操作与自主选择分开标记/)
 assert.match(html,/不提供重试按钮/)
})
test('README 仍有 npm 三个徽章与顶部导航，但不再展示备份测试章节',()=>{
 for(const key of ['npm/v/','npm/dm/','npm/dy/'])assert.ok(readme.includes(key))
 assert.match(readme,/\[功能概览\]/)
 assert.doesNotMatch(readme,/### 备份与测试/)
 assert.doesNotMatch(readme,/run-tests\.bat/)
})
