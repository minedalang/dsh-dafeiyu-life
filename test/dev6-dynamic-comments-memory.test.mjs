import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway,__test} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {contentRef,contentUrl,validDynamicId,validCommentId} from '../lib/bili-content-ref.mjs'
import {createBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
const start=Date.parse('2026-11-01T06:00:00Z'),DAY=86400000
const createHome=()=>mkdtempSync(join(tmpdir(),'dsh-dev6-dynamic-'))
const event={kind:'comment',contentType:'dynamic',dynamicId:'1264976926524571648',reply:true,text:'宿傩君，五条悟像开了外挂',rpid:'12649769265245716480',key:'comment:dynamic:1264976926524571648:12649769265245716480',time:new Date(start).toISOString()}

test('typed dynamic id and comment rpid stay strings above 2^53, never confused with BV',()=>{
 assert.deepEqual(contentRef(event),{type:'dynamic',id:event.dynamicId,dynamicId:event.dynamicId})
 assert.equal(contentUrl(contentRef(event)),'https://t.bilibili.com/1264976926524571648')
 assert.equal(validDynamicId(event.dynamicId),true)
 assert.equal(validCommentId(event.rpid),true)
 assert.equal(contentRef({dynamicId:event.dynamicId,bvid:'BV1ab2cd3ef4'}),null)
 assert.equal(contentRef({bvid:event.dynamicId}),null)
 assert.equal(contentRef({dynamicId:'1e18'}),null)
 assert.equal(contentRef({dynamicId:'1264976926524571648.0'}),null)
})

test('dynamic comment enters fading life memory; same receipt deduplicates; different media IDs isolate',()=>{
 const home=createHome();let clock=start;const gate=createLifeMemoryGateway({dataDir:home,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15})})
 try{
  assert.equal(gate.recordEvents([event]).added,1)
  assert.equal(gate.recordEvents([event]).added,0)
  assert.equal(gate.recordEvents([{...event,bvid:'BV1ab2cd3ef4'}]).added,0)
  assert.equal(gate.recordEvents([{...event,dynamicId:'not-an-id',key:'x'}]).added,0)
  const original=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.equal(original.bvid,'')
  assert.equal(original.contentType,'dynamic')
  assert.equal(original.dynamicId,event.dynamicId)
  assert.match(original.text,/一条动态/)
  assert.equal(gate.reflectionEvidence([event.key]).length,1)
  assert.equal(gate.reflectionEvidence([event.key])[0].dynamicId,event.dynamicId)
  assert.equal(gate.semanticCandidates({query:'宿傩君'}).some(x=>x.dynamicId===event.dynamicId),true)
  clock+=15*DAY
  gate.decay()
  const faded=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.notEqual(faded.stage,'clear')
  assert.equal(Object.hasOwn(faded,'dynamicId'),false)
  assert.equal(Object.hasOwn(faded,'contentType'),false)
  assert.equal(Object.hasOwn(faded,'key'),false)
  assert.equal(gate.reflectionEvidence([event.key]).some(x=>x.dynamicId===event.dynamicId),false)
  assert.equal(gate.semanticCandidates({query:'宿傩君'}).some(x=>x.dynamicId===event.dynamicId),false)
  clock+=100*DAY
  gate.decay()
  assert.equal(gate.reflectionEvidence([event.key]).length,0)
  assert.equal(gate.recall({query:event.dynamicId}).length,0)
 }finally{gate.close();rmSync(home,{recursive:true,force:true})}
})

test('dynamic comment creates reflection candidate; reflection uses only current fading memory evidence',()=>{
 const home=createHome();let clock=start
 const gateway=createLifeMemoryGateway({dataDir:home,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15})})
 const reflection=createLifeReflection({dataDir:home,now:()=>clock,getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true}),
  memoryGateway:gateway,invokeModel:async()=>'{"memories":[],"note":"无重要领悟"}',commitMemories:async()=>({ok:true})})
 try {
  gateway.recordEvents([event])
  const candidate=reflection.addEvents([event]);assert.equal(candidate.added,1)
  const rows=JSON.parse(readFileSync(join(home,'life-memory','candidates.json'),'utf8')).candidates
  assert.equal(rows.length,1)
  assert.equal(rows[0].dynamicId,event.dynamicId)
  assert.equal(rows[0].bvid,'')
  assert.equal(rows[0].contentType,'dynamic')
 }finally{reflection.stop?.();gateway.close();rmSync(home,{recursive:true,force:true})}
})

test('manual reply is gated; Python validates actual dynamic type/oid, comments and receipts',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(host,/name:'bili_dynamic_comment_context'/)
 assert.match(host,/name:'bili_dynamic_comment_manual'/)
 assert.match(host,/const gate=sessionManualGate\(args,'动态评论'\)/)
 assert.match(host,/lifeMemoryCoordinator\?\.recordEvents\(\[e\],\{reflect:true\}\)/)
 assert.match(host,/validCommentId\(result\.sentRpid\)/)
 assert.match(python,/_get_dynamic_comment_area\(did,cred\)/)
 assert.match(python,/await _find_dynamic_target\(area,cred,target_rpid,root\)/)
 assert.match(python,/comment\.send_comment\(/)
 assert.match(python,/_claim_session_manual_action\(uid,'comment'/)
 assert.match(python,/_finish_session_manual_action\(uid,'comment'/)
 assert.match(python,/no_retry.*True/)
 assert.doesNotMatch(python,/int\(dynamic_id\).*\.get_comments/)
})


test('portable backup can carry public dynamic receipt, but restoring an old clear snapshot cannot reanimate a faded dynamic id',()=>{
 const home=createHome();let clock=start
 const gate=createLifeMemoryGateway({dataDir:home,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15})})
 try {
  gate.recordEvents([event])
  const backup=createBackup({root:home,config:{},sqlite:{}})
  const saved=JSON.parse(backup.files['life-memory/episodic.json']).episodes[0]
  assert.equal(saved.dynamicId,event.dynamicId)
  clock+=16*DAY;gate.decay()
  restoreBackupFiles(home,backup)
  const restored=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.notEqual(restored.stage,'clear')
  assert.equal('dynamicId' in restored,false)
  assert.equal(gate.semanticCandidates({query:event.dynamicId}).some(e=>e.dynamicId===event.dynamicId),false)
 }finally{gate.close();rmSync(home,{recursive:true,force:true})}
})
