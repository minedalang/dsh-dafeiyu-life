/**
 * Explicit Desktop/Web -> headless provider sync. Never copy credentials, tools,
 * account sessions or arbitrary profile patches. Writes only llm-pi-ai providers.
 * A model is allowed in a separate headless process ONLY after a real tool-less
 * headless probe of that provider+model has succeeded.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const sha = s => createHash('sha256').update(String(s)).digest('hex')
const validName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)
const validModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,179}$/.test(value)
const fail = text => { throw Error(text) }
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
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
export function createHeadlessModelSync({ home, stateDir }) {
  if (!home || !stateDir) throw Error('缺少可信 DSH 根目录')
  const sourcePath = profile => join(home,'profiles',profile,'cordis.patch.yml')
  const target = sourcePath('headless')
  const globalPath = join(home,'cordis.patch.yml')
  const stampPath = join(stateDir,'headless-model-verified.json')
  const state = () => { try { const x=JSON.parse(read(stampPath)); return x?.version===1?x:{version:1,verified:[]} } catch { return {version:1,verified:[]} } }
  const fingerprint = profile => sha(JSON.stringify([profile,read(sourcePath(profile)),read(globalPath),read(target)]))
  const checkProfile = value => ['desktop','web'].includes(value) ? value : fail('只支持当前 DSH Desktop 或 Web Provider 来源')
  function hasAnyVerified() {
    const s=state()
    return s.verified.some(v=>['desktop','web'].includes(v?.profile) && validName(v?.provider) && validModel(v?.model) && v.fingerprint===fingerprint(v.profile))
  }
  function assertReady({provider,model}={}) {
    if (!validName(provider) || !validModel(model)) fail('独立后台模型没有明确 Provider 和模型 ID，请先在 DSH 模型页配置，再同步与测试')
    const s=state()
    const found=s.verified.some(v=>v.provider===provider && v.model===model && v.fingerprint===fingerprint(v.profile))
    if (!found) fail('独立后台模型「'+provider+' / '+model+'」尚未同步并通过连接验证。请到大肥鱼 → AI 模型 → 后台模型同步与检测；宿主直连功能仍可使用。')
    return true
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
    const s=await source(profile)
    const targetCfg=await docRows(read(target))
    const globalCfg=s.globalOverride ? await docRows(read(globalPath)) : null
    const stamp=state()
    return {ok:true,sourceProfile:profile,globalOverride:s.globalOverride,
      providers:s.names.map(id=>({id,api:String(s.providers[id]?.api||''),models:(s.providers[id]?.models||[]).map(m=>String(m.id||'')).filter(validModel),
        synced:!!(s.globalOverride ? globalCfg.providers[id] : targetCfg.providers[id]) && JSON.stringify(s.globalOverride ? globalCfg.providers[id] : targetCfg.providers[id])===JSON.stringify(sanitizeProvider(s.providers[id])),
        verifiedModels:stamp.verified.filter(v=>v.profile===profile&&v.provider===id&&v.fingerprint===fingerprint(profile)).map(v=>v.model)})),
      requiresSync:'独立视频 Agent 和独立视觉 Agent 必须同步并验证模型；仅使用 DSH 宿主的纯文本模型任务不受影响。',
    }
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
    const s=await source(profile),t=await docRows(read(s.globalOverride ? globalPath : target))
    if(!Object.hasOwn(s.providers,provider)||!Object.hasOwn(t.providers,provider)) fail('此 Provider 尚未同步到 headless')
    const sourceCfg=sanitizeProvider(s.providers[provider])
    if(JSON.stringify(t.providers[provider])!==JSON.stringify(sourceCfg)) fail('headless 配置与源环境不同，请重新同步')
    if(!sourceCfg.models.some(x=>x.id===model)) fail('模型 ID 不属于所选 Provider')
    if(typeof probe!=='function') fail('缺少真实 headless 模型检测程序')
    const before=fingerprint(profile)
    await probe({provider,model}) // MUST call real isolated DSH CLI; never infer from config.
    if(before!==fingerprint(profile)) fail('测试期间模型配置已变更，请重新验证')
    const st=state();st.verified=st.verified.filter(x=>!(x.profile===profile&&x.provider===provider&&x.model===model))
    st.verified.push({profile,provider,model,fingerprint:before,checkedAt:new Date().toISOString()})
    mkdirSync(stateDir,{recursive:true})
    const tmp=stampPath+'.'+randomUUID()+'.tmp'
    try {writeFileSync(tmp,JSON.stringify(st,null,2),{flag:'wx',mode:0o600});renameSync(tmp,stampPath)}
    catch(e){try{rmSync(tmp,{force:true})}catch{};throw e}
    return {ok:true,provider,model,checkedAt:st.verified.at(-1).checkedAt,verified:true}
  }
  return {status,preview,sync,verified,assertReady,hasAnyVerified}
}
