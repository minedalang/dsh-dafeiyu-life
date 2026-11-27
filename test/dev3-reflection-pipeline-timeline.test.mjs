import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeReflection,__test as reflectionTest} from '../lib/life-reflection.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createBackup,validateBackup} from '../lib/data-backup.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev3-reflection-'))
const bv=i=>'BV'+String(i.toString(36)).padStart(10,'0')
const events=(start,count)=>Array.from({length:count},(_,n)=>({kind:'watch',day:'2026-10-31',bvid:bv(start+n),title:`普通经历 ${start+n}`,key:`watch:${start+n}`}))
const baseConfig=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:24,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:16})
const gateway={reflectionEvidence:keys=>keys.map((key,i)=>({key,stage:'clear',text:`真实可衰减经历证据 ${key}。这是第 ${i+1} 条经历。`,importance:.5,at:Date.parse('2026-10-31T08:00:00Z')}))}

function createLife(dir,{config=baseConfig(),invokeModel=async()=>JSON.stringify({memories:[],note:'本批经历没有形成值得长期保留的新认识'}),commitMemories=()=>({added:0,rows:[]}),memoryGateway:gw=gateway,now=()=>Date.parse('2026-10-31T10:00:00Z')}={}){
 return createLifeReflection({dataDir:dir,getConfig:()=>config,invokeModel,commitMemories,memoryGateway:gw,now,logger:{warn(){}}})
}

test('dev.3 默认反思吞吐与积压动态批次上限',()=>{
 const c=reflectionTest.configOf({})
 assert.equal(c.minCandidates,6)
 assert.equal(c.batchSize,24)
 assert.equal(c.intervalHours,1)
 assert.equal(c.dailyBatches,16)
 assert.equal(reflectionTest.backlogBatchLimit(20),12)
 assert.equal(reflectionTest.backlogBatchLimit(100),18)
 assert.equal(reflectionTest.backlogBatchLimit(300),24)
})

test('dev.3 证据文本预算会动态缩小单批，不超过最大字符预算',()=>{
 const rows=Array.from({length:24},(_,i)=>({id:`c-${i}`,key:`k-${i}`}))
 const evidence=new Map(rows.map(x=>[x.key,{text:'中'.repeat(500)}]))
 const batch=reflectionTest.fitEvidenceBatch(rows,evidence,24)
 assert.ok(batch.length<24)
 const chars=batch.reduce((n,x)=>n+x.text.length+180,0)
 assert.ok(chars<=reflectionTest.MAX_REFLECTION_EVIDENCE_CHARS)
})

test('dev.3 正常完成评估但没有合格领悟：整批结束，不进入重试队列',async()=>{
 const dir=temp();try{
  const life=createLife(dir,{invokeModel:async()=>JSON.stringify({memories:[{candidate_ids:[],insight:'很有意思',behavior:'以后再看看'}],note:'已评估但没有可保存认识'})})
  life.addEvents(events(1,3))
  const result=await life.reflect({force:true})
  assert.equal(result.ok,true)
  assert.equal(result.qualityRejected,1)
  assert.equal(result.processed,3)
  const status=life.status()
  assert.equal(status.pending,0)
  assert.equal(status.reviewedNoMemory,3)
  assert.equal(status.retrying,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 模型／协议失败保留 pending，并按 30 分钟退避',async()=>{
 const dir=temp();const t=Date.parse('2026-10-31T10:00:00Z');try{
  const life=createLife(dir,{invokeModel:async()=>'{bad-json',now:()=>t})
  life.addEvents(events(10,2))
  const result=await life.reflect({force:true})
  assert.equal(result.ok,false)
  assert.equal(life.status().pending,2)
  assert.equal(life.status().retrying,2)
  assert.equal(life.list('pending').every(x=>x.retryCount===1&&x.nextRetryAt===t+30*60_000),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 技术失败的旧经历退避时，新经历仍可进入下一批',async()=>{
 const dir=temp();let t=Date.parse('2026-10-31T10:00:00Z'),calls=0;try{
  const life=createLife(dir,{now:()=>t,invokeModel:async()=>{calls++;if(calls===1)throw Error('model timeout');return JSON.stringify({memories:[],note:'新经历已完成评估'})}})
  life.addEvents(events(20,2))
  const first=await life.reflect({force:true});assert.equal(first.ok,false)
  t+=60_000
  life.addEvents(events(30,2))
  const second=await life.reflect({force:false})
  assert.equal(second.ok,true)
  assert.equal(second.processed,2)
  assert.equal(life.status().pending,2)
  assert.equal(life.status().retrying,2)
  assert.equal(life.status().reviewedNoMemory,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 连续五次技术失败后暂停自动重试，但主人仍可手动重试',async()=>{
 const dir=temp();let t=Date.parse('2026-10-31T10:00:00Z'),fail=true;try{
  const life=createLife(dir,{now:()=>t,invokeModel:async()=>{if(fail)throw Error('temporary model error');return JSON.stringify({memories:[],note:'人工重试后完成评估'})}})
  life.addEvents(events(40,2))
  for(let i=0;i<5;i++){const r=await life.reflect({force:true});assert.equal(r.ok,false);t+=60*60_000}
  assert.equal(life.status().retryPaused,2)
  const auto=await life.reflect({force:false});assert.equal(auto.ok,false);assert.equal(auto.skipped,'not-enough-or-backoff')
  fail=false
  const manual=await life.reflect({force:true});assert.equal(manual.ok,true)
  assert.equal(life.status().pending,0)
  assert.equal(life.status().retryPaused,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 每日上限统计技术失败尝试，避免失败时无限重调',async()=>{
 const dir=temp();let t=Date.parse('2026-10-31T10:00:00Z');const config=baseConfig();config.mainSessionReflectionDailyBatches=1;try{
  const life=createLife(dir,{config,now:()=>t,invokeModel:async()=>{throw Error('network unavailable')}})
  life.addEvents(events(60,2))
  const first=await life.reflect({force:false});assert.equal(first.ok,false)
  assert.equal(life.status().runsToday,1)
  const second=await life.reflect({force:false});assert.equal(second.skipped,'not-enough-or-backoff')
  t+=31*60_000
  const third=await life.reflect({force:false});assert.equal(third.skipped,'daily-limit')
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('dev.3 到期技术重试不受新经历积累门槛阻挡',async()=>{
 const dir=temp();let t=Date.parse('2026-10-31T10:00:00Z'),calls=0;const config=baseConfig();config.mainSessionReflectionMinCandidates=6;try{
  const life=createLife(dir,{config,now:()=>t,invokeModel:async()=>{calls++;if(calls===1)throw Error('first attempt failed');return JSON.stringify({memories:[],note:'重试已完成评估'})}})
  life.addEvents(events(70,2))
  assert.equal((await life.reflect({force:true})).ok,false)
  t+=31*60_000
  const retry=await life.reflect({force:false})
  assert.equal(retry.ok,true)
  assert.equal(retry.processed,2)
  assert.equal(life.status().pending,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 备份校验兼容公开社交经历候选与重试字段',()=>{
 const dir=temp();try{
  const life=createLife(dir)
  life.addEvents([{kind:'social',key:'social:123:BV0000000001:456',bvid:bv(101),day:'2026-10-31',time:'2026-10-31T08:00:00Z'}])
  const backup=createBackup({root:dir,config:{},sqlite:{},version:'2.6.0-dev.3'})
  assert.doesNotThrow(()=>validateBackup(backup))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 同一天准确时间事件排在日期级视频记录之前，不再伪造中午时间',()=>{
 const now=Date.parse('2026-10-31T20:00:00Z')
 const rows=buildLifeTimeline({now,days:7,watched:[{day:'2026-10-31',bvid:bv(99),title:'只有日期的视频',picked:true}],
  comments:[{bvid:bv(98),time:'2026-10-31T19:30:00Z',kind:'top',rpid:'100',snippet:'公开评论'}],
  emotionHistory:[{at:Date.parse('2026-10-31T18:00:00Z'),mood:'curious',label:'好奇'}]})
 assert.deepEqual(rows.map(x=>x.type),['comment','emotion','video'])
 const video=rows.find(x=>x.type==='video')
 assert.equal(video.dateOnly,true)
 assert.equal(video.day,'2026-10-31')
 assert.equal(video.at,'2026-10-31T00:00:00.000Z')
})


test('dev.24 automatic reflection pause retains candidates and charges only the started model attempt',async()=>{
 const {createAutomaticSessionScope}=await import('../lib/session-integration-policy.mjs')
 const dir=temp();let policy={mode:'memory-foundation',revision:1},release,started,calls=0,commits=0
 const entered=new Promise(r=>started=r),model=new Promise(r=>release=r)
 try{
  const life=createLifeReflection({automaticSession:createAutomaticSessionScope(()=>policy),dataDir:dir,getConfig:baseConfig,memoryGateway:gateway,
   now:()=>Date.parse('2026-10-31T10:00:00Z'),invokeModel:async()=>{calls++;if(calls===1){started();return model}return '{"memories":[]}'},commitMemories:()=>{commits++;return {added:0,rows:[]}}})
  life.addEvents(events(1,2));assert.equal((await life.reflect()).skipped,'session-integration-paused');assert.equal(calls,0)
  policy={mode:'autonomous-life',revision:2};const work=life.reflect();await entered;policy={mode:'memory-foundation',revision:3};policy={mode:'autonomous-life',revision:4};release('{"memories":[]}')
  const result=await work;assert.equal(result.skipped,'session-integration-paused');assert.equal(result.modelCalled,true)
  assert.equal(life.status().pending,2);assert.equal(life.status().retrying,0);assert.equal(life.status().lastError,'');assert.equal(commits,0)
  assert.equal((await life.reflect()).skipped,'interval')
  policy={mode:'memory-foundation',revision:5};assert.equal((await life.reflect({force:true})).ok,true);assert.equal(commits,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('dev.30 same-domain successful automatic reflection re-arms at most two exhausted candidates once',async()=>{
 const dir=temp();let t=Date.parse('2026-10-31T10:00:00Z'),fail=true
 try{
  const life=createLife(dir,{now:()=>t,invokeModel:async()=>{if(fail)throw Error('temporary outage');return JSON.stringify({memories:[]})}})
  life.addEvents(events(100,4))
  for(let i=0;i<5;i++){assert.equal((await life.reflect({force:true})).ok,false);t+=3600000}
  assert.equal(life.status().retryPaused,4)
  fail=false;life.addEvents(events(200,2));const recovered=await life.reflect();assert.equal(recovered.ok,true);assert.equal(recovered.recoveryRearmed,2);assert.equal(life.status().retryPaused,2)
  assert.equal(life.list('pending').filter(r=>r.recoveryRearmed===true&&r.nextRetryAt===t+12*3600000).length,2)
  t+=12*3600000;fail=true;assert.equal((await life.reflect()).ok,false);assert.equal(life.status().retryPaused,4)
  t+=3600000;fail=false;life.addEvents(events(300,2));assert.equal((await life.reflect()).recoveryRearmed,2)
  assert.equal(life.list('pending').filter(r=>r.recoveryRearmed===true).length,4);assert.equal(life.status().retryPaused,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.30 independent public recognition requires exact clear evidence and no invented behavior',()=>{
 const row={id:'c-recognition',kind:'watch',associationStage:'clear',evidenceCoverage:'complete',text:'我观察到雨滴沿着窗边缓慢滑落。'}
 const proposal={candidate_ids:[row.id],kind:'recognition',insight:'我体会到安静观察也能带来细微的乐趣',behavior:'',evidence_quote:'雨滴沿着窗边缓慢滑落',retention_reason:'这种感受值得在日常观察中记住'}
 const check=(p,r=row)=>reflectionTest.validateOutput(JSON.stringify({memories:[p]}),[r])
 assert.equal(check(proposal).memories.length,1);assert.equal(check(proposal).memories[0].kind,'experience');assert.equal(check(proposal).memories[0].text,proposal.insight)
 for(const p of [{...proposal,evidence_quote:'伪造的画面连续描述'},{...proposal,behavior:'以后我一定每天去看雨'},{...proposal,retention_reason:''},{...proposal,candidate_ids:[row.id,'fake']},{...proposal,kind:'experience'}])assert.equal(check(p).memories.length,0)
 assert.equal(check(proposal,{...row,associationStage:'fuzzy'}).memories.length,0);assert.equal(check(proposal,{...row,evidenceCoverage:'partial'}).memories.length,0);assert.equal(check(proposal,{...row,kind:'private-social'}).memories.length,0)
})
