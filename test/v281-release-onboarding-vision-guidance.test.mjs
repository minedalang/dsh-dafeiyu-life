import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {runInNewContext} from 'node:vm'
import {createFirstStart} from '../lib/first-start.mjs'

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('2.8.0 已完成安装须重新查看 2.8.1 引导，但旧凭据与业务解锁状态不变',t=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-281-upgrade-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const cred=join(dir,'bili_credential.json')
  writeFileSync(cred,'existing-user-credential')
  const digest=createHash('sha256').update('existing-user-credential').digest('hex')
  const stateFile=join(dir,'first-start-v1.json')
  const former={version:1,completed:true,welcomeSeen:true,quickSetupSeenRevision:4,
    biliCredentialHash:digest,skipped:['main-session'],otherLegacyState:'preserve'}
  writeFileSync(stateFile,JSON.stringify(former))
  const gate=createFirstStart({stateDir:dir,credentialPath:cred,headlessSync:{hasAnyVerified:()=>true}})
  assert.equal(gate.status().quickSetupRevision,5)
  assert.equal(gate.status().quickSetupSeen,false)
  assert.equal(gate.status().completed,true)
  assert.equal(gate.isReady(),true,'新版介绍不应暂停正常运行的后台 Life')
  assert.equal(gate.status().biliVerified,true)
  gate.acknowledgeQuickSetup()
  assert.equal(gate.status().quickSetupSeen,true)
  assert.equal(gate.isReady(),true)
  assert.equal(readFileSync(cred,'utf8'),'existing-user-credential')
  const updated=JSON.parse(readFileSync(stateFile,'utf8'))
  assert.equal(updated.otherLegacyState,'preserve')
  assert.deepEqual(updated.skipped,['main-session'])
  assert.equal(updated.quickSetupSeenRevision,5)
})

test('首次配置页包含独立视觉模型流程，默认不启用、不自动安装，且复用现有模型页',()=>{
  const page=read('lib/management-console.html')
  const js=read('lib/management-console.js')
  const server=read('index.js')
  assert.match(page,/id="fs-vision-guide"/)
  assert.match(page,/id="fs-vision-state"/)
  assert.match(page,/DSH 多模态 Provider \/ 模型/)
  assert.match(page,/自动修复视觉运行环境/)
  assert.match(page,/人工认可并启用/)
  assert.match(page,/data-open-tab="models" data-open-anchor="models-vision-settings"/)
  assert.match(page,/不自动下载安装/)
  assert.match(js,/renderFirstStartVision/)
  assert.match(js,/const needsSetup=\(state\.welcomeCompleted\?\?state\.completed\)!==true/)
  assert.match(server,/visionEnabled: z\.boolean\(\)\.default\(false\)/)
  assert.doesNotMatch(js,/\/onboarding\/vision\/autoenable/)
})

test('旧用户升级但未确认新版引导时保持后台工作；只在管理页显示提醒',()=>{
  const js=read('lib/management-console.js')
  const firstStart=read('lib/first-start.mjs')
  assert.match(firstStart,/isReady:\(\)=>status\(\)\.completed/)
  assert.match(js,/notice\.hidden=state\?\.ok!==true\|\|!\(needsReview\|\|needsRepair\|\|needsWelcome\)/)
  assert.match(js,/现有后台 Life 不会因此暂停/)
})

test('npm 安装包包含 2.8.1 升级指南、发布审计说明与检查单',()=>{
  const manifest=JSON.parse(read('package.json'))
  for(const path of ['docs/architecture','docs/release/README.md',
    'docs/release/2.8.1-user-upgrade-guide.md',
    'docs/release/2.8.1-release-checklist.md',
    'docs/release/RELEASE_NOTES_v2.8.1.md']){
    assert.ok(manifest.files.includes(path),`安装包遗漏 ${path}`)
  }
  assert.match(manifest.version,/^2\.8\.(?:1|2|3)(?:-dev\..+)?$/,'版本限当前维护的 2.8.x 稳定版或开发候选')
})


test('2.8.1 快速设置入口定位 02B 且新版视觉卡片突出；模型开关位于标题和折叠外',()=>{
  const page=read('lib/management-console.html')
  const js=read('lib/management-console.js')
  assert.match(page,/href="#fs-vision-guide" data-fs-step="preferences"/)
  assert.match(page,/id="fs-vision-guide"/)
  assert.match(page,/fs-new-281-badge/)
  assert.match(page,/绿色|#47a782/)
  const vision=page.indexOf('id="models-vision-settings"')
  const content=page.indexOf('class="model-task-body" id="models-vision-settings-body"',vision)
  const toggle=page.indexOf('id="models-vision-enabled"',vision)
  assert.ok(vision>0&&content>vision&&toggle>content,'视频权限开关必须位于可展开的模型配置内，不能压在折叠标题上')
  assert.match(js,/visionSection\.dataset\.videoObservationEnabled/)
  assert.match(js,/if\(element\?\.tagName==='DETAILS'\)element\.open=true/)
  assert.match(js,/event\.preventDefault\(\)/)
  assert.match(js,/management-jump-cue/)
  assert.match(js,/revealTarget\(target\)/)
  assert.match(page,/prefers-reduced-motion:reduce/)
  assert.match(read('README.md'),/2\.8\.2 重点优化/)
  assert.match(read('docs\/release\/RELEASE_NOTES_v2.8.1.md'),/2\.8\.1/)
  // README must state the exact package version, including a stable release candidate.
  assert.match(read('README.md'),new RegExp(JSON.parse(read('package.json')).version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
})

test('顶部提示栏按三种真实用户状态展示正确动作，不让新版确认替代首次校验',()=>{
  const html=read('lib/management-console.html')
  const js=read('lib/management-console.js')
  assert.equal((html.match(/id="fs-quick-ack"/g)||[]).length,1)
  assert.equal((html.match(/id="fs-complete"/g)||[]).length,1)
  const global=html.slice(html.indexOf('<aside id="fs-warning"'),html.indexOf('<section id="panel-firststart"'))
  assert.match(global,/id="fs-warning-open"/)
  assert.match(global,/id="fs-quick-ack"/)
  assert.match(global,/id="fs-complete"/)
  const inside=html.slice(html.indexOf('<section id="panel-firststart"'),html.indexOf('<section id="panel-models"'))
  assert.doesNotMatch(inside,/id="fs-quick-ack"|id="fs-complete"|id="fs-complete-skip"/)
  assert.match(inside,/id="fs-required-overview"/)
  assert.doesNotMatch(js,/已完成 '\+Object\.values\(progress\)/)
  assert.match(js,/const current=await request\('\/onboarding\/status'\)/)
  assert.match(js,/await request\('\/onboarding\/complete',\{skipped:\[\.\.\.skipFirstStart\]\}\)/)

  // Exercise the real production render function with a minimal DOM double.
  // No independent duplicate UI policy is reimplemented inside the test.
  const begin=js.indexOf('  const integrationLabel=mode=>')
  const end=js.indexOf('  // All dependency *installation*',begin)
  assert.ok(begin>=0&&end>begin)
  const nodes=new Map()
  const element=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,dataset:{},textContent:'',className:'',title:'',attributes:{},
      setAttribute(name,value){this.attributes[name]=String(value)}})
    return nodes.get(id)
  }
  const context={
    onboarding:null,mobileViewOnly:false,tabNames:['firststart','models','home','life','social'],
    $:element,document:{querySelector:selector=>element(selector)}
  }
  const render=runInNewContext(js.slice(begin,end)+'\nrenderFirstStart',context)
  const show=state=>{render(state);return element('fs-warning')}
  const old={ok:true,welcomeCompleted:true,completed:true,requiredReady:true,quickSetupSeen:false,
    biliVerified:true,headlessVerified:true,hasCredential:true,missing:[],skipped:[]}
  let banner=show(old)
  assert.equal(banner.hidden,false)
  assert.equal(banner.dataset.kind,'update')
  assert.equal(element('fs-quick-ack').hidden,false)
  assert.equal(element('fs-complete').hidden,true)
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-vision-guide')
  assert.equal(element('[data-tab="life"]').hidden,false,'仅新版引导未确认，不得暂停老用户 Life')
  assert.match(element('fs-warning-text').textContent,/后台 Life 不会因此暂停/)
  banner=show({...old,quickSetupSeen:true})
  assert.equal(banner.hidden,true,'老用户确认后只需关闭通知')

  const fresh={ok:true,welcomeCompleted:false,completed:false,requiredReady:false,quickSetupSeen:false,
    biliVerified:false,headlessVerified:false,hasCredential:false,missing:['B站登录验证','Headless 模型同步与验证'],skipped:[]}
  banner=show(fresh)
  assert.equal(banner.dataset.kind,'setup')
  assert.equal(element('fs-quick-ack').hidden,true)
  assert.equal(element('fs-complete').hidden,false)
  assert.equal(element('fs-complete').disabled,false,'未完成的用户仍应点击得到准确缺项说明')
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-bili-state')
  assert.equal(element('[data-tab="life"]').hidden,true)
  show({...fresh,biliVerified:true,missing:['Headless 模型同步与验证']})
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-headless-state')
  show({...fresh,requiredReady:true,biliVerified:true,headlessVerified:true,missing:[]})
  assert.equal(element('fs-complete').hidden,false)
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-final-stage')
  banner=show({...old,completed:false,requiredReady:false,quickSetupSeen:true,headlessVerified:false,missing:['Headless 模型同步与验证']})
  assert.equal(banner.dataset.kind,'repair')
  assert.equal(element('fs-complete').hidden,true)
  assert.equal(element('fs-quick-ack').hidden,true)
  assert.equal(element('[data-tab="life"]').hidden,true,'实际模型验证失效不等于仅需确认版本')
  const foundation={...fresh,memoryFoundationReady:true,sessionIntegration:{ok:true,activeMode:'memory-foundation',requestedMode:'memory-foundation',revision:1,restartRequired:false}}
  show(foundation)
  assert.equal(element('fs-mode-foundation').checked,true)
  assert.equal(element('fs-mode-autonomous').checked,false)
  assert.equal(element('fs-integration-current').dataset.state,'active')
  assert.equal(element('fs-integration-save').disabled,true,'当前模式无需重复保存')
  assert.equal(element('fs-platform-setup').open,false,'平台设置在独立记忆工作区默认折叠')
  assert.equal(element('fs-platform-summary').hidden,false)
  element('fs-platform-setup').open=true
  show(foundation)
  assert.equal(element('fs-platform-setup').open,true,'状态刷新不折叠用户已展开的设置')
  element('fs-mode-foundation').checked=false;element('fs-mode-autonomous').checked=true
  show(foundation)
  assert.equal(element('fs-mode-autonomous').checked,true,'相同代际的状态刷新保留待保存选择')
  assert.equal(element('fs-integration-save').disabled,false)
  assert.match(element('fs-integration-state').textContent,/尚未保存/)
  assert.match(element('fs-integration-current').textContent,/记忆基座/,'草稿选择不能冒充当前生效模式')
  assert.equal(element('fs-foundation-memory').hidden,false)
  assert.equal(element('fs-complete').hidden,true)
  assert.match(element('fs-summary').textContent,/记忆入口/)
  assert.equal(element('[data-tab="life"]').hidden,true)
  show({...fresh,sessionIntegration:{ok:true,activeMode:'autonomous-life',requestedMode:'memory-foundation',revision:0,restartRequired:true}})
  assert.equal(element('fs-integration-save').disabled,true)
  assert.equal(element('fs-foundation-memory').hidden,true)
  assert.match(element('fs-integration-state').textContent,/退出 DSH/)
  assert.equal(element('fs-mode-autonomous').disabled,true)
  assert.equal(element('fs-mode-foundation').disabled,true)
  assert.equal(element('fs-integration-current').dataset.state,'pending')
  show({...fresh,sessionIntegration:{ok:true,activeMode:'unknown',requestedMode:'memory-foundation',revision:0,restartRequired:false}})
  assert.equal(element('fs-integration-current').dataset.state,'error')
  assert.equal(element('fs-integration-save').disabled,true)
  context.mobileViewOnly=true
  show(foundation)
  assert.equal(element('fs-mode-foundation').disabled,true)
  assert.equal(element('fs-integration-save').disabled,true)
  show(fresh)
  assert.equal(element('fs-complete').disabled,true,'手机端只读不可获得写入权限')
})


test('新用户完成按钮先实时读取必需项，缺失时定位且不发送完成请求',async()=>{
  const js=read('lib/management-console.js')
  const begin=js.indexOf('  const completeFirstStart=async()=>{')
  const end=js.indexOf("  $('fs-complete').addEventListener",begin)
  assert.ok(begin>=0&&end>begin)
  const create=(status)=>{
    const calls=[],jumps=[]
    const context={
      skipFirstStart:new Set(['main-session']),active:'home',
      request:async(path,body)=>{
        calls.push([path,body]);
        if(path==='/onboarding/status')return status
        if(path==='/onboarding/complete')return {ok:true}
        throw Error('unexpected request: '+path)
      },
      renderFirstStart:()=>{},
      switchTab:async tab=>{jumps.push('tab:'+tab);context.active=tab},
      $:id=>({id}),
      revealTarget:node=>jumps.push('anchor:'+node.id),
      loadFirstStart:async()=>status,
      message:value=>jumps.push('message:'+value)
    }
    return {fn:runInNewContext(js.slice(begin,end)+'\ncompleteFirstStart',context),calls,jumps}
  }
  const missing=create({ok:true,welcomeCompleted:false,completed:false,requiredReady:false,biliVerified:false,
    missing:['B站登录验证','Headless 模型同步与验证']})
  await assert.rejects(missing.fn(),/B站登录验证.*Headless.*不能跳过/)
  assert.deepEqual(missing.calls.map(x=>x[0]),['/onboarding/status'])
  assert.deepEqual(missing.jumps,['tab:firststart','anchor:fs-bili-state'])
  const headless=create({ok:true,welcomeCompleted:false,completed:false,requiredReady:false,biliVerified:true,
    missing:['Headless 模型同步与验证']})
  await assert.rejects(headless.fn(),/Headless/)
  assert.deepEqual(headless.jumps,['tab:firststart','anchor:fs-headless-state'])
  const ready=create({ok:true,welcomeCompleted:false,completed:false,requiredReady:true,biliVerified:true,
    missing:[]})
  await ready.fn()
  assert.deepEqual(ready.calls.map(x=>x[0]),['/onboarding/status','/onboarding/complete'])
  assert.equal(ready.calls[1][1].skipped[0],'main-session')
  assert.ok(ready.jumps.includes('tab:home'))
  const past=create({ok:true,welcomeCompleted:true,completed:true,requiredReady:true})
  await assert.rejects(past.fn(),/已完成首次配置/)
  assert.deepEqual(past.calls.map(x=>x[0]),['/onboarding/status'])
})
