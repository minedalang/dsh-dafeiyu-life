import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
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
  assert.ok(rows.every(x=>x.detailStorage==='not-implemented'&&x.readOnly))
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

test('dev.4 未来设计明确推迟，当前 2.8.2 保留真实发布门禁',()=>{
 const roadmap=readFileSync(new URL('../docs/ROADMAP.md',import.meta.url),'utf8')
 const proposal=readFileSync(new URL('../docs/architecture/future-layered-memory-progressive-recall-proposal.md',import.meta.url),'utf8')
 assert.match(roadmap,/待单独排期（2\.8\.2 之后）/)
 assert.match(roadmap,/2\.8\.2 目前仍待正式发布的门禁与验收/)
 for(const name of ['2.9.0','通用浅层／深层回忆机制','仅静态预告页，真实 API 未实施'])assert.ok(roadmap.includes(name))
 for(const name of ['渐进式回忆协议','清晰度','遗忘','隐私','迁移','实施阶段','2.8.2 已有的前置适配与 2.8.3 边界'])assert.ok(proposal.includes(name))
 assert.match(proposal,/后两项\*\*目前不存在\*\*/)
})
