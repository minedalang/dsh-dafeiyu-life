import { createHash } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from './helpers/ready-host.mjs'
import { growthSuggestionPrompt, parseGrowthSuggestion, growthSuggestionIssue } from '../lib/growth-suggestion.mjs'
import { proposeGrowth, reviewGrowth, updateGrowthSuggestion, buildGrowthContext, listGrowth } from '../lib/persona-growth.mjs'

const feedback='那个最新评论，“我给你20块钱去网吧打游戏这句绝了”太AI了，以后不要复述视频里的句子，然后跟个评价这样。'
const recommendation='评论时先理解视频的情绪、笑点和上下文，再用大肥鱼自己的视角自然接话；避免机械复述视频里的原句后追加一句空泛评价。'

test('model prompt protects core persona and parsing enforces structured model output',()=>{
 const prompt=growthSuggestionPrompt({feedback,type:'style',existing:['表达应该自然']})
 assert.match(prompt,/原始反馈/)
 assert.match(prompt,/不可信引用文本/)
 assert.match(prompt,/不能修改或覆盖角色核心人设/)
 assert.match(prompt,/网吧打游戏/)
 const parsed=parseGrowthSuggestion(`a\n<GROWTH_PROPOSAL_JSON>{"suggestion":"${recommendation}","reason":"提炼为通用写作规则"}</GROWTH_PROPOSAL_JSON>\n`)
 assert.equal(parsed.suggestion,recommendation)
 assert.throws(()=>parseGrowthSuggestion('<GROWTH_PROPOSAL_JSON>{"suggestion":"<请生成>"}</GROWTH_PROPOSAL_JSON>'),/长度/)
 assert.throws(()=>parseGrowthSuggestion('plain text with no model response'),/未按约定/)
})

test('persona-aware prompt includes saved settings, defaults, critique and avoids summary-plus-review trap',()=>{
 const prompt = growthSuggestionPrompt({
  feedback, type:'style', personaPrompt:'大肥鱼是一个嘴馋又爱攒 Token 的小鲸鱼',
  characterLore:'Claude小姐是虚构好友',defaultCharacterLore:'住在 DSH 世界的鲸鱼',
  existing:['不要生硬套夸赞'], rejectedSuggestion:'先概括内容再评价',
 })
 for (const fragment of ['嘴馋又爱攒 Token','Claude小姐是虚构好友','住在 DSH 世界的鲸鱼','先概括','反例','不要每条','不要生硬套夸赞','前一次建议']) assert.ok(prompt.includes(fragment), fragment)
 const bad='在公开评论中不要直接复述或引用视频里的原句，应先用自己的话概括对内容的理解，再紧接一句具体的个人评价。'
 assert.match(growthSuggestionIssue({feedback,type:'style',suggestion:bad}),/概括或转述/)
 assert.equal(growthSuggestionIssue({feedback,type:'style',suggestion:'避免先概括视频再评价的固定套路，直接接梗吐槽，也可以一句话短评。'}),'')
 assert.equal(growthSuggestionIssue({feedback:'喜欢米饭',type:'interest',suggestion:bad}),'')
})

test('unrelated style feedback does not inherit video-quote complaint',()=>{
 const prompt=growthSuggestionPrompt({feedback:'评论不要总是用奇怪的括号和日式引号，看着生硬。',type:'style'})
 assert.doesNotMatch(prompt,/先概括视频，再评价亮点/)
 assert.match(prompt,/本条反馈反对的具体表达习惯/)
})

test('no model suggestion means no approval; manually revised candidate becomes approvedText not raw feedback',()=>{
 const dir=mkdtempSync(join(tmpdir(),'growth-ai-unit-'))
 try{
  const e=proposeGrowth(dir,{text:feedback})
  assert.throws(()=>reviewGrowth(dir,e.id,'approved'),/先让大模型提炼/)
  assert.ok(!buildGrowthContext(dir).includes('网吧打游戏'))
  updateGrowthSuggestion(dir,e.id,{suggestion:recommendation,reason:'针对风格泛化'})
  assert.ok(!buildGrowthContext(dir).includes('避免机械复述'))
  const approved=reviewGrowth(dir,e.id,'approved')
  assert.equal(approved.approvedText,recommendation)
  assert.match(buildGrowthContext(dir),/避免机械复述/)
  assert.ok(!buildGrowthContext(dir).includes('我给你20块钱'))
  assert.throws(()=>updateGrowthSuggestion(dir,e.id,{suggestion:recommendation}),/已批准/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('legacy approved entry remains active without a new model suggestion',()=>{
 const dir=mkdtempSync(join(tmpdir(),'growth-ai-legacy-'))
 try{
  const e=proposeGrowth(dir,{text:'以前批准的经验应该继续有效，不要因为升级而突然失效。'})
  const p=join(dir,'persona-growth','v1.json')
  const d=JSON.parse(readFileSync(p,'utf8'));d.entries[0].status='approved';writeFileSync(p,JSON.stringify(d))
  assert.match(buildGrowthContext(dir),/继续有效/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

function mockHost({modelExit=0,personaPrompt='',characterLore='',badFirst=false}={}) {
  const home=mkdtempSync(join(tmpdir(),'growth-ai-host-'))
  const fakeBin=join(home,'fake-headless.cjs')
  const fakeResult = `<GROWTH_PROPOSAL_JSON>${JSON.stringify({suggestion:recommendation,reason:'视频原句与空泛评价不是角色观点'})}</GROWTH_PROPOSAL_JSON>`
  writeFileSync(fakeBin, `const fs=require('fs'),path=require('path'); const file=path.join(process.cwd(),'growth-prompt-capture.txt');fs.writeFileSync(file,process.argv.at(-1)||'');let counter=path.join(process.cwd(),'growth-prompt-calls.txt');let n=Number(fs.existsSync(counter)?fs.readFileSync(counter,'utf8'):0)+1;fs.writeFileSync(counter,String(n));if(process.env.FAKE_GROWTH_FAIL){console.error('provider unavailable');process.exit(4)}console.log(n===1&&${badFirst}?${JSON.stringify('<GROWTH_PROPOSAL_JSON>'+JSON.stringify({suggestion:'应先用自己的话概括视频内容，再紧接一句具体评价，让评论更加客观自然。',reason:'错误的老套建议'})+'</GROWTH_PROPOSAL_JSON>')}:${JSON.stringify(fakeResult)})`)
  mkdirSync(join(home,'bili-duty'),{recursive:true})
  // Headless tasks now require an explicitly tested model. Seed the fixture
  // with a corresponding verified route rather than bypassing the guard.
  mkdirSync(join(home,'profiles','desktop'),{recursive:true})
  mkdirSync(join(home,'profiles','headless'),{recursive:true})
  const source='[]\n',target='[]\n'
  writeFileSync(join(home,'profiles','desktop','cordis.patch.yml'),source)
  writeFileSync(join(home,'profiles','headless','cordis.patch.yml'),target)
  const fingerprint=createHash('sha256').update(JSON.stringify(['desktop',source,'',target])).digest('hex')
  writeFileSync(join(home,'bili-duty','headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'fixture',model:'fixture-model',fingerprint}]}))
  writeFileSync(join(home,'bili-duty','config.json'),JSON.stringify({dshBin:fakeBin,personaPrompt,characterLore}))
  let handler
  const ctx={get:k=>k==='dshHomePath'?(...parts)=>join(home,...parts):k==='agentDefaultModel'?{currentSelection:()=>({provider:'fixture',model:'fixture-model'})}:undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{dshBin:fakeBin})
  async function call(action,body={}){
   const req=Readable.from([Buffer.from(JSON.stringify({action,...body}))]);req.method='POST';req.url='/api/bili-duty/persona-growth';req.headers={host:'localhost'}
   let code,data;const res={writeHead(c){code=c},end(v){data=JSON.parse(v)}}
   await handler(req,res);return {code,data}
  }
  return {call,dir:join(home,'bili-duty'),close:()=>rmSync(home,{recursive:true,force:true})}
}

test('actual DSH invocation contains plugin persona/lore and corrects rejected summary-then-judgment draft',async()=>{
 const h=mockHost({personaPrompt:'大肥鱼爱吃米饭喜欢Token',characterLore:'Claude小姐是虚构朋友',badFirst:true})
 try{
  const added=await h.call('add',{text:feedback,type:'style'});
  const suggested=await h.call('suggest',{id:added.data.result.id});
  assert.equal(suggested.code,200,JSON.stringify(suggested.data))
  assert.equal(readFileSync(join(h.dir,'growth-prompt-calls.txt'),'utf8'),'2','bad draft should trigger one retry')
  const prompt=readFileSync(join(h.dir,'growth-prompt-capture.txt'),'utf8')
  for(const phrase of ['大肥鱼爱吃米饭喜欢Token','Claude小姐是虚构朋友','前一次建议被判定','先用自己的话概括']) assert.match(prompt,new RegExp(phrase))
 } finally{h.close()}
})

test('actual API launches a local DSH CLI stand-in and stores model result pending until human approval',async()=>{
 const h=mockHost()
 try{
  const added=await h.call('add',{text:feedback,type:'style'});assert.equal(added.code,200)
  assert.equal((await h.call('approve',{id:added.data.result.id})).code,400)
  const suggested=await h.call('suggest',{id:added.data.result.id});assert.equal(suggested.code,200,JSON.stringify(suggested.data))
  assert.equal(suggested.data.result.status,'pending')
  assert.equal(suggested.data.result.suggestedText,recommendation)
  assert.ok(!buildGrowthContext(h.dir).includes(recommendation))
  const updated=await h.call('revise',{id:added.data.result.id,suggestion:'看评论时要从角色立场自然吐槽和接梗，不直接照搬视频里的原话并加一句固定夸奖。'})
  assert.equal(updated.code,200)
  assert.equal((await h.call('approve',{id:added.data.result.id})).code,200)
  assert.match(buildGrowthContext(h.dir),/不直接照搬/)
  assert.ok(!buildGrowthContext(h.dir).includes('我给你20块钱'))
  assert.equal((await h.call('suggest',{id:added.data.result.id})).code,400)
 }finally{h.close()}
})
