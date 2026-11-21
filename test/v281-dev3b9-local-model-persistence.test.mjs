import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLocalVisionModelManager} from '../lib/local-vision-model-manager.mjs'
const sha=x=>'sha256:'+x.repeat(64)
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}})
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('MiniCPM approval remains after user-triggered recheck failure and temporary missing tags; invalidated after actual digest change',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-minicpm-persistence-'))
 let digest=sha('a'),available=true,online=true,retestFails=false
 const fetchImpl=async url=>{
   if(!online)throw Error('offline')
   if(url.endsWith('/api/tags'))return json({models:available?[{name:'openbmb/minicpm-v4.7:1b',digest}]:[]})
   if(url.endsWith('/api/chat')){
      if(retestFails)throw Error('test transient failure')
      return json({message:{content:'蓝色头发，穿着深蓝色女仆服装的鱼尾角色。'}})
   }
   throw Error('unexpected request')
 }
 try{
   let manager=createLocalVisionModelManager({stateDir:dir,fetchImpl})
   const first=await manager.verifyId('minicpm-v4.7-1b')
   assert.equal((await manager.review('minicpm-v4.7-1b',{reviewId:first.reviewId,accepted:true})).verified,true)
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,true)
   retestFails=true
   await assert.rejects(manager.verifyId('minicpm-v4.7-1b'))
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,true)
   available=false
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,false)
   assert.match(readFileSync(join(dir,'local-vision-approvals.json'),'utf8'),/minicpm-v4.7-1b/)
   available=true;online=false
   assert.equal((await manager.list()).running,false)
   online=true
   manager=createLocalVisionModelManager({stateDir:dir,fetchImpl})
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,true)
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').approvalStatus,'restored')
   digest=sha('b')
   assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,false)
   assert.doesNotMatch(readFileSync(join(dir,'local-vision-approvals.json'),'utf8'),/minicpm-v4.7-1b/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('saved MiniCPM model is restored to the management dropdown on refresh; legacy Qwen default never wins',()=>{
 const js=read('lib/management-console.js')
 assert.match(js,/if\(\['qwen3\.5-2b','qwen3\.5-4b','minicpm-v4\.7-1b'\]\.includes\(c\.visionLocalModel\)\)/)
 assert.match(js,/\$\('local-vision-model'\)\.value=c\.visionLocalModel/)
 assert.match(js,/已人工验收 · 相同模型版本/)
 const index=read('index.js')
 assert.match(index,/refreshCfg\(\)[\s\S]{0,240}cfg\.visionLocalModel!==id/)
})

test('人工认可持久化失败必须明确报错，不能标记为已认可',async()=>{
 const stateDir=join(tmpdir(),'nonexistent-vision-state-'+process.pid+'-'+Date.now())
 const manager=createLocalVisionModelManager({stateDir,logger:{warn:()=>{}},fetchImpl:async url=>{
   if(url.endsWith('/api/tags'))return json({models:[{name:'openbmb/minicpm-v4.7:1b',digest:sha('a')}]})
   if(url.endsWith('/api/chat'))return json({message:{content:'看到了角色图片'}})
   throw Error('unexpected')
 }})
 const probe=await manager.verifyId('minicpm-v4.7-1b')
 await assert.rejects(manager.review('minicpm-v4.7-1b',{reviewId:probe.reviewId,accepted:true}),/未能写入/)
 assert.equal((await manager.list()).models.find(x=>x.id==='minicpm-v4.7-1b').verified,false)
})
