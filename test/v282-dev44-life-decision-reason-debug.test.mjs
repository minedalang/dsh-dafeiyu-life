import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')
const source=readFileSync(new URL('../lib/life-video-read-admission.mjs',import.meta.url),'utf8')
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const start=ui.indexOf('    if(twoStage){\n      const meanings=')
const end=ui.indexOf('    const fallback=payload?.visual?.adaptive_fallback;',start)
assert.ok(start>=0&&end>start,'test actual production UI, not a duplicate renderer')
const snippet=ui.slice(start,end)

function render(twoStage){
  const cards={items:[],appendChild(x){this.items.push(x)}}
  const ctx={twoStage,cards,debugCard:(title,value)=>({title,value}),String,Number,Math,Array}
  runInNewContext(snippet,ctx)
  return cards.items
}

test('existing Life skip reason is visible before local candidates with no extra model generation',()=>{
  const reason='预览线索显示内容可能以暴力游戏场景为主，和当前兴趣关联不明显；此刻不值得为此继续消耗视频流量。'
  const items=render({status:'life-declined',reason,candidates:[{
    atSeconds:12,startSeconds:4.5,endSeconds:19.5,nearbySpeech:'对话',speechSource:'machine-asr',
  }]})
  const index=items.findIndex(x=>x.title==='Life 本次不继续深入的理由')
  const candidate=items.findIndex(x=>x.title==='可信局部候选 1')
  assert.equal(index,1)
  assert.ok(candidate>index,'the reason must precede large candidate list')
  assert.match(items[index].value,/暴力游戏场景/)
  assert.match(items[index].value,/不值得为此继续消耗视频流量/)
  assert.match(items[index].value,/仅代表 Life 本次判断/)
  assert.equal(items.filter(x=>x.title==='Life 本次不继续深入的理由').length,1)
})

test('missing and non-specific Life skip reasons never produce invented motivations',()=>{
  for(const [reason,expected] of [
    [undefined,'本轮没有提供具体理由'],
    ['life-chose-no-local-window','未提供更具体解释'],
  ]){
    const card=render({status:'life-declined',reason,candidates:[]})[1]
    assert.equal(card.title,'Life 本次不继续深入的理由')
    assert.ok(card.value.includes(expected))
    assert.doesNotMatch(card.value,/不感兴趣|因为疲劳|模型失败/)
  }
})

test('Life defer, scheduler/model error and unavailable budget are not mislabeled as personal refusal',()=>{
  const deferred=render({status:'life-deferred',reason:'这轮稍后再看',candidates:[]})[1]
  assert.equal(deferred.title,'Life 本次决定延期的理由')
  assert.match(deferred.value,/这轮稍后再看/)
  for(const status of ['choice-unavailable','invalid-focus-plan','focus-unavailable','network-budget-exhausted',
    'overview-not-verified','no-verified-preview-candidates']){
    const card=render({status,reason:'life-choice-queue-timeout',candidates:[]})[1]
    assert.equal(card.title,'本轮局部深入未完成的技术原因',status)
    assert.equal(render({status,reason:'technical-error',candidates:[]})
      .some(x=>x.title==='Life 本次不继续深入的理由'),false)
  }
})

test('reason is UI-only, text-only and bounded; original Life model calls are unchanged',()=>{
  const malicious='\u0000<svg onload="alert(1)"> '+('z'.repeat(300))
  const card=render({status:'life-declined',reason:malicious,candidates:[]})[1]
  assert.ok(!card.value.includes('\u0000'))
  assert.ok(card.value.length<=225)
  assert.match(ui,/const node=\(tag,text='',className=''\)=>\{const e=document\.createElement\(tag\);if\(className\)e\.className=className;e\.textContent=/)
  assert.match(ui,/const debugCard=\(title,value\)=>\{/)
  assert.doesNotMatch(snippet,/(?:invokeInteractionPrompt|willingness\.decide|request\(|fetch\(|api\.chat|await )/)
  assert.match(source,/reason:String\(choice\?\.reason\|\|'choice-not-completed'\)\.slice\(0,65\)/)
  assert.match(host,/\.\.\.\(result\.reason\?\{reason:result\.reason\}:\{\}\)/)
  assert.doesNotMatch(snippet,/\.innerHTML\s*=/)
})
