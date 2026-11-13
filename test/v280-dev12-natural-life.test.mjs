import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {continuationMenu,parseContinuationDecision} from '../lib/life-continuation.mjs'
import {verifiedVideoObservation} from '../lib/life-action-protocol.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {verifiedEpisodeYield,shouldWakeAfterVerifiedRead} from '../lib/life-episode-value.mjs'
import {projectLifeGrowthAttribution} from '../lib/life-growth-attribution.mjs'

const A='BV1abcdEFG12',B='BV1hijkLMN34',cred={dedeuserid:'900',sessdata:'fake-local-session'},scope=discussionAccountTag(cred)
const withLife=async fn=>{
 const stateDir=mkdtempSync(join(tmpdir(),'dev12-life-'))
 let at=Date.now()
 const key='f'.repeat(24),personId=createHash('sha256').update('person:'+key).digest('hex').slice(0,24)
 const life=createLifeOpportunities({stateDir,getCredential:()=>cred,now:()=>at,
   getPublicPersonEvidence:()=>[{source:'public-person-observation',personKey:key,at,evidenceCount:3,evidenceDays:2}]})
 try{await fn({life,stateDir,get at(){return at},advance:ms=>at+=ms,key,personId})}
 finally{rmSync(stateDir,{recursive:true,force:true})}
}
function observe(life,at,source='comment-reply-receipt',sourceId='reply:700:comment:800'){
 const receipt=verifiedVideoObservation({source,sourceId,bvid:A,title:'真实视频标题',at,accountTag:scope})
 assert.equal(receipt.ok,true)
 return life.beginVideoObservation(receipt,scope)
}
test('a confirmed reply opens a general Life episode, not a mandatory hot-comment workflow',()=>withLife(({life,at})=>{
 const result=observe(life,at)
 assert.equal(result.created,true)
 const row=life.continuations()[0]
 assert.match(row.goal,/自由决定继续了解视频、作者、讨论/)
 const kinds=continuationMenu(row,{at,writeActions:['comment_video','like_video','follow_creator']}).map(x=>x.action)
 for(const action of ['inspect_creator_space','inspect_video_discussion','comment_video','like_video','follow_creator','abandon_exploration'])
   assert.ok(kinds.includes(action),action)
 assert.equal(life.continuations().length,1)
}))
test('independently proven public commenter can be explored, but unknown/revoked person ids cannot be supplied by the model',()=>withLife(({life,at,stateDir,personId})=>{
 const {id}=observe(life,at)
 const read=life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:A,count:1,publicPersonIds:[personId,'0'.repeat(24)]},scope)
 assert.equal(read.ok,true)
 const row=life.continuations()[0]
 assert.deepEqual(row.commenterPersonIds,[personId])
 const menu=continuationMenu(row,{at})
 const candidate=menu.find(x=>x.action==='inspect_commenter_works')
 assert.deepEqual(candidate.personIds,[personId])
 const good=parseContinuationDecision(JSON.stringify({action:'inspect_commenter_works',id,personId,reason:'想了解这位评论者的公开作品'}),menu)
 assert.equal(good.action,'inspect_commenter_works')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'inspect_commenter_works',id,personId:'1'.repeat(24)}),menu).action,'stop')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'like_video',id,bvid:A,personId}),menu).action,'stop')
 const raw=readFileSync(join(stateDir,'life-opportunities',scope+'.json'),'utf8')
 assert.ok(!raw.includes('dedeuserid')&&!raw.includes('fake-local-session'))
}))
test('repeated same-source video receipt merges an active identical BV instead of creating a fresh model loop',()=>withLife(({life,at})=>{
 const first=observe(life,at,'social-read-now','first')
 const second=observe(life,at,'social-read-now','second')
 assert.equal(second.ok,true);assert.equal(second.created,false);assert.equal(second.id,first.id)
 assert.equal(life.continuations().length,1)
 const independent=observe(life,at,'owner-dm-read','distinct-context')
 assert.equal(independent.created,true,'different social contexts are not silently overwritten')
}))
test('last verified read at five-step ceiling creates a single future optional chapter, never an automatic sixth action',()=>withLife(({life,at,advance})=>{
 const original=observe(life,at)
 const id=original.id
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:A,count:1},scope).ok,true) // 2
 const creator=life.inspectCreatorSpace(id,{ok:true,bvid:A,creatorUid:'333',accountUid:'900',videos:[{bvid:B,title:'可信第二条'}]},scope)
 assert.equal(creator.ok,true) // 3
 assert.equal(life.completeExploration(id,B,{ok:true,bvid:B,title:'可信第二条'},scope).ok,true) // 4
 const finish=life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:B,count:2},scope) // 5
 assert.equal(finish.ok,true)
 const rows=life.status().intentions
 const ended=rows.find(x=>x.id===id)
 const follow=rows.find(x=>x.source==='episode-carryover')
 assert.equal(ended.status,'completed')
 assert.ok(follow?.id,'new evidence survives only as a later optional choice')
 assert.equal(follow.chapterDepth,1)
 assert.ok(!life.continuations().some(x=>x.id===follow.id),'not immediately eligible')
 advance(20*60_000+1)
 const resumed=life.continuations().find(x=>x.id===follow.id)
 assert.ok(resumed)
 assert.equal(continuationMenu(resumed,{at:at+20*60_000+1}).some(x=>x.action==='inspect_video_discussion'),false,
   'already read comment section is not re-fetched merely due to new chapter')
}))
test('new evidence accounting is not a new preference voter or autonomous write permission',()=>{
 assert.deepEqual(verifiedEpisodeYield('inspect_video_discussion',{receipt:{ok:true,count:0},before:{discussionReadBvids:[]}}),
   {kind:'discussion',novel:false,observations:0}) // an empty page contains no new comment item
 assert.equal(shouldWakeAfterVerifiedRead({kind:'discussion',novel:true,observations:0}),false)
 assert.equal(verifiedEpisodeYield('inspect_creator_space',{receipt:{ok:false}}).novel,false)
 assert.equal(verifiedEpisodeYield('inspect_exploration',{before:{selectedBvid:A},after:{selectedBvid:A},receipt:{ok:true}}).novel,false)
})
test('interest and personality attribution is only a read-only summary of existing independent evidence',()=>{
 const report=projectLifeGrowthAttribution({yieldEvidence:{episodes:2,video:3,discussion:10},
  interestEvidence:[{source:'interest-milestone',stage:'growing',evidenceCount:4,evidenceDays:3,uid:'123',bvid:A},
    {source:'interest-milestone',stage:'stable',evidenceCount:1,evidenceDays:1}],
  reflection:{recentPublicRun:{personalityEnabled:true,personalityObserved:1,personalityAccepted:0,personalityProposed:2,processed:3}}})
 assert.equal(report.exploration.verifiedVideoMetadata,3)
 assert.equal(report.independentInterestMilestones.length,1)
 assert.equal(report.reflection.personalityAccepted,0)
 assert.equal(JSON.stringify(report).includes(A),false)
 assert.equal(JSON.stringify(report).includes('123'),false)
 assert.match(report.caveat,/不等于喜欢/)
})
test('npm update entry remains visible without a newer registry version and the install source is pinned',()=>{
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(client,/npmUpdateState\.status==='error'/)
 assert.match(client,/newVer\?'更新至 v'/)
 assert.match(client,/onClick:newVer\?onUpgrade:onCheckUpdate/)
 assert.match(client,/source:newVerSource==='npm'\?'npm':'github'/)
 assert.match(host,/String\(requested\.expectedLatest\)!==String\(updateCache\?\.latest\|\|''\)/)
 assert.match(host,/const refreshNpm = npmOnly && url\.searchParams\.get\('refresh'\) === '1'/)
})
