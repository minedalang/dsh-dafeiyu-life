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
// Object-key order in YAML is not part of the model route. Fingerprint the
// effective configuration, not its spelling or presentation.
const stableJson = value => JSON.stringify(value, (_key, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v))
    return Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b, 'en')))
  return v
})
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
    return {source:src.providers,target:dest.providers}
  }
  const customFingerprint=(profile,provider,model)=>{
    const configs=activeCustom(profile)
    if(!Object.hasOwn(configs.source,provider)||!Object.hasOwn(configs.target,provider))return ''
    const sourceCfg=sanitizeProvider(configs.source[provider])
    const targetCfg=sanitizeProvider(configs.target[provider])
    if(stableJson(sourceCfg)!==stableJson(targetCfg) || !sourceCfg.models.some(m=>m.id===model))return ''
    return sha(stableJson(['custom-route-v2',profile,provider,model,sourceCfg,targetCfg]))
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
    return items.filter(p=>validName(p?.id)&&registryPresent(p.id)).slice(0,40).map(p=>({
      id:p.id,api:'DSH 已注册模型',kind:'registered',
      models:[...new Set((Array.isArray(p.models)?p.models:[]).filter(validModel))].slice(0,100),
    })).filter(p=>p.models.length)
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
    const stamp=migrateVerified()
    const providers=s.names.map(id=>{
      const models=(s.providers[id]?.models||[]).map(m=>String(m.id||'')).filter(validModel)
      const synced=!!(s.globalOverride ? globalCfg.providers[id] : targetCfg.providers[id]) &&
        stableJson(sanitizeProvider(s.globalOverride ? globalCfg.providers[id] : targetCfg.providers[id]))===stableJson(sanitizeProvider(s.providers[id]))
      return {id,kind:'custom',api:String(s.providers[id]?.api||''),models,synced,
        verifiedModels:stamp.verified.filter(v=>v.profile===profile&&v.provider===id&&receiptValid(v)).map(v=>v.model)}
    })
    const seen=new Set(s.names)
    for(const route of await builtinRoutes()){
      if(seen.has(route.id))continue
      providers.push({...route,synced:true,
        verifiedModels:stamp.verified.filter(v=>v.profile===profile&&v.provider===route.id&&receiptValid(v)).map(v=>v.model)})
    }
    return {ok:true,sourceProfile:profile,globalOverride:s.globalOverride,providers,
      requiresSync:'DSH 内置官方模型直接验证；自定义 Provider 配置不同时才需要同步。每个独立 Agent 使用的模型必须通过 Headless 真实验证。'}
  }
  async function preview(profile, selected) {
    profile=checkProfile(profile);selected=normalize(selected)
    const s=await source(profile)
    const t=await docRows(read(target))
    const models=[]
    for (const id of selected) {
      if (!Object.hasOwn(s.providers,id)) fail('源环境中没有 Provider：'+id)
      const sanitized=sanitizeProvider(s.providers[id])
      models.push({id,models:sanitized.models.map(m=>m.id),overwrite:Object.hasOwn(t.providers,id)})
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
    for (const id of selected) t.doc.setIn([index,'config','providers',id],sanitizeProvider(s.providers[id]))
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
    // Existing probe marks are deliberately invalidated by the target file hash.
    return {ok:true,sourceProfile:profile,synced:selected,backup:old?backup:null,verified:false,
      note:'配置已写入（不是连接成功）。请逐个验证所需模型；验证通过后对应独立任务才会解锁。'}
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
  return {status,preview,sync,verified,assertReady,hasAnyVerified}
}
