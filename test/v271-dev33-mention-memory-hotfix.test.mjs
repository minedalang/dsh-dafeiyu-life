import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'

const BV='BV17x411w7KC',T0=Date.parse('2026-11-08T11:22:53+08:00')
const marker='对方原评论（含@昵称，昵称边界不明确，不能把昵称当正文）：@大肥鱼怒了看看'
const event={kind:'social',key:`social:485221842:${BV}:45122`,actorUid:'485221842',bvid:BV,text:marker,at:T0}
const make=fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-at-memory-repair-'));try{fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const getConfig=()=>({mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.1})

test('late retry of older @ parser warning never enters the fresh Life episode as a quote',()=>make(dir=>{
 const gate=createLifeMemoryGateway({dataDir:dir,now:()=>T0,getConfig})
 gate.recordEvents([event])
 const rows=gate.recall({query:'',domain:'main-session'})
 assert.equal(rows.length,1)
 assert.match(rows[0].summary,/收到过一条真实的@提及/)
 assert.doesNotMatch(rows[0].summary,/怒了|原评论|对方当时说/)
 const raw=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
 assert.equal(raw.incomingText,'')
 gate.close()
}))

test('existing clear Life memory is safely corrected, preserving independently verified reply',()=>make(dir=>{
 const removed=[]
 const gate=createLifeMemoryGateway({dataDir:dir,now:()=>T0,getConfig,onEpisodesRemoved:(ids,meta)=>removed.push({ids,reason:meta.reason})})
 gate.recordEvents([{...event,text:'实际起初已核验的普通文本'}])
 const data=JSON.parse(readFileSync(gate.file,'utf8'))
 const e=data.episodes[0]
 e.text=`我曾经在评论区与一位观众交谈，对方当时说“${marker}”；我当时回复“没怒啊，我在磨针呢，一天磨一点”`
 e.incomingText=marker;e.confirmedReply=true
 writeFileSync(gate.file,JSON.stringify(data))
 const result=gate.recall({query:'',domain:'main-session',maxChars:1200})
 assert.equal(result.length,1)
 assert.match(result[0].summary,/收到过一条真实的@提及/)
 assert.match(result[0].summary,/我当时回复“没怒啊，我在磨针呢，一天磨一点”/)
 assert.doesNotMatch(result[0].summary,/原评论|怒了看看|对方当时说/)
 const after=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
 assert.equal(after.incomingText,'')
 assert.equal(after.id,e.id);assert.equal(after.at,e.at);assert.equal(after.stage,'clear')
 assert.deepEqual(removed,[{ids:[e.id],reason:'source-correction'}])
 gate.recall({query:'',domain:'main-session'})
 assert.equal(removed.length,1,'纠错必须幂等，不能每次重做')
 gate.close()
}))

test('correction cannot resurrect a social detail already forgotten',()=>make(dir=>{
 const clock={now:T0};const gate=createLifeMemoryGateway({dataDir:dir,now:()=>clock.now,getConfig})
 gate.recordEvents([event]);clock.now+=365*86400000
 gate.decay()
 assert.deepEqual(gate.recall({query:'怒了',domain:'main-session'}),[])
 const after=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
 assert.equal(after.stage,'forgotten')
 assert.equal(after.incomingText,undefined)
 gate.close()
}))
