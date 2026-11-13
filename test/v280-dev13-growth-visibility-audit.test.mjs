import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {projectLifeGrowthAudit} from '../lib/life-growth-audit.mjs'
import {projectLifeGrowthAttribution} from '../lib/life-growth-attribution.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'

const scopeA='a'.repeat(16),scopeB='b'.repeat(16)

test('growth dashboard audit separates offered input, real receipts and unproven causation',()=>{
 const runs=[{presentation:'decision-finished',steps:[
  {type:'candidate-scan',cues:3,ignoredUid:'secret-UID-123'},
  {type:'episode-context',episodeOffered:1},
  {type:'model-input',contextSources:['life-voice','public-interest-evidence','public-memory-evidence','episode-summary']},
  {type:'model-choice',action:'inspect_exploration'},
  {type:'read-result',state:'verified'},
  {type:'experience-yield',kind:'video-metadata',newEvidence:true,observations:1},
  {type:'memory-projection',state:'queued'}]},
  {presentation:'decision-unsettled',steps:[{type:'model-input',contextSources:['life-voice']},
    {type:'experience-yield',newEvidence:false,observations:0},{type:'action-result',result:'episode-step-limit'}]}]
 const result=projectLifeGrowthAudit({runs})
 assert.equal(result.inspectedRuns,2)
 assert.equal(result.modelDecisions,1)
 assert.equal(result.lifeVoiceOffered,2)
 assert.equal(result.publicInterestEvidenceOffered,1)
 assert.equal(result.publicMemoryEvidenceOffered,1)
 assert.equal(result.interestCueCandidates,1)
 assert.equal(result.episodesOffered,1)
 assert.equal(result.verifiedReadReceipts,1)
 assert.equal(result.newEvidenceReadSteps,1)
 assert.equal(result.noNoveltyReadSteps,1)
 assert.equal(result.memoryProjectionsQueued,1)
 assert.equal(result.episodeStepLimits,1)
 assert.equal(result.unsettledRuns,1)
 assert.equal(result.causalLinkConfirmed,false)
 assert.doesNotMatch(JSON.stringify(result),/secret|UID|BV1/)
})

test('no data is not proof of growth, and invalid inputs never produce bogus scores',()=>{
 const r=projectLifeGrowthAudit({runs:[null,{}, {steps:[{type:'model-input',contextSources:['life-voice'],modelProse:'private secret'}]}]})
 assert.equal(r.lifeVoiceOffered,1)
 assert.equal(r.publicInterestEvidenceOffered,0)
 assert.equal(r.verifiedExternalWrites,0)
 assert.equal(r.causalLinkConfirmed,false)
 assert.equal(projectLifeGrowthAudit({runs:'not-array'}).inspectedRuns,0)
 const growth=projectLifeGrowthAttribution({interestEvidence:[{source:'interest-milestone',stage:'growing',evidenceDays:1,evidenceCount:2}],reflection:{}})
 assert.deepEqual(growth.independentInterestMilestones,[])
 assert.equal(growth.reflection,null)
})

test('verified novelty is persisted in a redacted account-isolated trace; not model prose',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev13-life-audit-'))
 let account=scopeA
 try{
  const tr=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>account})
  const item=tr.begin({mode:'active',trigger:'automatic'})
  item.step('experience-yield',{kind:'video-metadata',newEvidence:true,observations:1,bvid:'BV1abcde1234',uid:'1337',comment:'private model text'})
  item.step('model-input',{contextSources:['life-voice','public-memory-evidence'],inputChars:123,rawPrompt:'private model text'})
  item.finish({result:'done',state:'finished'})
  const a=tr.get(item.id).run
  assert.ok(a.steps.some(x=>x.type==='experience-yield'&&x.newEvidence===true&&x.observations===1))
  assert.equal(projectLifeGrowthAudit({runs:[a]}).newEvidenceReadSteps,1)
  const saved=JSON.stringify(a)
  assert.doesNotMatch(saved,/BV1abcde1234|1337|private model text/)
  account=scopeB
  assert.equal(tr.get(item.id).ok,false)
  assert.deepEqual(tr.list().runs,[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('life management center displays real read-only growth evidence without adding an authority switch',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const id of ['life-growth-evidence','life-growth-kpis','life-growth-interests','life-growth-personality','life-growth-chain','life-growth-diagnosis','life-growth-status','life-growth-refresh'])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
 assert.ok(html.indexOf('id="life-growth-evidence"')<html.indexOf('class="life-plans-shortcut"'))
 assert.match(js,/renderLifeGrowthEvidence\(r\.growthAttribution,r\.growthAudit\)/)
 assert.match(js,/life-growth-refresh.*addEventListener/)
 assert.match(js,/mobileReadOnlySelector=.*#life-growth-refresh/)
 assert.match(js,/kpis\.replaceChildren|for\(const target of \[kpis,interests,traits,chain\]\)target\.replaceChildren/)
 assert.match(js,/modelDecisions/)
 assert.match(html,/关联不等于因果/)
 assert.doesNotMatch(html,/id="life-growth-enable"|id="growth-auto-increase"/)
 assert.match(server,/growthAudit:read\(\(\)=>projectLifeGrowthAudit/)
 assert.match(server,/growthAttribution:read\(\(\)=>lifeOpportunityAccountReady\(\)\?projectLifeGrowthAttribution/)
})

test('real model input provenance only advertises present public interest and memory evidence',()=>{
 const src=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 assert.match(src,/world\.publicInterests\?\.length\?\['public-interest-evidence'\]/)
 assert.match(src,/world\.relatedPublicMemories\?\.length\?\['public-memory-evidence'\]/)
 assert.match(src,/suppliedLifeVoice\?\['life-voice'\]/)
 assert.doesNotMatch(src,/contextSources:socialFast\?\['life-voice'/)
})
