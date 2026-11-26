import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'

const tmp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-silent-sync-'))
const cfg=()=>({mainSessionBridgeEnabled:true,mainSessionId:'abc',mainSessionAutoSync:true,mainSessionSyncMinutes:60,mainSessionDailyBatches:4,mainSessionBatchSize:8,mainSessionIncludeComments:false})
const watched=(bvid)=>({day:'2026-10-31',bvid,title:'确实探访过的视频',picked:true})
const create=(dir,rows,agent)=>createMainSessionBridge({dataDir:dir,
  agents:{get:()=>agent,list:()=>[agent]},getConfig:cfg,getWatched:()=>rows.value,getComments:()=>({rows:[]}),
  now:()=>Date.parse('2026-10-31T11:00:00+08:00')})

test('自动同步使用非唤醒 inject；不产生 followup 模型回合，没有新事件不重复发送',async()=>{
  const dir=tmp(),rows={value:[]},calls=[]
  const agent={id:'abc',inject:async x=>calls.push(['inject',x]),followup:async x=>calls.push(['followup',x])}
  try {
    const bridge=create(dir,rows,agent);bridge.collect()
    rows.value=[watched('BV1234567890')]
    const a=await bridge.deliver({silent:true})
    assert.equal(a.ok,true);assert.equal(a.mode,'inject');assert.equal(a.sent,1)
    assert.equal(bridge.status().pending,0);assert.equal(bridge.status().lastDeliveryMode,'inject')
    const b=await bridge.deliver({silent:true});assert.equal(b.sent,0)
    assert.deepEqual(calls.map(x=>x[0]),['inject'])
    assert.match(calls[0][1].content[0].text,/非指令/)
    const state=JSON.parse(readFileSync(join(dir,'main-session-memory.json'),'utf8'))
    assert.equal(state.deliveredKeys.length,1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('宿主缺少 inject 时不能回退唤醒模型；留下队列供主人手动汇报',async()=>{
  const dir=tmp(),rows={value:[]},calls=[]
  const agent={id:'abc',followup:async x=>calls.push(x)}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    const r=await bridge.deliver({silent:true})
    assert.equal(r.ok,false);assert.equal(r.skipped,'silent-unavailable');assert.equal(calls.length,0)
    assert.equal(bridge.status().pending,1)
    assert.match(bridge.status().lastError,/非唤醒注入/)
    const manually=await bridge.deliver({force:true})
    assert.equal(manually.ok,true);assert.equal(manually.mode,'followup');assert.equal(calls.length,1)
    assert.equal(bridge.status().pending,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('自动注入失败不会静默退回 followup，也不会丢失待汇报经历',async()=>{
  const dir=tmp(),rows={value:[]};let shouldFail=true;let injectCount=0,followupCount=0
  const agent={id:'abc',inject:async()=>{injectCount++;if(shouldFail)throw Error('TRANSPORT')},followup:async()=>{followupCount++}}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    let r=await bridge.deliver({silent:true})
    assert.equal(r.ok,false);assert.match(r.error,/TRANSPORT/)
    assert.equal(bridge.status().pending,1);assert.equal(followupCount,0)
    shouldFail=false;r=await bridge.deliver({silent:true})
    assert.equal(r.ok,true);assert.equal(bridge.status().pending,0)
    assert.equal(injectCount,2);assert.equal(followupCount,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('并发同步不得重复发消息，且异步注入期间新收集的事件不能被旧快照覆盖',async()=>{
  const dir=tmp(),rows={value:[]},calls=[];let release=()=>{};let started=()=>{}
  const waiting=new Promise(resolve=>release=resolve)
  const entered=new Promise(resolve=>started=resolve)
  const agent={id:'abc',inject:async m=>{calls.push(m);started();await waiting},followup:async()=>{throw Error('unexpected followup')}}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    const inflight=bridge.deliver({silent:true});await entered
    const concurrent=await bridge.deliver({silent:true})
    assert.equal(concurrent.skipped,'busy')
    rows.value=[...rows.value,watched('BV0987654321')]
    bridge.collect()
    release();const done=await inflight;assert.equal(done.ok,true)
    assert.equal(done.pending,1);assert.equal(bridge.status().pending,1)
    const next=await bridge.deliver({silent:true});assert.equal(next.sent,1)
    assert.equal(calls.length,2);assert.equal(bridge.status().pending,0)
  }finally{release();rmSync(dir,{recursive:true,force:true})}
})

test('定时同步入口明确调用 silent 模式，不直接唤醒主 Session',()=>{
  const src=readFileSync(new URL('../lib/main-session-bridge.mjs',import.meta.url),'utf8')
  assert.match(src,/const tick=async\(\)=>[\s\S]*?await deliver\(\{silent:true\}\)/)
})


test('协作模式阻断所有主 Session 自动桥接入口且保留旧队列；恢复不重复同步',async()=>{
  const dir=tmp(),rows={value:[]},calls=[];let policy={mode:'autonomous-life',revision:0},reads=0
  const agent={id:'abc',inject:async()=>calls.push('inject'),followup:async()=>calls.push('followup'),session:{deriveMessages:()=>{reads++;return []}}}
  try{
    const bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:cfg,getWatched:()=>{reads++;return rows.value},getComments:()=>({rows:[]}),getSessionIntegration:()=>policy,now:()=>Date.parse('2026-10-31T11:00:00+08:00')})
    bridge.collect();rows.value=[watched('BV1234567890')];bridge.collect()
    const before=readFileSync(bridge.file),readCount=reads
    policy={mode:'memory-foundation',revision:1};bridge.refreshIntegration()
    assert.equal(bridge.status().integrationMode,'memory-foundation');assert.equal(bridge.status().pending,1)
    assert.equal(bridge.sessionDirectory().selectedId,'abc');assert.equal(bridge.recall().length,1)
    assert.equal(bridge.collect({forceQueue:true,backfillDays:7}).ok,false)
    assert.equal((await bridge.deliver({force:true})).skipped,'integration-paused')
    assert.equal((await bridge.deliver({silent:true})).skipped,'integration-paused')
    assert.equal(bridge.canShare(),false);assert.equal((await bridge.shareRecall('回忆')).ok,false)
    assert.equal(bridge.ownerChatReadiness().eligible,false);assert.equal(bridge.mainSilenceCandidate().eligible,false)
    assert.equal((await bridge.considerShortPause()).reason,'integration-paused')
    assert.equal(bridge.reserveOwnerContact({sourceKey:'1234567890abcdef:idle:2026-10-31'}).reason,'integration-paused')
    assert.equal((await bridge.initiateOwnerChat()).ok,false)
    assert.equal((await bridge.ownerDmContext()).available,false)
    assert.equal((await bridge.injectOwnerDmExperience({type:'watch',summary:'已看'})).ok,false)
    assert.equal((await bridge.test()).ok,false)
    assert.equal(reads,readCount);assert.deepEqual(calls,[]);assert.deepEqual(readFileSync(bridge.file),before)
    policy={mode:'autonomous-life',revision:-1};assert.equal(bridge.status().integrationMode,'unavailable');assert.equal((await bridge.deliver({force:true})).ok,false)
    policy={mode:'autonomous-life',revision:2};bridge.refreshIntegration()
    assert.equal((await bridge.deliver({silent:true})).sent,1);assert.equal((await bridge.deliver({silent:true})).sent,0)
    assert.deepEqual(calls,['inject']);bridge.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('私信上下文异步读取遇到模式 ABA 不返回旧主 Session 内容',async()=>{
  const dir=tmp();let policy={mode:'autonomous-life',revision:0},release
  const agent={id:'abc',followup:async()=>{},session:{deriveMessages:()=>new Promise(resolve=>release=resolve)}}
  try{
    const bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:cfg,getWatched:()=>[],getComments:()=>({rows:[]}),getSessionIntegration:()=>policy})
    const waiting=bridge.ownerDmContext();policy={mode:'memory-foundation',revision:1};bridge.refreshIntegration();policy={mode:'autonomous-life',revision:2};bridge.refreshIntegration()
    release([{role:'user',content:[{type:'text',text:'私密历史'}]}]);const result=await waiting
    assert.equal(result.available,false);assert.deepEqual(result.lines,[]);assert.equal(result.reason,'session-integration-changed');bridge.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('已交给宿主的非唤醒注入允许结算，不因模式切换重放',async()=>{
  const dir=tmp(),rows={value:[]};let policy={mode:'autonomous-life',revision:0},release,calls=0
  const agent={id:'abc',followup:async()=>{},inject:()=>{calls++;return new Promise(resolve=>release=resolve)}}
  try{
    const bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:cfg,getWatched:()=>rows.value,getComments:()=>({rows:[]}),getSessionIntegration:()=>policy,now:()=>Date.parse('2026-10-31T11:00:00+08:00')})
    bridge.collect();rows.value=[watched('BV1234567890')];const sending=bridge.deliver({silent:true})
    policy={mode:'memory-foundation',revision:1};bridge.refreshIntegration();assert.equal((await bridge.deliver({force:true})).ok,false)
    release();assert.equal((await sending).sent,1);assert.equal(bridge.status().pending,0)
    policy={mode:'autonomous-life',revision:2};assert.equal((await bridge.deliver({silent:true})).sent,0);assert.equal(calls,1);bridge.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})
