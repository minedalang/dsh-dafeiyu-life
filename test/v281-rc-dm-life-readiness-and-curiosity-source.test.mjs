import test from 'node:test'
import assert from 'node:assert/strict'
import {waitForDmLifeReadiness} from '../lib/dm-life-readiness.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createHash} from 'node:crypto'

test('短暂 Life 视频占用结束后，私信可在有界等待内进入既有决策链',async()=>{
 let at=0,calls=0
 const result=await waitForDmLifeReadiness({now:()=>at,pollMs:100,maxWaitMs:300,
  inspect:()=>++calls===3?{ok:true}:{ok:false,reason:'life-choice-in-progress',ownerChannel:'video'},
  sleep:async ms=>{at+=ms}})
 assert.equal(result.ok,true)
 assert.equal(calls,3)
 assert.equal(at,200)
})
test('已批准但结果未知或需人工复核的 Life 栅栏绝不能被等待器解除',async()=>{
 let sleepCount=0
 const denied=await waitForDmLifeReadiness({inspect:()=>({ok:false,reason:'life-choice-review-required'}),
  sleep:async()=>{sleepCount++}})
 assert.equal(denied.reason,'life-choice-review-required')
 assert.equal(sleepCount,0)
})
test('持续占用只发生有界等待，不会永久阻塞私信轮询',async()=>{
 let at=0,n=0
 const denied=await waitForDmLifeReadiness({inspect:()=>{n++;return {ok:false,reason:'life-choice-in-progress'}},
  maxWaitMs:150,pollMs:50,now:()=>at,sleep:async ms=>{at+=ms}})
 assert.equal(denied.ok,false)
 assert.equal(at,150)
 assert.ok(n<=7)
})
test('自主探索按确切公共兴趣来源展示，不按相近时间误配其他搜索',()=>{
 const now=Date.now(),cue='a'.repeat(24),other='b'.repeat(24)
 const ref=value=>createHash('sha256').update('life-continuation\0'+value).digest('hex').slice(0,16)
 const base={days:3,now,lifeDecisions:[{at:now-1000,mode:'active',action:'begin_exploration',
  result:'verified-search-results',continuation:ref(cue),options:{}}]}
 const evidence=[{action:'search',at:now-1002,cueRef:ref(cue),sourceKind:'interest-milestone',
  sourceTopic:'日语歌曲',relatedVideos:[{bvid:'BV1xx411c7mD',title:'实例'}]}]
 const rows=buildLifeTimeline({...base,explorationEvidence:evidence})
 assert.ok(rows.some(x=>x.title.includes('日语歌曲')&&x.detail.includes('真实选片积累')))
 const noMatch=buildLifeTimeline({...base,explorationEvidence:[{...evidence[0],cueRef:ref(other)}]})
 assert.ok(noMatch.some(x=>x.title==='按自己的好奇心查找了公开资料'))
 assert.ok(!noMatch.some(x=>x.title.includes('日语歌曲')))
})

test('临时选片好奇也可标明源头，但不能冒充长期形成的兴趣',()=>{
 const now=Date.now(),cue='c'.repeat(24)
 const ref=createHash('sha256').update('life-continuation\0'+cue).digest('hex').slice(0,16)
 const rows=buildLifeTimeline({days:3,now,lifeDecisions:[{at:now-1000,mode:'active',action:'begin_exploration',
  result:'verified-search-results',continuation:ref,options:{}}],explorationEvidence:[{
   action:'search',at:now-1000,cueRef:ref,sourceKind:'selection-curiosity',sourceTopic:'日语歌曲'}]})
 assert.ok(rows.some(x=>x.title==='因好奇「日语歌曲」查找了公开视频'&&x.detail.includes('此前一次真实选片')))
})
