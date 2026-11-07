import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {createFirstStart} from '../lib/first-start.mjs'
import {quickMemoryState,quickSocialState,quickMemoryPlan,quickSocialPlan} from '../lib/quick-setup-options.mjs'
import {apply} from '../index.js'

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
test('快速设置实际可保存、原页参数保持同一配置键，模型仍独立配置',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js'),server=read('index.js')
  for(const id of ['quick-life-section','quick-memory-section','quick-social-section','quick-life-save','quick-memory-save','quick-dm-save','quick-share-save','quick-memory-enabled','quick-reflection-enabled','quick-share-limit'])
    assert.match(html,new RegExp('id="'+id+'"'))
  assert.match(js,/quickConfirmSave\('memory'/)
  assert.match(js,/quickConfirmSave\('life'/)
  assert.match(js,/quickConfirmSave\('social'/)
  assert.match(server,/path\.endsWith\('\/quick\/save'\)/)
  assert.match(html,/data-open-tab="models"/)
  assert.match(html,/id="main-memory-save"/)
  assert.match(html,/id="life-v2-save-btn"/)
  assert.doesNotMatch(html,/id="fs-life-settings"/)
  assert.match(html,/顶部|快速设置/)
})
test('记忆方案只改记忆字段，不影响生活节奏、聊天授权和自定义参数',()=>{
  const cfg={mainSessionMemoryEnabled:false,mainSessionReflectionAuto:false,mainSessionMemoryHalfLifeDays:55,autonomousPlannerMinutes:99,dmStrangerAutonomyEnabled:true}
  const revision=quickMemoryState(cfg).revision
  const plan=quickMemoryPlan(cfg,{choice:'balanced',revision,previewOnly:true,memoryEnabled:true,reflectionEnabled:true})
  assert.equal(plan.patch.mainSessionMemoryHalfLifeDays,30)
  assert.equal(plan.patch.mainSessionMemoryEnabled,true)
  assert.equal(plan.patch.autonomousPlannerMinutes,undefined)
  assert.equal(plan.patch.dmStrangerAutonomyEnabled,undefined)
  const custom=quickMemoryPlan(cfg,{choice:'custom',revision,previewOnly:true,memoryEnabled:true,reflectionEnabled:false})
  assert.deepEqual(custom.patch,{mainSessionMemoryEnabled:true})
  assert.throws(()=>quickMemoryPlan(cfg,{choice:'balanced',revision,previewOnly:false,memoryEnabled:true,reflectionEnabled:true}),/明确确认/)
  assert.throws(()=>quickMemoryPlan(cfg,{choice:'__proto__',revision,previewOnly:true,memoryEnabled:true,reflectionEnabled:true}),/有效/)
})
test('未验证安装不能增加社交许可；保存时必须有同版本快照和明确确认',()=>{
  const cfg={dmWatch:false,dmStrangerAutonomyEnabled:false,dmApprovalEnabled:false,socialOutreachEnabled:false,socialLifeIntentEnabled:false,socialAutoSend:false,socialVideoRecommendationsAuthorizedV2:false,socialOutreachDailyLimit:1}
  const revision=quickSocialState(cfg).revision
  assert.throws(()=>quickSocialPlan(cfg,{channel:'dm',choice:'free',revision,previewOnly:true},{ready:false}),/先完成/)
  assert.throws(()=>quickSocialPlan(cfg,{channel:'share',choice:'autonomous',dailyLimit:100,revision,previewOnly:true},{ready:false}),/先完成/)
  assert.throws(()=>quickSocialPlan(cfg,{channel:'share',choice:'autonomous',dailyLimit:3,revision,previewOnly:true},{ready:true}),/50–1000/)
  assert.throws(()=>quickSocialPlan(cfg,{channel:'dm',choice:'friends',revision:'stale',previewOnly:true},{ready:true}),/更新/)
  assert.throws(()=>quickSocialPlan(cfg,{channel:'dm',choice:'friends',revision,previewOnly:false},{ready:true}),/明确确认/)
  const safe=quickSocialPlan(cfg,{channel:'share',choice:'paused',revision,previewOnly:true},{ready:false})
  assert.deepEqual(safe.patch,{})
  const plan=quickSocialPlan(cfg,{channel:'share',choice:'autonomous',dailyLimit:100,revision,previewOnly:true},{ready:true})
  assert.equal(plan.patch.socialAutoSend,true)
  assert.equal(plan.patch.socialVideoRecommendationsAuthorizedV2,true)
  assert.equal(plan.patch.dmStrangerAutonomyEnabled,undefined)
})
test('新版快速设置提示升级仅一次，老用户运行和凭据不被重置',t=>{
  const stateDir=mkdtempSync(join(tmpdir(),'quick-v4-'))
  t.after(()=>rmSync(stateDir,{recursive:true,force:true}))
  const f=createFirstStart({stateDir,credentialPath:join(stateDir,'not-exists'),headlessSync:{hasAnyVerified:()=>false}})
  assert.equal(f.status().quickSetupRevision,3)
  assert.equal(f.status().quickSetupSeen,false)
  f.acknowledgeQuickSetup()
  assert.equal(f.status().quickSetupSeen,true)
  assert.equal(f.isReady(),false)
})
test('真实 HTTP：首次设置可保存非外发配置，新增社交和自主生活权限仍须完成验证',async t=>{
  const home=mkdtempSync(join(tmpdir(),'quick-v4-http-'))
  t.after(()=>rmSync(home,{recursive:true,force:true}))
  let handle
  apply({get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handle=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}},{})
  const call=async(method,path,body,origin='http://127.0.0.1:8011')=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8011',origin}
    let status=0,payload=''
    await handle(req,{writeHead(code){status=code},end(x){payload=String(x||'')}})
    return {status,data:JSON.parse(payload)}
  }
  const before=await call('GET','onboarding/quick/options')
  assert.equal(before.status,200)
  assert.equal(before.data.requiredReady,false)
  assert.equal(before.data.social.values.dmStrangerAutonomyEnabled!==undefined,true)
  assert.equal(before.data.memory.profiles.balanced.mainSessionMemoryHalfLifeDays,30)
  const memReq={kind:'memory',choice:'balanced',revision:before.data.memory.revision,memoryEnabled:!before.data.memory.values.mainSessionMemoryEnabled,reflectionEnabled:!before.data.memory.values.mainSessionReflectionAuto}
  assert.equal((await call('POST','onboarding/quick/save',{...memReq,previewOnly:true})).status,200)
  assert.equal((await call('POST','onboarding/quick/save',{...memReq,previewOnly:false})).status,400)
  const saved=await call('POST','onboarding/quick/save',{...memReq,previewOnly:false,confirm:'APPLY_QUICK_MEMORY'})
  assert.equal(saved.status,200)
  assert.equal(saved.data.localVerified,true)
  // Mock DSH has no writable native settings form: local authoritative config
  // must still read back correctly, without pretending native sync succeeded.
  assert.equal(saved.data.host.ok,false)
  assert.equal(saved.data.host.role,'optional-native-mirror')
  const after=await call('GET','onboarding/quick/options')
  assert.equal(after.data.memory.values.mainSessionMemoryHalfLifeDays,30)
  const socialReq={kind:'social',channel:'share',choice:'autonomous',dailyLimit:100,revision:after.data.social.revision,previewOnly:false,confirm:'APPLY_QUICK_SOCIAL'}
  assert.equal((await call('POST','onboarding/quick/save',socialReq)).status,400)
  assert.equal((await call('POST','onboarding/quick/save',{kind:'life',mode:'active',pace:'lively',revision:after.data.life.revision,enableMaster:true,previewOnly:true})).status,400)
  assert.equal((await call('POST','onboarding/quick/save',{...memReq,previewOnly:true},'https://evil.example')).status,403)
  assert.equal((await call('GET','life-memory/status')).status,423)
})
