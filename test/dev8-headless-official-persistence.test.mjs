import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHeadlessModelSync} from '../lib/headless-model-sync.mjs'

const root=()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-headless-official-'))
  const stateDir=join(home,'bili-duty')
  const desktop=join(home,'profiles','desktop','cordis.patch.yml')
  const headless=join(home,'profiles','headless','cordis.patch.yml')
  const global=join(home,'cordis.patch.yml')
  mkdirSync(stateDir)
  mkdirSync(join(home,'profiles','desktop'),{recursive:true})
  mkdirSync(join(home,'profiles','headless'),{recursive:true})
  writeFileSync(desktop,'[]\n');writeFileSync(headless,'[]\n')
  return {home,stateDir,desktop,headless,global,close:()=>rmSync(home,{recursive:true,force:true})}
}
const hasYaml=await import('yaml').then(()=>true,()=>false)
const providerYml=(apiKey='API_KEY')=>`- id: llm-pi-ai
  config:
    providers:
      custom:
        api: openai-completions
        apiKeyEnv: ${apiKey}
        baseURL: https://api.example.com/v1
        models:
          - id: custom-model
`

// The receipt does not grant Headless permission without a real probe.
test('官方已注册模型：无 YAML 同步、真实探针失败时不能解锁', {skip:!hasYaml&&'需要 yaml 生产依赖'},async()=>{
  const f=root()
  let registered=true
  try {
    const s=createHeadlessModelSync({home:f.home,stateDir:f.stateDir,
      registeredModels:async()=>[{id:'deepseek-official',models:['deepseek-v4-flash']}],
      isRegistered:id=>registered&&id==='deepseek-official'})
    const status=await s.status()
    const route=status.providers.find(p=>p.id==='deepseek-official')
    assert.equal(route.kind,'registered')
    assert.equal(route.synced,true)
    assert.deepEqual(route.models,['deepseek-v4-flash'])
    assert.deepEqual(route.verifiedModels,[])
    await assert.rejects(s.preview('desktop',['deepseek-official']),/没有 Provider/)
    await assert.rejects(s.verified({provider:'deepseek-official',model:'deepseek-v4-flash',probe:async()=>{throw Error('HEADLESS_UNAVAILABLE')}}),/HEADLESS_UNAVAILABLE/)
    assert.equal(s.hasAnyVerified(),false)
    await s.verified({provider:'deepseek-official',model:'deepseek-v4-flash',probe:async route=>{
      assert.equal(route.provider,'deepseek-official');assert.equal(route.model,'deepseek-v4-flash')
    }})
    assert.equal(s.assertReady({provider:'deepseek-official',model:'deepseek-v4-flash'}),true)
    assert.equal(s.hasAnyVerified(),true)
    assert.equal(readFileSync(f.headless,'utf8'),'[]\n')
    // Unrelated file edits cannot invalidate an official adapter probe.
    writeFileSync(f.headless,'# plugin updated\n[]\n')
    writeFileSync(f.desktop,'# another plugin changed\n[]\n')
    assert.equal(s.assertReady({provider:'deepseek-official',model:'deepseek-v4-flash'}),true)
    registered=false
    assert.throws(()=>s.assertReady({provider:'deepseek-official',model:'deepseek-v4-flash'}),/尚未同步并通过连接验证/)
  }finally{f.close()}
})

test('仅列出真正注册的 Provider/模型；不能根据提供方名字猜可用模型',{skip:!hasYaml&&'需要 yaml 生产依赖'},async()=>{
  const f=root()
  try {
    const s=createHeadlessModelSync({home:f.home,stateDir:f.stateDir,
      registeredModels:async()=>[{id:'deepseek-official',models:['deepseek-v4-flash']},{id:'imposter',models:['fake']}],
      isRegistered:id=>id==='deepseek-official'})
    const status=await s.status()
    assert.deepEqual(status.providers.map(p=>p.id),['deepseek-official'])
    await assert.rejects(s.verified({provider:'deepseek-official',model:'nonexistent',probe:async()=>{}}),/未注册/)
    await assert.rejects(s.verified({provider:'imposter',model:'fake',probe:async()=>{}}),/未注册/)
  }finally{f.close()}
})

test('自定义 Provider：无关 YAML 变化不吊销验证，真实路由变化必须重验',{skip:!hasYaml&&'需要 yaml 生产依赖'},async()=>{
  const f=root()
  try {
    writeFileSync(f.desktop,providerYml())
    writeFileSync(f.headless,providerYml())
    const s=createHeadlessModelSync({home:f.home,stateDir:f.stateDir})
    await s.verified({provider:'custom',model:'custom-model',probe:async()=>{}})
    assert.equal(s.assertReady({provider:'custom',model:'custom-model'}),true)
    writeFileSync(f.desktop,'# unrelated comment\n'+providerYml())
    writeFileSync(f.headless,'# another plugin comment\n'+providerYml())
    writeFileSync(f.global,'- id: unrelated-plugin\n  config:\n    enabled: true\n')
    assert.equal(s.assertReady({provider:'custom',model:'custom-model'}),true)
    assert.equal((await s.status()).providers[0].verifiedModels[0],'custom-model')
    // YAML key ordering is not a meaningful model-route change either.
    const reordered=providerYml().replace('        api: openai-completions\n        apiKeyEnv: API_KEY\n        baseURL: https://api.example.com/v1\n',
      '        baseURL: https://api.example.com/v1\n        apiKeyEnv: API_KEY\n        api: openai-completions\n')
    writeFileSync(f.desktop,reordered);writeFileSync(f.headless,reordered)
    assert.equal(s.assertReady({provider:'custom',model:'custom-model'}),true)
    writeFileSync(f.desktop,providerYml('CHANGED_KEY_ENV'))
    assert.throws(()=>s.assertReady({provider:'custom',model:'custom-model'}),/尚未同步并通过连接验证/)
    writeFileSync(f.headless,providerYml('CHANGED_KEY_ENV'))
    assert.throws(()=>s.assertReady({provider:'custom',model:'custom-model'}),/尚未同步并通过连接验证/)
    await s.verified({provider:'custom',model:'custom-model',probe:async()=>{}})
    assert.equal(s.assertReady({provider:'custom',model:'custom-model'}),true)
    writeFileSync(f.headless,'[]\n')
    assert.throws(()=>s.assertReady({provider:'custom',model:'custom-model'}),/尚未同步并通过连接验证/)
  }finally{f.close()}
})

test('旧版有效的真实连接回执可以迁移为不受无关配置扰动的稳定回执',{skip:!hasYaml&&'需要 yaml 生产依赖'},async()=>{
  const f=root()
  try {
    writeFileSync(f.desktop,providerYml())
    writeFileSync(f.headless,providerYml())
    const {createHash}=await import('node:crypto')
    const hash=createHash('sha256').update(JSON.stringify(['desktop',readFileSync(f.desktop,'utf8'),'',''+readFileSync(f.headless,'utf8')])).digest('hex')
    writeFileSync(join(f.stateDir,'headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'custom',model:'custom-model',fingerprint:hash}]}))
    const s=createHeadlessModelSync({home:f.home,stateDir:f.stateDir})
    assert.equal(s.hasAnyVerified(),true)
    assert.equal(JSON.parse(readFileSync(join(f.stateDir,'headless-model-verified.json'),'utf8')).version,2)
    writeFileSync(f.headless,'# comment\n'+providerYml())
    assert.equal(s.hasAnyVerified(),true)
  }finally{f.close()}
})

test('无效的旧校验回执不能通过迁移伪造成当前有效的模型验证',{skip:!hasYaml&&'需要 yaml 生产依赖'},async()=>{
  const f=root()
  try {
    writeFileSync(f.desktop,providerYml());writeFileSync(f.headless,providerYml())
    writeFileSync(join(f.stateDir,'headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'custom',model:'custom-model',fingerprint:'not-real'}]}))
    const s=createHeadlessModelSync({home:f.home,stateDir:f.stateDir})
    assert.equal(s.hasAnyVerified(),false)
    assert.throws(()=>s.assertReady({provider:'custom',model:'custom-model'}),/尚未同步并通过连接验证/)
  }finally{f.close()}
})

test('宿主模型发现与官方直接验证已接入实际 HTTP 和 First Start 安全门禁',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(host,/listLiveModels=async/)
  assert.match(host,/llm\.listModels\(id\)/)
  assert.match(host,/registeredModels:listLiveModels/)
  assert.match(host,/headlessSync\.verified/)
  assert.match(host,/assertSafeHeadlessLaunch/)
  assert.match(html,/官方内置模型直接进行 Headless 真实连接验证/)
  assert.match(js,/p\.kind==='registered'/)
  assert.match(js,/Headless 请求/)
})
