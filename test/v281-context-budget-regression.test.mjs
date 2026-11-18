import test from 'node:test'
import assert from 'node:assert/strict'
import {boundedJson,boundedText,boundedTranscript} from '../lib/context-budget.mjs'

test('JSON context always stays parseable, bounded, and retains recent evidence',()=>{
 const input={bvid:'BV1234567890',events:Array.from({length:18},(_,i)=>({id:String(i),source:'video',text:'片段 '+i+' '+('字幕画面'.repeat(90))}))}
 const out=boundedJson(input,900)
 assert.ok(out.length<=900)
 const obj=JSON.parse(out)
 assert.equal(obj.bvid,'BV1234567890')
 assert.ok(obj.events.some(x=>x.id==='17'))
 assert.match(out,/省略|片段/)
 assert.equal(input.events.length,18)
})
test('multi-candidate contexts do not completely drop later IDs in favor of first',()=>{
 const original=Object.fromEntries(Array.from({length:6},(_,i)=>['q'+i,{id:'q'+i,verified:true,description:('场景'+i).repeat(160)}]))
 const obj=JSON.parse(boundedJson(original,1800))
 assert.equal(Object.keys(obj).length,6)
 for(let i=0;i<6;i++)assert.equal(obj['q'+i].id,'q'+i)
})
test('transcript truncation includes beginning, center, ending and an explicit gap',()=>{
 const raw='开头'.repeat(4000)+'中段特殊记忆'.repeat(2500)+'结尾'.repeat(4000)
 const out=boundedTranscript(raw,12000)
 assert.ok(out.truncated)
 assert.equal(out.selection,'beginning-middle-end')
 assert.ok(out.text.length<=12000)
 assert.match(out.text,/开头/)
 assert.match(out.text,/中段特殊记忆/)
 assert.match(out.text,/结尾/)
 assert.match(out.text,/已省略/)
 assert.equal(raw.length,out.originalChars)
})
test('short contexts remain byte-for-byte unchanged',()=>{
 assert.equal(boundedJson({hello:'world'},200),'{"hello":"world"}')
 assert.equal(boundedText('hi',8),'hi')
 assert.deepEqual(boundedTranscript('short',100),{text:'short',truncated:false,originalChars:5,selection:'complete'})
})

import {spawnSync} from 'node:child_process'
test('automated guard rejects broken serialized JSON prompt truncation',()=>{
  const result=spawnSync(process.execPath,['scripts/check-context-budget.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'})
  assert.equal(result.status,0,result.stderr||result.stdout)
  assert.match(result.stdout,/Context budget shape check PASS/)
})
