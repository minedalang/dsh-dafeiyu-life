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
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  for(const id of ['headless-sync-preview','headless-sync-commit','headless-provider-list','headless-sync-status']) assert.match(html,new RegExp(id))
  for(const route of ['/headless-model/status','/headless-model/preview','/headless-model/sync','/headless-model/verify']) assert.ok(js.includes(route),route)
  assert.match(host,/assertVerifiedHeadless\(args,overlay,\{kind:'main'/)
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
    await assert.rejects(s.preview('desktop',['gpt']),/全局共享配置/)
    await s.verified({profile:'desktop',provider:'gpt',model:'gpt-6.1-terra',probe:async()=>{}})
    assert.equal(s.assertReady({provider:'gpt',model:'gpt-6.1-terra'}),true)
    assert.equal(readFileSync(f.target,'utf8'),'[]\n')
  } finally {f.dispose()}
})
