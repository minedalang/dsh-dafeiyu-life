import test from 'node:test'
import assert from 'node:assert/strict'
import {__test} from '../lib/read-action-execution-gate.mjs'

test('Bilibili dynamic and AV link metadata reads require exact safe identifiers',()=>{
 assert.deepEqual(__test.readToolAction('bili_dynamic_info',{dynamic_id:'1234567890123456'}),
  {operation:'bili_dynamic_info',target:'1234567890123456'})
 assert.deepEqual(__test.readToolAction('bili_video_info_by_aid',{aid:'12345678'}),
  {operation:'bili_video_info_by_aid',target:'12345678'})
 assert.throws(()=>__test.readToolAction('bili_dynamic_info',{dynamic_id:'https://evil.example'}))
 assert.throws(()=>__test.readToolAction('bili_video_info_by_aid',{aid:'0'}))
})
