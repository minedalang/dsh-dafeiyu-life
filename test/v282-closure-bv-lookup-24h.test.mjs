import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const TARGET='BV114WM6FEuE',OTHER='BV1234567890',NOW=Date.parse('2026-11-21T03:00:00Z')
const credential={dedeuserid:'12345678',sessdata:'fixture'},tag=discussionAccountTag(credential)
const temp=fn=>{const dir=mkdtempSync(join(tmpdir(),'v282-bv-recall-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const row=(id,bvid,stage='clear')=>({id,kind:'watch',stage,bvid,summary:'当时看到了几个不同的卡通角色',at:new Date(NOW).toISOString()})

test('owner neural BV exact search indexes clear source identifier, without matching other or faded events',()=>{
  const r=memoryNeuralProjection({episodes:[row('a',TARGET),row('b',OTHER),row('c',TARGET,'fuzzy')],query:TARGET,showAll:true})
  assert.equal(r.matched,1)
  const hit=r.nodes.find(n=>n.matched)
  assert.equal(hit.bvid,TARGET)
  assert.equal(hit.matchType,'keyword')
  assert.equal(r.nodes.find(n=>n.clarity==='fuzzy').bvid,undefined)
  assert.equal(r.nodes.find(n=>n.clarity==='fuzzy').matched,false)
  assert.equal(memoryNeuralProjection({episodes:[row('b',OTHER)],query:TARGET}).matched,0)
})

test('BV lookup can bring a verified older current episode ahead of many recent nonmatches without archived reads',()=>temp(dir=>{
  const memory=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>tag,now:()=>NOW,getConfig:()=>({mainSessionMemoryHalfLifeDays:30}),logger:{warn(){}}})
  try{
    const event=(id,bvid,at)=>({kind:'watch',key:'video-explore:'+id,bvid,title:'未包含 BV 的标题',at,accountTag:tag,
      experience:{source:'bili-life',metadata:true,evidenceSchema:'life-video-evidence/v1',vision:true,
        visualReceipt:{source:'low-resolution-preview',frameCount:2},visualSceneNotes:['这是已验证的少量画面笔记']}})
    const events=[event('target',TARGET,NOW-800_000)]
    for(let i=0;i<90;i++)events.push(event('other-'+i,'BV'+String(i).padStart(10,'0'),NOW-90_000+i*800))
    assert.equal(memory.recordEvents(events).added,91)
    const noQuery=memory.semanticCandidates({query:'',role:'owner',domain:'main-session',limit:8,kinds:['watch']})
    assert.ok(!noQuery.some(x=>x.bvid===TARGET),'older BV is beyond the normal graph cap')
    const withQuery=memory.semanticCandidates({query:TARGET,role:'owner',domain:'main-session',limit:8,kinds:['watch']})
    assert.equal(withQuery[0]?.bvid,TARGET,'real current Gateway search retrieves older precise BV')
    const g=memoryNeuralProjection({episodes:withQuery,query:TARGET,showAll:true})
    assert.equal(g.nodes[0].bvid,TARGET)
    assert.equal(g.matched,1)
  }finally{memory.close()}
}))

test('verified full visual proof protects one account and BV for 24h, then returns to clear-memory authority',()=>temp(dir=>{
  let now=NOW
  const life=createLifeOpportunities({stateDir:dir,getCredential:()=>credential,getAccountTag:()=>tag,now:()=>now})
  const proof={ok:true,bvid:TARGET,depth:'standard',frameCount:12,source:'low-resolution-preview'}
  assert.equal(life.rememberVerifiedVideoVisual(proof,tag).recorded,true)
  now=NOW+23*60*60_000+59*60_000
  assert.equal(life.hasVerifiedVideoVisual(TARGET,tag),true)
  assert.equal(life.hasVerifiedVideoVisual(OTHER,tag),false)
  assert.equal(life.hasVerifiedVideoVisual(TARGET,'f'.repeat(16)),false)
  now=NOW+24*60*60_000
  assert.equal(life.hasVerifiedVideoVisual(TARGET,tag),false)
}))

test('Embedding is optional for Life recall; neural graph search stays disabled until ready',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const retriever=readFileSync(new URL('../lib/memory-retriever.mjs',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(index,/本地语义回忆未启动，继续使用原有词法回忆/)
  assert.match(retriever,/if\(!semanticAvailable\(\)\)return fallback/)
  assert.match(ui,/mask\.hidden=ready===true/)
  assert.match(ui,/if\(!localEmbeddingEnabled\)\{void refreshNeuralActivation\(\);return\}/)
  assert.doesNotMatch(ui,/\$\('main-session-history-(?:query|search)'\)\.disabled=ready!==true/)
  assert.match(index,/const exactVideoQuery=\/\^BV\[0-9A-Za-z\]\{10\}\$\//)
})
