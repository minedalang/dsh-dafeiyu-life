import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedTranscript} from '../lib/context-budget.mjs'
import {continuationPrompt} from '../lib/life-continuation.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {__test as reflection} from '../lib/life-reflection.mjs'

const BV='BV1234567890', ID='e'.repeat(24)

test('long transcript exposes source character coverage without claiming uninterrupted playback',()=>{
  const raw='开始字幕。'.repeat(1000)+'中间发生反转。'.repeat(1200)+'结尾字幕。'.repeat(1000)
  const excerpt=boundedTranscript(raw,4200)
  assert.equal(excerpt.truncated,true)
  assert.equal(excerpt.originalChars,raw.length)
  assert.equal(excerpt.sourceCharRanges.length,3)
  assert.deepEqual(excerpt.sourceCharRanges[0][0],0)
  assert.equal(excerpt.sourceCharRanges[2][1],raw.length)
  assert.match(excerpt.coverageNotice,/不能推断已阅读全部字幕/)
  assert.ok(excerpt.sourceCharRanges.reduce((n,[a,b])=>n+b-a,0)<raw.length)
  assert.match(excerpt.text,/已省略/)
  assert.ok(excerpt.text.length<=4200)
  assert.equal(boundedTranscript('short',120).truncated,false)
  assert.equal(raw.includes('中间发生反转'),true,'original source never overwritten')
})

test('Life Episode input distinguishes five verified steps, trimmed event detail and incomplete visual evidence',()=>{
  const menu=[{action:'observe_video',id:ID,bvid:BV,viewDepths:['standard','deep']}]
  const steps=['browse-home','inspect-video','observe-video','inspect-video-discussion','inspect-creator-space']
    .map((action,i)=>({action,at:1000+i*100,bvid:BV,frameCount:i===2?3:undefined}))
  const events=Array.from({length:12},(_,i)=>({type:'result',action:'explore-'+i,outcome:'verified',evidence:{verified:true,bvid:BV,title:'公开事实'+i,description:'视频描述'.repeat(400)}}))
  const prompt=continuationPrompt(menu,'鱼鱼有选择不看的自由',{episodeHistory:steps,
    episodeSessionEvents:events,verifiedEpisodeContext:{bvid:BV,summary:'有限经历'.repeat(400)},
    visualObservation:{untrustedObservationNotes:['可能有动作变化'.repeat(500)],source:'decoded-video'}})
  for(const step of steps)assert.match(prompt,new RegExp(step.action))
  assert.match(prompt,/只提供最近 3\/12 条已核验事实的详情/)
  assert.match(prompt,/visual-observation:partial/)
  assert.match(prompt,/verified-episode:partial/)
  assert.match(prompt,/verifiedFactsAvailable/)
  assert.match(prompt,/未进入本轮模型的内容未知/)
  assert.match(prompt,/当前合法行动菜单/)
  assert.doesNotMatch(prompt,/登录凭据|真实私信正文/)
  assert.ok(prompt.length<14000)
})

test('reflection evidence truncation is visible and cannot solely create stable memories, traits or mood',()=>{
  const raw='已经被证据核对的公共事件。'.repeat(300)
  const rows=[{id:'c1',key:'k1',kind:'watch',bvid:BV,summary:'公开事件'}]
  const batch=reflection.fitEvidenceBatch(rows,new Map([['k1',{text:raw}]]),2)
  assert.equal(batch.length,1)
  assert.equal(batch[0].evidenceCoverage,'partial')
  assert.match(batch[0].text,/省略/)
  const prompt=reflection.reflectionPrompt(batch,true)
  assert.match(prompt,/evidenceCoverage/)
  assert.match(prompt,/不能把未看到的部分说成已核验/)
  const proposal=JSON.stringify({memories:[{candidate_ids:['c1'],insight:'我发现这次经历值得珍惜',behavior:'以后遇到类似事件我会先观察',importance:.7}],
    trait_proposals:[{trait:'curiosity',direction:1,candidate_ids:['c1'],feedback:'positive',confidence:.9}],
    mood_update:{mood:'joyful',intensity:3}})
  const checked=reflection.validateOutput(proposal,batch)
  assert.equal(checked.memories.length,0)
  assert.equal(checked.traitProposals.length,0)
  assert.equal(checked.moodUpdate,null)
  assert.match(checked.rejectedMemories[0].reason,/证据均为节选/)
  assert.equal(raw.includes('已经被证据核对'),true)
  const complete=reflection.fitEvidenceBatch(rows,new Map([['k1',{text:'公开事实和实际核验记录。'}]]),2)
  assert.equal(complete[0].evidenceCoverage,'complete')
  const good=reflection.validateOutput(proposal,complete)
  assert.equal(good.memories.length,1)
})

test('Memory Retriever reports omitted live candidates without claiming retrieval equals delivery',async()=>{
  const memories=Array.from({length:9},(_,i)=>({id:'m'+i,text:'做音乐的兴趣和体验；'+('讨论编曲技法').repeat(35)+i,importance:.85-i*.03,source:'life-reflection'}))
  const episodes=Array.from({length:4},(_,i)=>({id:'ep'+i,summary:'近期与乐迷讨论音乐体验 '+i,importance:.8}))
  const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:false,mainSessionMemoryMaxItems:3,
    mainSessionMemoryMaxChars:220,mainSessionMemoryFactsMax:0})
  const r=createMemoryRetriever({getMemories:()=>memories,getEpisodes:()=>episodes,getConfig:config})
  const local=r.localContext('音乐','chat')
  const retrieved=await r.retrieve('音乐','chat')
  for(const result of [local,retrieved.context]){
    assert.match(result,/【记忆范围】/)
    assert.match(result,/未进入本轮模型/)
    assert.ok(result.length<=220,'context budget is preserved')
    assert.ok(result.split('\n').filter(x=>x.startsWith('- ')).length<=3)
  }
  assert.ok(retrieved.ids.length+retrieved.episodeIds.length<=3)
  assert.ok(!local.includes('m8'),'internal IDs are not emitted in short memory snippets')
  // Public retrieval must not expose memories that are not explicitly approved.
  assert.doesNotMatch(r.localContext('音乐','video'),/做音乐的兴趣和体验/)
})
