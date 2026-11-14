/** Portable business-data export/import. Never include login cookies, DPAPI keys or sticker assets. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validateCommentMemeRules } from './comment-meme-rules.mjs'

export const FORMAT = 'dsh-dafeiyu-life-backup'
export const SCHEMA = 2
// v2.4.x official portable exports used schema 1 with no cryptographic manifest.
// Parse only these two historical names and never pretend the old export was
// authenticated. Normalize for the current structural checks, without changing
// the bytes/content of any imported business file.
const LEGACY_FORMATS = new Set([FORMAT, 'dsh-bili-scroll-plus-backup'])
function normalizeHistoricalBackup(backup) {
  if (backup?.schema !== 1) return backup
  if (!LEGACY_FORMATS.has(backup.format)) throw Error('不支持的旧版备份格式')
  if (!backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config) ||
      !backup.files || typeof backup.files !== 'object' || Array.isArray(backup.files) ||
      !backup.sqlite || typeof backup.sqlite !== 'object' || Array.isArray(backup.sqlite))
    throw Error('旧版备份缺少必要的设置、业务文件或 SQLite 字段')
  // A manifest calculated now is only an internal adapter for the *structure*
  // validator, never proof the original SHA-256 existed or bytes were untampered.
  const files=backup.files,config=backup.config,sqlite=backup.sqlite
  return {format:FORMAT,schema:SCHEMA,createdAt:backup.createdAt,version:backup.version,
    config,files,sqlite,manifest:{algorithm:'sha256',
      files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,digest(v)])),
      config:digest(config),sqlite:digest(sqlite)}}
}
export function backupAuthenticity(backup) {
  return backup?.schema===1&&LEGACY_FORMATS.has(backup.format)?'legacy-unsealed':'sha256-verified'
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const memoryItem=name=>name.startsWith('life-memory/')||name.startsWith('long-term-memory/')||name==='personality-evolution/v1.json'
const MAX_FILE = 8 * 1024 * 1024
const MAX_TOTAL = 48 * 1024 * 1024
const MAX_ITEMS = 3000
const ROOT_FILES = new Set([
  'character-identity.json', 'state.json', 'seen.md', 'duty.md', 'verify-state.json', 'uid-cache.json',
  'comment-meme-rules.json', 'main-session-memory.json', 'session-watch-history.json',
  // Sensitive per-UID private preference observations and outreach drafts are NOT
  // included in portable general business backups. They remain local.
  'video-recommendations.json', 'owner-todos.json', 'emotion-recall.json',
  'dm-autoreply-state.json', 'comment-interact-state.json', 'comment-ledger-import-v1.json',
  'confirmed-comment-recipients.json',
])
const DIR_RULES = new Map([
  ['persona-growth',/^(?:v1|previous)\.json$/],
  ['personality-evolution',/^v1\.json$/],
  // Historical dev.4 claim receipts are archived/backup-only in dev.5; never replay.
  ['video-wish-claims',/^[a-zA-Z0-9_-]{1,110}--[a-zA-Z0-9_-]{1,110}\.json$/],
  ['seen',/^\d{4}-\d{2}\.md$/],
  ['out',/^\d{4}-\d{2}-\d{2}\.md$/],
  ['reports',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['digest',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['comment-video-context',/^BV[A-Za-z0-9]{10}\.json$/],
  ['mention-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['meme-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['vision-events',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['model-usage',/^\d{4}-\d{2}\.jsonl$/],
  ['dynamic-sync',/^[\w.-]{1,100}\.(?:json|jsonl)$/],
  ['long-term-memory',/^[a-zA-Z0-9_-]{1,180}\.json$/],
  ['life-memory',/^(?:candidates|interests|emotional-state|episodic|event-outbox|private-insights)\.json$/],
  ['life-memory/archive',/^20\d{2}-(?:0[1-9]|1[0-2])\.jsonl$/],
  ['daily-dynamic',/^drafts\.json$/],
])
const SQL_PATHS = new Set(['meme-memory.sqlite3', 'public-comment-quota.sqlite3', 'video-actions.sqlite3', 'dynamic-sync/dynamic-limit.sqlite3','daily-dynamic/publish-quota.sqlite3'])

export function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 180 || path.includes('\\') || path.includes('..') || path.startsWith('/')) return false
  const parts = path.split('/')
  if (parts.length === 1) return ROOT_FILES.has(path)
  if (parts.length < 2 || parts.length > 3) return false
  return !!DIR_RULES.get(parts.slice(0,-1).join('/'))?.test(parts.at(-1))
}

export function collectBackupFiles(root,{includePrivate=false}={}) {
  const data = {}, stats = { bytes: 0, count: 0 }
  const add = (relative) => {
    if (!allowedPath(relative)) return
    const path = join(root, ...relative.split('/'))
    if (!existsSync(path)) return
    const s = lstatSync(path)
    if (!s.isFile() || s.isSymbolicLink()) return
    if (s.size > MAX_FILE) throw Error('数据文件过大，未进行不完整备份：'+relative)
    stats.bytes += s.size; stats.count++
    if (stats.count > MAX_ITEMS || stats.bytes > MAX_TOTAL) throw Error('业务数据超过单次备份限制（48 MB / 3000 文件），请先归档历史报告')
    let content=readFileSync(path,'utf8')
    if(!includePrivate){
      if(relative==='life-memory/private-insights.json')return
      if(relative==='life-memory/episodic.json'){const obj=JSON.parse(content);obj.episodes=(obj.episodes||[]).filter(x=>x.kind!=='private-social');content=JSON.stringify(obj,null,2)+'\n'}
      if(relative==='life-memory/candidates.json'){const obj=JSON.parse(content);obj.candidates=(obj.candidates||[]).filter(x=>x.kind!=='private-social');content=JSON.stringify(obj,null,2)+'\n'}
      if(relative==='life-memory/event-outbox.json'){const obj=JSON.parse(content);obj.pending=(obj.pending||[]).filter(row=>!(row.events||[]).some(e=>e.kind==='private-social'));content=JSON.stringify(obj,null,2)+'\n'}
      if(relative==='personality-evolution/v1.json'){
        // Anonymous private learning signals also stay out of portable
        // business backups, even though public-facing trait prose is generic.
        const obj=JSON.parse(content)
        for(const trait of Object.values(obj.traits||{}))if(Array.isArray(trait?.evidence))
          trait.evidence=trait.evidence.filter(e=>e.kind!=='private-social')
        if(Array.isArray(obj.timeline))obj.timeline=obj.timeline.filter(e=>e.source!=='private')
        content=JSON.stringify(obj,null,2)+'\n'
      }
      if(relative.startsWith('life-memory/archive/')){content=content.split('\n').filter(Boolean).filter(line=>JSON.parse(line)?.event?.kind!=='private-social').join('\n')+'\n'}
    }
    data[relative] = content
  }
  for (const name of ROOT_FILES) add(name)
  for (const [dir, rule] of DIR_RULES) {
    const folder = join(root, ...dir.split('/'))
    if (!existsSync(folder) || !lstatSync(folder).isDirectory()) continue
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isFile() && rule.test(item.name)) add(dir+'/'+item.name)
    }
  }
  return data
}

export function createBackup({root, config, sqlite = {}, version = ''}) {
  const files = collectBackupFiles(root)
  const backup = {format:FORMAT,schema:SCHEMA,createdAt:new Date().toISOString(),version,
    config:structuredClone(config),files,sqlite,manifest:{algorithm:'sha256',files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,digest(v)])),config:digest(config),sqlite:digest(sqlite)},
    exclusions:['表情包图片与素材','B站登录凭证/Cookie','独立密钥','Python环境、模型、缓存与日志','外部 dsh-fish-memory 插件目录（仅内置长期记忆会随本插件备份）','私密好友兴趣/关系观察与社交草稿（不随可携带备份转移）']}
  validateBackup(backup)
  return backup
}

export function validateBackup(backup) {
  const original=backup
  backup=normalizeHistoricalBackup(backup)
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || backup.format!==FORMAT || backup.schema !== SCHEMA) throw Error('不是兼容的大肥鱼数据备份（格式版本不支持）')
  if (!backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config)) throw Error('备份缺少设置项')
  if (!backup.files || typeof backup.files !== 'object' || Array.isArray(backup.files)) throw Error('备份缺少业务数据')
  if (!backup.sqlite || typeof backup.sqlite !== 'object' || Array.isArray(backup.sqlite)) throw Error('备份缺少数据库字段')
  if(backup.manifest?.algorithm!=='sha256'||!backup.manifest.files||
    digest(backup.config)!==backup.manifest.config||digest(backup.sqlite)!==backup.manifest.sqlite||
    Object.keys(backup.manifest.files).length!==Object.keys(backup.files).length)
    throw Error('备份完整性校验失败：配置或数据库被修改/缺少清单')
  for(const [name,content] of Object.entries(backup.files))if(backup.manifest.files[name]!==digest(content))throw Error('备份完整性校验失败：'+name)
  let total = 0, count = 0
  for (const [file, content] of Object.entries(backup.files)) {
    if (!allowedPath(file) || typeof content !== 'string') throw Error('备份包含不允许恢复的路径：'+String(file).slice(0,90))
    const bytes = Buffer.byteLength(content, 'utf8'); total += bytes; count++
    if (bytes > MAX_FILE || total > MAX_TOTAL || count > MAX_ITEMS) throw Error('备份文件内容超过安全限制')
    if(file==='confirmed-comment-recipients.json'){
      try{
        const x=JSON.parse(content)
        if(x?.version!==1||!x.entries||typeof x.entries!=='object'||Array.isArray(x.entries)||Object.keys(x.entries).length>8000)throw Error('格式不兼容')
        for(const [key,row] of Object.entries(x.entries)){
          if(!/^BV[0-9A-Za-z]{10}:[1-9]\d{5,29}$/.test(key)||!/^[1-9]\d{0,18}$/.test(String(row?.uid||''))||
            String(row?.name||'').length>60||String(row?.comment||'').length>420)throw Error('接收人字段不合法')
        }
      }catch(e){throw Error('评论接收人备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if(file==='personality-evolution/v1.json'){
      try{
        const x=JSON.parse(content),ids=['social_openness','curiosity','assertiveness','patience','boundaries']
        if(x?.version!==1||typeof x.enabled!=='boolean'||!x.traits||typeof x.traits!=='object'||Array.isArray(x.traits)||!Array.isArray(x.timeline)||x.timeline.length>160)throw Error('版本或结构不兼容')
        for(const [id,row] of Object.entries(x.traits)){
          if(!ids.includes(id)||!row||!Array.isArray(row.evidence)||row.evidence.length>100)throw Error('非法成长特质')
          for(const e of row.evidence)if(!e||!/^\w{24}$/.test(String(e.id))||!/^\d{4}-\d\d-\d\d$/.test(String(e.day))||![-1,1].includes(e.direction))throw Error('非法人格证据')
        }
        for(const e of x.timeline)if(!ids.includes(e.trait)||typeof e.at!=='string'||e.at.length>32)throw Error('非法人格时间线')
      }catch(e){throw Error('人格成长备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if(file==='character-identity.json'){
      try{const x=JSON.parse(content)
        if(x?.version!==1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x.id||''))||!Number.isSafeInteger(Number(x.createdAt)))throw Error('身份结构不兼容')
      }catch(e){throw Error('鱼鱼角色身份备份无效：'+String(e?.message||e).slice(0,100))}
    }
    if(file==='life-memory/private-insights.json'){
      try{const x=JSON.parse(content);if(x.schema!==1||!Array.isArray(x.rows)||x.rows.length>700)throw Error('私密反思数据格式不兼容')
       for(const r of x.rows)if(!r||!/^pi-[a-f0-9]{18}$/.test(String(r.id))||!['owner-private','friend-private'].includes(r.visibility)||typeof r.text!=='string'||r.text.length>480)throw Error('私密反思条目不合法')
      }catch(e){throw Error('私密反思备份无效：'+String(e?.message||e).slice(0,100))}
    }
    if(file==='life-memory/episodic.json'){
      try{const x=JSON.parse(content);if(x?.version!==1||!Array.isArray(x.episodes)||!Array.isArray(x.archiveKeys)||x.episodes.length>3200||x.archiveKeys.length>30000||x.episodes.some(e=>!e||!['clear','fuzzy','trace','forgotten'].includes(e.stage)||typeof e.id!=='string'||typeof e.text!=='string'))throw Error('结构不兼容')}
      catch(e){throw Error('可衰减记忆备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if(file.startsWith('life-memory/archive/')){
      try{for(const line of content.split('\n').filter(Boolean)){if(line.length>20000)throw Error('单条档案过长');const x=JSON.parse(line);if(x.version!==1||typeof x.id!=='string'||!x.event||typeof x.event!=='object')throw Error('事件不合法')}}
      catch(e){throw Error('永久档案备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file.startsWith('long-term-memory/')) {
      try {
        const x=JSON.parse(content)
        if (![2,3].includes(x?.version) || !Array.isArray(x.memories) || !Array.isArray(x.traces) || !Array.isArray(x.deleted) || x.memories.length>5000 || x.deleted.length>1500) throw Error('结构不兼容')
      } catch (e) { throw Error('长期记忆备份无效：'+String(e?.message||e).slice(0,120)) }
    }
    if (file === 'owner-todos.json') {
      try {
        const x=JSON.parse(content),types=['watch_video','like_video','inspect_my_space','inspect_creator_videos','search_videos','check_notifications','collect_video','follow_creator','unfollow_creator','comment_video','dm_friend'],statuses=['open','deferred','running','done','dismissed','uncertain','blocked']
        if(x?.version!==1||!Array.isArray(x.items)||x.items.length>500)throw Error('待办数量或版本不合法')
        for(const t of x.items){
          if(!t||typeof t!=='object'||typeof t.id!=='string'||t.id.length>80||!types.includes(t.type)||!statuses.includes(t.status))throw Error('待办结构不合法')
          for(const [k,max] of [['title',120],['note',220],['topic',120],['folderTitle',40],['sourceKey',240],['lastError',220],['resultSummary',420],['text',2000]])if(t[k]!=null&&(typeof t[k]!=='string'||t[k].length>max))throw Error('待办文本字段不合法：'+k)
          if(t.bvid&& !/^BV[0-9A-Za-z]{10}$/.test(t.bvid))throw Error('待办 BV 号不合法')
          if(t.uid&& !/^[1-9]\d{0,18}$/.test(String(t.uid)))throw Error('待办 UID 不合法')
          if(t.ownerAuthorized!==true&&t.ownerAuthorized!==false)throw Error('待办授权字段不合法')
        }
      } catch(e) { throw Error('自主待办备份无效：'+String(e?.message||e).slice(0,120)) }
    }
    if (file === 'emotion-recall.json') {
      try {
        const x=JSON.parse(content)
        if(x?.version!==1||!Array.isArray(x.recentKeys)||x.recentKeys.length>80||
          x.recentKeys.some(v=>typeof v!=='string'||v.length>240)||
          !['checks','sent','lastCheckAt','lastSentAt','lastEmotionAt'].every(k=>Number.isFinite(Number(x[k]))&&Number(x[k])>=0)||
          typeof x.lastError!=='string'||x.lastError.length>220||typeof x.lastResult!=='string'||x.lastResult.length>220)
          throw Error('自主回忆账本字段不合法')
      }catch(e){throw Error('自主回忆备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/emotional-state.json') {
      try{
        const x=JSON.parse(content), moods=['joyful','curious','warm','calm','tired','sad','irritated','neutral'],sources=['dm','comment','life-reflection','social-reflection','owner-reset']
        if(x?.version!==1||!x.current||!Array.isArray(x.history)||x.history.length>100||!moods.includes(x.current.mood))throw Error('情绪状态结构不兼容')
        for(const k of ['intensity','energy','curiosity','sociality'])if(!Number.isFinite(Number(x.current[k]))||Number(x.current[k])<0||Number(x.current[k])>100)throw Error('情绪数值不合法')
        if(!Number.isFinite(Number(x.current.valence))||Number(x.current.valence)<-100||Number(x.current.valence)>100)throw Error('情绪正向度不合法')
        for(const row of x.history)if(!row||!Number.isFinite(Number(row.at))||!moods.includes(row.mood)||!sources.includes(row.source)||!Number.isFinite(Number(row.intensity))||row.intensity<1||row.intensity>3)throw Error('情绪历史不合法')
      }catch(e){throw Error('情绪状态备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/interests.json') {
      try{
        const x=JSON.parse(content)
        if(x?.schema!==1||!Array.isArray(x.entries)||x.entries.length>30)throw Error('兴趣条目数量或格式不合法')
        for(const e of x.entries){
          if(!e||typeof e.topic!=='string'||e.topic.length>48||!Array.isArray(e.evidence)||e.evidence.length>90||!Array.isArray(e.history)||e.history.length>20)throw Error('兴趣条目不合法')
          for(const v of e.evidence)if(!v||typeof v.bvid!=='string'||!/^BV[0-9A-Za-z]{10}$/.test(v.bvid)||typeof v.day!=='string'||v.day.length>12||typeof v.at!=='string'||v.at.length>40)throw Error('兴趣证据不合法')
          // stageOf() can legitimately write legacy-unverified when preserved old evidence has no provable account provenance.
          // Historical state is readable for review, never promoted to autonomous evidence during restore.
          for(const h of e.history)if(!h||typeof h.at!=='string'||h.at.length>40||!['insufficient','legacy-unverified','emerging','growing','stable','quiet',''].includes(String(h.from))||!['legacy-unverified','emerging','growing','stable'].includes(String(h.to)))throw Error('兴趣历史不合法')
        }
      }catch(e){throw Error('兴趣档案备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/candidates.json') {
      try {
        const x=JSON.parse(content)
        if (x?.version !== 1 || !Array.isArray(x.candidates) || !Array.isArray(x.runs) || x.candidates.length>2500 || x.runs.length>120) throw Error('结构不兼容')
        for (const c of x.candidates) {
          if (!c || typeof c !== 'object' || Array.isArray(c)) throw Error('候选项不是对象')
          if (typeof c.id !== 'string' || !/^c-[a-f0-9]{18}$/.test(c.id)) throw Error('candidate id 不合法')
          if (typeof c.key !== 'string' || c.key.length>220 || !['watch','comment','social','private-social'].includes(c.kind)) throw Error('候选键或类型不合法')
          // Comment experiences can refer to a Bilibili dynamic instead of a video.
          // Validate the real source type; never require a fabricated BV for dynamic comments.
          const videoRef = /^BV[0-9A-Za-z]{10}$/.test(String(c.bvid ?? '')) &&
            (c.dynamicId == null || c.dynamicId === '') && (c.contentType == null || c.contentType === '' || c.contentType === 'video')
          const dynamicRef = c.kind === 'comment' && c.bvid === '' && c.contentType === 'dynamic' &&
            typeof c.dynamicId === 'string' && /^[1-9][0-9]{5,19}$/.test(c.dynamicId)
          const privateRef = c.kind === 'private-social' && c.bvid === '' &&
            (c.dynamicId == null || c.dynamicId === '') && (c.contentType == null || c.contentType === '')
          if (typeof c.bvid !== 'string' || !(privateRef || dynamicRef || (c.kind !== 'private-social' && videoRef))) {
            throw Error('候选视频/动态来源 ID 不合法')
          }
          if (!['pending','reflected','reviewed'].includes(c.status)) throw Error('候选状态不合法')
          if (!Array.isArray(c.memoryIds) || c.memoryIds.length>12 || c.memoryIds.some(v=>typeof v!=='string'||v.length>120)) throw Error('候选关联记忆不合法')
          for (const [k,max] of [['day',20],['time',40],['title',180],['tier',60],['note',260],['recipientName',70],['text',320],['rpid',40],['root',40],['createdAt',40],['reviewedAt',40],['reviewNote',180]]) {
            if (c[k] != null && (typeof c[k] !== 'string' || c[k].length>max)) throw Error('候选文本字段不合法：'+k)
          }
          if (c.retryCount != null && (!Number.isInteger(c.retryCount) || c.retryCount < 0 || c.retryCount > 100)) throw Error('候选重试次数不合法')
          if (c.nextRetryAt != null && (!Number.isFinite(Number(c.nextRetryAt)) || Number(c.nextRetryAt) < 0)) throw Error('候选重试时间不合法')
          if (c.retryPaused != null && typeof c.retryPaused !== 'boolean') throw Error('候选重试暂停标记不合法')
          if (c.lastError != null && (typeof c.lastError !== 'string' || c.lastError.length > 300)) throw Error('候选重试错误过长')
        }
        for (const r of x.runs) {
          if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('反思运行记录不是对象')
          if (!['ok','error'].includes(r.status) || !Number.isFinite(Number(r.at))) throw Error('反思运行记录不合法')
          if ((r.note!=null && (typeof r.note!=='string'||r.note.length>180)) || (r.error!=null && (typeof r.error!=='string'||r.error.length>300))) throw Error('反思运行文本过长')
        }
        if (x.lastError != null && (typeof x.lastError !== 'string' || x.lastError.length>300)) throw Error('lastError 不合法')
      } catch (e) { throw Error('人生记忆候选备份无效：'+String(e?.message||e).slice(0,120)) }
    }
  }
  for (const [file, content] of Object.entries(backup.sqlite)) {
    if (!SQL_PATHS.has(file) || typeof content !== 'string' || content.length > 34_000_000 || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('SQLite 数据不合法：'+String(file).slice(0,90))
  }
  // Never restore an invalid owner-editable rule set; Python would otherwise refuse to search.
  // Backups from older versions may not contain a custom rule file at all.
  let memeRules = null
  if (Object.hasOwn(backup.files, 'comment-meme-rules.json')) {
    try {
      const content=JSON.parse(backup.files['comment-meme-rules.json'])
      memeRules=validateCommentMemeRules(content).rules.length
    } catch (e) {
      throw Error('表情包检索规则备份无效：'+String(e?.message||e).slice(0,120))
    }
  }
  if (Object.keys(backup.config).length > 300) throw Error('设置字段数量异常')
  return {count, databases:Object.keys(backup.sqlite).length, configKeys:Object.keys(backup.config).length, memeRules, createdAt:backup.createdAt||'',integrity:backupAuthenticity(original),legacyUnscoped:!Object.hasOwn(original?.files||{},'character-identity.json'),archiveMonths:Object.keys(backup.files).filter(x=>x.startsWith('life-memory/archive/')).length,episodic:!!backup.files['life-memory/episodic.json'],longTerm:!!backup.files['long-term-memory/dafeiyu.json']}
}

/** Reject identity mixing BEFORE SQLite or any business files are restored.
 * On a fresh installation a portable backup may establish the character ID;
 * on an already-bound installation it must NEVER replace a different fish. */
export function validateRestoreIdentity(root, backup) {
  validateBackup(backup)
  const incoming=backup.files?.['character-identity.json']
  if(!incoming)return {ok:true,legacyBackup:true}
  const wanted=JSON.parse(incoming).id
  for(const name of ['character-identity.json','account-binding.json']) {
    const path=join(root,name)
    if(!existsSync(path))continue
    const st=lstatSync(path)
    if(!st.isFile()||st.isSymbolicLink())throw Error('角色身份目标文件不安全：'+name)
    let prior
    try{prior=JSON.parse(readFileSync(path,'utf8'))}catch{throw Error('本机角色身份文件损坏，不能恢复业务备份')}
    const present=name==='account-binding.json'?prior?.characterId:prior?.id
    if(!present||present!==wanted)throw Error('备份属于不同的鱼鱼角色；不能覆盖本机身份与人生记忆，请使用独立资料目录恢复')
  }
  return {ok:true,characterId:wanted}
}

export function restoreBackupFiles(root, backup, {includePrivate=false}={}) {
  validateRestoreIdentity(root,backup)
  backup=normalizeHistoricalBackup(backup)
  const writes=[], committed=[]
  try {
    // Two-pass restore: validate every path and stage every file before changing
    // any business file. Never traverse an existing symlink directory.
    for (const [name, content] of Object.entries(backup.files)) {
      const parts=name.split('/'),path=join(root,...parts),base=dirname(path)
      let parent=root
      if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('备份根目录不可为符号链接')
      for(const segment of parts.slice(0,-1)){
        parent=join(parent,segment)
        if(existsSync(parent)&&(!lstatSync(parent).isDirectory()||lstatSync(parent).isSymbolicLink()))throw Error('拒绝符号链接/非法目标目录：'+name)
      }
      mkdirSync(base,{recursive:true})
      if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('拒绝符号链接/非法目标文件：'+name)
      const previous=existsSync(path)?readFileSync(path,'utf8'):null
      const newContent=name==='life-memory/episodic.json'?mergeFadedEpisodes(path,content):
        name==='life-memory/event-outbox.json'?mergePrivateLifeOutbox(path,content):
        name==='personality-evolution/v1.json'&&!includePrivate?preservePrivatePersonality(path,content):content
      const tmp=path+'.restore-'+randomUUID()+'.tmp'
      writeFileSync(tmp,newContent,{encoding:'utf8',mode:0o600,flag:'wx'})
      writes.push({path,tmp,previous})
    }
    for(const row of writes){renameSync(row.tmp,row.path);committed.push(row)}
    return committed.length
  }catch(e){
    for(const row of committed.reverse()){
      try{
        if(row.previous===null)rmSync(row.path,{force:true})
        else{
          const restore=row.path+'.rollback-'+randomUUID()+'.tmp'
          writeFileSync(restore,row.previous,{encoding:'utf8',mode:0o600,flag:'wx'})
          renameSync(restore,row.path)
        }
      }catch{}
    }
    throw e
  }finally{
    for(const row of writes)try{rmSync(row.tmp,{force:true})}catch{}
  }
}

export function backupSummary(backup) { return validateBackup(backup) }

// Even an older admin backup may not silently revive details already forgotten
// in the currently active fading copy. This rule also applies to full restores.
const STAGES=['clear','fuzzy','trace','forgotten']
function preservePrivatePersonality(path,content){
  if(!existsSync(path))return content
  const existing=JSON.parse(readFileSync(path,'utf8'))
  // A portable export omits private-derived traits. Do not destroy the local
  // privacy-scoped observations when such an export is restored in-place.
  // Preserve the complete local ledger: the private HMAC salt cannot be
  // reconciled safely with an imported, different public personality salt.
  if(Object.values(existing.traits||{}).some(t=>(t?.evidence||[]).some(e=>e.kind==='private-social')))
    return JSON.stringify(existing,null,2)+'\n'
  return content
}

function mergeFadedEpisodes(path,content){
  if(!existsSync(path))return content
  const old=JSON.parse(readFileSync(path,'utf8')),incoming=JSON.parse(content)
  const current=new Map((old.episodes||[]).map(e=>[e.id,e]))
  incoming.episodes=incoming.episodes.map(e=>{
    const prior=current.get(e.id)
    return prior&&STAGES.indexOf(prior.stage)>STAGES.indexOf(e.stage)?prior:e
  })
  // Portable backups exclude private episodes: preserve the *local* private
  // fading copies during an ordinary restore instead of accidentally erasing.
  for(const e of old.episodes||[])if(e.kind==='private-social'&&!incoming.episodes.some(x=>x.id===e.id))incoming.episodes.push(e)
  incoming.archiveKeys=[...new Set([...(incoming.archiveKeys||[]),...(old.archiveKeys||[])])].slice(-30000)
  return JSON.stringify(incoming,null,2)+'\n'
}

function mergePrivateLifeOutbox(path,content){
  if(!existsSync(path))return content
  const old=JSON.parse(readFileSync(path,'utf8')),incoming=JSON.parse(content)
  if(!Array.isArray(old.pending)||!Array.isArray(incoming.pending))return content
  const known=new Set(incoming.pending.map(r=>r.id))
  for(const r of old.pending)if(r&&typeof r.id==='string'&&!known.has(r.id)&&
      Array.isArray(r.events)&&r.events.some(e=>e.kind==='private-social')){
    incoming.pending.push(r);known.add(r.id)
  }
  if(incoming.pending.length>500)throw Error('私密人生经历待补偿记录过多，不能安全恢复通用备份')
  return JSON.stringify(incoming,null,2)+'\n'
}

export function createLifeMemoryBackup(root){
  // Explicitly confirmed standalone owner memory backup may include private
  // scoped data; ordinary portable business backup never does.
  const all=collectBackupFiles(root,{includePrivate:true})
  const files=Object.fromEntries(Object.entries(all).filter(([name])=>memoryItem(name)))
  if(!files['life-memory/episodic.json'])files['life-memory/episodic.json']=JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:0})
  if(!files['long-term-memory/dafeiyu.json'])files['long-term-memory/dafeiyu.json']=JSON.stringify({version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]}})
  const bundle={format:'dafeiyu-life-memory-backup',schema:2,createdAt:new Date().toISOString(),files,
    hashes:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,digest(content)]))}
  inspectLifeMemoryBackup(bundle)
  return bundle
}
export function inspectLifeMemoryBackup(bundle){
  if(!bundle||bundle.format!=='dafeiyu-life-memory-backup'||bundle.schema!==2||!bundle.files||!bundle.hashes)throw Error('不是双层人生记忆备份')
  const keys=Object.keys(bundle.files)
  if(keys.length>100||keys.length!==Object.keys(bundle.hashes).length)throw Error('记忆备份文件数量不合法')
  let bytes=0
  for(const name of keys){const content=bundle.files[name];if(!memoryItem(name)||!allowedPath(name)||typeof content!=='string'||digest(content)!==bundle.hashes[name])throw Error('记忆备份文件篡改或路径非法：'+name);bytes+=Buffer.byteLength(content);if(bytes>MAX_TOTAL||Buffer.byteLength(content)>MAX_FILE)throw Error('记忆备份文件过大')}
  if(!keys.includes('life-memory/episodic.json')||!keys.some(x=>x.startsWith('long-term-memory/')))throw Error('双层记忆备份缺少核心数据')
  // Reuse the full backup structural validation for all record types.
  const config={},sqlite={};validateBackup({format:FORMAT,schema:SCHEMA,files:bundle.files,config,sqlite,manifest:{algorithm:'sha256',files:bundle.hashes,config:digest(config),sqlite:digest(sqlite)}})
  return {count:keys.length,bytes,archiveMonths:keys.filter(x=>x.startsWith('life-memory/archive/')).length,episodic:true,createdAt:bundle.createdAt,integrity:'sha256-verified'}
}
export function restoreLifeMemoryBackup(root,bundle){
  inspectLifeMemoryBackup(bundle)
  const config={},sqlite={}
  return restoreBackupFiles(root,{format:FORMAT,schema:SCHEMA,files:bundle.files,config,sqlite,manifest:{algorithm:'sha256',files:bundle.hashes,config:digest(config),sqlite:digest(sqlite)}},{includePrivate:true})
}
