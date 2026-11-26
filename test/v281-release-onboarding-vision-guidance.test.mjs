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
  assert.match(page,/id="models-vision-mode"/)
  assert.match(page,/自动修复视觉运行环境/)
  assert.match(page,/人工认可/)
  assert.match(page,/id="fs-wizard-video"/);assert.match(js,/moveWizardControl\(\$\('models-vision-shell'\)\)/)
  assert.match(js,/await confirmAction\(\{title:'安装 FFmpeg？'/)
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
  assert.doesNotMatch(html,/fs-initial-social|启用新安装推荐社交能力/)
  assert.doesNotMatch(js,/fs-initial-social|initialSocialOffer|ENABLE_INITIAL_RECOMMENDATIONS/)

  // Exercise the real production render function with a minimal DOM double.
  // No independent duplicate UI policy is reimplemented inside the test.
  const begin=js.indexOf('  // UI-only dependency observation.')
  const end=js.indexOf('  // All dependency *installation*',begin)
  assert.ok(begin>=0&&end>begin)
  const nodes=new Map()
  const element=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,dataset:{},textContent:'',className:'',title:'',attributes:{},style:{},classList:{add(){},remove(){}},addEventListener(){},replaceChildren(){},removeAttribute(){},removeAttribute(name){delete this.attributes[name]},
      setAttribute(name,value){this.attributes[name]=String(value)},appendChild(child){child.parentElement=this},after(child){child.parentElement=null},before(child){child.parentElement=null}})
    return nodes.get(id)
  }
  const context={
    syncFavoriteNav:()=>{},onboarding:null,quickOptions:null,mobileViewOnly:false,firstNavigation:true,active:'firststart',tabNames:['firststart','models','home','life','social','life-agent','plans','backup'],
    $:element,document:{querySelector:selector=>element(selector)}
  }
  const policy=js.slice(js.indexOf('  const capabilityKeys='),js.indexOf('  const skipFirstStart='));
  const production=js.slice(begin,end).replace(/const mountWizardPage=stage=>\{[\s\S]*?\r?\n  \};\r?\n  const renderSetupGuide=/,'const mountWizardPage=stage=>{wizardMounted=stage};\n  const renderSetupGuide=');
  const render=runInNewContext(policy+production+'\n({renderFirstStart,getStep:()=>wizardMounted,setDefaultDone:()=>{wizardDefaultDone=true;renderSetupGuide(onboarding)},setRuntimeReady:value=>{setupMainReady=value;renderSetupGuide(onboarding)},setQuickOptions:value=>{quickOptions=value;renderSetupGuide(onboarding)}})',context)
  const show=state=>{render.renderFirstStart(state);return element('fs-warning')}
  const old={ok:true,welcomeCompleted:true,completed:true,requiredReady:true,quickSetupSeen:false,
    biliVerified:true,headlessVerified:true,hasCredential:true,missing:[],skipped:[],localMemoryReady:true,capabilities:{ok:true,available:true,active:{platform:true,autonomous:true,persona:true,automaticMemory:true,bridge:true},requested:{platform:true,autonomous:true,persona:true,automaticMemory:true,bridge:true},revision:0,restartRequired:false}}
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
    biliVerified:false,headlessVerified:false,hasCredential:false,missing:['B站登录验证','Headless 模型同步与验证'],skipped:[],localMemoryReady:true,capabilities:old.capabilities}
  banner=show(fresh)
  assert.equal(banner.dataset.kind,'setup')
  assert.equal(render.getStep(),'runtime')
  render.setRuntimeReady(true)
  assert.equal(render.getStep(),'account')
  assert.equal(element('fs-guide-runtime').dataset.state,'done')
  assert.equal(element('fs-quick-ack').hidden,true)
  assert.equal(element('fs-complete').hidden,false)
  assert.equal(element('fs-complete').disabled,false)
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-bili-state')
  assert.equal(element('[data-tab="life"]').hidden,false)
  show({...fresh,biliVerified:true,missing:['Headless 模型同步与验证']})
  assert.equal(element('fs-warning-open').dataset.openAnchor,'fs-headless-state')
  assert.equal(render.getStep(),'model')
  show({...fresh,requiredReady:true,biliVerified:true,headlessVerified:true,missing:[]})
  assert.equal(render.getStep(),'model','验证后保留同步与默认模型的同一实际面板')
  assert.equal(element('fs-wizard-step').textContent,'步骤 4 / 12')
  render.setDefaultDone()
  assert.equal(render.getStep(),'core')
  assert.equal(element('fs-wizard-continue').disabled,false)
  assert.equal(element('fs-guide-count').textContent,'3 / 3 必要项就绪')
  show({...fresh,requiredReady:false,biliVerified:true,headlessVerified:true})
  assert.equal(render.getStep(),'core')
  assert.equal(element('fs-wizard-continue').disabled,true,'展示检查不能绕过服务端总准入')
  render.setRuntimeReady(null)
  assert.equal(render.getStep(),'runtime','依赖状态失效不能继续显示已就绪')
  render.setRuntimeReady(true)
  banner=show({...old,completed:false,requiredReady:false,quickSetupSeen:true,headlessVerified:false,missing:['Headless 模型同步与验证']})
  assert.equal(banner.dataset.kind,'repair')
  assert.equal(element('fs-complete').hidden,true)
  assert.equal(element('fs-quick-ack').hidden,true)
  assert.equal(element('[data-tab="life"]').hidden,false,'独立记忆不受模型验证失效影响')
  const local={...fresh,localMemoryReady:true,capabilities:{ok:true,available:true,active:{platform:false,autonomous:false,persona:false,automaticMemory:false,bridge:false},requested:{platform:false,autonomous:false,persona:false,automaticMemory:false,bridge:false},revision:1,restartRequired:false}}
  show({...old,capabilities:local.capabilities})
  assert.equal(element('management-shell').dataset.platform,'off')
  for(const tab of ['social','life-agent','plans','backup'])assert.equal(element(`[data-tab="${tab}"]`).hidden,true)
  for(const tab of ['home','models','life','firststart'])assert.equal(element(`[data-tab="${tab}"]`).hidden,false)
  assert.equal(element('life-system-health').hidden,true)
  show(local)
  assert.equal(element('fs-guided-setup').hidden,true)
  assert.equal(element('fs-cap-platform').checked,false)
  assert.equal(element('fs-cap-autonomous').checked,false)
  assert.equal(element('fs-integration-current').dataset.state,'active')
  assert.equal(element('fs-integration-save').disabled,true)
  element('fs-platform-setup').open=true
  show(local)
  assert.equal(element('fs-platform-setup').open,true)
  element('fs-cap-platform').checked=true
  show(local)
  assert.equal(element('fs-cap-platform').checked,true,'相同代际保留草稿')
  assert.equal(element('fs-integration-save').disabled,false)
  assert.match(element('fs-integration-state').textContent,/尚未保存/)
  assert.match(element('fs-integration-current').textContent,/当前配置已生效/)
  assert.equal(element('core-quick-links').hidden,false)
  assert.equal(element('fs-complete').hidden,true)
  assert.match(element('fs-summary').textContent,/鱼的记忆/)
  show({...fresh,localMemoryReady:false,capabilities:{...old.capabilities,available:false,requested:local.capabilities.active,restartRequired:true}})
  assert.equal(element('fs-integration-save').disabled,true)
  assert.equal(element('core-quick-links').hidden,true)
  assert.match(element('fs-integration-state').textContent,/退出 DSH/)
  assert.equal(element('fs-cap-platform').disabled,true)
  assert.equal(element('fs-cap-autonomous').disabled,true)
  assert.equal(element('fs-integration-current').dataset.state,'pending')
  assert.equal(element('management-shell').dataset.platform,'checking')
  for(const tab of ['home','models','life','backup','life-agent','social'])assert.equal(element(`[data-tab="${tab}"]`).hidden,true)
  show({...fresh,capabilities:{ok:false}})
  assert.equal(element('fs-integration-current').dataset.state,'error')
  assert.equal(element('fs-integration-save').disabled,true)
  context.mobileViewOnly=true
  show(local)
  assert.equal(element('fs-cap-platform').disabled,true)
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
      launchWizard:()=>jumps.push('wizard'),
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
  assert.deepEqual(ready.calls.map(x=>x[0]),['/onboarding/status'])
  assert.deepEqual(ready.jumps,['tab:firststart','wizard'])
  const past=create({ok:true,welcomeCompleted:true,completed:true,requiredReady:true})
  await assert.rejects(past.fn(),/已完成首次配置/)
  assert.deepEqual(past.calls.map(x=>x[0]),['/onboarding/status'])
})


test('记忆基座 Session 指南与正式文档一致，复制仅本地且保留移动端只读',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js'),doc=read('docs/SESSION_INTEGRATION.md');
  const text=html.match(/<textarea id="fs-foundation-guide-text"[^>]*readonly[^>]*>([\s\S]*?)<\/textarea>/)?.[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  assert.equal(text?.replace(/\r\n/g,'\n'),doc.replace(/\r\n/g,'\n').match(/```text\n([\s\S]*?)\n```/)?.[1]);
  for(const name of ['dafeiyu_remember','dafeiyu_memory_recall','dafeiyu_life_recall'])assert.ok(text.includes(name)&&read('lib/long-term-memory.mjs').includes("name:'"+name+"'"));
  const copy=js.slice(js.indexOf("$('fs-foundation-guide-copy').addEventListener"),js.indexOf('const renderSessionMount='));
  assert.match(copy,/navigator\.clipboard\.writeText\(guide\.value\)/);assert.match(copy,/guide\.select\(\)/);assert.doesNotMatch(copy,/request\(|fetch\(/);
  assert.match(js,/mobileReadOnlySelector=.*#fs-foundation-guide-copy/);assert.match(js,/#fs-foundation-guide-text\[readonly\]/);
})
