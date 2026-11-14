import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
const S='b'.repeat(16)
test('counterfactual replay: changed recallable public interests can change later Life choice without fabricating growth',async t=>{
  const dataDir=mkdtempSync(join(tmpdir(),'life-rc10-causal-'))
  t.after(()=>rmSync(dataDir,{recursive:true,force:true}))
  let day=Date.now(),interests=['绘画'],prompts=[]
  const traces=createLifeDecisionTrace({dataDir,getAccountTag:()=>S,now:()=>day})
  const life=createLifeWillingness({dataDir,getAccountTag:()=>S,now:()=>day,enabled:()=>true,
    beginTrace:args=>traces.begin(args),getContext:()=>({voice:'自然表达，不编造经历',world:{interests,publicEvidenceDays:interests.includes('摄影')?3:1}}),
    invokeModel:async prompt=>{prompts.push(prompt);return JSON.stringify(interests.includes('摄影')
      ?{action:'act',candidateId:'explore_video',reason:'最近积累了拍摄兴趣，想了解新题材'}
      :{action:'skip',reason:'这会儿不感兴趣'})}})
  const offer=()=>({trigger:'spontaneous-window',sourceKey:'verified-spontaneous:'+day,
    candidates:[{id:'explore_video',kind:'explore_video',label:'选一个公开视频做下一次探索'}]})
  const earlier=await life.decide(offer());assert.equal(earlier.action,'skip')
  day+=86400_000;interests=['摄影']
  const later=await life.decide(offer());assert.equal(later.ok,true)
  life.receipt(later.proof,{status:'delegated'})
  assert.match(prompts[0],/绘画/);assert.match(prompts[1],/摄影/)
  assert.equal(traces.list({limit:5}).runs.length,2)
  assert.ok(!JSON.stringify(traces.list({limit:5})).includes('摄影'))
  assert.ok(!JSON.stringify(traces.list({limit:5})).includes('绘画'))
})
