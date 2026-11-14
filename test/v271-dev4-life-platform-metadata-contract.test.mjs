import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {verifyLifePublicMetadata,lifeMetadataDiagnostics,classifyLifeMetadataFailure} from '../lib/life-public-metadata.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {classifyReadFailure} from '../lib/read-action-diagnostics.mjs'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
const BV='BV1abcde1234'

test('Python video-info platform error remains a typed, privacy-safe read failure',()=>{
  const platform={ok:false,failureCode:'metadata-rate-limited',diagnosticOrigin:'python-bili-video-info',
    failureLayer:'platform',platformCode:-412,extra:'secret-cookie-do-not-copy'}
  const result=verifyLifePublicMetadata(BV,platform)
  assert.equal(result.ok,false)
  assert.equal(result.code,'metadata-rate-limited')
  assert.equal(result.platformCode,-412)
  assert.equal(result.diagnosticOrigin,'python-bili-video-info')
  assert.equal(result.extra,undefined)
  assert.ok(!JSON.stringify(result).includes('secret-cookie'))
  assert.equal(lifeMetadataDiagnostics(result,BV).layer,'platform')
})

test('legacy MCP errors, Python reservation errors and actual platform codes classify distinctly',()=>{
  assert.equal(classifyLifeMetadataFailure({ok:false,error:{code:-412,message:'opaque'}}),'metadata-rate-limited')
  assert.equal(classifyLifeMetadataFailure({ok:false,error:{code:-101,message:'opaque'}}),'metadata-account-unavailable')
  assert.equal(classifyLifeMetadataFailure({ok:false,status:'reservation-held'}),'metadata-read-busy')
  assert.equal(classifyLifeMetadataFailure({ok:false,status:'reservation-unavailable',error:'当前账号凭据无效'}),'metadata-account-unavailable')
  assert.equal(classifyLifeMetadataFailure(Error('MCP tools/call timeout')),'metadata-timeout')
  assert.equal(classifyLifeMetadataFailure({ok:false,failureCode:'metadata-response-invalid'}),'metadata-response-invalid')
  assert.equal(verifyLifePublicMetadata(BV,{ok:false,failureCode:'metadata-account-unavailable',platformCode:-101}).code,'metadata-account-unavailable')
  assert.equal(verifyLifePublicMetadata(BV,{bvid:BV,title:'确认过的标题'}).ok,true)
})

test('untrusted diagnosticOrigin cannot smuggle private prose into a trace, even after platform failure',()=>{
  const dir=mkdtempSync(join(tmpdir(),'metadata-trace-'))
  try{
    const tag='abcdef0123456789',trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>tag})
    const run=trace.begin({mode:'active',trigger:'manual'})
    run.step('read-result',{action:'begin_exploration',tool:'bili_video_info',state:'rejected',
      ...lifeMetadataDiagnostics(verifyLifePublicMetadata(BV,{ok:false,diagnosticOrigin:'private-UID-and-cookie',
        failureCode:'metadata-api-error',platformCode:-412,error:'A_PRIVATE_TOKEN'}),BV),
      bvid:BV,privateText:'SECRET_TEXT',platformCode:-412})
    run.finish({state:'finished'})
    const actual=trace.list().runs[0].steps.find(x=>x.type==='read-result')
    const text=JSON.stringify(actual)
    assert.equal(actual.code,'metadata-api-error')
    assert.equal(actual.origin,'response-validation')
    assert.equal(actual.platformCode,-412)
    for(const forbidden of [BV,'SECRET_TEXT','A_PRIVATE_TOKEN','cookie'])assert.equal(text.includes(forbidden),false)
  }finally{rmSync(dir,{force:true,recursive:true})}
})

test('production probe shares the guarded reader, does not accept a user-supplied BV and never calls the model',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/executeOpportunityRead:readLifeVideoMetadata/)
  assert.match(src,/life-agent\/metadata-probe/)
  assert.match(src,/lifeOpportunities\.explorationCues\(\{limit:6\}\)/)
  assert.match(src,/await readLifeVideoMetadata\(evidence\.bvid\)/)
  assert.match(src,/modelCalled:false,lifeEventChanged:false/)
  assert.match(src,/life_metadata_diagnostics\.py/)
  assert.doesNotMatch(src,/body\?\.bvid[\s\S]{0,150}readLifeVideoMetadata/)
  const consoleHtml=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(consoleHtml,/life-metadata-probe/)
  const sync=readFileSync(new URL('../lib/state.mjs',import.meta.url),'utf8')
  assert.match(sync,/life_metadata_diagnostics\.py/)
  const repair=readFileSync(new URL('../lib/mcp-reviewed-repair.mjs',import.meta.url),'utf8')
  assert.match(repair,/life_metadata_diagnostics\.py/)
})

test('typed Python platform and account failures reach read receipts without sensitive text',()=>{
  const cases=[
    [{ok:false,failureCode:'metadata-rate-limited',platformCode:-412,error:'PRIVATE_UID'},'platform-rate-limit'],
    [{ok:false,failureCode:'metadata-account-unavailable',platformCode:-101},'account-auth'],
    [{ok:false,failureCode:'metadata-timeout'},'platform-timeout'],
    [{ok:false,failureCode:'metadata-read-busy'},'reservation-held'],
    [{ok:false,platformCode:-412},'platform-rate-limit'],
    [{ok:false,failureCode:'metadata-response-invalid'},'invalid-response'],
  ]
  for(const [body,expected] of cases){
    assert.equal(classifyReadFailure(body).code,expected)
    assert.equal(classifyReadFailure(body).failed,true)
    assert.doesNotMatch(JSON.stringify(classifyReadFailure(body)),/PRIVATE_UID/)
  }
})

test('typed rate-limit starts existing read cooldown and stops immediate repeated platform calls',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'metadata-budget-'))
  try{
    const guard=createBiliReadBudget({dataDir:dir,logger:{warn(){}}})
    let dispatched=0
    const result=await guard.guard('mcp:bili_video_info',async()=>{
      dispatched++
      return {ok:false,failureCode:'metadata-rate-limited',diagnosticOrigin:'python-bili-video-info',platformCode:-412}
    })
    assert.equal(result.platformCode,-412)
    assert.equal(guard.status().reason,'platform-cooldown')
    assert.equal(guard.status().backoffCount,1)
    await assert.rejects(()=>guard.guard('mcp:bili_video_info',async()=>{dispatched++;return {ok:true}}),BiliReadDeferredError)
    assert.equal(dispatched,1)
    const restarted=createBiliReadBudget({dataDir:dir,logger:{warn(){}}})
    assert.equal(restarted.status().reason,'platform-cooldown','cooldown survives process restart')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('typed account failure starts the existing 15-minute credential cooldown',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'metadata-budget-auth-'))
  try{
    const guard=createBiliReadBudget({dataDir:dir,logger:{warn(){}}})
    await guard.guard('mcp:bili_video_info',async()=>({ok:false,failureCode:'metadata-account-unavailable',platformCode:-101}))
    assert.equal(guard.status().reason,'platform-cooldown')
    assert.match(guard.status().lastReason,/登录态/)
    assert.throws(()=>guard.acquire('mcp:bili_video_info'),BiliReadDeferredError)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
