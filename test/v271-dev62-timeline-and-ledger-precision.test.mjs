import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {readOwnedVideoLedger} from '../lib/video-owned-ledger.mjs'
import {buildLifeTimeline,groupLifeTimeline} from '../lib/life-timeline.mjs'
const A='abcdefabcdef',R=A+'1234567890ab',BV='BV1abcde1234',t=Date.parse('2026-11-11T09:00:00Z')
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
