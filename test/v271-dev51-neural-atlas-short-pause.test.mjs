import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
import {memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
import {createEmbeddingMemoryIndex} from '../lib/embedding-memory-index.mjs'

const scope='1234567890abcdef'
const at=()=>new Date('2026-11-10T12:00:00').getTime()
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev51-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function shortPauseHarness(dir,{choice='act',seconds=90,onDecide=()=>{}}={}){
  let t=at(),requests=0,decisions=0,receipts=[]
  const handlers=new Map(),calls=[]
  const agent={id:'main',status:'idle',followup:async message=>{requests++;calls.push(message)},ctx:{on:(event,fn)=>{handlers.set(event,fn);return ()=>handlers.delete(event)}}}
  const cfg={masterEnabled:true,lifeAgentMode:'active',mainSessionBridgeEnabled:true,mainSessionId:'main',mainSessionShortPauseEnabled:true,
    mainSessionShortPauseSeconds:seconds,ownerContactPreset:'natural',ownerSpontaneousChatEnabled:false}
  const bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:()=>cfg,
    getAccountTag:()=>scope,getWatched:()=>[],getComments:()=>({rows:[]}),now:()=>t,
    shouldShortPause:async()=>{decisions++;await onDecide({handlers});return {ok:choice==='act',action:choice,settle:status=>receipts.push(status)}},logger:{warn(){}}})
  bridge.shortPauseReadiness()
  const incoming=id=>handlers.get('agent/inbox/inserted')({message:{role:'user',id,source:{kind:'dsh-chat'}}})
  const answered=()=>handlers.get('session/event')(null,{type:'assistant/message'})
  return {bridge,cfg,calls,agent,incoming,answered,receipts,tick:delta=>{t+=delta},get callsMade(){return requests},get decisions(){return decisions}}
}

test('short pause is NOT life long-idle outreach: 90 seconds, once, and no shared 4h/daily contact quota',async()=>withDir(async dir=>{
 const h=shortPauseHarness(dir)
 assert.equal(h.bridge.shortPauseReadiness().reason,'no-completed-owner-turn')
 h.incoming('human-turn-1');h.answered();h.tick(89_000)
 assert.equal(h.bridge.shortPauseReadiness().reason,'waiting-for-brief-pause')
 h.tick(1000)
 assert.equal(h.bridge.shortPauseReadiness().eligible,true)
 const r=await h.bridge.considerShortPause()
 assert.equal(r.ok,true);assert.equal(r.queued,true);assert.equal(r.delivered,false)
 assert.equal(h.callsMade,1);assert.equal(h.decisions,1)
 assert.equal(h.calls[0].source.kind,'dafeiyu-main-short-pause')
 assert.deepEqual(h.receipts,['delegated'])
 assert.equal(h.bridge.shortPauseReadiness().reason,'already-considered-this-turn')
 h.tick(5*3600000)
 assert.equal((await h.bridge.considerShortPause()).ok,false)
 const state=JSON.parse(readFileSync(join(dir,'main-session-memory.json'),'utf8'))
 assert.equal(state.ownerChatAttempts.length,0);assert.equal(state.shortPauseAttempts[0].status,'queued')
 assert.equal(JSON.stringify(state).includes('human-turn-1'),false)
 h.bridge.stop()
}))

test('Life can choose silence without awakening main Session; the same turn is not replayed',async()=>withDir(async dir=>{
 const h=shortPauseHarness(dir,{choice:'skip'});h.incoming('turn-2');h.answered();h.tick(91_000)
 const r=await h.bridge.considerShortPause()
 assert.equal(r.ok,false);assert.equal(r.reason,'life-chose-silence')
 assert.equal(h.callsMade,0);assert.equal(h.decisions,1)
 assert.equal(h.bridge.shortPauseReadiness().reason,'already-considered-this-turn')
 const state=JSON.parse(readFileSync(join(dir,'main-session-memory.json'),'utf8'))
 assert.equal(state.shortPauseAttempts[0].status,'skipped')
 h.bridge.stop()
}))

test('owner speaks again before scheduled short pause, cancelling prior opportunity',async()=>withDir(async dir=>{
 const h=shortPauseHarness(dir);h.incoming('turn-3');h.answered();h.tick(90_000)
 assert.equal(h.bridge.shortPauseReadiness().eligible,true)
 h.incoming('turn-4')
 assert.equal(h.bridge.shortPauseReadiness().reason,'no-completed-owner-turn')
 assert.equal((await h.bridge.considerShortPause()).ok,false)
 assert.equal(h.callsMade,0)
 h.bridge.stop()
}))

test('new owner input DURING Life deliberation revokes the old pause, without followup or quota consumption',async()=>withDir(async dir=>{
 const h=shortPauseHarness(dir,{onDecide:async({handlers})=>{
   handlers.get('agent/inbox/inserted')({message:{role:'user',id:'newer-human-turn',source:{kind:'dsh-chat'}}})
 }});
 h.incoming('old-human-turn');h.answered();h.tick(90_000)
 const result=await h.bridge.considerShortPause()
 assert.equal(result.ok,false);assert.equal(result.reason,'owner-replied-during-life-choice')
 assert.equal(h.callsMade,0);assert.equal(h.receipts[0],'not-sent')
 assert.equal(h.bridge.shortPauseReadiness().reason,'no-completed-owner-turn')
 h.bridge.stop()
}))

test('running main Session is never interrupted by a short-pause followup',async()=>withDir(async dir=>{
 const h=shortPauseHarness(dir);h.incoming('turn-5');h.answered();h.tick(100_000);h.agent.status='running'
 assert.equal(h.bridge.shortPauseReadiness().reason,'session-still-responding')
 assert.equal(h.callsMade,0);h.bridge.stop()
}))

test('whole-memory search keeps unmatched memories as dark background, and only shared evidence creates edges',()=>{
 const m=memoryNeuralProjection({gardenRows:[
  {id:'one',text:'养猫的经历',gardenKind:'experience',sourceIds:['source-cat']},
  {id:'two',text:'关于猫的兴趣',gardenKind:'interest',sourceIds:['source-cat']},
  {id:'three',text:'游戏评论',gardenKind:'experience',sourceIds:['other-source']}
 ],query:'猫',limit:1000,showAll:true})
 assert.equal(m.nodes.length,3);assert.equal(m.matched,2);assert.equal(m.nonmatching,1)
 assert.equal(m.nodes.find(x=>x.title==='游戏评论').matched,false)
 assert.equal(m.edges.length,1);assert.equal(m.edgeCounts.interest,1)
 assert.equal(JSON.stringify(m).includes('source-cat'),false)
 const legacy=memoryNeuralProjection({gardenRows:[{id:'one',text:'养猫的经历'},{id:'other',text:'游戏评论'}],query:'猫'})
 assert.equal(legacy.nodes.length,1)
})

test('large atlas supports 10k WITHOUT quadratic edges; forgot/deleted memories remain excluded',()=>{
 const rows=Array.from({length:10002},(_,i)=>({id:'m-'+i,text:'真实可回忆经历-'+i,gardenKind:'experience'}))
 rows[9999].deletedAt='2026-11-01';rows[9998].stage='forgotten'
 const projection=memoryNeuralProjection({gardenRows:rows,limit:10000,showAll:true,query:'真实可回忆经历-9997'})
 assert.equal(projection.nodes.length,10000)
 assert.equal(projection.matched,1)
 assert.equal(projection.edges.length,0)
 assert.equal(projection.nodes.some(m=>m.title==='真实可回忆经历-9999'),false)
})

test('indexed coordinates scale beyond old 80-node PCA cap with no extra embedding calls',async()=>withDir(async dir=>{
 let embedded=0
 const idx=createEmbeddingMemoryIndex({dataDir:dir,dimension:4,modelId:'dev51-pca',provider:{
  embedDocuments:async texts=>{embedded+=texts.length;return texts.map((text,i)=>[i+1,text.length%13,Math.sin(i+1),Math.cos(i+1)])},
  embedQuery:async()=>{throw Error('project must not query model')}
 }})
 const corpus=Array.from({length:210},(_,i)=>({id:'memory:'+i,text:'独立话题_'+i}))
 assert.equal((await idx.sync(corpus)).ok,true)
 const before=embedded
 const rows=corpus.map((x,i)=>({nodeId:i.toString(16).padStart(16,'0'),corpusId:x.id,text:x.text}))
 const p=idx.projectPoints(rows)
 assert.equal(p.mode,'embedding-pca-3d');assert.equal(p.matched,210)
 assert.equal(Object.keys(p.coordinates).length,210);assert.equal(embedded,before)
}))

test('UI no longer duplicates short-pause controls, graph cap and evidence view remain available',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const text of ['neural-show-all','neural-node-limit','value="1000"','value="2000"','value="10000"','neural-memory-canvas','neural-evidence-explanation'])assert.ok(html.includes(text),text)
 assert.doesNotMatch(html,/id="main-session-short-pause-enabled"|id="main-session-short-pause-seconds"/)
 assert.match(js,/focusNeuralHits/);assert.match(js,/neuralCanvas\.getContext/)
 assert.match(index,/shouldShortPause:async/)
 assert.match(index,/mainSessionShortPauseSeconds: z\.natural\(\)\.default\(90\)/)
})
