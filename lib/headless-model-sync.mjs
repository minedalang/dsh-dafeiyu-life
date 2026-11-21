/**
 * Explicit Desktop/Web -> headless provider sync. Never copy credentials, tools,
 * account sessions or arbitrary profile patches. Writes only llm-pi-ai providers.
 * A model is allowed in a separate headless process ONLY after a real tool-less
 * headless probe of that provider+model has succeeded.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const sha = s => createHash('sha256').update(String(s)).digest('hex')
const validName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)
const validModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,179}$/.test(value)
const fail = text => { throw Error(text) }
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const allowedInputs = new Set(['text','image','audio','video','file'])
const modelCapability = model => {
  const hasInput = Array.isArray(model?.input)
  const input = hasInput ? [...new Set(model.input.filter(x => typeof x === 'string' && allowedInputs.has(x)))].slice(0,8) : null
  const hasEfforts = isRecord(model?.reasoningEfforts)
  const reasoningEfforts = hasEfforts
    ? Object.keys(model.reasoningEfforts).filter(x => /^[a-zA-Z0-9_-]{1,40}$/.test(x)).sort().slice(0,24)
    : null
  return {
    input,
    textInputDeclared: hasInput ? input.includes('text') : null,
    imageInputDeclared: hasInput ? input.includes('image') : null,
    reasoningEfforts,
    reasoningEffortsDeclared: hasEfforts,
  }
}
const providerSummary = provider => {
  if(!provider)return null
  let baseURL=''
  try{
    const u=new URL(String(provider.baseURL||''))
    if(!u.username&&!u.password&&!u.search&&!u.hash&&['https:','http:'].includes(u.protocol))baseURL=u.origin
  }catch{}
  return {api:String(provider.api||''),baseURL}
}
// Object-key order in YAML is not part of the model route. Fingerprint the
// effective configuration, not its spelling or presentation.
const stableJson = value => JSON.stringify(value, (key, v) => {
  if(key==='input'&&Array.isArray(v))return [...v].sort()
  if (v && typeof v === 'object' && !Array.isArray(v))
    return Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b, 'en')))
  return v
})
const cloneJson=value=>JSON.parse(JSON.stringify(value))
// Desktop remains the source of provider/model routing. Headless may add only
// explicit model-level capability declarations; these two fields are excluded
// from the structural sync comparison but remain inside every probe fingerprint.
const withoutModelCapabilities=provider=>{
  const copy=cloneJson(provider)
  for(const model of copy.models||[]){delete model.input;delete model.reasoningEfforts}
  return copy
}
const providerSyncEquivalent=(source,target)=>!!source&&!!target&&
  stableJson(withoutModelCapabilities(source))===stableJson(withoutModelCapabilities(target))
// A model that stays in a partially synced custom Provider may still be
// verified independently. Never allow unknown extra Headless models or changed
// endpoint/auth settings to inherit a successful probe.
const modelRouteEquivalent=(source,target,model)=>{
  if(!source||!target||!source.models?.some(x=>x.id===model)||!target.models?.some(x=>x.id===model))return false
  if(target.models.some(x=>!source.models.some(y=>y.id===x.id)))return false
  const one=p=>{const copy=cloneJson(p);copy.models=copy.models.filter(x=>x.id===model);return withoutModelCapabilities(copy)}
  return stableJson(one(source))===stableJson(one(target))
}
const modelCapabilityOverride=(sourceModel,targetModel)=>!!targetModel&&
  stableJson({input:sourceModel?.input??null,reasoningEfforts:sourceModel?.reasoningEfforts??null})!==
  stableJson({input:targetModel?.input??null,reasoningEfforts:targetModel?.reasoningEfforts??null})
const mergeHeadlessCapabilities=(sourceProvider,targetProvider)=>{
  const next=cloneJson(sourceProvider)
  if(!targetProvider)return next
  // Provider sync is an explicit user action. Keep capability additions for
  // matching model IDs even when another provider field changed; the complete
  // route fingerprint then invalidates old probes and requires a fresh test.
  for(const model of next.models||[]){
    const previous=targetProvider.models?.find(x=>x?.id===model.id)
    if(!previous)continue
    const sourceInputs=Array.isArray(model.input)?model.input:[]
    const targetInputs=Array.isArray(previous.input)?previous.input:[]
    const inputs=[...new Set([...sourceInputs,...targetInputs].filter(x=>allowedInputs.has(x)))].slice(0,8)
    if(inputs.length)model.input=inputs
    const sourceEfforts=isRecord(model.reasoningEfforts)?model.reasoningEfforts:{}
    const targetEfforts=isRecord(previous.reasoningEfforts)?previous.reasoningEfforts:{}
    const efforts={...targetEfforts,...sourceEfforts}
    if(Object.keys(efforts).length)model.reasoningEfforts=efforts
  }
  return next
}
const read = file => {
  if (!existsSync(file)) return ''
  if (lstatSync(file).isSymbolicLink()) fail('检测到符号链接配置，拒绝写入，请检查 DSH Profile')
  const txt = readFileSync(file, 'utf8')
  if (txt.length > 1024 * 1024) fail('DSH 配置文件过大，需手动检查')
  return txt
}
const normalize = list => {
  if (!Array.isArray(list) || list.length < 1 || list.length > 12 || !list.every(validName) || new Set(list).size !== list.length)
    fail('请选择 1–12 个有效且不重复的 Provider')
  return [...list].sort()
}
const docRows = async raw => {
  const YAML = await import('yaml')
  const doc = YAML.parseDocument(raw || '[]', { uniqueKeys:true, strict:true })
  if (doc.errors.length) fail('配置 YAML 解析失败：'+doc.errors[0].message.slice(0,140))
  const rows = doc.toJS()
  if (!Array.isArray(rows)) fail('DSH 配置格式必须为插件条目数组')
  const entries = rows.filter(x => x && x.id === 'llm-pi-ai')
  if (entries.length > 1) fail('同一配置文件包含多个 llm-pi-ai 条目，请先合并冲突')
  const config = entries[0]?.config
  if (config != null && !isRecord(config)) fail('llm-pi-ai.config 必须是 YAML 对象')
  const rawProviders=config?.providers
  if (rawProviders != null && !isRecord(rawProviders)) fail('llm-pi-ai.providers 必须是 YAML 对象')
  const providers = rawProviders ?? {}
  return {doc, rows, providers}
}
export function sanitizeProvider(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('Provider 配置不是对象')
  const forbidden = /^(?!apiKeyEnv$)(?:.*(?:api[_-]?key|secret|password|token|authorization|cookie|credential|private[_-]?key|headers).*)$/i
  const check = (val, depth=0) => {
    if (depth > 8) fail('Provider 配置嵌套过深')
    if (Array.isArray(val)) return val.map(x=>check(x, depth+1))
    if (val && typeof val === 'object') {
      const out = {}
      for (const [k,v] of Object.entries(val)) {
        if (forbidden.test(k)) fail('Provider 中包含可能的明文凭据字段「'+k+'」，禁止自动同步')
        out[k] = check(v, depth+1)
      }
      return out
    }
    if (typeof val === 'string' && /\$\{|!!js/.test(val)) fail('包含动态表达式的 Provider 必须由用户在 DSH 中手工配置')
    return val
  }
  const out = check(p)
  if (!['openai-completions','openai-responses','anthropic-messages','google-generative-ai','openai-chat-completions'].includes(out.api))
    fail('未知或不支持安全复制的 Provider API 协议：'+String(out.api||''))
  if (!Array.isArray(out.models) || !out.models.length || out.models.length > 100 || !out.models.every(m=>validModel(m?.id)))
    fail('Provider 的模型列表为空或格式不支持同步')
  if (out.apiKeyEnv && !/^[A-Za-z_][A-Za-z_0-9]{0,119}$/.test(out.apiKeyEnv)) fail('API Key 环境变量名不合法')
  if (out.baseURL) {
    let u
    try { u=new URL(out.baseURL) } catch { fail('Provider Base URL 不合法') }
    if (u.username || u.password || u.search || u.hash || !['https:','http:'].includes(u.protocol)) fail('Base URL 含凭据或参数，禁止同步')
    if (u.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) fail('不支持同步非本机 HTTP 明文地址')
  }
  return out
}
export function createHeadlessModelSync({ home, stateDir, registeredModels, isRegistered } = {}) {
  if (!home || !stateDir) throw Error('缺少可信 DSH 根目录')
  const sourcePath = profile => join(home,'profiles',profile,'cordis.patch.yml')
  const target = sourcePath('headless')
  const globalPath = join(home,'cordis.patch.yml')
  const stampPath = join(stateDir,'headless-model-verified.json')
  const state = () => {
    try {
      const x=JSON.parse(read(stampPath))
      return (x?.version===1 || x?.version===2) && Array.isArray(x.verified) ? x : {version:2,verified:[]}
    } catch { return {version:2,verified:[]} }
  }
  // Only the explicit PREVIEW transaction binds all raw files. Probe receipts
  // must NOT depend on comments, other plugins or unrelated model definitions.
  const fingerprint = profile => sha(JSON.stringify([profile,read(sourcePath(profile)),read(globalPath),read(target)]))
  const checkProfile = value => ['desktop','web'].includes(value) ? value : fail('只支持当前 DSH Desktop 或 Web Provider 来源')
  let registeredCatalog=[]
  const registryPresent = provider => {
    try { return typeof isRegistered==='function' && isRegistered(provider)===true }
    catch { return false }
  }
  const registeredFingerprint=(provider,model)=>sha(JSON.stringify(['registered-route-v2',provider,model]))
  // Synchronous parse is needed by the launch gate / First Start status. The
  // runtime depends on yaml; if it is absent, fail closed rather than trust a stamp.
  const activeCustom = profile => {
    const YAML=require('yaml')
    const extract=file=>{
      const entries=YAML.parse(read(file)||'[]',{uniqueKeys:true,strict:true})
      if(!Array.isArray(entries))fail('DSH 配置格式异常')
      const nodes=entries.filter(e=>e?.id==='llm-pi-ai')
      if(nodes.length>1)fail('重复 llm-pi-ai 条目')
      const providers=nodes[0]?.config?.providers||{}
      if(!isRecord(providers))fail('Provider 配置格式异常')
      return {hasEntry:nodes.length>0,providers}
    }
    const global=extract(globalPath)
    const src=global.hasEntry?global:extract(sourcePath(profile))
    const dest=global.hasEntry?global:extract(target)
    return {source:src.providers,target:dest.providers,globalOverride:global.hasEntry}
  }
  const customFingerprint=(profile,provider,model)=>{
    const configs=activeCustom(profile)
    if(!Object.hasOwn(configs.source,provider)||!Object.hasOwn(configs.target,provider))return ''
    const sourceCfg=sanitizeProvider(configs.source[provider])
    const targetCfg=sanitizeProvider(configs.target[provider])
    if(!modelRouteEquivalent(sourceCfg,targetCfg,model))return ''
    return sha(stableJson(['custom-route-v3',profile,provider,model,sourceCfg,targetCfg]))
  }
  const receiptValid=v=>{
    try {
      if(!['desktop','web'].includes(v?.profile)||!validName(v.provider)||!validModel(v.model))return false
      if(v.kind==='registered')return registryPresent(v.provider)&&v.fingerprint===registeredFingerprint(v.provider,v.model)
      if(v.kind==='custom')return !!customFingerprint(v.profile,v.provider,v.model)&&v.fingerprint===customFingerprint(v.profile,v.provider,v.model)
      // Legacy receipts are valid only while the EXACT originally tested
      // configuration survives. Never silently upgrade an invalid old stamp.
      return v.fingerprint===fingerprint(v.profile)
    } catch { return false }
  }
  const saveState=st=>{
    mkdirSync(stateDir,{recursive:true})
    const tmp=stampPath+'.'+randomUUID()+'.tmp'
    try {writeFileSync(tmp,JSON.stringify(st,null,2),{flag:'wx',mode:0o600});renameSync(tmp,stampPath)}
    catch(e){try{rmSync(tmp,{force:true})}catch{};throw e}
  }
  function migrateVerified() {
    const st=state()
    let changed=false
    for(const v of st.verified){
      if(v.kind || !receiptValid(v))continue
      try {
        const fp=customFingerprint(v.profile,v.provider,v.model)
        if(fp){v.kind='custom';v.fingerprint=fp;changed=true}
      }catch{}
    }
    if(changed){st.version=2;saveState(st)}
    return st
  }
  function hasAnyVerified() {
    return migrateVerified().verified.some(receiptValid)
  }
  function assertReady({provider,model}={}) {
    if (!validName(provider) || !validModel(model)) fail('独立后台模型没有明确 Provider 和模型 ID，请先在 DSH 模型页配置，再同步与测试')
    const found=migrateVerified().verified.some(v=>v.provider===provider&&v.model===model&&receiptValid(v))
    if (!found) fail('独立后台模型「'+provider+' / '+model+'」尚未同步并通过连接验证，或之前的验证已因模型配置变化而失效。请到大肥鱼 → AI 模型 → 后台模型验证；DSH 官方内置模型无需同步。')
    return true
  }
  async function builtinRoutes() {
    if(typeof registeredModels!=='function')return []
    let items
    try {items=await registeredModels()}catch{return []}
    if(!Array.isArray(items))return []
    registeredCatalog=items.filter(p=>validName(p?.id)&&registryPresent(p.id)).slice(0,40).map(p=>{
      const models=[...new Set((Array.isArray(p.models)?p.models:[]).filter(validModel))].slice(0,100)
      const detailRows=Array.isArray(p.modelDetails)?p.modelDetails:[]
      const modelDetails=models.map(id=>{
        const found=detailRows.find(x=>x?.id===id)
        return {id,...modelCapability(found)}
      })
      return {id:p.id,api:'DSH 已注册模型',kind:'registered',models,modelDetails}
    }).filter(p=>p.models.length)
    return registeredCatalog
  }
  async function source(profile) {
    profile=checkProfile(profile)
    const global=await docRows(read(globalPath))
    const local=await docRows(read(sourcePath(profile)))
    // Home layer overrides the entire llm-pi-ai entry, not one provider at a time.
    const effective = global.rows.some(x=>x?.id==='llm-pi-ai') ? global : local
    const names=Object.keys(effective.providers).filter(validName).sort()
    return {profile, providers:effective.providers, names, globalOverride:global.rows.some(x=>x?.id==='llm-pi-ai')}
  }
  async function status(profile='desktop') {
    profile=checkProfile(profile)
    const s=await source(profile)
    const targetCfg=await docRows(read(target))
    const globalCfg=s.globalOverride ? await docRows(read(globalPath)) : null
    const headlessProviders=s.globalOverride ? globalCfg.providers : targetCfg.providers
    const stamp=migrateVerified()
    const providers=s.names.map(id=>{
      const sourceProvider=sanitizeProvider(s.providers[id])
      const targetProvider=headlessProviders[id] ? sanitizeProvider(headlessProviders[id]) : null
      const models=sourceProvider.models.map(m=>String(m.id||'')).filter(validModel)
      const synced=providerSyncEquivalent(sourceProvider,targetProvider)
      const modelDetails=models.map(model=>{
        const sourceModel=sourceProvider.models.find(m=>m.id===model)
        const headlessModel=targetProvider?.models?.find(m=>m.id===model)
        return {id:model,source:modelCapability(sourceModel),headless:headlessModel?modelCapability(headlessModel):null,
          routeSynced:!!headlessModel&&modelRouteEquivalent(sourceProvider,targetProvider,model),
          headlessOnlyOverride:modelCapabilityOverride(sourceModel,headlessModel)}
      })
      return {id,kind:'custom',api:String(sourceProvider.api||''),baseURL:providerSummary(sourceProvider)?.baseURL||'',
        headlessApi:String(targetProvider?.api||''),headlessBaseURL:providerSummary(targetProvider)?.baseURL||'',
        models,modelDetails,synced,targetExists:!!targetProvider,capabilityEditable:!s.globalOverride&&synced,
        verifiedModels:stamp.verified.filter(v=>v.profile===profile&&v.provider===id&&receiptValid(v)).map(v=>v.model)}
    })
    const seen=new Set(s.names)
    for(const route of await builtinRoutes()){
      if(seen.has(route.id))continue
      providers.push({...route,synced:true,targetExists:true,baseURL:'',headlessApi:route.api,headlessBaseURL:'',
        modelDetails:route.modelDetails.map(x=>({id:x.id,source:x,headless:x})),
        verifiedModels:stamp.verified.filter(v=>v.profile===profile&&v.provider===route.id&&receiptValid(v)).map(v=>v.model)})
    }
    return {ok:true,sourceProfile:profile,globalOverride:s.globalOverride,providers,
      requiresSync:'DSH 内置官方模型直接验证；自定义 Provider 配置不同时才需要同步。每个独立 Agent 使用的模型必须通过 Headless 真实验证。'}
  }
  function describeRoute({provider,model}={}) {
    if(!validName(provider)||!validModel(model))return {ok:false,kind:'unresolved',provider:String(provider||''),model:String(model||''),verified:false}
    const stamp=migrateVerified()
    const candidates=[]
    for(const profile of ['desktop','web']){
      try{
        const configs=activeCustom(profile)
        if(!Object.hasOwn(configs.source,provider))continue
        const sourceProvider=sanitizeProvider(configs.source[provider])
        const sourceModel=sourceProvider.models.find(m=>m.id===model)
        if(!sourceModel)continue
        const targetProvider=configs.target[provider]?sanitizeProvider(configs.target[provider]):null
        const headlessModel=targetProvider?.models?.find(m=>m.id===model)||null
        const fingerprint=customFingerprint(profile,provider,model)
        const verified=stamp.verified.some(v=>v.profile===profile&&v.provider===provider&&v.model===model&&receiptValid(v))
        candidates.push({
          ok:true,kind:'custom',profile,provider,model,
          source:providerSummary(sourceProvider),headless:providerSummary(targetProvider),
          sourceModel:modelCapability(sourceModel),headlessModel:headlessModel?modelCapability(headlessModel):null,
          synced:!!fingerprint,verified,fingerprint:fingerprint||'',
          headlessOnlyOverride:modelCapabilityOverride(sourceModel,headlessModel),
          capabilityEditable:!configs.globalOverride&&!!fingerprint,
        })
      }catch{}
    }
    if(candidates.length){
      candidates.sort((a,b)=>Number(b.verified)-Number(a.verified)||Number(b.synced)-Number(a.synced))
      return candidates[0]
    }
    if(registryPresent(provider)){
      const route=registeredCatalog.find(p=>p.id===provider)
      const modelInfo=route?.modelDetails?.find(x=>x.id===model)||modelCapability(null)
      const verified=stamp.verified.some(v=>v.provider===provider&&v.model===model&&receiptValid(v))
      return {ok:true,kind:'registered',provider,model,source:{api:'DSH 已注册模型',baseURL:''},
        headless:{api:'DSH 已注册模型',baseURL:''},sourceModel:modelInfo,headlessModel:modelInfo,
        synced:true,verified,fingerprint:registeredFingerprint(provider,model)}
    }
    return {ok:false,kind:'unresolved',provider,model,verified:false}
  }
  async function preview(profile, selected) {
    profile=checkProfile(profile);selected=normalize(selected)
    const s=await source(profile)
    const t=await docRows(read(target))
    const models=[]
    for (const id of selected) {
      if (!Object.hasOwn(s.providers,id)) fail('源环境中没有 Provider：'+id)
      const sanitized=sanitizeProvider(s.providers[id])
      const previous=t.providers[id]?sanitizeProvider(t.providers[id]):null
      const capabilityOverrides=previous?sanitized.models
        .filter(m=>modelCapabilityOverride(m,previous.models.find(x=>x.id===m.id))).map(m=>m.id):[]
      models.push({id,models:sanitized.models.map(m=>m.id),overwrite:Object.hasOwn(t.providers,id),
        routeChanged:!!previous&&!providerSyncEquivalent(sanitized,previous),
        headlessCapabilityOverrides:capabilityOverrides})
    }
    if (s.globalOverride) fail('模型定义位于 DSH 全局共享配置，Headless 已继承它。无需重复同步，请直接点击对应模型的「验证」。')
    const token=sha(JSON.stringify([fingerprint(profile),selected]))
    return {ok:true,sourceProfile:profile,selected:models,previewToken:token,
      note:'只写入选中的 Provider 模型配置；不复制凭据与其他 DSH 工具。写入完成后还需逐个模型验证才能解锁。'}
  }
  async function sync({profile='desktop',selected,previewToken}) {
    profile=checkProfile(profile);selected=normalize(selected)
    const plan=await preview(profile,selected)
    const expected=Buffer.from(plan.previewToken,'hex'),got=Buffer.from(String(previewToken||'').replace(/[^0-9a-f]/gi,'').slice(0,64),'hex')
    if (expected.length!==got.length || !timingSafeEqual(expected,got)) fail('配置已变更或预览已过期，请重新预览再确认')
    const s=await source(profile)
    const t=await docRows(read(target))
    if (!t.doc.contents || !t.doc.contents.items) fail('headless 配置结构异常，拒绝自动覆盖')
    let index=t.rows.findIndex(r=>r?.id==='llm-pi-ai')
    if (index<0) {
      index=t.rows.length
      t.doc.contents.add(t.doc.createNode({id:'llm-pi-ai',config:{providers:{}}}))
    } else {
      // The user may have manually deleted the synced YAML content.
      if(t.rows[index].config == null)t.doc.setIn([index,'config'],{providers:{}})
      else if(!isRecord(t.rows[index].config))fail('Headless llm-pi-ai.config 不是对象，拒绝覆盖')
      else if(t.rows[index].config.providers == null)t.doc.setIn([index,'config','providers'],{})
      else if(!isRecord(t.rows[index].config.providers))fail('Headless providers 不是对象，拒绝覆盖')
    }
    for (const id of selected) {
      const sourceProvider=sanitizeProvider(s.providers[id])
      const previous=t.providers[id]?sanitizeProvider(t.providers[id]):null
      // Re-syncing a provider must not silently erase previously confirmed
      // Headless-only capability additions. A changed route still invalidates
      // its old verification receipt through the full fingerprint.
      t.doc.setIn([index,'config','providers',id],mergeHeadlessCapabilities(sourceProvider,previous))
    }
    const updated=String(t.doc)
    const parsed=await docRows(updated)
    for(const id of selected) if(!Object.hasOwn(parsed.providers,id)) fail('生成的 headless 配置没有目标 Provider：'+id)
    if (plan.previewToken!==sha(JSON.stringify([fingerprint(profile),selected]))) fail('源配置在确认时已变化，请重新预览')
    const old=read(target)
    mkdirSync(join(home,'profiles','headless'),{recursive:true})
    for (const part of [join(home,'profiles'),join(home,'profiles','headless')])
      if(lstatSync(part).isSymbolicLink())fail('Profile 目录是符号链接，拒绝写入')
    const backup=target+'.dafeiyu-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak'
    if (old) copyFileSync(target,backup)
    const tmp=target+'.dafeiyu-'+randomUUID()+'.tmp'
    try {writeFileSync(tmp,updated,{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(tmp,target)}
    catch(e){try{rmSync(tmp,{force:true})}catch{};throw e}
    // A receipt remains valid only if the semantic source + target route
    // fingerprint is unchanged; YAML formatting alone does not invalidate it.
    const afterStatus=await status(profile)
    const verifiedModels=selected.flatMap(id=>{
      const row=afterStatus.providers.find(x=>x.id===id)
      return (row?.verifiedModels||[]).map(model=>({provider:id,model}))
    })
    return {ok:true,sourceProfile:profile,synced:selected,backup:old?backup:null,
      verified:verifiedModels.length>0,verifiedModels,
      note:'配置已写入（不是连接成功）。只有配置指纹仍一致的既有验证回执会保留；其他模型仍需单独验证。'}
  }

  // Cancel the sync of ONE custom model, not the Desktop provider or Ollama weights.
  // Preview token binds the current source and target files; all unrelated YAML
  // entries survive and the existing verified receipts fail closed automatically.
  async function previewUnsync({profile='desktop',provider,model}={}){
    profile=checkProfile(profile)
    if(!validName(provider)||!validModel(model))fail('无效的 Provider 或模型 ID')
    const s=await source(profile)
    if(s.globalOverride)fail('当前模型由 DSH 全局配置共享，不能单独从 Headless 删除；请在 DSH 中操作')
    if(!Object.hasOwn(s.providers,provider))fail('来源模型不存在或不属于可独立管理的 Provider')
    const targetDoc=await docRows(read(target))
    const models=targetDoc.providers[provider]?.models
    if(!Array.isArray(models)||!models.some(x=>x?.id===model))fail('Headless 中没有此模型，无需取消同步')
    const previewToken=sha(JSON.stringify(['unsync-v1',fingerprint(profile),provider,model]))
    return {ok:true,profile,provider,model,previewToken,removeProvider:models.length===1,
      note:'仅删除 Headless 中选定的模型路由，不删除 Desktop 源定义、Ollama 本地模型、凭据或其他 Headless 模型。'}
  }
  async function unsync(args={}){
    const plan=await previewUnsync(args)
    const given=Buffer.from(String(args.previewToken||'').replace(/[^0-9a-f]/gi,'').slice(0,64),'hex')
    const expected=Buffer.from(plan.previewToken,'hex')
    if(expected.length!==given.length||!timingSafeEqual(expected,given))fail('模型配置发生变化，请重新预览取消同步')
    const current=await docRows(read(target))
    const pluginIndex=current.rows.findIndex(x=>x?.id==='llm-pi-ai')
    const models=current.providers[plan.provider]?.models
    const modelIndex=models?.findIndex(x=>x?.id===plan.model)??-1
    if(pluginIndex<0||modelIndex<0)fail('Headless 模型已变化，请重新加载')
    if(models.length===1)current.doc.deleteIn([pluginIndex,'config','providers',plan.provider])
    else current.doc.deleteIn([pluginIndex,'config','providers',plan.provider,'models',modelIndex])
    const content=String(current.doc)
    const parsed=await docRows(content)
    if(parsed.providers[plan.provider]?.models?.some(x=>x?.id===plan.model))fail('取消同步后的校验失败')
    const latest=await previewUnsync(args)
    if(latest.previewToken!==plan.previewToken)fail('确认期间模型配置发生变化')
    const old=read(target)
    mkdirSync(join(home,'profiles','headless'),{recursive:true})
    for(const part of [join(home,'profiles'),join(home,'profiles','headless')])
      if(lstatSync(part).isSymbolicLink())fail('Profile 路径包含符号链接，拒绝改写')
    const backup=target+'.dafeiyu-unsync-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak'
    if(old)copyFileSync(target,backup)
    const tmp=target+'.dafeiyu-'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,content,{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(tmp,target)}
    catch(error){try{rmSync(tmp,{force:true})}catch{};throw error}
    const verify=await docRows(read(target))
    if(verify.providers[plan.provider]?.models?.some(x=>x?.id===plan.model))fail('Headless 回读仍包含该模型')
    // Verification receipts are bound to the route fingerprint, so deletion
    // invalidates the removed model without altering other receipt records.
    return {ok:true,provider:plan.provider,model:plan.model,removed:true,backup,
      note:'已从 Headless 配置取消此模型同步；Desktop 来源与本地 Ollama 模型未删除。'}
  }
  const capabilityInputs=new Set(['text','image'])
  const capabilityEfforts=new Set(['off','low','medium','high','xhigh','max'])
  const normalizeCapabilityList=(value,allowed,label)=>{
    if(!Array.isArray(value)||value.length>allowed.size||!value.every(x=>typeof x==='string'&&allowed.has(x))||new Set(value).size!==value.length)
      fail(label+' 选项格式不正确')
    return [...value].sort()
  }
  async function previewCapabilities({profile='desktop',provider,model,addInput=[],addReasoningEfforts=[],reset=false}={}){
    profile=checkProfile(profile)
    if(!validName(provider)||!validModel(model))fail('无效的 Provider 或模型 ID')
    const s=await source(profile)
    if(s.globalOverride)fail('当前模型来自 DSH 全局共享配置；修改会影响 Desktop，已禁止 Headless 专属能力补充。')
    if(!Object.hasOwn(s.providers,provider))fail('来源环境中没有这个自定义 Provider')
    const sourceProvider=sanitizeProvider(s.providers[provider])
    const targetDoc=await docRows(read(target))
    if(!Object.hasOwn(targetDoc.providers,provider))fail('请先将此 Provider 同步到 DSH Headless')
    const targetProvider=sanitizeProvider(targetDoc.providers[provider])
    if(!providerSyncEquivalent(sourceProvider,targetProvider))fail('Provider 路由尚未同步或存在其他配置差异；请先重新同步，再补充能力声明')
    const sourceModel=sourceProvider.models.find(x=>x.id===model)
    const targetModel=targetProvider.models.find(x=>x.id===model)
    if(!sourceModel||!targetModel)fail('来源与 Headless 中没有对应模型')
    const selectedInput=normalizeCapabilityList(addInput,capabilityInputs,'输入能力')
    const selectedEfforts=normalizeCapabilityList(addReasoningEfforts,capabilityEfforts,'思考档位')
    const before=cloneJson(targetModel),after=cloneJson(targetModel)
    if(reset){
      if(Array.isArray(sourceModel.input))after.input=cloneJson(sourceModel.input);else delete after.input
      if(isRecord(sourceModel.reasoningEfforts))after.reasoningEfforts=cloneJson(sourceModel.reasoningEfforts);else delete after.reasoningEfforts
    }else{
      const inputs=[...new Set([
        ...(Array.isArray(sourceModel.input)?sourceModel.input:[]),
        ...(Array.isArray(targetModel.input)?targetModel.input:[]),
        ...selectedInput,
      ].filter(x=>allowedInputs.has(x)))].slice(0,8)
      if(inputs.length)after.input=inputs;else delete after.input
      const efforts={
        ...(isRecord(targetModel.reasoningEfforts)?targetModel.reasoningEfforts:{}),
        ...(isRecord(sourceModel.reasoningEfforts)?sourceModel.reasoningEfforts:{}),
      }
      for(const effort of selectedEfforts){
        if(Object.hasOwn(efforts,effort))continue
        efforts[effort]=effort==='off'?null:effort
      }
      if(Object.keys(efforts).length)after.reasoningEfforts=efforts;else delete after.reasoningEfforts
    }
    const token=sha(JSON.stringify([fingerprint(profile),provider,model,{addInput:selectedInput,addReasoningEfforts:selectedEfforts,reset:reset===true},stableJson(before)]))
    const beforeInput=Array.isArray(before.input)?before.input:[]
    const afterInput=Array.isArray(after.input)?after.input:[]
    const beforeEfforts=isRecord(before.reasoningEfforts)?Object.keys(before.reasoningEfforts):[]
    const afterEfforts=isRecord(after.reasoningEfforts)?Object.keys(after.reasoningEfforts):[]
    return {ok:true,profile,provider,model,reset:reset===true,previewToken:token,
      before:modelCapability(before),after:modelCapability(after),
      addedInput:afterInput.filter(x=>!beforeInput.includes(x)),
      addedReasoningEfforts:afterEfforts.filter(x=>!beforeEfforts.includes(x)),
      changed:stableJson(before)!==stableJson(after),
      note:'仅更新 DSH Headless 的此模型 input / reasoningEfforts 声明；Desktop 来源文件、Provider、API Key 和其他模型均不修改。能力声明不是上游实测结果。'}
  }
  async function setCapabilities(args={}){
    const plan=await previewCapabilities(args)
    const expected=Buffer.from(plan.previewToken,'hex')
    const got=Buffer.from(String(args.previewToken||'').replace(/[^0-9a-f]/gi,'').slice(0,64),'hex')
    if(expected.length!==got.length||!timingSafeEqual(expected,got))fail('能力配置已变化或预览已过期，请重新打开向导')
    if(!plan.changed)return {ok:true,provider:plan.provider,model:plan.model,changed:false,verified:false,
      note:'当前 Headless 能力声明已经与所选内容一致，无需写入。'}
    const current=await docRows(read(target))
    const pluginIndex=current.rows.findIndex(x=>x?.id==='llm-pi-ai')
    const providerCfg=current.providers[plan.provider]
    const modelIndex=providerCfg?.models?.findIndex(x=>x?.id===plan.model)??-1
    if(pluginIndex<0||modelIndex<0)fail('Headless 模型条目已变化，请重新检测')
    const base=['config','providers',plan.provider,'models',modelIndex]
    if(Array.isArray(plan.after.input))current.doc.setIn([pluginIndex,...base,'input'],plan.after.input)
    else current.doc.deleteIn([pluginIndex,...base,'input'])
    if(plan.after.reasoningEffortsDeclared){
      const sourceData=await source(plan.profile)
      const sourceModel=sanitizeProvider(sourceData.providers[plan.provider]).models.find(x=>x.id===plan.model)
      const targetModel=sanitizeProvider(current.providers[plan.provider]).models.find(x=>x.id===plan.model)
      const efforts={
        ...(isRecord(targetModel.reasoningEfforts)?targetModel.reasoningEfforts:{}),
        ...(isRecord(sourceModel.reasoningEfforts)?sourceModel.reasoningEfforts:{}),
      }
      for(const effort of normalizeCapabilityList(args.addReasoningEfforts||[],capabilityEfforts,'思考档位'))
        if(!Object.hasOwn(efforts,effort))efforts[effort]=effort==='off'?null:effort
      if(args.reset===true){
        if(isRecord(sourceModel.reasoningEfforts))current.doc.setIn([pluginIndex,...base,'reasoningEfforts'],sourceModel.reasoningEfforts)
        else current.doc.deleteIn([pluginIndex,...base,'reasoningEfforts'])
      }else current.doc.setIn([pluginIndex,...base,'reasoningEfforts'],efforts)
    }else current.doc.deleteIn([pluginIndex,...base,'reasoningEfforts'])
    const updated=String(current.doc)
    await docRows(updated)
    const latest=await previewCapabilities(args)
    if(latest.previewToken!==plan.previewToken)fail('配置在确认期间发生变化，请重新打开能力向导并预览')
    const old=read(target)
    mkdirSync(join(home,'profiles','headless'),{recursive:true})
    for(const part of [join(home,'profiles'),join(home,'profiles','headless')])
      if(lstatSync(part).isSymbolicLink())fail('Profile 目录是符号链接，拒绝写入')
    const backup=target+'.dafeiyu-capabilities-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak'
    if(old)copyFileSync(target,backup)
    const tmp=target+'.dafeiyu-'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,updated,{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(tmp,target)}
    catch(e){try{rmSync(tmp,{force:true})}catch{};throw e}
    return {ok:true,provider:plan.provider,model:plan.model,changed:true,verified:false,backup:old?backup:null,
      note:'Headless 专属能力声明已写入；之前的模型验证回执已因配置变化失效，请重新执行文字连接验证。图片输入仍须单独实测。'}
  }

  // Desktop/Web source capability declarations have their own explicit preview
  // transaction. Never alter the Headless copy implicitly.
  async function previewSourceCapabilities({profile='desktop',provider,model,addInput=[],addReasoningEfforts=[]}={}){
    profile=checkProfile(profile)
    if(!validName(provider)||!validModel(model))fail('无效的 Provider 或模型 ID')
    const s=await source(profile)
    if(s.globalOverride)fail('模型来自 DSH 全局共享配置，禁止通过此按钮改写；请在 DSH 原生模型页操作')
    const providerData=s.providers[provider]
    if(!providerData)fail('Desktop 来源中没有此 Provider')
    const sourceModel=sanitizeProvider(providerData).models.find(x=>x?.id===model)
    if(!sourceModel)fail('Desktop 来源中没有此模型')
    const inputs=normalizeCapabilityList(addInput,capabilityInputs,'输入能力')
    const efforts=normalizeCapabilityList(addReasoningEfforts,capabilityEfforts,'思考档位')
    const before=cloneJson(sourceModel),after=cloneJson(sourceModel)
    const mergedInputs=[...new Set([...(Array.isArray(before.input)?before.input:[]),...inputs])]
    if(mergedInputs.length)after.input=mergedInputs
    const mergedEfforts={...(isRecord(before.reasoningEfforts)?before.reasoningEfforts:{})}
    for(const item of efforts)if(!Object.hasOwn(mergedEfforts,item))mergedEfforts[item]=item==='off'?null:item
    if(Object.keys(mergedEfforts).length)after.reasoningEfforts=mergedEfforts
    const token=sha(JSON.stringify(['source-capabilities-v1',fingerprint(profile),provider,model,inputs,efforts,stableJson(before)]))
    return {ok:true,profile,provider,model,previewToken:token,changed:stableJson(before)!==stableJson(after),
      before:modelCapability(before),after:modelCapability(after),
      addedInput:inputs.filter(x=>!(before.input||[]).includes(x)),
      addedReasoningEfforts:efforts.filter(x=>!Object.hasOwn(before.reasoningEfforts||{},x)),
      note:'只向 Desktop/Web 来源模型新增确知支持的图片与思考能力声明；Headless 不会自动修改或自动验证。'}
  }
  async function setSourceCapabilities(args={}){
    const plan=await previewSourceCapabilities(args)
    const expected=Buffer.from(plan.previewToken,'hex')
    const received=Buffer.from(String(args.previewToken||'').replace(/[^0-9a-f]/gi,'').slice(0,64),'hex')
    if(expected.length!==received.length||!timingSafeEqual(expected,received))fail('来源能力配置发生变化，请重新预览')
    if(!plan.changed)return {ok:true,changed:false,note:'来源能力声明未变化'}
    const dest=sourcePath(plan.profile)
    const doc=await docRows(read(dest))
    const index=doc.rows.findIndex(x=>x?.id==='llm-pi-ai')
    const models=doc.providers[plan.provider]?.models
    const modelIndex=models?.findIndex(x=>x?.id===plan.model)??-1
    if(index<0||modelIndex<0)fail('来源模型已变化，请刷新配置')
    const base=[index,'config','providers',plan.provider,'models',modelIndex]
    const modelData=models[modelIndex]
    const selectedInputs=normalizeCapabilityList(args.addInput||[],capabilityInputs,'输入能力')
    const selectedEfforts=normalizeCapabilityList(args.addReasoningEfforts||[],capabilityEfforts,'思考档位')
    const nextInput=[...new Set([...(Array.isArray(modelData.input)?modelData.input:[]),...selectedInputs])]
    if(nextInput.length)doc.doc.setIn([...base,'input'],nextInput)
    const nextEfforts={...(isRecord(modelData.reasoningEfforts)?modelData.reasoningEfforts:{})}
    for(const name of selectedEfforts)if(!Object.hasOwn(nextEfforts,name))nextEfforts[name]=name==='off'?null:name
    if(Object.keys(nextEfforts).length)doc.doc.setIn([...base,'reasoningEfforts'],nextEfforts)
    const text=String(doc.doc)
    const parsed=await docRows(text)
    sanitizeProvider(parsed.providers[plan.provider])
    const latest=await previewSourceCapabilities(args)
    if(latest.previewToken!==plan.previewToken)fail('保存前来源配置发生变化')
    for(const parent of [join(home,'profiles'),join(home,'profiles',plan.profile)])
      if(lstatSync(parent).isSymbolicLink())fail('来源 Profile 包含符号链接，拒绝自动编辑')
    const original=read(dest)
    const backup=dest+'.dafeiyu-capability-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak'
    if(original)copyFileSync(dest,backup)
    const tmp=dest+'.dafeiyu-'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,text,{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(tmp,dest)}
    catch(error){try{rmSync(tmp,{force:true})}catch{};throw error}
    const verified=await docRows(read(dest))
    const modelNow=verified.providers[plan.provider]?.models?.find(x=>x?.id===plan.model)
    if(!modelNow||!selectedInputs.every(x=>modelNow.input?.includes(x))||!selectedEfforts.every(x=>Object.hasOwn(modelNow.reasoningEfforts||{},x)))
      fail('来源配置回读失败，请核查备份，不要认为已保存')
    return {ok:true,changed:true,backup,note:'已补充 Desktop/Web 来源声明；未改 Headless。若要后台使用新增能力，请重新同步并执行独立验证。'}
  }
  async function verified({profile='desktop',provider,model,probe}) {
    profile=checkProfile(profile)
    if (!validName(provider)||!validModel(model)) fail('无效的 Provider 或模型 ID')
    if(typeof probe!=='function') fail('缺少真实 headless 模型检测程序')
    const s=await source(profile)
    let kind='',before=''
    if(Object.hasOwn(s.providers,provider)){
      // A user-defined provider must be present and identical in Headless.
      before=customFingerprint(profile,provider,model)
      if(!before)fail('自定义 Provider 尚未同步，或 Headless 配置与源配置不同，请先同步')
      kind='custom'
    }else{
      // Never infer a built-in route from a name alone: require a live DSH
      // adapter and an advertised model before running the CLI probe.
      const routes=await builtinRoutes()
      if(!routes.some(p=>p.id===provider&&p.models.includes(model)))fail('DSH 当前未注册该内置 Provider/模型，无法进行 Headless 验证')
      before=registeredFingerprint(provider,model)
      kind='registered'
    }
    await probe({provider,model}) // MUST call real isolated DSH CLI; never infer from config.
    const after=kind==='custom' ? customFingerprint(profile,provider,model) :
      registryPresent(provider)?registeredFingerprint(provider,model):''
    if(before!==after||!after)fail('测试期间模型路由配置发生变化，请重新验证')
    const st=migrateVerified()
    st.version=2
    st.verified=st.verified.filter(x=>!(x.profile===profile&&x.provider===provider&&x.model===model))
    st.verified.push({profile,provider,model,kind,fingerprint:before,checkedAt:new Date().toISOString()})
    saveState(st)
    return {ok:true,provider,model,checkedAt:st.verified.at(-1).checkedAt,verified:true}
  }
  return {status,preview,sync,previewUnsync,unsync,previewCapabilities,setCapabilities,previewSourceCapabilities,setSourceCapabilities,verified,assertReady,hasAnyVerified,describeRoute}
}
