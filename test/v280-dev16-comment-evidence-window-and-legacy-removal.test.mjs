import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifePublicDiscussionWindow} from '../lib/life-public-discussion-window.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {validateSocialActionProposal,composeSocialDecisionContext} from '../lib/social-autonomy-contract.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
const BVID='BV1xx1234567',ACCOUNT='1234abcd1234abcd',OTHER='abcdabcdabcdabcd'
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
test('公开讨论摘要仅同账号同BV、进程内短期可复用；过期/换号即消失',()=>{
 let clock=1234567890000
 const cache=createLifePublicDiscussionWindow({now:()=>clock})
 assert.equal(cache.put(ACCOUNT,BVID,[{content:'公开讨论片段'},{content:'\u0000另一段'}]),true)
 assert.deepEqual(cache.get(ACCOUNT,BVID),['公开讨论片段','另一段'])
 assert.deepEqual(cache.get(ACCOUNT,'BV1aa1234567'),[])
 assert.deepEqual(cache.get(OTHER,BVID),[])
 assert.deepEqual(cache.get(ACCOUNT,BVID),[])
 assert.equal(cache.put(ACCOUNT,BVID,['新片段']),true)
 clock+=600000
 assert.deepEqual(cache.get(ACCOUNT,BVID),[])
 assert.equal(cache.put(ACCOUNT,'invalid-id',['x']),false)
})
test('Life 证据诊断仅保存布尔和计数，不保存评论正文或BV',()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-evidence-safe-'))
 try{
  let at=1790000000000
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>ACCOUNT,now:()=>at})
  const t=trace.begin({mode:'active'})
  t.step('candidate-detail',{kind:'life-public-evidence-depth',metadataVerified:true,descriptionAvailable:false,
    verifiedDiscussionExcerpts:3,recentReadNovel:true,episodeStepsUsed:2,bvid:BVID,comments:['私密原文不得出现']})
  t.finish({state:'finished'})
  const last=trace.list().runs[0].steps.find(x=>x.kind==='life-public-evidence-depth')
  assert.equal(last.verifiedDiscussionExcerpts,3)
  assert.equal(last.recentReadNovel,true)
  assert.equal(last.metadataVerified,true)
  assert.equal(last.descriptionAvailable,false)
  assert.equal(last.episodeStepsUsed,2)
  assert.doesNotMatch(JSON.stringify(trace.list()),/私密原文不得出现|BV1xx1234567/)
 } finally{rmSync(dir,{recursive:true,force:true})}
})
test('删除旧延期预约配置和发送器，保留独立自然续想',()=>{
 for(const file of ['lib/dm-autoreply.mjs','lib/comment-interact.mjs','index.js','lib/interaction-batch.mjs','lib/management-console.js','lib/management-console.html']){
  const data=src(file)
  assert.doesNotMatch(data,/socialP6MinDelayMinutes|socialP6MaxDelayMinutes|scheduleContinuity|continuityFor\(|createSocialContinuityLedger/)
 }
 assert.equal(existsSync(new URL('../lib/social-continuity-ledger.mjs',import.meta.url)),false)
 assert.match(src('lib/dm-autoreply.mjs'),/createNaturalExpressionOpportunity/)
 assert.match(src('lib/comment-interact.mjs'),/life-deferred-no-appointment/)
})
test('模型选择 defer 不会创建未来的再发送凭据',async()=>{
 const context=composeSocialDecisionContext({channel:'dm',actorUid:'98765',threadKey:'dm:98765',lifeVoiceContext:'生活人格'})
 assert.equal(context.ok,true)
 const check=validateSocialActionProposal({action:'defer',notBefore:1234567890000},context)
 assert.equal(check.ok,true)
 assert.equal(check.action,'defer')
 assert.equal(check.requiresReconsideration,undefined)
 assert.equal(check.notBefore,undefined)
 const batch=createInteractionBatcher({getPersona:()=> '生活人格',delayMs:1,logger:{warn(){}},invoke:async()=>JSON.stringify({items:[{id:'0',action:'defer',messages:[],mood:'neutral',intensity:0}]})})
 try{
  const r=await batch.generate({kind:'dm',uid:'98765',socialAutonomy:true,threadKey:'dm:98765',text:'之后再聊'})
  assert.equal(r.action,'defer')
  assert.equal(r.notBefore,undefined)
 }finally{batch.stop()}
})
test('普通私信 defer 后不重开旧预约，下一条真实来信仍可得到新决定',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-dm-defer-'))
 try{
  let now=1800000000000,steps=0,rows=[],sent=[]
  const agent=createDmAutoReply({dataDir:dir,now:()=>now,selfUid:'99999',
    getConfig:()=>({enabled:true,strangerEnabled:true,p6Enabled:true,whitelist:[],whitelistCooldownSeconds:0}),
    fetchIncoming:async()=>rows,send:async row=>{sent.push(row);return {ok:true,receiptId:'r1'}},
    generateReply:async()=>++steps===1?{action:'defer'}:{action:'reply',messages:['新消息才回复']},logger:{warn(){}}})
  await agent.poll()
  rows=[{senderUid:'98765',messageId:'1',timestampMs:now+1000,incoming:true,text:'先想想'}]
  now+=1000;await agent.poll();assert.equal(steps,1);assert.equal(sent.length,0)
  now+=31*60_000;await agent.poll();assert.equal(steps,1)
  rows.push({senderUid:'98765',messageId:'2',timestampMs:now+1000,incoming:true,text:'有新问题'})
  now+=1000;await agent.poll();assert.equal(steps,2);assert.equal(sent.length,1)
  assert.equal(existsSync(join(dir,'social-continuity','intentions.json')),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Life 续行在不同决策轮次使用同账号同 BV 的短期公开讨论，不复制到持久账本',()=>{
 const planner=src('lib/autonomous-planner.mjs')
 assert.match(planner,/const publicDiscussionWindow=createLifePublicDiscussionWindow\(\{now\}\)/)
 assert.match(planner,/publicDiscussionWindow\.put\(scope,selected,discussion\.comments\|\|\[\]\)/)
 assert.match(planner,/publicDiscussionWindow\.get\(scope,writeEvidence\.bvid\)/)
 assert.doesNotMatch(src('lib/life-public-discussion-window.mjs'),/writeFileSync|appendFileSync/)
})
test('模型配置指南不会把高频 Life 行为决策误推荐为昂贵的强推理档',()=>{
 const page=src('lib/management-console.html')
 const guide=page.match(/<div class="settings-section" id="models-role-guide">([\s\S]*?)<h4 class="model-role-group">/)
 assert.ok(guide)
 assert.match(guide[1],/高频决策重视成本/)
 assert.doesNotMatch(guide[1],/行为决策.*适合较强的推理模型/)
 assert.match(page,/行为决策模型（Life 的行动选择）[\s\S]*?高频 · 推荐均衡模型/)
 assert.match(page,/人生反思与经历提炼模型[\s\S]*?较强推理与长文本归纳模型/)
})
