import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createHeadlessModelSync, sanitizeProvider } from '../lib/headless-model-sync.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const fixture=()=>{
  const home=mkdtempSync(join(tmpdir(),'dafeiyu-sync-'))
  const stateDir=join(home,'bili-duty'),desktop=join(home,'profiles','desktop','cordis.patch.yml'),target=join(home,'profiles','headless','cordis.patch.yml'),global=join(home,'cordis.patch.yml')
  mkdirSync(stateDir);mkdirSync(join(home,'profiles','desktop'),{recursive:true});mkdirSync(join(home,'profiles','headless'),{recursive:true})
  writeFileSync(desktop,'- id: llm-pi-ai\n  config:\n    providers:\n      claude:\n        api: anthropic-messages\n        models: [{id: claude-haiku-5-5}]\n')
  writeFileSync(target,'[]\n')
  return {home,stateDir,desktop,target,global,dispose:()=>rmSync(home,{recursive:true,force:true})}
}
test('从未验证的 headless 路由一律拒绝，不能绕过为默认模型',()=>{
  const f=fixture()
  try {
    const s=createHeadlessModelSync(f)
    assert.throws(()=>s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步并通过连接验证/)
    assert.throws(()=>s.assertReady({provider:'',model:''}),/Provider/)
    assert.throws(()=>s.assertReady({provider:'gpt\n- id: shell',model:'a'}),/Provider/)
  }finally{f.dispose()}
})
test('验证回执与源、目标、全局文件指纹绑定；改动配置立刻吊销',()=>{
  const f=fixture()
  try {
    const s=createHeadlessModelSync(f)
    const digest=()=>hash(JSON.stringify(['desktop',readFileSync(f.desktop,'utf8'),'',''+readFileSync(f.target,'utf8')]))
    const stamp={version:1,verified:[{profile:'desktop',provider:'claude',model:'claude-haiku-5-5',fingerprint:digest()}]}
    writeFileSync(join(f.stateDir,'headless-model-verified.json'),JSON.stringify(stamp))
    assert.equal(s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),true)
    assert.throws(()=>s.assertReady({provider:'claude',model:'other'}),/尚未同步/)
    writeFileSync(f.target,'# updated\n[]\n')
    assert.throws(()=>s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步/)
    writeFileSync(f.target,'[]\n')
    writeFileSync(f.global,'# global changed\n')
    assert.throws(()=>s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步/)
  }finally{f.dispose()}
})
test('自动同步禁止复制明文密钥、鉴权请求头和带令牌的 URL',()=>{
  const base={api:'openai-completions',apiKeyEnv:'GPT_API_KEY',baseURL:'https://4router.net/v1',models:[{id:'gpt-6.1-terra'}]}
  assert.deepEqual(sanitizeProvider(base),base)
  assert.throws(()=>sanitizeProvider({...base,apiKey:'sensitive'}),/凭据/)
  assert.throws(()=>sanitizeProvider({...base,headers:{Authorization:'abc'}}),/凭据/)
  assert.throws(()=>sanitizeProvider({...base,baseURL:'https://site.test/v1?token=123'}),/Base URL/)
  assert.throws(()=>sanitizeProvider({...base,baseURL:'http://remote.test/v1'}),/HTTP/)
  assert.throws(()=>sanitizeProvider({...base,models:[{id:'bad\nnew'}]}),/模型列表/)
})
test('管理页必须有明确选择、预览、确认、后台验证和未同步拦截',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  for(const id of ['headless-source-list','headless-target-list','headless-sync-board','headless-capability-dialog','headless-sync-status']) assert.match(html,new RegExp(id))
  for(const route of ['/headless-model/status','/headless-model/preview','/headless-model/sync','/headless-model/capabilities-preview','/headless-model/capabilities','/headless-model/verify']) assert.ok(js.includes(route),route)
  assert.match(index,/action==='capabilities-preview'/)
  assert.match(index,/action==='capabilities'/)
  assert.match(html,/data-headless-effort="max"/)
  assert.match(host,/assertVerifiedHeadless\(args,overlay,\{kind:homeFirst\?'home':'main'/)
  assert.match(host,/assertVerifiedHeadless\(visionArgs/)
  assert.match(host,/assertVerifiedHeadless\(memArgs/)
  assert.match(host,/hostLlmService\(ctx\)/)
})

test('真实 YAML：预览、精确同步、保留原条目并通过 Headless 探针后解锁',async t=>{
  try { await import('yaml') } catch { t.skip('当前隔离环境尚未安装生产依赖 yaml；需在 npm install 后重跑');return }
  const f=fixture()
  try {
    writeFileSync(f.desktop,`- id: llm-pi-ai
  config:
    providers:
      claude:
        displayName: Claude
        api: anthropic-messages
        apiKeyEnv: CLAUDE_API_KEY
        baseURL: https://4router.net
        models:
          - id: claude-haiku-5-5
`)
    writeFileSync(f.target,`- id: unrelated-plugin
  config:
    enabled: true
- id: llm-pi-ai
  config:
    providers:
      preserved:
        api: openai-completions
        models:
          - id: old-model
`)
    const s=createHeadlessModelSync(f)
    const initial=await s.status();assert.equal(initial.providers[0].id,'claude')
    assert.equal(initial.providers[0].synced,false)
    const plan=await s.preview('desktop',['claude'])
    assert.equal(plan.selected[0].overwrite,false)
    await assert.rejects(s.sync({profile:'desktop',selected:['claude'],previewToken:'f'.repeat(64)}),/预览|过期/)
    const after=await s.sync({profile:'desktop',selected:['claude'],previewToken:plan.previewToken})
    assert.equal(after.verified,false)
    assert.match(readFileSync(f.target,'utf8'),/unrelated-plugin/)
    assert.match(readFileSync(f.target,'utf8'),/preserved/)
    assert.throws(()=>s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步/)
    await assert.rejects(s.verified({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',probe:async()=>{throw Error('NO_ADAPTER')}}),/NO_ADAPTER/)
    assert.throws(()=>s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步/)
    await s.verified({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',probe:async()=>{}})
    assert.equal(s.assertReady({provider:'claude',model:'claude-haiku-5-5'}),true)
  } finally {f.dispose()}
})

test('Headless 能力向导只补充目标模型声明、保留来源与凭据，并使旧验证回执失效',async t=>{
  try { await import('yaml') } catch { t.skip('当前隔离环境尚未安装生产依赖 yaml；需在 npm install 后重跑');return }
  const f=fixture()
  try{
    let sourceText=`- id: llm-pi-ai
  config:
    providers:
      claude:
        displayName: Claude Relay
        api: anthropic-messages
        apiKeyEnv: CLAUDE_RELAY_KEY
        baseURL: https://relay.example/v1
        models:
          - id: claude-haiku-5-5
`
    writeFileSync(f.desktop,sourceText)
    const sync=createHeadlessModelSync(f)
    const plan=await sync.preview('desktop',['claude'])
    await sync.sync({profile:'desktop',selected:['claude'],previewToken:plan.previewToken})
    const capabilityPlan=await sync.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',
      addInput:['text','image'],addReasoningEfforts:['off','low','medium','high','xhigh','max']})
    assert.deepEqual(capabilityPlan.addedInput,['image','text'])
    assert.deepEqual(capabilityPlan.addedReasoningEfforts,['high','low','max','medium','off','xhigh'])
    writeFileSync(f.target,readFileSync(f.target,'utf8')+'\n# concurrent operator change\n')
    await assert.rejects(sync.setCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',
      addInput:['text','image'],addReasoningEfforts:['off','low','medium','high','xhigh','max'],previewToken:capabilityPlan.previewToken}),/配置已变化/)
    const freshCapabilityPlan=await sync.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',
      addInput:['text','image'],addReasoningEfforts:['off','low','medium','high','xhigh','max']})
    const changed=await sync.setCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',
      addInput:['text','image'],addReasoningEfforts:['off','low','medium','high','xhigh','max'],previewToken:freshCapabilityPlan.previewToken})
    assert.equal(changed.changed,true)
    assert.equal(changed.verified,false)
    assert.equal(readFileSync(f.desktop,'utf8'),sourceText,'Desktop 来源配置必须逐字节保持不变')
    const status=await sync.status('desktop')
    const provider=status.providers.find(x=>x.id==='claude')
    assert.equal(provider.synced,true,'能力声明差异不应误报 Provider 未同步')
    assert.equal(provider.capabilityEditable,true)
    assert.equal(provider.modelDetails[0].headless.textInputDeclared,true)
    assert.equal(provider.modelDetails[0].headless.imageInputDeclared,true)
    assert.deepEqual(provider.modelDetails[0].headless.reasoningEfforts,['high','low','max','medium','off','xhigh'])
    assert.equal(provider.modelDetails[0].headlessOnlyOverride,true)
    const headlessText=readFileSync(f.target,'utf8')
    assert.match(headlessText,/apiKeyEnv: CLAUDE_RELAY_KEY/)
    assert.match(headlessText,/input:[\s\S]{0,80}image/)
    assert.throws(()=>sync.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步并通过连接验证/)
    await sync.verified({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',probe:async()=>{}})
    assert.equal(sync.assertReady({provider:'claude',model:'claude-haiku-5-5'}),true)

    const resync=await sync.preview('desktop',['claude'])
    await sync.sync({profile:'desktop',selected:['claude'],previewToken:resync.previewToken})
    assert.match(readFileSync(f.target,'utf8'),/input:[\s\S]{0,80}image/,'重新同步不能悄悄抹掉 Headless 专属补充')
    assert.equal(sync.assertReady({provider:'claude',model:'claude-haiku-5-5'}),true,'配置语义未变时保留有效验证回执')

    sourceText=sourceText.replace('https://relay.example/v1','https://relay.example/v2')
    writeFileSync(f.desktop,sourceText)
    const routeChange=await sync.preview('desktop',['claude'])
    assert.equal(routeChange.selected[0].routeChanged,true)
    assert.deepEqual(routeChange.selected[0].headlessCapabilityOverrides,['claude-haiku-5-5'])
    await sync.sync({profile:'desktop',selected:['claude'],previewToken:routeChange.previewToken})
    assert.match(readFileSync(f.target,'utf8'),/baseURL: https:\/\/relay\.example\/v2/)
    assert.match(readFileSync(f.target,'utf8'),/input:[\s\S]{0,80}image/,'Provider 路由变化后仍保留已确认的 Headless 能力')
    assert.throws(()=>sync.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步并通过连接验证/)

    const resetPlan=await sync.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',reset:true})
    await sync.setCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',reset:true,previewToken:resetPlan.previewToken})
    const resetStatus=await sync.status('desktop')
    const resetModel=resetStatus.providers.find(x=>x.id==='claude').modelDetails[0]
    assert.equal(resetModel.headless.imageInputDeclared,null)
    assert.equal(resetModel.headless.reasoningEffortsDeclared,false)
    assert.equal(resetModel.headlessOnlyOverride,false)
    assert.equal(readFileSync(f.desktop,'utf8'),sourceText)
    assert.throws(()=>sync.assertReady({provider:'claude',model:'claude-haiku-5-5'}),/尚未同步并通过连接验证/)
  }finally{f.dispose()}
})

test('Headless 能力向导拒绝未同步路由、非法声明及修改全局共享模型',async t=>{
  try { await import('yaml') } catch { t.skip('当前隔离环境尚未安装生产依赖 yaml；需在 npm install 后重跑');return }
  const f=fixture()
  try{
    const s=createHeadlessModelSync(f)
    await assert.rejects(s.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',addInput:['text']}),/先将此 Provider 同步/)
    const plan=await s.preview('desktop',['claude'])
    await s.sync({profile:'desktop',selected:['claude'],previewToken:plan.previewToken})
    await assert.rejects(s.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',addInput:['shell']}),/输入能力/)
    writeFileSync(f.global,`- id: llm-pi-ai\n  config:\n    providers:\n      claude:\n        api: anthropic-messages\n        models: [{id: claude-haiku-5-5}]\n`)
    await assert.rejects(s.previewCapabilities({profile:'desktop',provider:'claude',model:'claude-haiku-5-5',addInput:['image']}),/全局共享配置/)
  }finally{f.dispose()}
})

test('真实 YAML：全局共享 Provider 不修改 Headless 配置，只需实际探针验证',async t=>{
  try { await import('yaml') } catch { t.skip('当前隔离环境尚未安装生产依赖 yaml；需在 npm install 后重跑');return }
  const f=fixture()
  try {
    writeFileSync(f.global,`- id: llm-pi-ai
  config:
    providers:
      gpt:
        displayName: gpt
        api: openai-completions
        apiKeyEnv: GPT_API_KEY
        baseURL: https://4router.net/v1
        models:
          - id: gpt-6.1-terra
`)
    const s=createHeadlessModelSync(f)
    const status=await s.status()
    assert.equal(status.globalOverride,true)
    assert.equal(status.providers[0].synced,true)
    assert.equal(status.providers[0].capabilityEditable,false)
    await assert.rejects(s.preview('desktop',['gpt']),/全局共享配置/)
    await assert.rejects(s.previewCapabilities({profile:'desktop',provider:'gpt',model:'gpt-6.1-terra',addInput:['image']}),/全局共享配置/)
    await s.verified({profile:'desktop',provider:'gpt',model:'gpt-6.1-terra',probe:async()=>{}})
    assert.equal(s.assertReady({provider:'gpt',model:'gpt-6.1-terra'}),true)
    assert.equal(readFileSync(f.target,'utf8'),'[]\n')
  } finally {f.dispose()}
})
