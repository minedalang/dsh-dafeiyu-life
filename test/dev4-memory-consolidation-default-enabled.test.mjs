import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createMemoryConsolidator} from '../lib/memory-consolidation.mjs'
const src=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('新安装默认开启整理：Schema 与运行时 DEFAULTS 必须同时声明，管理页面不得标为默认关闭',()=>{
 const index=src('index.js')
 assert.match(index,/mainSessionMemoryConsolidationEnabled:\s*z\.boolean\(\)\.default\(true\)/)
 assert.match(index,/mainSessionMemoryConsolidationEnabled:\s*true,\s*mainSessionMemoryFactsMax:/)
 assert.match(index,/Object\.keys\(DEFAULTS\)/,'运行时应以统一默认配置表解析新旧设置')
 const ui=src('lib/management-console.html')
 assert.match(ui,/主人聊天记忆整理（新安装默认开启）/)
 assert.match(ui,/id="main-memory-consolidation-enabled" checked\/>/)
 assert.match(src('lib/management-console.js'),/mainSessionMemoryConsolidationEnabled===true/)
 assert.match(src('lib/management-console.js'),/mainSessionMemoryConsolidationEnabled:\$\('main-memory-consolidation-enabled'\)\.checked/,'保存设置必须包含该开关')
})

test('允许已设置关闭的旧用户维持关闭；默认开启也不得无条件调用模型',async()=>{
 let modelCalls=0
 const samples=[{id:'1',source:'main-session-ai',importance:.5,text:'喜欢独立游戏',createdAt:'2026-01-01'}]
 const make=enabled=>createMemoryConsolidator({getMemories:()=>samples,commit:()=>({ok:true}),
   invokeModel:async()=>{modelCalls++;return JSON.stringify({skip:true})},
   getConfig:()=>({mainSessionMemoryConsolidationEnabled:enabled})})
 const enabled=make(true)
 assert.equal(enabled.status().enabled,true)
 assert.equal((await enabled.run()).skipped,'no-work')
 assert.equal(modelCalls,0)
 const disabled=make(false)
 assert.equal(disabled.status().enabled,false)
 assert.equal((await disabled.run()).reason,'disabled')
 assert.equal(modelCalls,0)
})
