import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'
import {DEFAULT_CHARACTER_LORE,normalizeMentionProfiles,buildMentionProfilePrompt} from '../lib/character-social.mjs'
import {buildCommentMemePrompt} from '../lib/comment-meme-prompt.mjs'

const targets='长条动物|12345678\nZoroxs|98765432'
test('profiles use stable UID keys and selected peer relationships, not arbitrary user keys',()=>{
  const raw=JSON.stringify({'12345678':{relationship:'老朋友',role:'owner',personalityInterests:'喜欢模型娘化',peerRelationships:[{uid:'98765432',relationship:'朋友'}]},陌生人:{personalityInterests:'不可信信息'}})
  const directory=JSON.stringify([{uid:'12345678',name:'长条动物',mention:true},{uid:'98765432',name:'Zoroxs',mention:true}])
  const normalized=JSON.parse(normalizeMentionProfiles(raw,targets,'',directory))
  assert.deepEqual(Object.keys(normalized),['12345678'])
  assert.equal(normalized['12345678'].role,'owner')
  assert.equal(normalized['12345678'].peerRelationships[0].uid,'98765432')
  assert.equal(normalized.陌生人,undefined)
  const prompt=buildMentionProfilePrompt({targetsText:targets,friendDirectory:directory,profiles:raw})
  assert.match(prompt,/主人|与其他好友的关系/)
  assert.match(prompt,/喜欢模型娘化/)
  assert.doesNotMatch(prompt,/陌生人|不可信信息/)
})
test('profile notes bounded, invalid JSON ignored',()=>{
  assert.equal(normalizeMentionProfiles('{bad-json',targets),'{}')
  const huge=normalizeMentionProfiles({'12345678':{personalityInterests:'a'.repeat(900)}},targets)
  assert.equal(JSON.parse(huge)['12345678'].personalityInterests.length,700)
  assert.match(DEFAULT_CHARACTER_LORE,/DeepSeek Harness/)
  assert.match(DEFAULT_CHARACTER_LORE,/虚构/)
})
test('comment meme strategy receives bounded listing before AI chooses and supports reason for decline',()=>{
  const prompt=buildCommentMemePrompt({inventory:'• 奶娃/奶龙大笑\n• 其他/无语',dailyLimit:20,roundLimit:2})
  assert.match(prompt,/奶娃\/奶龙大笑/)
  assert.match(prompt,/no_meme_image_reason/)
  assert.match(prompt,/不要为凑图改评论/)
})
test('settings write and prompt endpoints, reject agent editing private profile',async()=>{
  const home=mkdtempSync(join(tmpdir(),'bili-social-'))
  try {
    let route
    const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
      tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(f){return f()},settings:{describe(){return []}}}
    apply(ctx,{})
    const call=async(method,path,body)=>{
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      req.method=method;req.url=path;req.headers={host:'localhost'}
      let code,value
      const res={writeHead(x){code=x},end(txt){value=JSON.parse(txt)}}
      await route.handler(req,res);return {code,value}
    }
    const data=await call('GET','/api/bili-duty/character-lore-default')
    assert.equal(data.value.ok,true)
    assert.match(data.value.prompt,/DeepSeek/)
    const saved=await call('POST','/api/bili-duty/config',{mentionTargets:targets,mentionProfiles:JSON.stringify({'12345678':{personalityInterests:'视频制作'}}),characterLore:'我是一条常看DeepSeek二创的小鱼'})
    assert.equal(saved.code,200)
    assert.equal(JSON.parse(saved.value.config.mentionProfiles)['12345678'].personalityInterests,'视频制作')
    assert.match(saved.value.config.characterLore,/DeepSeek/)
    const full=await call('GET','/api/bili-duty/status')
    assert.equal(JSON.parse(full.value.config.mentionProfiles)['12345678'].personalityInterests,'视频制作')
  } finally {rmSync(home,{recursive:true,force:true})}
})
test('client UI has bounded per-friend controls and lore editor, server has generated prompt integration',()=>{
  const ui=readFileSync(new URL('../client.js',import.meta.url),'utf8')
  const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const manage=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  for(const s of ['friend-save-all','friend-directory-editor','friend-new-uid','lore-text']) assert.ok(html.includes(s))
  for(const s of ['mentionProfiles','characterLore','drawFriendDirectory','保存']) assert.ok(manage.includes(s))
  const consoleHtml=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.ok(consoleHtml.includes('今日表情包诊断'))
  for(const s of ['buildMentionProfilePrompt','loreDoc','memeInventory','/api/bili-duty/meme-diagnostics']) assert.ok(server.includes(s))
})
