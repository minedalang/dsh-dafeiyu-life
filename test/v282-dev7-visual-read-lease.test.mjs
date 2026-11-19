import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {withLifeVideoVisualLease} from '../lib/life-planner-atomic.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const BV='BV1234567890', OTHER='BV0987654321', NOW=Date.parse('2026-11-18T12:00:00Z')
const cred={dedeuserid:'12345678',sessdata:'test'},account=discussionAccountTag(cred)
const runInDir=async fn=>{const d=mkdtempSync(join(tmpdir(),'life-video-lease-'));try{return await fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
const child=(dir,code)=>{
 const module=fileURLToPath(new URL('../lib/life-planner-atomic.mjs',import.meta.url))
 const run=spawnSync(process.execPath,['--input-type=module','-e',
   `import {withLifeVideoVisualLease} from ${JSON.stringify('file://'+module.replaceAll('\\','/'))};\n${code}`],
   {encoding:'utf8',env:{...process.env,TEST_DIR:dir,TEST_TAG:account,TEST_BV:BV},timeout:10_000})
 assert.equal(run.status,0,run.stderr);return run.stdout.trim()
}

test('same-process and independent Node processes cannot sample one account and BV concurrently',()=>runInDir(async dir=>{
 let unlock
 const held=withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>{
   await new Promise(resolve=>{unlock=resolve});return {ok:true,done:true}
 })
 const busy=await withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>{throw Error('should not run')})
 assert.deepEqual(busy,{ok:false,reason:'video-visual-busy'})
 const fromOtherProcess=child(dir,`console.log(JSON.stringify(await withLifeVideoVisualLease(process.env.TEST_DIR,{accountTag:process.env.TEST_TAG,bvid:process.env.TEST_BV},async()=>({ok:true}))));`)
 assert.deepEqual(JSON.parse(fromOtherProcess),busy)
 assert.deepEqual(await withLifeVideoVisualLease(dir,{accountTag:account,bvid:OTHER},async()=>({ok:true,other:true})),{ok:true,other:true})
 assert.deepEqual(await withLifeVideoVisualLease(dir,{accountTag:'f'.repeat(16),bvid:BV},async()=>({ok:true,otherAccount:true})),{ok:true,otherAccount:true})
 unlock();assert.deepEqual(await held,{ok:true,done:true})
 assert.deepEqual(await withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>({ok:true})),{ok:true})
 assert.deepEqual(readdirSync(dir).filter(x=>x.startsWith('life-video-visual-')),[])
}))

test('a killed read-only sampler lease is recoverable only after its owner has definitely exited',()=>runInDir(async dir=>{
 child(dir,`await withLifeVideoVisualLease(process.env.TEST_DIR,{accountTag:process.env.TEST_TAG,bvid:process.env.TEST_BV},async()=>{process.exit(0)});`)
 assert.equal(readdirSync(dir).filter(x=>x.startsWith('life-video-visual-')).length,1)
 const resumed=await withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>({ok:true,recovered:true}))
 assert.deepEqual(resumed,{ok:true,recovered:true})
 assert.deepEqual(readdirSync(dir).filter(x=>x.startsWith('life-video-visual-')),[])
}))

test('suspicious lock content and invalid targets fail closed without running callback',()=>runInDir(async dir=>{
 assert.deepEqual(await withLifeVideoVisualLease(dir,{accountTag:'bad',bvid:BV},async()=>({ok:true})),
   {ok:false,reason:'video-visual-lease-invalid'})
 let count=0,release
 await withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>({ok:true}))
 // The exact anonymous directory is discoverable only by a test-created claim.
 const held=withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>{
   await new Promise(resolve=>{release=resolve})
 })
 assert.deepEqual(await withLifeVideoVisualLease(dir,{accountTag:account,bvid:OTHER},async()=>{throw Error('read failed')}),
   {ok:false,reason:'video-visual-read-failed'})
 const lockName=readdirSync(dir).find(x=>x.startsWith('life-video-visual-'))
 writeFileSync(join(dir,lockName,'extra.txt'),'tamper')
 const another=await withLifeVideoVisualLease(dir,{accountTag:account,bvid:BV},async()=>{count++;return {ok:true}})
 assert.equal(another.ok,false);assert.equal(count,0)
 release();await assert.rejects(held,/video-visual-lease-release-failed/)
}))

test('old visual receipts only prevent immediate retries; clear current memory remains authoritative',()=>runInDir(async dir=>{
 let at=NOW
 const state=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>at})
 const proof={ok:true,bvid:BV,depth:'standard',frameCount:12,source:'decoded-public-video'}
 assert.equal(state.rememberVerifiedVideoVisual(proof,account).recorded,true)
 assert.equal(state.hasVerifiedVideoVisual(BV,account),true)
 at+=31*60_000
 assert.equal(state.hasVerifiedVideoVisual(BV,account),false,'expired receipt cannot be a permanent history blacklist')
 let clear=true
 const memoryAware=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>at,
   getCurrentVisualMemoryEvidence:()=>clear?[{readOnly:true,bvid:BV,sources:['visual-model-observation'],visual:{source:'decoded-public-video',frameCount:12}}]:[]})
 assert.equal(memoryAware.hasVerifiedVideoVisual(BV,account),true)
 clear=false
 assert.equal(memoryAware.hasVerifiedVideoVisual(BV,account),false,'faded or deleted memory is not recoverable from the old ledger')
 assert.equal(memoryAware.hasVerifiedVideoVisual(OTHER,account),false)
}))

test('production guards Life Episode and independently Life-elected full view, leaving explicit focused revisit distinct',async()=>{
 const {readFileSync}=await import('node:fs')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 assert.match(index,/withLifeVisualObservationLease:\(target,run\)=>withLifeVideoVisualLease\(stateDir,target,run\)/)
 assert.match(index,/return withLifeVideoVisualLease\(stateDir,\{accountTag:account,bvid\}/)
 assert.match(planner,/const observeSelectedVideo=async\(live,depth\)=>withLifeVisualObservationLease\(/)
 assert.match(index,/name:'bili_video_revisit_moment'/)
})
