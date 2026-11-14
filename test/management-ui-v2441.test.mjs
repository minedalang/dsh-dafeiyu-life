import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {Readable} from 'node:stream'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {apply} from './helpers/ready-host.mjs'
import {DEFAULT_PERSONA_PROMPT,effectivePersonaPrompt} from '../lib/persona-default.mjs'
import {DEFAULT_COMMENT_MEME_PROMPT} from '../lib/comment-meme-prompt.mjs'
import {DEFAULT_VISION_PROMPT} from '../lib/vision-prompt.mjs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const web=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')

test('管理中心成为额度与提示词单一编辑入口，旧页面不会覆盖新配额',()=>{
  for(const id of ['quotas','persona']) assert.match(html,new RegExp(`data-tab="${id}"`))
  for(const id of ['quota-comment-daily','quota-vision-frames','quota-meme-day','friend-directory-editor','persona-text','meme-prompt-text','vision-prompt-text']) assert.match(html,new RegExp(`id="${id}"`))
  assert.doesNotMatch(html,/id="quota-per-day"|id="quota-pick-round"/,'选片数量已不是用户额度设置');
  for(const key of ['commentDailyLimit','commentReplyPerDay','memeMemoryMaxEntries','minVideoViews','visionFrames']) assert.ok(web.includes(key))
  assert.doesNotMatch(web,/dmApprovedTotalLimit/)
  assert.match(web,/commentWatchReplies:\$\('comment-watch-replies'\)\.checked/)
  assert.doesNotMatch(client,/patch\(\{ personaPrompt: String\(persona/)
  assert.match(client,/clear: list.length \? \[\] : \['keywords'\]/)
  assert.match(html,/恢复默认只清除这一项的自定义/)
})

test('三段首次安装默认提示词及恢复默认接口被保留',async()=>{
  assert.match(DEFAULT_PERSONA_PROMPT,/你是大肥鱼/)
  assert.match(DEFAULT_PERSONA_PROMPT,/Claude 小姐/)
  assert.match(DEFAULT_COMMENT_MEME_PROMPT,/no_meme_reason/)
  assert.match(DEFAULT_VISION_PROMPT,/不能把单帧画面推断成完整剧情/)
  assert.equal(effectivePersonaPrompt(''),DEFAULT_PERSONA_PROMPT)
  assert.equal(effectivePersonaPrompt(' 自定义 '),'自定义')
  const home=mkdtempSync(join(tmpdir(),'ui241-'))
  try{
    let route
    apply({get(k){return k==='dshHomePath'?(...x)=>join(home,...x):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{})
    async function call(method,path,body){
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let result;const res={writeHead(){},end(text){result=JSON.parse(text)}}
      await route.handler(req,res);return result
    }
    const defaultR=await call('GET','/api/bili-duty/persona-prompt-default')
    assert.equal(defaultR.prompt,DEFAULT_PERSONA_PROMPT)
    const config=await call('GET','/api/bili-duty/config')
    assert.equal(config.config.personaPrompt,DEFAULT_PERSONA_PROMPT)
    const saved=await call('POST','/api/bili-duty/config',{personaPrompt:'我是另一只鱼'})
    assert.equal(saved.config.personaPrompt,'我是另一只鱼')
    const reset=await call('POST','/api/bili-duty/config',{personaPrompt:'',clear:['personaPrompt']})
    assert.equal(effectivePersonaPrompt(reset.config.personaPrompt),DEFAULT_PERSONA_PROMPT)
  }finally{rmSync(home,{recursive:true,force:true})}
})
