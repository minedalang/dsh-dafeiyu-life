import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {readOwnedVideoLedger} from '../lib/video-owned-ledger.mjs'
import {buildLifeTimeline,groupLifeTimeline} from '../lib/life-timeline.mjs'
const A='abcdefabcdef',R=A+'1234567890ab',BV='BV1abcde1234',t=Date.parse('2026-11-11T09:00:00Z')
test('same-second metadata and verified visual receipts retain true millisecond reverse chronology',()=>{
 const rows=buildLifeTimeline({now:t+5000,days:2,
  lifeDecisions:[{at:t+100,mode:'active',action:'inspect_exploration',verifiedReadKind:'video-metadata',result:'verified-metadata'}],
  explorationEvidence:[{at:t+650,action:'observe-video',bvid:BV,frameCount:12,title:'同一视频'}]})
 const actions=rows.filter(x=>['核验视频资料','观察视频画面'].includes(x.label))
 assert.deepEqual(actions.map(x=>x.label),['观察视频画面'])
 assert.equal(rows.some(x=>x.type==='life-read'),false,'没有同源视频回执的旧决策不得显示无 BV 卡片')
 assert.deepEqual(actions.map(x=>Date.parse(x.at)-t),[650])
 assert.ok(actions.every(x=>!x.continuity),'同一秒不能伪造 Episode 关联')
})

test('verified BV without a stored title is labeled missing, not a fictional video title',()=>{
 const ref='d'.repeat(16),at=t+1000
 const rows=buildLifeTimeline({now:t+5000,days:2,
  lifeDecisions:[{at,mode:'active',action:'inspect_opportunity',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:at-200,action:'inspect-opportunity',cueRef:ref,bvid:BV,title:''}]})
 const matched=rows.find(x=>x.type==='life-read')
 assert.equal(matched?.bvid,BV);assert.match(matched?.title||'',/标题未记录/)
 assert.equal(matched?.url,'https://www.bilibili.com/video/'+BV)
 const visual=buildLifeTimeline({now:t+5000,days:2,explorationEvidence:[
  {at:at+100,action:'observe-video',bvid:BV,title:'',frameCount:4,visualSource:'low-resolution-preview'}]})
 assert.match(visual.find(x=>x.type==='life-visual')?.title||'',/标题未记录/)
})
test('verified opportunity uses the source-opaque key; other nearby video is never substituted',()=>{
 const ref='a'.repeat(16),other='b'.repeat(16),now=t+30000;
 const decisions=[{at:t+1000,mode:'active',action:'inspect_opportunity',result:'verified-metadata',
  verifiedReadKind:'video-metadata',continuation:ref}]
 const source=[{at:t+800,action:'inspect-opportunity',cueRef:other,bvid:'BV1abcde9999',title:'另一个视频'},
  {at:t+900,action:'inspect-opportunity',cueRef:ref,bvid:BV,title:'真正核验的标题'}]
 const matched=buildLifeTimeline({now,days:2,lifeDecisions:decisions,explorationEvidence:source}).find(x=>x.type==='life-read')
 assert.equal(matched?.bvid,BV);assert.equal(matched?.title,'真正核验的标题')
 const wrong=buildLifeTimeline({now,days:2,lifeDecisions:decisions,explorationEvidence:source.slice(0,1)})
 assert.equal(wrong.find(x=>x.type==='life-read'),undefined)
 const older=buildLifeTimeline({now,days:2,lifeDecisions:[{...decisions[0],continuation:''}],explorationEvidence:source})
 assert.equal(older.find(x=>x.type==='life-read'),undefined,'legacy anonymous read must not attach by nearby timestamp')
})
test('same-episode successive metadata reads keep the latest *preceding* verified BV',()=>{
 const ref='c'.repeat(16),other='BV1abcde1235',at=t+30000;
 const diary=buildLifeTimeline({now:at+1000,days:2,
  lifeDecisions:[{at,mode:'active',action:'inspect_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:at-800,action:'inspect-video',episodeRef:ref,bvid:other,title:'上一条视频'},
   {at:at-200,action:'inspect-video',episodeRef:ref,bvid:BV,title:'本次核验视频'}]})
 assert.equal(diary.find(x=>x.type==='life-read')?.bvid,BV)
 const ambiguous=buildLifeTimeline({now:at+1000,days:2,
  lifeDecisions:[{at,mode:'active',action:'inspect_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:at-200,action:'inspect-video',episodeRef:ref,bvid:other,title:'第一条'},
   {at:at-200,action:'inspect-video',episodeRef:ref,bvid:BV,title:'第二条'}]})
 assert.equal(ambiguous.find(x=>x.type==='life-read'),undefined,'same-millisecond ambiguity must not fabricate association')
})
test('only exact same-episode metadata and verified vision merge into one public diary event',()=>{
 const ref='e'.repeat(16),rows=buildLifeTimeline({now:t+20000,days:3,
  lifeDecisions:[{at:t+100,mode:'active',action:'inspect_exploration',result:'verified-metadata',
    verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:t+80,action:'inspect-video',episodeRef:ref,bvid:BV,title:'测试视频'},
   {at:t+650,action:'observe-video',episodeRef:ref,bvid:BV,frameCount:12,visualSource:'low-resolution-preview',title:'测试视频'}]})
 const matches=rows.filter(x=>x.bvid===BV&&['life-visual','life-read'].includes(x.type))
 assert.equal(matches.length,1)
 assert.equal(matches[0].label,'核验视频资料、并观看了视频画面')
 assert.match(matches[0].detail,/12 个/)
 assert.doesNotMatch(matches[0].detail,/仅核对了/)
})
test('metadata-only diary explains recorded stop reason without inventing a visual receipt',()=>{
 const ref='e'.repeat(16),rows=buildLifeTimeline({now:t+20000,days:3,
  lifeDecisions:[{at:t+100,mode:'active',action:'inspect_exploration',result:'verified-metadata',
   verifiedReadKind:'video-metadata',continuation:ref,continuationResultCode:'fish-chose-rest'}],
  explorationEvidence:[{at:t+80,action:'inspect-video',episodeRef:ref,bvid:BV,title:'仅核验资料'}]})
 const m=rows.find(x=>x.type==='life-read')
 assert.equal(m.label,'核验视频资料')
 assert.match(m.detail,/未继续观察画面的原因：Life 选择先休息/)
 assert.doesNotMatch(m.detail,/仅核对了公开视频资料|这次了解了视频公开资料|不代表已经完整观看或理解画面|画面已核验/)
})
test('metadata-only record without a confirmed stop reason does not invent a reason or show a template disclaimer',()=>{
 const ref='e'.repeat(16),rows=buildLifeTimeline({now:t+20000,days:3,
  lifeDecisions:[{at:t+100,mode:'active',action:'inspect_exploration',result:'verified-metadata',
   verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:t+80,action:'inspect-video',episodeRef:ref,bvid:BV,title:'仅核验资料'}]})
 const m=rows.find(x=>x.type==='life-read')
 assert.equal(m.label,'核验视频资料')
 assert.equal(m.detail,'当前记录缺少有效的续行选择回执，无法追溯当时原因。')
})
test('metadata and verified visual diary describes sampled imagery without speculating on audio or subtitles',()=>{
 const ref='f'.repeat(16),rows=buildLifeTimeline({now:t+20000,days:3,
  lifeDecisions:[{at:t+100,mode:'active',action:'inspect_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref}],
  explorationEvidence:[{at:t+80,action:'inspect-video',episodeRef:ref,bvid:BV,title:'含字幕也可只读图像'},
   {at:t+650,action:'observe-video',episodeRef:ref,bvid:BV,frameCount:24,visualSource:'low-resolution-preview',title:'含字幕也可只读图像'}]})
 const row=rows.find(x=>x.type==='life-read')
 assert.match(row.detail,/24 个 B站低清预览采样画面/)
 assert.doesNotMatch(row.detail,/未听原声|没有字幕|未解码原视频/)
})
test('metadata-only diary renders actual voluntary and technical continuation reason without invented refusal',()=>{
 const ref='f'.repeat(16),base={at:t+100,mode:'active',action:'inspect_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref}
 const evidence=[{at:t+80,action:'inspect-video',episodeRef:ref,bvid:BV,title:'只读资料'}]
 for(const [code,label] of [['fish-chose-prefer-text','想先阅读文字'],['fish-chose-enough-evidence','现有资料已足够'],
   ['no-eligible-action','没有符合条件'],['continuation-not-started','未进入后续画面观察选择'],
   ['target-not-offered','选择了本轮没有提供'],['model-stop-reason-missing','模型没有按要求返回'],
   ['model-nonvisual-reason-missing','没有按要求返回不看画面的原因'],['fish-chose-other-action','更想先做其他探索动作']]){
  const row=buildLifeTimeline({now:t+20000,days:3,lifeDecisions:[{...base,continuationResultCode:code}],
   explorationEvidence:evidence}).find(x=>x.type==='life-read')
  assert.match(row.detail,new RegExp(label))
  assert.doesNotMatch(row.detail,/未听原声|未记录继续观察/)
 }
})
test('real account-scoped decision status exposes only a bounded verified-episode join key and genuine stop reason',()=>{
 const home=mkdtempSync(join(tmpdir(),'dsh-life-timeline-link-'))
 try{
  const account='a'.repeat(16),intentionId='video-intention-test',ref=createHash('sha256')
   .update('life-continuation\0'+intentionId).digest('hex').slice(0,16)
  const events=createLifeAgentEvents({stateDir:home,getAccountTag:()=>account,now:()=>t+100})
  const r=events.recordDecision({action:'inspect_exploration',targetId:intentionId,
   mode:'active',result:'verified-metadata',verifiedReadKind:'video-metadata',
   continuationResultCode:'fish-chose-rest'})
  assert.equal(r.ok,true)
  const row=events.status().timeline[0]
  assert.equal(row.continuation,ref)
  assert.equal(row.continuationResultCode,'fish-chose-rest')
  const diary=buildLifeTimeline({now:t+2000,days:3,lifeDecisions:[row],explorationEvidence:[
   {at:t+50,action:'inspect-video',episodeRef:ref,bvid:BV,title:'有原始视频回执'},
   {at:t+600,action:'observe-video',episodeRef:ref,bvid:BV,frameCount:12,visualSource:'low-resolution-preview',title:'有原始视频回执'}]})
  assert.equal(diary.filter(x=>x.bvid===BV&&['life-read','life-visual'].includes(x.type)).length,1)
  assert.equal(diary.find(x=>x.bvid===BV).label,'核验视频资料、并观看了视频画面')
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('one account round explicitly links selected video, without inventing its time',()=>{
 const rows=buildLifeTimeline({now:t+180000,days:2,watched:[{bvid:BV,day:'2026-11-11',picked:true,roundId:R}],videoRounds:[{ref:A,source:'life-agent',state:'completed',startedAt:t,endedAt:t+60000,pickedCount:1}]})
 const grouped=groupLifeTimeline(rows)
 assert.equal(grouped.chains.length,1)
 assert.deepEqual(grouped.chains[0].rows.map(x=>x.type),['video-round-start','video-round','video'])
 assert.equal(grouped.chains[0].rows[2].dateOnly,true)
 assert.equal(grouped.independent.length,0)
})
test('different round or skipped video must stay separate; timestamp is only recorded when real',()=>{
 const rows=buildLifeTimeline({now:t+180000,days:2,watched:[
   {bvid:BV,day:'2026-11-11',picked:true,roundId:'f'.repeat(24)},
   {bvid:'BV1abcde1235',day:'2026-11-11',picked:false,observedAt:0},
   {bvid:'BV1abcde1236',day:'2026-11-11',picked:true,roundId:R,observedAt:t+20000}],
   videoRounds:[{ref:A,source:'life-agent',state:'completed',startedAt:t,endedAt:t+60000,pickedCount:1}]})
 const grouped=groupLifeTimeline(rows)
 assert.equal(grouped.chains[0].rows.find(x=>x.bvid==='BV1abcde1236').dateOnly,false)
 assert.equal(grouped.independent.filter(x=>x.type==='video').length,2)
})
test('legacy account database remains readable without fictional timestamps',()=>{
 const home=mkdtempSync(join(tmpdir(),'dsh-timeline-'))
 try{
  execFileSync('python',['-c',`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE selected_videos(account TEXT,bvid TEXT,day TEXT,round_id TEXT,status TEXT)');c.execute('CREATE TABLE seen_observations(account TEXT,bvid TEXT,day TEXT,title TEXT,up TEXT,status TEXT)');c.execute('CREATE TABLE comment_receipts(account TEXT,bvid TEXT,rpid TEXT,day TEXT)');c.execute('INSERT INTO selected_videos VALUES (?,?,?,?,?)',('12345','${BV}','2026-11-11','${R}','挑中'));c.commit();c.close()`,join(home,'video-actions.sqlite3')])
  const got=readOwnedVideoLedger({home,uid:'12345'});assert.equal(got.ok,true);assert.equal(got.rows[0].observedAt,0);assert.equal(got.rows[0].roundId,R)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('new schema returns authentic persisted observation time without clock guessing',()=>{
 const home=mkdtempSync(join(tmpdir(),'dsh-timeline-new-'))
 try{
  execFileSync('python',['-c',`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE selected_videos(account TEXT,bvid TEXT,day TEXT,round_id TEXT,status TEXT,recorded_at_ms INTEGER NOT NULL DEFAULT 0)');c.execute('CREATE TABLE seen_observations(account TEXT,bvid TEXT,day TEXT,title TEXT,up TEXT,status TEXT,recorded_at_ms INTEGER NOT NULL DEFAULT 0)');c.execute('CREATE TABLE comment_receipts(account TEXT,bvid TEXT,rpid TEXT,day TEXT)');c.execute('INSERT INTO selected_videos VALUES (?,?,?,?,?,?)',('12345','${BV}','2026-11-11','${R}','挑中',${t}));c.commit();c.close()`,join(home,'video-actions.sqlite3')])
  const got=readOwnedVideoLedger({home,uid:'12345'});assert.equal(got.ok,true);assert.equal(got.rows[0].observedAt,t)
 }finally{rmSync(home,{recursive:true,force:true})}
})
