import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {watchedEvent} from '../lib/main-session-bridge.mjs'
import {explainCommentSelection} from '../lib/video-owned-ledger.mjs'

const BV='BV14kWt6DE6H',ROUND='0123456789abcdef01234567',DAY='2026-11-11'
const stamp=new Date('2026-11-11T10:03:11+08:00').getTime()

test('评论登记细分账本异常、旧选片、跨轮次，不通过猜测绕过发送门禁',()=>{
  const good={ok:true,rows:[{bvid:BV,picked:true,roundId:ROUND}]}
  assert.deepEqual(explainCommentSelection(good,BV,ROUND),{ok:true})
  assert.equal(explainCommentSelection({ok:false,rows:[]},BV,ROUND).reason,'comment-selection-ledger-unavailable')
  assert.equal(explainCommentSelection(good,BV,ROUND,{previouslyPicked:true}).reason,'comment-selection-preexisting')
  assert.equal(explainCommentSelection(good,BV,'fedcba987654321001234567').reason,'comment-selection-round-mismatch')
  assert.equal(explainCommentSelection({ok:true,rows:[]},BV,ROUND).reason,'comment-selection-not-confirmed')
  assert.equal(explainCommentSelection(good,BV,'bad').reason,'comment-review-not-current')
})

test('新入选保留来自当前账号 SQLite 的确切记账时间，旧记录仅有日期',()=>{
  const current=watchedEvent({day:DAY,observedAt:stamp,bvid:BV,title:'真实中文标题',picked:true,autonomousSelected:true})
  assert.equal(current?.time,new Date(stamp).toISOString())
  const legacy=watchedEvent({day:DAY,observedAt:0,bvid:BV,title:'只有日期',picked:true})
  assert.equal(legacy?.time,DAY)
  // A timestamp from another day must NOT be reattributed to this date.
  assert.equal(watchedEvent({day:DAY,observedAt:stamp-86400_000,bvid:BV,picked:true}).time,DAY)
})

test('过去的日期锚点展示为日期未知时刻；已经存储乱码不污染展示，也不恢复遗忘',()=>{
  const home=mkdtempSync(join(tmpdir(),'dsh-dev64-episodes-'))
  try{
    mkdirSync(join(home,'life-memory'))
    const legacyAt=Date.parse('2026-11-11T00:00:00Z')
    const data={version:1,episodes:[
      {id:'bad',key:`watch:${DAY}:${BV}`,kind:'watch',stage:'clear',at:legacyAt,
        text:'我曾经选中视频《���Day 1����》',bvid:BV,importance:0.6,reinforcedAt:legacyAt},
      {id:'good',key:`watch:${DAY}:BV1msWM6hEzB`,kind:'watch',stage:'clear',at:legacyAt,
        text:'我曾经选中视频《正常中文》',bvid:'BV1msWM6hEzB',importance:0.6,reinforcedAt:legacyAt},
    ],archiveKeys:[],migrated:true,updatedAt:legacyAt}
    writeFileSync(join(home,'life-memory','episodic.json'),JSON.stringify(data))
    const mem=createLifeMemoryGateway({dataDir:home,now:()=>Date.parse('2026-11-11T12:00:00Z'),getConfig:()=>({})})
    const rows=mem.recall({domain:'main-session',kinds:['watch'],maxItems:10,maxChars:3000})
    assert.equal(rows.length,2)
    for(const x of rows){assert.equal(x.dateOnly,true);assert.equal(x.day,DAY)}
    const broken=rows.find(x=>x.bvid===BV)
    assert.equal(broken.titleCorrupted,true)
    assert.match(broken.summary,/编码已损坏/)
    assert.doesNotMatch(broken.summary,/�/)
    assert.equal(rows.find(x=>x.bvid==='BV1msWM6hEzB').summary,'我曾经选中视频《正常中文》')
    // Don't alter persisted memory or read the permanent archive to reconstruct a title.
    const source=JSON.parse(readFileSync(join(home,'life-memory','episodic.json'),'utf8'))
    assert.match(source.episodes[0].text,/�/)
  }finally{rmSync(home,{recursive:true,force:true})}
})
