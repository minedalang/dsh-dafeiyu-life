import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'

const A='1111111111111111',B='2222222222222222',BV='BV1234567890',OTHER='BV0987654321'
const DAY=86400000, start=Date.parse('2026-11-18T12:00:00Z')
const fake=(key,{bvid=BV,tag=A,at=start,source='bili-life',visual=false,schema='life-video-evidence/v1'}={})=>({
  kind:'watch',key:`video-explore:${key}`,bvid,title:'主流 AI 娘介绍',at,accountTag:tag,
  experience:{source,metadata:true,subtitle:!visual,preview:visual,vision:visual,
    evidenceSchema:schema,comments:visual?2:0,danmaku:0,
    ...(visual?{visualReceipt:{source:'low-resolution-preview',frameCount:2,firstAtMs:1000,lastAtMs:9000},
      visualSceneNotes:['描述中出现蓝天与草地']}:{}),purpose:'Life 自主选择'}})
const setup=()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-282-video-ref-'));let at=start
 const gateway=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A,now:()=>at,
   getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
 return {dir,gateway,setNow:v=>at=v,close:()=>{gateway.close();rmSync(dir,{recursive:true,force:true})}}
}

test('dev.4 仅当前账号清晰经历可按 BV 查询；不同轮次有独立 memoryId，不因同 BV 合并',()=>{
 const s=setup();try{
  s.setNow(start+5000)
  assert.equal(s.gateway.recordEvents([fake('metadata-only'),fake('real-frame',{at:start+5000,visual:true}),
    fake('another-account',{tag:B,visual:true}),fake('other-bv',{bvid:OTHER}),
    fake('old-accountless',{tag:''}),fake('private-owner',{source:'main-session',visual:true})]).added,6)
  const rows=s.gateway.videoEvidenceTrace({accountTag:A,bvid:BV})
  assert.equal(rows.length,2)
  assert.notEqual(rows[0].memoryId,rows[1].memoryId)
  assert.equal(rows[0].at,start+5000)
  assert.ok(rows[0].sources.includes('visual-model-observation'))
  assert.ok(rows[0].sources.includes('preview-frames'))
  assert.ok(rows[0].sources.includes('public-comments'))
  assert.deepEqual(rows[0].visual,{source:'low-resolution-preview',frameCount:2,firstAtMs:1000,
    lastAtMs:9000,certainty:'sampled-model-observation-not-full-playback'})
  assert.deepEqual(rows[1].sources,['metadata','subtitle'])
  assert.equal('visual' in rows[1],false,'只读元数据/字幕不能冒充看过画面')
  assert.ok(rows.every(x=>x.detailStorage==='no-detail'&&x.readOnly))
  assert.equal(s.gateway.videoEvidenceTrace({accountTag:A,memoryId:rows[1].memoryId}).length,1)
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A,memoryId:rows[1].memoryId,bvid:OTHER}),[])
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:B,bvid:BV}),[])
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A,bvid:'not-bv'}),[])
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A}),[])
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A,memoryId:'../../../archive'}),[])
  const json=JSON.stringify(rows)
  assert.ok(!json.includes('描述中出现蓝天'))
  assert.ok(!json.includes('主流 AI 娘介绍'))
  assert.ok(!json.includes('source:main-session'))
 }finally{s.close()}
})

test('dev.4 过期后当前来源和视觉信息均不可读；不能通过永久归档或旧账号反查',()=>{
 const s=setup();try{
  s.gateway.recordEvents([fake('before-fade',{visual:true}),fake('other-account',{tag:B,visual:true})])
  const rows=s.gateway.videoEvidenceTrace({accountTag:A,bvid:BV});assert.equal(rows.length,1)
  const ref=rows[0].memoryId
  s.setNow(start+14*DAY)
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A,bvid:BV}),[])
  assert.deepEqual(s.gateway.videoEvidenceTrace({accountTag:A,memoryId:ref}),[])
  const persisted=JSON.parse(readFileSync(join(s.dir,'life-memory','episodic.json'),'utf8'))
  const row=persisted.episodes.find(x=>x.id===ref)
  assert.notEqual(row.stage,'clear')
  assert.equal(row.visualMemo,undefined)
  assert.equal(row.readEvidenceKinds,undefined)
  assert.equal(row.bvid,undefined)
  // This is an intentionally archive-independent lookup: the archive is still
  // present for admin audit but may never reconstruct faded details at runtime.
  assert.match(readFileSync(join(s.dir,'life-memory','archive','2026-11.jsonl'),'utf8'),/video-explore/)
 }finally{s.close()}
})

test('dev.4 真实事件构造入口只把已获元数据转换为当前存活记忆的来源类别',()=>{
 const s=setup();try{
  const event=buildVideoExplorationEvent({bvid:BV,info:{ok:true,bvid:BV,title:'一条真实公开作品'},
    operationId:'operation-282-verified-read',accountTag:A,at:start})
  assert.ok(event)
  assert.equal(event.experience.evidenceSchema,'life-video-evidence/v1')
  assert.equal(s.gateway.recordEvents([event]).added,1)
  const rows=s.gateway.videoEvidenceTrace({accountTag:A,bvid:BV})
  assert.equal(rows.length,1)
  assert.deepEqual(rows[0].sources,['metadata'])
  assert.equal(rows[0].visual,undefined)
 }finally{s.close()}
})

test('dev.4 旧来源不伪造可信视觉凭据，未来深层详情不被当前实现创建',()=>{
 const s=setup();try{
  s.gateway.recordEvents([fake('legacy',{schema:'legacy-schema'}),
    {...fake('no-visual-receipt'),key:'video-explore:no-visual-receipt',experience:{
      source:'bili-life',metadata:true,vision:true,evidenceSchema:'life-video-evidence/v1'}}])
  const rows=s.gateway.videoEvidenceTrace({accountTag:A,bvid:BV})
  assert.equal(rows.length,2)
  assert.deepEqual(rows.find(x=>x.sources.length===0)?.sources,[])
  assert.ok(rows.every(x=>!('visual' in x)))
  assert.ok(!rows.some(x=>x.sources.includes('visual-model-observation')))
  const files=JSON.stringify(readFileSync(join(s.dir,'life-memory','episodic.json'),'utf8'))
  assert.ok(!files.includes('deepMemory')&&!files.includes('detailFragments'))
 }finally{s.close()}
})

test('未来设计明确推迟，2.8.3 现行范围与发布门禁分离',()=>{
 const roadmap=readFileSync(new URL('../docs/ROADMAP.md',import.meta.url),'utf8')
 const proposal=readFileSync(new URL('../docs/architecture/future-layered-memory-progressive-recall-proposal.md',import.meta.url),'utf8')
 assert.match(roadmap,/待单独排期（2\.8\.2 之后）/)
 assert.match(roadmap,/2\.8\.3 的实际实现及未完成验收/)
 assert.match(readFileSync(new URL('../docs/release/2.8.3-release-checklist.md',import.meta.url),'utf8'),/releaseReady:false|releaseReady:true/)
 for(const name of ['2.9.0','通用深浅分层回忆','仅静态预告页，真实 API 未实施'])assert.ok(roadmap.includes(name))
 for(const name of ['渐进式回忆协议','清晰度','遗忘','隐私','迁移','实施阶段','2.8.2 已有的前置适配与 2.8.3 边界'])assert.ok(proposal.includes(name))
 assert.match(proposal,/深层读取适配在 dev\.2 仅提供受限内部接口，尚未接入正常 Life 聊天或自主补看/)
})


test('partial memory survives restart in existing fading row; exact public gap only; no full proof or deep attachment; archive redacted and revocation survives restore',async()=>{
 const {proposeVideoRecallFollowup,validateVideoRecallGap}=await import('../lib/video-moment-followup.mjs')
 const s=setup();let reloaded
 try{
  const event={...fake('partial-live'),autonomousSelected:true,experience:{...fake('partial-live').experience,vision:false,partialVisualReceipt:{source:'low-resolution-preview',sampledTimesMs:[1000,2000,3000],describedTimesMs:[1000,3000],notes:['画面可见绿色草地和小鸟'],interpretation:'partial-model-observation-not-semantic-proof'}}}
  assert.equal(s.gateway.recordEvents([event]).added,1)
  assert.equal(s.gateway.recordEvents([event]).added,0)
  const path=join(s.dir,'life-memory','episodic.json'),snapshot=readFileSync(path,'utf8')
  const row=JSON.parse(snapshot).episodes[0],id=row.id
  assert.ok(row.text.includes('2/3'));assert.ok(row.text.includes('缺口2秒'));assert.ok(row.text.includes('绿色草地'))
  assert.equal(row.visualMemo,undefined);assert.ok(!row.readEvidenceKinds.includes('visual-model-observation'))
  assert.ok(!readFileSync(join(s.dir,'life-memory','archive','2026-11.jsonl'),'utf8').includes('绿色草地'))
  assert.ok(!readFileSync(join(s.dir,'life-memory','archive','2026-11.jsonl'),'utf8').includes('partialVisualReceipt'))
  reloaded=createLifeMemoryGateway({dataDir:s.dir,getAccountTag:()=>A,now:()=>start,getConfig:()=>({mainSessionMemoryHalfLifeDays:15}),logger:{warn(){}}})
  assert.ok(reloaded.recall({query:BV})[0].summary.includes('2/3'))
  assert.deepEqual(reloaded.videoEvidenceTrace({accountTag:A,bvid:BV,visualOnly:true}),[])
  assert.equal(reloaded.memoryDetailInfo({memoryId:id,accountTag:A}).available,false)
  const sel={accountTag:A,bvid:BV,memoryId:id,startMs:2000,endMs:2000}
  const trace=reloaded.partialVideoGapTrace(sel),result=reloaded.recallVideoDetails({...sel,visibility:'public-event'})
  assert.equal(trace.length,1);assert.equal(result.reason,'no-detail')
  const candidate=proposeVideoRecallFollowup({bvid:BV,startMs:2000,endMs:2000,trace,result})
  assert.equal(candidate.args.at_seconds,2);assert.equal(candidate.args.recall_memory_id,id)
  assert.equal(validateVideoRecallGap({bvid:BV,memoryId:id,startMs:2000,endMs:2000,atSeconds:2,trace,result}),true)
  assert.equal(validateVideoRecallGap({bvid:BV,memoryId:id,startMs:2000,endMs:2000,atSeconds:3,trace,result}),false)
  for(const changed of [{accountTag:B},{bvid:OTHER},{startMs:1000,endMs:1000},{endMs:3000},{memoryId:'e-'+'f'.repeat(18)}])assert.deepEqual(reloaded.partialVideoGapTrace({...sel,...changed}),[])
  const privateEvent={...event,key:'video-explore:partial-private',bvid:OTHER,experience:{...event.experience,source:'main-session'}}
  reloaded.recordEvents([privateEvent]);assert.deepEqual(reloaded.partialVideoGapTrace({...sel,bvid:OTHER,memoryId:''}),[])
  const other={...event,key:'video-explore:partial-second',experience:{...event.experience,partialVisualReceipt:{...event.experience.partialVisualReceipt,describedTimesMs:[2000]}}}
  reloaded.recordEvents([other]);assert.deepEqual(reloaded.partialVideoGapTrace(sel),[])
  reloaded.close();reloaded=null
  s.setNow(start+14*DAY);assert.deepEqual(s.gateway.partialVideoGapTrace(sel),[])
  assert.equal(JSON.parse(readFileSync(path,'utf8')).episodes.find(e=>e.id===id).partialVisualMemo,undefined)
  writeFileSync(path,snapshot,'utf8') // simulate restoring the older shallow snapshot only
  s.setNow(start);assert.deepEqual(s.gateway.partialVideoGapTrace(sel),[])
  assert.ok(!JSON.stringify(s.gateway.recall({query:BV})).includes('绿色草地'))
  const blank=JSON.parse(snapshot);blank.episodes=[];blank.archiveKeys=[];writeFileSync(path,JSON.stringify(blank),'utf8')
  assert.equal(s.gateway.recordEvents([event]).added,0,'revoked event must not be re-admitted from an old outbox')
 }finally{reloaded?.close();s.close()}
})

test('malformed partial event cannot add coverage or a new full proof',()=>{
 const s=setup();try{
  const p={source:'low-resolution-preview',sampledTimesMs:[1000,2000],describedTimesMs:[3000],notes:['不应存储的局部正文'],interpretation:'partial-model-observation-not-semantic-proof'}
  const event={...fake('partial-malformed'),autonomousSelected:true,experience:{...fake('partial-malformed').experience,partialVisualReceipt:p}}
  assert.equal(s.gateway.recordEvents([event]).added,1)
  const row=JSON.parse(readFileSync(join(s.dir,'life-memory','episodic.json'),'utf8')).episodes[0]
  assert.equal(row.partialVisualMemo,undefined);assert.equal(row.visualMemo,undefined)
  assert.ok(!row.text.includes('不应存储'))
 }finally{s.close()}
})
