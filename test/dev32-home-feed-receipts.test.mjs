import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents,projectVideoRoundFeedback} from '../lib/life-agent-events.mjs'
import {summarizeHomeFeedResult} from '../lib/life-home-feed-evidence.mjs'

const T=Date.parse('2026-11-08T08:00:00Z'),A='a'.repeat(16),B='b'.repeat(16)
const dirRun=fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-home32-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const video=id=>({bvid:'BV'+String(id).padStart(10,'0'),title:'仅测试标题',author:'不应该进入事件账本'})

test('首页结果只根据实际 BV 候选计数，绝不相信外层 count 或任意文本',()=>{
 const data={ok:true,count:10000,videos:[video(1),video(1),video(2),{bvid:'BV-malicious',cookie:'secret'},{}]}
 assert.deepEqual(summarizeHomeFeedResult(data),{status:'candidates',count:2})
 assert.deepEqual(summarizeHomeFeedResult(data,{includeCandidateBvids:true}),{status:'candidates',count:2,candidateBvids:['BV0000000001','BV0000000002']})
 assert.deepEqual(summarizeHomeFeedResult(JSON.stringify({ok:true,videos:[]})),{status:'empty',count:0})
 assert.deepEqual(summarizeHomeFeedResult('{broken'),{status:'unavailable',count:0})
 assert.deepEqual(summarizeHomeFeedResult({ok:false,videos:[video(1)]}),{status:'unavailable',count:0})
 assert.deepEqual(summarizeHomeFeedResult({ok:true,count:3}),{status:'unavailable',count:0})
 assert.deepEqual(summarizeHomeFeedResult({ok:true,videos:[{bvid:'forged'},null]}),{status:'empty',count:0})
 assert.equal(summarizeHomeFeedResult({ok:true,videos:Array.from({length:30},(_,i)=>video(i))}).count,12)
})

test('首页启动与真实读取分开记账，Life 后续只见枚举状态和数字',()=>dirRun(dir=>{
 let clock=T
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const start=e.recordVideoRoundStart({source:'life-agent',entryMode:'home',commentGate:'configured'})
 assert.equal(e.status().recentVideoRounds[0].entryMode,'home')
 assert.equal(e.status().recentVideoRounds[0].homeRead,'not-observed')
 clock+=1_000
 assert.deepEqual(e.recordHomeFeedRead(start.id,{status:'candidates',count:7}),{ok:true,updated:true})
 assert.deepEqual(e.recordHomeFeedRead(start.id,{status:'unavailable'}),{ok:true,updated:false},'同轮不得覆写已登记读回')
 clock+=1_000
 e.recordVideoRoundFinish(start.id,{exitCode:0,pickedCount:0})
 const row=e.status().recentVideoRounds[0]
 assert.equal(row.homeRead,'candidates');assert.equal(row.homeCandidates,7)
 assert.equal(row.pickedCount,0,'读到首页候选不等于真正挑中')
 const feedback=projectVideoRoundFeedback([row],{at:clock+1_000})[0]
 assert.equal(feedback.entryMode,'home')
 assert.equal(feedback.homeRead,'candidates')
 assert.equal(feedback.homeCandidates,7)
 assert.match(feedback.proof,/not-video-viewed/)
 const raw=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/BV000|secret|仅测试标题|author|收件人|uid/i)
}))


test('精确关联首页候选与本轮新入选视频，只持久化匿名计数',()=>dirRun(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const start=e.recordVideoRoundStart({source:'life-agent',entryMode:'home'})
 const candidates=[video(11),video(12),video(13)]
 const summary=summarizeHomeFeedResult({ok:true,videos:candidates},{includeCandidateBvids:true})
 assert.deepEqual(e.recordHomeFeedRead(start.id,summary),{ok:true,updated:true})
 e.recordVideoRoundFinish(start.id,{exitCode:0,pickedCount:2,pickedBvids:[candidates[1].bvid,'BV0000000099']})
 const row=e.status().recentVideoRounds[0]
 assert.equal(row.homeCandidates,3)
 assert.equal(row.pickedCount,2,'总入选数包含所有来源')
 assert.equal(row.homePickedCount,1,'只有精确命中首页候选的入选视频计入首页来源')
 const projected=projectVideoRoundFeedback([row],{at:T+1})[0]
 assert.equal(projected.homePickedCount,1)
 const raw=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/BV0000000011|BV0000000012|BV0000000013|仅测试标题/)
 assert.deepEqual(JSON.parse(raw).videoRounds[0].homeCandidateRefs,[],'临时哈希在轮次结束后清除')
}))

test('无法读取本轮新入选账本时，首页来源入选数保持未知而不是零',()=>dirRun(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const start=e.recordVideoRoundStart({entryMode:'home'})
 const candidate=video(21)
 e.recordHomeFeedRead(start.id,summarizeHomeFeedResult({ok:true,videos:[candidate]},{includeCandidateBvids:true}))
 e.recordVideoRoundFinish(start.id,{exitCode:0,pickedCount:null,pickedBvids:null})
 assert.equal(e.status().recentVideoRounds[0].homePickedCount,null)
}))

test('未实际访问首页时保留 not-observed；旧历史轮次兼容',()=>dirRun(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const id=e.recordVideoRoundStart({entryMode:'home'}).id
 e.recordVideoRoundFinish(id,{exitCode:0,pickedCount:3})
 assert.equal(e.status().recentVideoRounds[0].homeRead,'not-observed')
 assert.throws(()=>e.recordHomeFeedRead(id,{status:'candidates',count:5}),/round-not-active/,'结束的轮次不可补造证据')
 const legacy=e.recordVideoRoundStart().id
 e.recordVideoRoundFinish(legacy,{exitCode:0,pickedCount:1})
 assert.equal(e.status().recentVideoRounds[0].entryMode,'mixed')
 assert.equal(e.status().recentVideoRounds[0].homeRead,'not-observed')
}))

test('跨账号、无效轮次或结果值不能登记首页读取；失败和空列表区分',()=>dirRun(dir=>{
 let scope=A
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>T})
 const id=e.recordVideoRoundStart({entryMode:'home'}).id
 scope=B
 assert.throws(()=>e.recordHomeFeedRead(id,{status:'candidates',count:4}),/round-not-active/)
 assert.equal(e.status().recentVideoRounds.length,0)
 scope=A
 assert.equal(e.recordHomeFeedRead('BV_private_data',{status:'candidates'}).ok,false)
 assert.equal(e.recordHomeFeedRead(id,{status:'private-text',count:2}).ok,false)
 assert.equal(e.recordHomeFeedRead(id,{status:'unavailable',count:4}).ok,true)
 e.recordVideoRoundFinish(id,{exitCode:1,pickedCount:2})
 const row=e.status().recentVideoRounds[0]
 assert.equal(row.state,'failed')
 assert.equal(row.homeRead,'unavailable')
 assert.equal(row.homeCandidates,null)
}))

test('首页工具返回空结果时能区分真正读取与没有调用',()=>dirRun(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const id=e.recordVideoRoundStart({entryMode:'home'}).id
 e.recordHomeFeedRead(id,summarizeHomeFeedResult({ok:true,videos:[]}))
 e.recordVideoRoundFinish(id,{exitCode:0,pickedCount:0})
 assert.equal(e.status().recentVideoRounds[0].homeRead,'empty')
}))

test('生产链经同一个视频 Agent 传轮次 ID，不能只靠提示词声称浏览成功',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.equal((idx.match(/BILI_DUTY_LIFE_ROUND_ID:videoRoundReceiptId/g)||[]).length,1,'only video Agent inherits the opaque round ID')
 assert.match(idx,/recordHomeFeedRead\(round,summarizeHomeFeedResult\(response,\{includeCandidateBvids:true\}\)\)/)
 assert.match(idx,/pickedBvids:newlyPickedBvids/)
 assert.match(idx,/recordVideoRoundStart\(\{source:why/)
 assert.match(idx,/recordVideoRoundFinish\(videoRoundReceiptId/)
 assert.match(ui,/homeLabel=lastRound\?\.entryMode==='home'\?'首页闲逛'/)
 assert.match(ui,/真正入选的首页视频/)
})
