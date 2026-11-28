import {planBackupLifeSettings} from './life-settings-control.mjs'
import {assertColdRestoreClear} from './cold-restore-fence.mjs'
import {storageDataPath} from './storage-layout.mjs'
/** Portable business-data export/import. Never include login cookies, DPAPI keys or sticker assets. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validateCommentMemeRules } from './comment-meme-rules.mjs'
import {createLifeMemoryDetailStore,validateDetailFragments} from './life-memory-details.mjs'
import {expandVideoObservationGroups,packVideoObservationGroups} from './video-memory-observation-groups.mjs'
import {validateSelfRecordRows,IDENTITY_MEMORY_MAX_FILE_BYTES} from './long-term-memory.mjs'
import {withDurableFileLock} from './durable-file-lock.mjs'
import {desiredStage,verifyOriginalPublicWatch} from './life-memory-gateway.mjs'

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
const memoryItem=name=>name==='character-identity.json'||name.startsWith('life-memory/')||name.startsWith('long-term-memory/')||name==='personality-evolution/v1.json'||name==='detail-protection/revocations-v1.json'
const MAX_FILE = 16 * 1024 * 1024
const MAX_TOTAL = 192 * 1024 * 1024
const MAX_ITEMS = 15000
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
  ['detail-protection',/^revocations-v1\.json$/],
  ['life-memory/archive',/^20\d{2}-(?:0[1-9]|1[0-2])\.jsonl$/],
  ['daily-dynamic',/^drafts\.json$/],
])
const SQL_PATHS = new Set(['meme-memory.sqlite3', 'public-comment-quota.sqlite3', 'video-actions.sqlite3', 'dynamic-sync/dynamic-limit.sqlite3','daily-dynamic/publish-quota.sqlite3'])

export function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 180 || path.includes('\\') || path.includes('..') || path.startsWith('/')) return false
  const parts = path.split('/')
  if (parts.length === 1) return ROOT_FILES.has(path)
  if(parts.length===5&&parts[0]==='life-memory'&&parts[1]==='details'&&parts[2]==='v1'&&/^[a-f0-9]{16}$/.test(parts[3])&&/^e-[a-f0-9]{18}\.json$/.test(parts[4]))return true
  if (parts.length < 2 || parts.length > 3) return false
  return !!DIR_RULES.get(parts.slice(0,-1).join('/'))?.test(parts.at(-1))
}

// An allowed file that is linked, inaccessible or not a regular file is not
// "absent". Failing the export prevents false complete backups and prevents
// a repair from using another directory's archive as the live witness.
const existingNode=path=>{try{return lstatSync(path)}catch(e){if(e.code==='ENOENT')return null;throw e}}
function backupDirectoryNode(root,relative){
 const parts=relative.split('/')
 for(let i=1;i<=parts.length;i++){
  const path=storageDataPath(root,...parts.slice(0,i)),st=existingNode(path)
  if(!st)return null
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('备份目录存在链接或非目录节点：'+relative)
 }
 return storageDataPath(root,...parts)
}
export function collectBackupFiles(root,{includePrivate=false}={}) {
  const data = {}, stats = { bytes: 0, count: 0 }
  const add = (relative) => {
    if (!allowedPath(relative) || (!includePrivate && relative==='life-memory/private-insights.json')) return
    const parts=relative.split('/')
    if(parts.length>1&&!backupDirectoryNode(root,parts.slice(0,-1).join('/')))return
    const path = storageDataPath(root, ...parts)
    const s = existingNode(path)
    if (!s) return
    if (!s.isFile() || s.isSymbolicLink() || s.nlink!==1) throw Error('备份文件存在链接或非普通文件：'+relative)
    if (s.size > MAX_FILE) throw Error('数据文件过大，未进行不完整备份：'+relative)
    // Refuse before export, never silently omit historical records or details.
    stats.bytes += s.size; stats.count++
    if (stats.count > MAX_ITEMS || stats.bytes > MAX_TOTAL) throw Error(
      `业务数据超过安全备份上限（192 MB / 15000 文件）；已扫描 ${stats.count} 个文件、${(stats.bytes/1048576).toFixed(1)} MB。请使用分批归档方案，不要删除 Life 记忆或省略文件。`
    )
    let content=readFileSync(path,'utf8')
    if(relative==='life-memory/episodic.json'){const snapshot=JSON.parse(content);if(Object.hasOwn(snapshot,'pendingVisualDetails')&&(!Array.isArray(snapshot.pendingVisualDetails)||snapshot.pendingVisualDetails.length))throw Error('深层记忆仍有待写记录，请恢复后再备份')}
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
    const folder = backupDirectoryNode(root,dir)
    if (!folder) continue
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (rule.test(item.name)) add(dir+'/'+item.name)
    }
  }
  // Only owner-confirmed standalone memory backups include private-session
  // details. Portable business backups retain their existing public scope.
  const detailsRoot=backupDirectoryNode(root,'life-memory/details/v1')
  if(detailsRoot){
    for(const dir of [storageDataPath(root,'life-memory'),storageDataPath(root,'life-memory','details'),detailsRoot])
      if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())throw Error('深层记忆备份路径不安全')
    const main=storageDataPath(root,'life-memory','episodic.json')
    if(!existsSync(main))throw Error('存在深层附件却缺少可衰减主记忆，拒绝不完整备份')
    const episodes=expandVideoObservationGroups(JSON.parse(readFileSync(main,'utf8')).episodes||[])
    const eligible=new Map(episodes.filter(e=>e.stage==='clear'&&e.kind==='watch'&&(e.visibility==='public-event'||includePrivate&&e.visibility==='private-session')&&/^[a-f0-9]{16}$/.test(String(e.accountTag||''))).map(e=>[e.id,e]))
    const store=createLifeMemoryDetailStore({dataDir:root})
    for(const tag of readdirSync(detailsRoot)){
      if(!/^[a-f0-9]{16}$/.test(tag))throw Error('未知的深层账号目录')
      const folder=join(detailsRoot,tag)
      if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())throw Error('深层附件目录不安全')
      for(const filename of readdirSync(folder)){
        if(!/^e-[a-f0-9]{18}\.json$/.test(filename))continue
        const id=filename.slice(0,-5),episode=eligible.get(id)
        if(!episode||episode.accountTag!==tag)continue
        const checked=store.read(episode,{limitBytes:16384})
        if(!checked.ok)throw Error('深层附件来源验证失败，备份已停止：'+checked.reason)
        add(['life-memory','details','v1',tag,filename].join('/'))
      }
    }
  }
  return data
}

export function createBackup({root, config, sqlite = {}, version = ''}) {
  return buildBusinessBackup(collectBackupFiles(root),config,sqlite,version)
}
// Capture files synchronously as before; only yield after the snapshot has
// been collected, so progress reporting never interleaves live file reads.
export async function createBackupWithProgress({root,config,sqlite={},version=''},progress){
  const files=collectBackupFiles(root)
  await progress('manifest')
  return buildBusinessBackup(files,config,sqlite,version)
}
function buildBusinessBackup(files,config,sqlite,version){
  const backup = {format:FORMAT,schema:SCHEMA,createdAt:new Date().toISOString(),version,
    config:structuredClone(config),files,sqlite,manifest:{algorithm:'sha256',files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,digest(v)])),config:digest(config),sqlite:digest(sqlite)},
    exclusions:['表情包图片与素材','B站登录凭证/Cookie','独立密钥','Python环境、模型、缓存与日志','外部 dsh-fish-memory 插件目录（仅内置长期记忆会随本插件备份）','私密好友兴趣/关系观察与社交草稿（不随可携带备份转移）','主人私密视觉深层附件（由独立记忆备份保存）']}
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
    if(file.startsWith('life-memory/details/v1/')){
      try{const row=JSON.parse(content);if(row?.schema!=='life-memory-detail/v1'||!/^e-[a-f0-9]{18}$/.test(row.parentMemoryId)||row.accountTag!==file.split('/')[3]||!['public-event','private-session'].includes(row.visibility)||!row.parentFingerprint||!Array.isArray(row.fragments))throw Error('结构不合法');validateDetailFragments(row.fragments)}catch(e){throw Error('深层记忆附件无效：'+String(e?.message||e).slice(0,90))}
    }
    if(file==='detail-protection/revocations-v1.json'){
      try{const row=JSON.parse(content);if(row?.version!==1||!Array.isArray(row.ids)||row.ids.length>200000||row.ids.some(v=>!/^e-[a-f0-9]{18}$/.test(v)))throw Error('遗忘记录无效')}catch(e){throw Error('深层记忆遗忘保护无效：'+String(e?.message||e).slice(0,90))}
    }
    if(file==='life-memory/episodic.json'){
      try{const x=JSON.parse(content);if(Object.hasOwn(x||{},'pendingVisualDetails')&&(!Array.isArray(x.pendingVisualDetails)||x.pendingVisualDetails.length))throw Error('备份不可携带未完成的深层写入');if(x?.version!==1||!Array.isArray(x.episodes)||!Array.isArray(x.archiveKeys)||x.episodes.length>3200||x.archiveKeys.length>30000||expandVideoObservationGroups(x.episodes).some(e=>!e||!['clear','fuzzy','trace','forgotten'].includes(e.stage)||typeof e.id!=='string'||typeof e.text!=='string'))throw Error('结构不兼容')}
      catch(e){throw Error('可衰减记忆备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if(file.startsWith('life-memory/archive/')){
      try{for(const line of content.split('\n').filter(Boolean)){if(line.length>20000)throw Error('单条档案过长');const x=JSON.parse(line);if(x.version!==1||typeof x.id!=='string'||!x.event||typeof x.event!=='object'||Object.hasOwn(x,'originalPublicWatchSha256')&&!/^[a-f0-9]{64}$/.test(x.originalPublicWatchSha256))throw Error('事件不合法')}}
      catch(e){throw Error('永久档案备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file.startsWith('long-term-memory/')) {
      try {
        if(bytes>IDENTITY_MEMORY_MAX_FILE_BYTES)throw Error('长期记忆文件超过 8MB 安全上限')
        const x=JSON.parse(content)
        if (![2,3].includes(x?.version) || !Array.isArray(x.memories) || !Array.isArray(x.traces) || !Array.isArray(x.deleted) || x.memories.length>5000 || x.deleted.length>1500) throw Error('结构不兼容')
        validateSelfRecordRows(x)
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
  const identity=JSON.parse(incoming),wanted=identity.id
  for(const name of ['character-identity.json','account-binding.json']) {
    const path=storageDataPath(root,...name.split('/'))
    if(!existsSync(path))continue
    const st=lstatSync(path)
    if(!st.isFile()||st.isSymbolicLink())throw Error('角色身份目标文件不安全：'+name)
    let prior
    try{prior=JSON.parse(readFileSync(path,'utf8'))}catch{throw Error('本机角色身份文件损坏，不能恢复业务备份')}
    const present=name==='account-binding.json'?prior?.characterId:prior?.id
    if(!present||present!==wanted||name==='character-identity.json'&&Number(prior.createdAt)!==Number(identity.createdAt))throw Error('备份属于不同的鱼鱼角色；不能覆盖本机身份与人生记忆，请使用独立资料目录恢复')
  }
  return {ok:true,characterId:wanted}
}

// A portable backup is not proof of the latest permissions or action state.
// Only editable preferences and user-authored rules can be applied to a running
// identity. Never replay a stale ledger, private memory or SQLite snapshot.
const EDITABLE_BACKUP_FILES=new Set(['duty.md','comment-meme-rules.json'])
const EDITABLE_BACKUP_SETTINGS=new Set(['personaPrompt','characterLore','coreInterestTopics','keywords','visionPrompt','memeRulesPrompt','commentMemePrompt','asrLanguage','reportLevel'])
const sameBackupValue=(a,b)=>a===b||JSON.stringify(a)===JSON.stringify(b)
// One explicit policy for the live portable restore. Unknown and authority-
// bearing settings are deliberately not interpreted as preferences.
const RESTORE_GROUPS=Object.freeze([
 {id:'identity',title:'人格、兴趣与用户规则',keys:['personaPrompt','characterLore','coreInterestTopics','keywords','reportLevel','memeRulesPrompt','commentMemePrompt'],files:['duty.md','comment-meme-rules.json']},
 {id:'memory',title:'记忆与反思',keys:['mainSessionMemoryHalfLifeDays','mainSessionMemoryThreshold','mainSessionMemoryMaxItems','mainSessionMemoryMaxChars','mainSessionMemoryDailyQuota','mainSessionMemoryFactsMax','mainSessionMemoryConsolidationEnabled','mainSessionMemorySemanticEnabled','mainSessionMemoryCandidates','mainSessionMemorySearchDailyLimit','mainSessionReflectionMinCandidates','mainSessionReflectionBatchSize','mainSessionReflectionIntervalHours','mainSessionReflectionDailyBatches','socialMemoryHalfLifeNewDays','socialMemoryHalfLifeKnownDays','socialMemoryHalfLifeFamiliarDays','socialMemoryHalfLifeFriendDays','socialMemoryHalfLifeWhitelistDays','socialMemoryHalfLifeOwnerDays']},
 {id:'messages',title:'消息感知与请求保护',keys:['dmActivePollEnabled','dmOwnerPollEnabled','dmOwnerPollSeconds','dmOwnerActivePollSeconds','dmActivePollSeconds','dmActiveWindowSeconds','dmWatchMinutes','dmQuietMaxMinutes','dmDetailMaxSessions','dmDetailSpacingMs','commentReplyWatchMinutes','commentAtWatchMinutes','commentTopWatchMinutes','biliReadMinuteLimit','biliReadHourLimit']},
 {id:'perception',title:'视频感知与探索偏好',keys:['visionPrompt','visionFrames','asrLanguage','homeRecommendationsEnabled','memeMemoryMaxEntries','minVideoViews','minVideoLikes','minVideoReplies']},
 {id:'textModels',title:'已验证文字模型路线',keys:['pluginDefaultModelProvider','pluginDefaultModelId','videoModelProvider','videoModelId','behaviorDecisionModelProvider','behaviorDecisionModelId','interactionModelProvider','interactionModelId','mainSessionMemoryModelProvider','mainSessionMemoryModelId','mainSessionReflectionModelProvider','mainSessionReflectionModelId','dailyDynamicModelProvider','dailyDynamicModelId','ownerDmAgentModelProvider','ownerDmAgentModelId','memeRulesModelProvider','memeRulesModelId'],verify:true},
 {id:'asr',title:'本地语音识别',keys:['asrModel','transcribe'],verify:true},
 {id:'diagnostics',title:'诊断与日志偏好',keys:['diagMentionEnabled','diagDynamicEnabled','diagVisionEnabled','diagMemeEnabled','diagAtInviteEnabled','diagReplyInboxEnabled','visionDebug','commentMemesDebug']},
])
const RESTORE_LABELS={personaPrompt:'人格提示词',characterLore:'角色背景',coreInterestTopics:'核心兴趣',keywords:'关键词',reportLevel:'报告级别',memeRulesPrompt:'梗规则提示词',commentMemePrompt:'评论表情提示词',visionPrompt:'画面理解提示词',visionFrames:'每次观察帧数',asrLanguage:'语音识别语言',homeRecommendationsEnabled:'首页推荐探索',minVideoViews:'最低播放量',minVideoLikes:'最低点赞数',minVideoReplies:'最低评论数',mainSessionMemoryHalfLifeDays:'普通记忆半衰期（天）',mainSessionMemoryThreshold:'召回证据门槛',mainSessionMemoryMaxItems:'每轮召回条数',mainSessionMemoryMaxChars:'每轮召回字数',mainSessionMemoryDailyQuota:'每日记忆写入额度',mainSessionMemoryFactsMax:'长期事实召回上限',mainSessionMemoryConsolidationEnabled:'聊天记忆凝练',mainSessionMemorySemanticEnabled:'AI 辅助记忆检索',mainSessionMemoryCandidates:'AI 检索候选数',mainSessionMemorySearchDailyLimit:'每日 AI 检索额度',mainSessionReflectionMinCandidates:'反思候选门槛',mainSessionReflectionBatchSize:'单批反思上限',mainSessionReflectionIntervalHours:'反思间隔（小时）',mainSessionReflectionDailyBatches:'每日反思批数',socialMemoryHalfLifeNewDays:'新关系半衰期（天）',socialMemoryHalfLifeKnownDays:'认识半衰期（天）',socialMemoryHalfLifeFamiliarDays:'熟人半衰期（天）',socialMemoryHalfLifeFriendDays:'朋友半衰期（天）',socialMemoryHalfLifeWhitelistDays:'白名单半衰期（天）',socialMemoryHalfLifeOwnerDays:'主人半衰期（天）',dmOwnerPollSeconds:'主人日常检测（秒）',dmOwnerActivePollSeconds:'主人活跃检测（秒）',dmOwnerPollEnabled:'主人优先检测',dmActivePollEnabled:'普通活跃检测',dmActivePollSeconds:'普通活跃检测（秒）',dmActiveWindowSeconds:'活跃窗口（秒）',dmWatchMinutes:'私信最短轮询（分钟）',dmQuietMaxMinutes:'私信最长轮询（分钟）',dmDetailMaxSessions:'私信单轮会话数',dmDetailSpacingMs:'私信详情间隔（毫秒）',commentReplyWatchMinutes:'评论回复检测（分钟）',commentAtWatchMinutes:'评论提及检测（分钟）',commentTopWatchMinutes:'热门评论检测（分钟）',biliReadMinuteLimit:'每分钟读取预算',biliReadHourLimit:'每小时读取预算',lifeAgentMode:'自主生活状态',autonomousPlannerEnabled:'计划员',peakValley:'旧定时器',autonomousPlannerMinutes:'考虑间隔（分钟）',autonomousPlannerDailyLimit:'每日考虑额度',autonomousPlannerStartHour:'开始时段',autonomousPlannerEndHour:'结束时段',videoAgentMinIntervalMinutes:'视频探索间隔（分钟）',videoAgentReadTargetPerRound:'每轮阅读目标',videoAgentPickTargetPerRound:'每轮挑选目标'}
const displayValue=v=>{const text=typeof v==='string'?v:JSON.stringify(v??null);return text.length>360?text.slice(0,360)+'…（预览截断）':v??null}
const timestamp=v=>{const n=typeof v==='number'?v:Date.parse(v);return Number.isFinite(n)&&n>0&&n<=8640000000000000?n:0}
function memoryRows(files,name,key,expand=false){
 if(!Object.hasOwn(files,name))return null
 const rows=JSON.parse(files[name])[key];if(!Array.isArray(rows))return null
 return expand?expandVideoObservationGroups(rows):rows
}
// Count logical observations, not physical packed rows. Never expose text,
// private identities or claim that a backed-up row can be restored.
export function backupMemoryOverview(files={}){
 const episodes=memoryRows(files,'life-memory/episodic.json','episodes',true),long=memoryRows(files,'long-term-memory/dafeiyu.json','memories'),candidates=memoryRows(files,'life-memory/candidates.json','candidates')
 const rowSummary=rows=>rows===null?null:{count:rows.length,lastAt:rows.reduce((n,row)=>Math.max(n,timestamp(row?.at),timestamp(row?.createdAt),timestamp(row?.time)),0)||null}
 const stages=episodes===null?null:Object.fromEntries(STAGES.map(stage=>[stage,episodes.filter(row=>row.stage===stage).length]))
 return {episodes:rowSummary(episodes),stages,longTerm:rowSummary(long===null?null:long.filter(row=>!row?.已被取代)),candidates:rowSummary(candidates),associations:episodes===null?null:(Array.isArray(JSON.parse(files['life-memory/episodic.json']).associations)?JSON.parse(files['life-memory/episodic.json']).associations.length:0),details:Object.keys(files).filter(name=>name.startsWith('life-memory/details/v1/')).length,archiveMonths:Object.keys(files).filter(name=>name.startsWith('life-memory/archive/')).length}
}
// Compare stable record identities, not file size or newest timestamp. Never
// return raw memory text or infer that absence means accidental deletion.
export function backupMemoryDifferences(current={},incoming={}){
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value
 const compare=(name,key,expand=false)=>{
  const a=memoryRows(current,name,key,expand),b=memoryRows(incoming,name,key,expand)
  if(a===null||b===null)return null
  const index=rows=>{const map=new Map();for(const row of rows){if(typeof row?.id!=='string'||!row.id||map.has(row.id))return null;map.set(row.id,row)}return map}
  const live=index(a),old=index(b);if(!live||!old)return {comparable:false,reason:'记录缺少唯一身份或身份重复，不能安全逐条比较'}
  let backupOnly=0,currentOnly=0,changed=0,same=0,archived=0,revoked=0,liveForgotten=0
  const samples=[],keys=name==='life-memory/episodic.json'?new Set(JSON.parse(current[name]).archiveKeys||[]):new Set()
  const revokedIds=name==='life-memory/episodic.json'&&current['detail-protection/revocations-v1.json']?new Set(JSON.parse(current['detail-protection/revocations-v1.json']).ids||[]):new Set()
  const sample=(type,row,prior)=>{if(samples.length<12)samples.push({type,at:timestamp(row.at)||timestamp(row.createdAt)||timestamp(row.time)||null,backupStage:type==='currentOnly'?null:row.stage||null,currentStage:type==='currentOnly'?row.stage||null:prior?.stage||null})}
  for(const [id,row] of old){const prior=live.get(id);if(!prior){backupOnly++;if(keys.has(id))archived++;if(revokedIds.has(id))revoked++;sample('backupOnly',row)}else if(JSON.stringify(canonical(prior))!==JSON.stringify(canonical(row))){changed++;if(prior.stage==='forgotten')liveForgotten++;sample('changed',row,prior)}else same++}
  for(const [id,row] of live)if(!old.has(id)){currentOnly++;sample('currentOnly',row)}
  return {comparable:true,backupOnly,currentOnly,changed,same,archived,revoked,liveForgotten,samples}
 }
 return {episodes:compare('life-memory/episodic.json','episodes',true),longTerm:compare('long-term-memory/dafeiyu.json','memories'),candidates:compare('life-memory/candidates.json','candidates')}
}
const modelField=k=>/Model(?:Provider|Id|Path|ReasoningEffort)$|ReasoningEffort$|^(?:visionMode|visionEnabled|visionLocalModel|visionLocalThinking|transcribe|asrModel|mainSessionMemoryEmbeddingEnabled|pythonPath|visionPythonPath|ffmpegPath|dshBin|headlessProfile|workspace|backupDirectory|overlayMcp)$/.test(k)
const delta=(key,before,after)=>({key,label:RESTORE_LABELS[key]||key,before:displayValue(before),after:displayValue(after)})
export function previewBusinessRestore(current,incoming,{normalizePatch,verifyGroup, ...scope}={}){
 validateBackup(current);validateBackup(incoming)
 const groups=[],patches={},known=new Set(),knownFiles=new Set()
 for(const spec of RESTORE_GROUPS){
  const raw={},rows=[],files=[]
  for(const key of spec.keys){known.add(key);if(!Object.hasOwn(incoming.config,key)||sameBackupValue(current.config[key],incoming.config[key]))continue
   const value=incoming.config[key],prior=current.config[key]
   rows.push(delta(key,prior,value));raw[key]=value
  }
  for(const name of spec.files||[]){knownFiles.add(name);if(Object.hasOwn(incoming.files,name)&&!sameBackupValue(current.files[name],incoming.files[name]))files.push(name)}
  // A unit is the smallest safely restorable change. Model routes and ASR
  // retain atomic verification; ordinary independent preferences do not block
  // their neighbours. No caller may construct a patch from arbitrary keys.
  const units=[]
  const addUnit=(id,keys,names)=>{
   const selected=Object.fromEntries(keys.map(k=>[k,raw[k]]))
   let reason=''
   try{
    for(const [key,value] of Object.entries(selected)){
     const prior=current.config[key];if(prior===undefined||typeof prior!==typeof value||Array.isArray(prior)!==Array.isArray(value)||value===null||typeof value==='object'&&(!Array.isArray(value)||value.some(x=>typeof x!=='string')))throw Error('旧设置类型或当前字段不兼容：'+key)
    }
    if(keys.length){if(typeof normalizePatch!=='function')throw Error('缺少当前设置校验器');const checked=normalizePatch(selected);for(const [key,value] of Object.entries(selected))if(!sameBackupValue(checked[key],value))throw Error('备份参数超出当前版本范围：'+key)}
    if(keys.length&&(spec.verify||selected.mainSessionMemorySemanticEnabled===true)){if(typeof verifyGroup!=='function')throw Error('缺少当前环境核验器');verifyGroup(spec.id,selected,current.config)}
   }catch(e){reason=String(e?.message||e).slice(0,180)}
   units.push({id,keys,files:names,available:!reason,reason})
   if(!reason)patches[id]={raw:selected,files:names}
   for(const row of rows.filter(r=>keys.includes(r.key)))Object.assign(row,{unitId:id,available:!reason,reason})
  }
  if(spec.verify){if(rows.length)addUnit(spec.id,Object.keys(raw),[])}
  else for(const key of Object.keys(raw))addUnit(spec.id+':'+key,[key],[])
  for(const name of files)addUnit(spec.id+':file:'+name,[],[name])
  if(units.length){
   const available=units.filter(u=>u.available)
   // Legacy group-selection clients can still select an entirely eligible group.
   // Mixed groups require explicit unit IDs so the exact subset is confirmed.
   if(available.length===units.length)patches[spec.id]={raw,files}
   groups.push({id:spec.id,title:spec.title,rows,files,units,available:available.length>0,reason:available.length===units.length?'':available.length?'部分设置需要单独核验；可恢复项仍可选择。':units.map(u=>u.reason).filter(Boolean).join('；').slice(0,360)})
  }
 }
 const life=previewBusinessLifeRestore(current.config,incoming,scope)
 const lifeKeys=['lifeAgentMode','autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit','autonomousPlannerStartHour','autonomousPlannerEndHour','videoAgentMinIntervalMinutes','videoAgentReadTargetPerRound','videoAgentPickTargetPerRound']
 const lifeRows=[];for(const key of lifeKeys){known.add(key);if(Object.hasOwn(incoming.config,key)&&!sameBackupValue(current.config[key],incoming.config[key]))lifeRows.push(delta(key,current.config[key],incoming.config[key]))}
 if(lifeRows.length&&(!life.available||Object.keys(life.changed).length))groups.push({id:'life',title:'自主生活方案',rows:life.available?Object.entries(life.changed).map(([k,v])=>delta(k,v.before,v.after)):lifeRows,files:[],available:life.available,reason:life.reason||'开启状态需要当前账号及能力核验'})
 const protectedKeys=Object.keys(incoming.config).filter(k=>!known.has(k)&&!sameBackupValue(current.config[k],incoming.config[k]))
 const modelKeys=protectedKeys.filter(modelField),otherKeys=protectedKeys.filter(k=>!modelField(k))
 // Protected values may contain account identifiers, credentials or paths.
 // Show their labels/count only, not their actual values.
 for(const [id,title,keys,reason] of [['models','模型与本机环境',modelKeys,'须在相应模型、安装或能力验收页重新核验；不会直接写入旧路径或模型。'],['protected','权限、会话及其他设置',otherKeys,'当前授权、绑定、任务及未识别的旧字段保持不变。']])if(keys.length)groups.push({id,title,rows:keys.map(key=>({key,label:RESTORE_LABELS[key]||key,protected:true})),files:[],available:false,reason})
 const retainedFiles=Object.keys(incoming.files).filter(k=>!knownFiles.has(k)&&!sameBackupValue(current.files[k],incoming.files[k]))
 if(retainedFiles.length||Object.keys(incoming.sqlite).length)groups.push({id:'records',title:'历史业务记录与记忆',rows:[],files:[],recordCount:retainedFiles.length,databases:Object.keys(incoming.sqlite).length,available:false,reason:'检测到历史文件差异或备份数据库，但禁止整体覆盖：旧经历可能已衰减、遗忘或被容量淘汰，旧任务及发送账本也不能重放。可核验的缺失深层附件可单独补回；符合连续保留及原回执核验的缺失公开经历可单独修复。'})
 const currentKeys=[...known].sort(),ruleNames=[...knownFiles].sort()
 const revision=digest([incoming.format,incoming.schema,incoming.config,incoming.files,incoming.sqlite,scope.characterId,scope.scopeRevision??"",scope.canResume===true,life.revision,groups.map(g=>[g.id,g.available,g.units?.map(u=>[u.id,u.available,u.reason])]),currentKeys.map(k=>[k,current.config[k]]),ruleNames.map(k=>[k,current.files[k]])]).slice(0,32)
 let memoryRepairable=null,missingEpisodes=0,missingReason='业务备份缺少同角色校验或完整记忆核心'
 try{const live=memoryRepairSource(current,scope),old=memoryRepairSource(incoming,scope);memoryRepairable=planPortableMemoryRepair(live,old).repairs.length;const missing=planMissingPublicEpisodes(live,old,{...scope,sameCharacter:true});missingEpisodes=missing.rows.length;missingReason=missing.reason}catch{/* No compatible scoped core; counts remain informational. */}
 return {groups,revision,life, memory:{continuity:memoryRestoreContinuity(current,incoming),current:backupMemoryOverview(current.files),backup:backupMemoryOverview(incoming.files),repairable:memoryRepairable,missingEpisodes,missingReason,differences:backupMemoryDifferences(current.files,incoming.files)},patches}
}
// Return only the UI projection, not full raw patches / private data.
export function businessRestorePreview(current,incoming,options){const {patches,...preview}=previewBusinessRestore(current,incoming,options);return preview}
// The original conservative restore remains the default. A separate explicit
// selection can restore Life preferences for this same sealed character only.
export function previewBusinessLifeRestore(currentConfig,incoming,{characterId,canResume=false,scopeRevision=""}={}){
  if(!characterId||incoming?.schema!==SCHEMA||!incoming.files?.['character-identity.json'])return {available:false,reason:'仅同角色且有完整校验清单的备份支持恢复生活方案'}
  try{
    if(JSON.parse(incoming.files['character-identity.json']).id!==characterId)return {available:false,reason:'备份角色与当前角色不一致'}
    const plan=planBackupLifeSettings(currentConfig,incoming.config)
    if(plan.mode!=='off'&&(!canResume||currentConfig.masterEnabled!==true))return {available:false,reason:'备份中的生活方案会恢复运行；请先完成当前账号、能力、模型核验并开启总开关，再重新选择备份'}
    return {available:true,...plan,revision:digest([plan.revision,scopeRevision]).slice(0,32)}
  }catch(e){return {available:false,reason:String(e?.message||e).slice(0,180)}}
}
export function planBusinessRestore(current,incoming,{lifeRevision,characterId,canResume=false,scopeRevision="",selection,restoreRevision,normalizePatch,verifyGroup}={}){
  validateBackup(current);validateBackup(incoming)
  const files={},config={}
  const changed=[]
  let selectedPreview=null,selectedFiles=null,selectedKeys=null
  if(selection!==undefined||restoreRevision!==undefined){
    if(!Array.isArray(selection)||!selection.length||new Set(selection).size!==selection.length)throw Error('请选择要恢复的设置分类')
    selectedPreview=previewBusinessRestore(current,incoming,{characterId,canResume,scopeRevision,normalizePatch,verifyGroup})
    if(restoreRevision!==selectedPreview.revision)throw Error('设置或备份已变化，请重新预览并确认')
    for(const id of selection)if(id==='life'?!selectedPreview.groups.some(g=>g.id==='life'&&g.available):!Object.hasOwn(selectedPreview.patches,id))throw Error('选中的恢复分类或设置不可用')
    if(selection.some(id=>selection.some(other=>other!==id&&other.startsWith(id+':'))))throw Error('不能重复选择分类与单项')
    selectedFiles=new Set(selection.flatMap(id=>selectedPreview.patches[id]?.files||[]))
    selectedKeys=new Set(selection.flatMap(id=>Object.keys(selectedPreview.patches[id]?.raw||{})))
    if(selection.includes('life'))lifeRevision=selectedPreview.life.revision
  }
  for(const [name,content] of Object.entries(incoming.files)){
    if(sameBackupValue(current.files[name],content))continue
    if(selectedFiles?selectedFiles.has(name):EDITABLE_BACKUP_FILES.has(name))files[name]=content
    else changed.push(name)
  }
  for(const [name,content] of Object.entries(incoming.sqlite))if(!sameBackupValue(current.sqlite[name],content))changed.push(name)
  for(const [name,value] of Object.entries(incoming.config))if((selectedKeys?selectedKeys.has(name):EDITABLE_BACKUP_SETTINGS.has(name))&&!sameBackupValue(current.config[name],value))config[name]=value
  let lifePlan=null
  if(lifeRevision!==undefined){
    if(!characterId||JSON.parse(current.files['character-identity.json']||'null')?.id!==characterId)throw Error('当前恢复前备份的角色身份不一致')
    lifePlan=previewBusinessLifeRestore(current.config,incoming,{characterId,canResume,scopeRevision})
    if(!lifePlan.available)throw Error(lifePlan.reason)
    if(lifeRevision!==lifePlan.revision)throw Error('生活设置已变化，请重新选择备份并确认差异')
    Object.assign(config,lifePlan.patch)
  }
  if(selectedPreview&&typeof normalizePatch==='function'&&Object.keys(config).length){
    const checked=normalizePatch(config)
    if(Object.entries(config).some(([k,v])=>!sameBackupValue(checked[k],v)))throw Error('组合后的设置不兼容，请重新选择')
    if(Object.keys(config).some(k=>RESTORE_GROUPS.find(g=>g.id==='textModels').keys.includes(k)))verifyGroup('textModels',config,current.config)
    if(config.mainSessionMemorySemanticEnabled===true)verifyGroup('memory',config,current.config)
    if(Object.keys(config).some(k=>RESTORE_GROUPS.find(g=>g.id==='asr').keys.includes(k)))verifyGroup('asr',config,current.config)
  }
  const retainedSettingKeys=Object.keys(incoming.config).filter(name=>!Object.hasOwn(config,name)&&!sameBackupValue(current.config[name],incoming.config[name]))
  const retainedSettings=retainedSettingKeys.length
  const subset=(source,selected)=>{
    const chosen=Object.fromEntries(selected.filter(name=>Object.hasOwn(source.files,name)).map(name=>[name,source.files[name]]))
    const config={},sqlite={}
    return {format:FORMAT,schema:SCHEMA,files:chosen,config,sqlite,manifest:{algorithm:'sha256',files:Object.fromEntries(Object.entries(chosen).map(([name,value])=>[name,digest(value)])),config:digest(config),sqlite:digest(sqlite)}}
  }
  const names=Object.keys(files)
  return {patch:config,retainedSettings,retainedSettingKeys,retainedRecords:changed.length,names,lifePlan,restore:subset(incoming,names),rollback:subset(current,names)}
}
// An older backup may repair a missing detail only when the live parent
// is still clear, byte-equivalent to the original parent, and the live
// revocation ledger demonstrably retains all recorded revocations. No
// historical parent, memory relation, or queued action is ever imported here.
const backupCharacterRecord=bundle=>JSON.parse(bundle?.files?.['character-identity.json']||'null')
const backupCharacter=bundle=>backupCharacterRecord(bundle)?.id||''
// An equal ID is necessary, never sufficient proof that two histories are one branch.
export function memoryRestoreContinuity(current,incoming){
 const live=current?.schema===2?backupCharacter(current):'',old=incoming?.schema===2?backupCharacter(incoming):''
 const identity=live&&old?(live===old&&Number(backupCharacterRecord(current).createdAt)===Number(backupCharacterRecord(incoming).createdAt)?'same-character':'different-character'):'unscoped'
 return {identity,historyProven:false,mode:'incremental-repair',
   reason:identity==='same-character'?'角色身份一致；仍须逐条核验原经历、归档、账号及遗忘保护，不合并独立生活分支。':identity==='different-character'?'角色身份不同，拒绝合并记忆。':'缺少可核验角色身份；仅保留旧版精确活体附件修复，不允许恢复缺失经历。',
   fullRestore:{available:false,reason:'便携备份排除了凭据、部分私密状态和运行账本，不是完整停机快照；历史覆盖必须先具备完整保护事实、停机事务及回滚，当前入口不开放。'},
   migration:{available:false,reason:'尚无跨设备唯一现役主体及完整历史交接证明；不能将旧备份作为第二个现役鱼鱼启动。'}}
}
export function memoryRepairSource(bundle,{characterId}={}){
  if(bundle?.format==='dafeiyu-life-memory-backup'){
    inspectLifeMemoryBackup(bundle)
    if(backupCharacter(bundle)&&(!characterId||backupCharacter(bundle)!==characterId))throw Error('记忆备份角色身份与当前鱼鱼不同或尚未核验，拒绝恢复')
    return bundle
  }
  validateBackup(bundle)
  if(bundle.schema!==SCHEMA||!characterId||JSON.parse(bundle.files['character-identity.json']||'null')?.id!==characterId)throw Error('业务备份需具备原始校验清单及相同角色身份，才能用于记忆修复')
  const files=Object.fromEntries(Object.entries(bundle.files).filter(([name])=>memoryItem(name)))
  // A business bundle has public scope. Do not widen it on import.
  for(const name of Object.keys(files))if(name==='life-memory/private-insights.json'||name.startsWith('life-memory/details/v1/')&&JSON.parse(files[name]).visibility!=='public-event')delete files[name]
  const result={format:'dafeiyu-life-memory-backup',schema:2,createdAt:bundle.createdAt,files,hashes:Object.fromEntries(Object.keys(files).map(name=>[name,bundle.manifest.files[name]]))}
  inspectLifeMemoryBackup(result);return result
}
export function planPortableMemoryRepair(current,incoming){
  inspectLifeMemoryBackup(current);inspectLifeMemoryBackup(incoming)
  const parseFile=(b,n)=>Object.hasOwn(b.files,n)?JSON.parse(b.files[n]):null
  const parents=b=>new Map(expandVideoObservationGroups(parseFile(b,'life-memory/episodic.json').episodes).map(e=>[e.id,e]))
  const continuity=memoryRestoreContinuity(current,incoming)
  if(backupCharacter(incoming)&&continuity.identity!=='same-character')throw Error('记忆备份角色身份与当前鱼鱼不一致，拒绝修复')
  const live=parents(current),old=parents(incoming)
  const currentLedger=parseFile(current,'detail-protection/revocations-v1.json'),oldLedger=parseFile(incoming,'detail-protection/revocations-v1.json')
  const revoked=new Set(currentLedger?.ids||[])
  const ledgerKnown=!!currentLedger&&!!oldLedger&&oldLedger.ids.every(id=>revoked.has(id))
  const repairs=[];let retainedRecords=0
  for(const [name,content] of Object.entries(incoming.files)){
    if(name==='character-identity.json'||sameBackupValue(current.files[name],content))continue
    if(ledgerKnown&&name.startsWith('life-memory/details/v1/')&&!Object.hasOwn(current.files,name)){
      const row=JSON.parse(content),ep=live.get(row.parentMemoryId),prior=old.get(row.parentMemoryId)
      const fingerprint=ep&&digest([ep.id,ep.accountTag,ep.kind,ep.at,ep.bvid,ep.visibility])
      if(ep&&prior&&sameBackupValue(ep,prior)&&ep.stage==='clear'&&ep.kind==='watch'&&
        !revoked.has(ep.id)&&row.accountTag===ep.accountTag&&row.visibility===ep.visibility&&
        row.parentFingerprint===fingerprint&&name===`life-memory/details/v1/${ep.accountTag}/${ep.id}.json`){
        repairs.push({episode:ep,fragments:validateDetailFragments(row.fragments)});continue
      }
    }
    retainedRecords++
  }
  return {repairs,retainedRecords,requiredRevocations:[...revoked]}
}
// The permanent archive is append-only for current public facts. Compare the
// actual recorded sequence, not latest time or number of rows. Private-social
// rows are omitted in business exports; ignore that intentional projection.
// This is a necessary local witness, not proof of global device exclusivity.
function checkPublicArchivePrefix(current,incoming){
 const visible=content=>(content||'').split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.event?.kind!=='private-social'&&row.event?.experience?.source!=='main-session')
 let matched=0
 for(const [name,content] of Object.entries(incoming.files)){
  if(!name.startsWith('life-memory/archive/'))continue
  const old=visible(content),live=visible(current.files[name])
  if(old.length>live.length)return {ok:false,matched}
  for(let i=0;i<old.length;i++){
   if(!sameBackupValue(old[i],live[i]))return {ok:false,matched}
   matched++
  }
 }
 return {ok:matched>0,matched}
}
// Administrative repair only. Absence from the live window is NOT evidence
// of accidental loss. Require a recent uninterrupted mutation history and
// an independently retained original receipt; never import an archive row as
// a new experience, resurrect a tombstone, or overwrite a current record.
export function planMissingPublicEpisodes(current,incoming,{sameCharacter=false,accountTag='',halfLifeDays=30,now=Date.now()}={}){
 const empty=reason=>({rows:[],reason})
 const name='life-memory/episodic.json',ledgerName='detail-protection/revocations-v1.json'
 const parse=(bundle,key)=>Object.hasOwn(bundle.files,key)?JSON.parse(bundle.files[key]):null
 const live=parse(current,name),old=parse(incoming,name)
 if(!live||!old)return empty('缺少完整经历主记录')
 const active=expandVideoObservationGroups(live.episodes),previous=expandVideoObservationGroups(old.episodes),ids=new Set(active.map(e=>e.id)),missing=previous.filter(e=>!ids.has(e.id))
 if(!missing.length)return empty('没有备份独有的经历；同 ID 内容差异及当前独有经历不会回退')
 if(!sameCharacter||memoryRestoreContinuity(current,incoming).identity!=='same-character'||! /^[a-f0-9]{16}$/.test(accountTag))return empty('缺少相同角色的已校验备份或当前已核验账号；独立旧记忆备份不能证明角色身份')
 const oldLedger=parse(incoming,ledgerName),liveLedger=parse(current,ledgerName),revoked=new Set(liveLedger?.ids||[])
 if(!oldLedger||!liveLedger||!oldLedger.ids.every(id=>revoked.has(id)))return empty('缺少完整且连续的遗忘／深层撤销保护')
 const start=timestamp(old.updatedAt),end=timestamp(live.updatedAt),created=timestamp(incoming.createdAt)
 if(!start||!end||!created||start>created||created>now||end<start||end>now||now-start>6*86400000)return empty('备份或当前经历更新时间不在可核验的近期保留窗口内')
 const health=data=>{
  if(!Array.isArray(data.healthEvents)||data.healthEvents.length>7)return null
  const map=new Map();for(const row of data.healthEvents){if(!/^\d{4}-\d{2}-\d{2}$/.test(row?.date)||map.has(row.date)||!['added','evicted','naturallyForgotten','evictedForgotten'].every(k=>Number.isSafeInteger(row[k])&&row[k]>=0&&row[k]<1_000_000_000))return null;map.set(row.date,row)}return map
 }
 const before=health(old),after=health(live),day=t=>new Date(t).toLocaleDateString('en-CA'),first=day(start),last=day(now)
 if(!before?.has(first)||!after?.has(first))return empty('缺少备份当日的连续保留统计，无法区分意外缺失与淘汰')
 for(const [date,row] of before){const next=after.get(date);if(date>=first&&(!next||['added','evicted','naturallyForgotten','evictedForgotten'].some(k=>next[k]<row[k])))return empty('保留统计缺失或回退')}
 const cursor=new Date(start);cursor.setHours(12,0,0,0)
 while(day(cursor)<=last){const date=day(cursor),a=after.get(date),b=date===first?before.get(date):null
  if(!a)return empty('保留统计存在未核验日期，无法证明期间未发生淘汰或遗忘')
  if(['evicted','naturallyForgotten','evictedForgotten'].some(k=>a[k]!== (b?.[k]||0)))return empty('备份后发生过淘汰或遗忘，不能将缺失旧经历直接激活')
  cursor.setDate(cursor.getDate()+1)
 }
 const currentKeys=new Set(live.archiveKeys),backupKeys=new Set(old.archiveKeys),eligible=missing.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.visibility==='public-event'&&e.accountTag===accountTag&&typeof e.key==='string'&&e.id==='e-'+createHash('sha256').update(e.key).digest('hex').slice(0,18)&&typeof e.text==='string'&&e.text.length>0&&Number.isSafeInteger(e.at)&&e.at<=start&&Number(e.reinforcedAt||e.at)<=start&& !e.focusRevision&&currentKeys.has(e.id)&&backupKeys.has(e.id)&&!revoked.has(e.id)&&desiredStage(e,now,Math.max(15,Math.min(120,Number(halfLifeDays)||30)))==='clear')
 if(!eligible.length)return empty('缺失经历不满足当前清晰、公开、同账号、原身份及未撤销条件')
 const history=checkPublicArchivePrefix(current,incoming)
 if(!history.ok)return empty('当前公开档案并非备份的连续延伸；可能存在不同生活分支或档案缺失，拒绝合并')
 const wanted=new Set(eligible.map(e=>e.id))
 const archived=bundle=>{const found=new Map();for(const [path,content] of Object.entries(bundle.files)){if(!path.startsWith('life-memory/archive/'))continue;for(const line of content.split('\n').filter(Boolean)){const row=JSON.parse(line);if(!wanted.has(row.id))continue;found.set(row.id,found.has(row.id)?null:row)}}return found}
 const a=archived(current),b=archived(incoming)
 const rows=eligible.filter(e=>{const x=a.get(e.id),y=b.get(e.id);return x&&y&&sameBackupValue(x,y)&&timestamp(x.recordedAt)<=start&&verifyOriginalPublicWatch(x,e)})
 if(!rows.length)return empty('当前永久档案与备份没有一致且唯一、正文及原始状态可核验的公开经历回执（旧视觉摘要或已强化的历史状态可能无法验证）')
 if(active.length+rows.length>3200)return empty('恢复会超过原3200条活体经历上限，不能为旧记录淘汰当前记忆')
 return {rows,reason:rows.length===missing.length?'原经历、归档和保留统计均通过；仅补缺，不覆盖当前经历':'仅部分缺失经历具备完整证据；其他历史差异继续保留'}
}
export function previewPortableMemoryRepair(current,incoming,scopeRevision='',options={}){
 const plan=planPortableMemoryRepair(current,incoming),missing=planMissingPublicEpisodes(current,incoming,options)
 return {continuity:memoryRestoreContinuity(current,incoming),current:backupMemoryOverview(current.files),backup:backupMemoryOverview(incoming.files),repairable:plan.repairs.length,missingEpisodes:missing.rows.length,missingReason:missing.reason,retainedRecords:plan.retainedRecords,differences:backupMemoryDifferences(current.files,incoming.files),revision:digest([scopeRevision,incoming.createdAt,incoming.hashes,plan.repairs,plan.requiredRevocations,missing.rows,missing.rows.length?current.hashes:null]).slice(0,32)}
}
export function repairMissingPublicEpisodes(root,incoming,options,expectedRevision,scopeRevision){
 assertColdRestoreClear(root)
 const path=storageDataPath(root,'life-memory','episodic.json')
 return withDurableFileLock(path+'.lock',()=>{
  assertColdRestoreClear(root)
  const current=createLifeMemoryBackup(root),preview=previewPortableMemoryRepair(current,incoming,scopeRevision,options)
  if(preview.revision!==expectedRevision||!preview.missingEpisodes)throw Error('缺失经历修复资格已变化，请重新预览')
  const plan=planMissingPublicEpisodes(current,incoming,options),raw=readFileSync(path,'utf8')
  if(raw!==current.files['life-memory/episodic.json']||lstatSync(path).isSymbolicLink())throw Error('当前经历已变化，请重新预览')
  const data=JSON.parse(raw),rows=expandVideoObservationGroups(data.episodes)
  // Preserve all live records, revocations, associations, original clocks
  // and receipts. No recordEvents(), no new archive or growth event.
  const result={...data,episodes:packVideoObservationGroups([...rows,...plan.rows])}
  const content=JSON.stringify(result,null,2)+'\n'
  if(Buffer.byteLength(content)>8*1024*1024)throw Error('恢复会超过原活体记忆文件上限')
  const tmp=path+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,content,{mode:0o600,flag:'wx'});if(readFileSync(tmp,'utf8')!==content)throw Error('缺失经历暂存核验失败');renameSync(tmp,path)}finally{rmSync(tmp,{force:true})}
  return plan.rows.length
 })
}
export function repairPortableMemoryDetails(root,plan){
  assertColdRestoreClear(root)
  if(!plan.repairs.length)return 0
  const parent=storageDataPath(root,'life-memory','episodic.json')
  if(!backupDirectoryNode(root,'life-memory')||!existingNode(parent)?.isFile()||existingNode(parent).nlink!==1)throw Error('当前活体记忆路径不安全或不存在')
  // The parent may fade or be evicted while a separate worker is writing a
  // detail. Serialize with the original Gateway lock, not a new repair lock.
  return withDurableFileLock(parent+'.lock',()=>{
  assertColdRestoreClear(root)
  const store=createLifeMemoryDetailStore({dataDir:root})
  let restoredFiles=0
  for(const row of plan.repairs){
    const main=JSON.parse(readFileSync(parent,'utf8'))
    const ep=expandVideoObservationGroups(main.episodes||[]).find(e=>e.id===row.episode.id)
    // Recheck live source immediately before each lock-protected write.
    if(!ep||!sameBackupValue(ep,row.episode)||!existsSync(storageDataPath(root,'detail-protection','revocations-v1.json'))||store.isRevoked(ep.id))continue
    const ledger=JSON.parse(readFileSync(storageDataPath(root,'detail-protection','revocations-v1.json'),'utf8'))
    if(ledger.version!==1||!Array.isArray(ledger.ids)||!(plan.requiredRevocations||[]).every(id=>ledger.ids.includes(id)))continue
    if(store.read(ep).reason!=='no-detail')continue
    const result=store.write({episode:ep,fragments:row.fragments,verified:true,append:true})
    if(result.ok&&!result.duplicate)restoredFiles++
  }
  return restoredFiles
  })
}

// Online HTTP restore may only write explicitly editable user files. Do not
// let a future planner accidentally feed historical receipts to the legacy
// maintenance helper. The latter remains for old isolated round-trip tooling.
export function restorePortableSettingsFiles(root,backup,{expected}={}){
 assertColdRestoreClear(root)
 const check=source=>{validateBackup(source);if(Object.keys(source.files).some(name=>!EDITABLE_BACKUP_FILES.has(name))||Object.keys(source.sqlite).length)throw Error('在线恢复只允许明确可编辑的规则文件；业务账本不能覆盖')}
 check(backup)
 if(expected){
  check(expected)
  for(const name of new Set([...Object.keys(backup.files),...Object.keys(expected.files)])){
   const path=storageDataPath(root,name),st=existingNode(path)
   if(st&&(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)|| (st?readFileSync(path,'utf8'):undefined)!==expected.files[name])throw Error('规则文件已变化，请重新预览或保留当前文件人工核对')
  }
 }
 return restoreBackupFiles(root,backup,{reconcileDetails:false})
}

export function restoreBackupFiles(root, backup, {includePrivate=false,reconcileDetails=true}={}) {
 assertColdRestoreClear(root)
  validateRestoreIdentity(root,backup)
  backup=normalizeHistoricalBackup(backup)
  const liveMemory=storageDataPath(root,'life-memory','episodic.json')
  if(existsSync(liveMemory)&&Object.keys(backup.files).some(n=>n==='life-memory/episodic.json'||n.startsWith('life-memory/details/')||n==='detail-protection/revocations-v1.json')){const existing=JSON.parse(readFileSync(liveMemory,'utf8'));if(Object.hasOwn(existing,'pendingVisualDetails')&&(!Array.isArray(existing.pendingVisualDetails)||existing.pendingVisualDetails.length))throw Error('深层记忆仍有待写记录，请恢复后再还原备份')}
  const writes=[], committed=[]
  try {
    // Two-pass restore: validate every path and stage every file before changing
    // any business file. Never traverse an existing symlink directory.
    for (const [name, content] of Object.entries(backup.files)) {
      if(!includePrivate&&name.startsWith('life-memory/details/v1/')&&JSON.parse(content).visibility==='private-session')throw Error('私密深层附件须通过主人独立记忆恢复')
      const parts=name.split('/'),path=storageDataPath(root,...parts),base=dirname(path)
      let parent=root
      if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('备份根目录不可为符号链接')
      for(let i=0;i<parts.length-1;i++){
        parent=storageDataPath(root,...parts.slice(0,i+1))
        if(existsSync(parent)&&(!lstatSync(parent).isDirectory()||lstatSync(parent).isSymbolicLink()))throw Error('拒绝符号链接/非法目标目录：'+name)
      }
      mkdirSync(base,{recursive:true})
      if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw Error('拒绝符号链接/非法目标文件：'+name)
      const previous=existsSync(path)?readFileSync(path,'utf8'):null
      const newContent=name==='detail-protection/revocations-v1.json'?mergeDetailRevocations(path,content):
        name==='life-memory/episodic.json'?mergeFadedEpisodes(path,content,{includePrivate}):
        name==='life-memory/event-outbox.json'?mergePrivateLifeOutbox(path,content):
        name==='personality-evolution/v1.json'&&!includePrivate?preservePrivatePersonality(path,content):content
      const tmp=path+'.restore-'+randomUUID()+'.tmp'
      writeFileSync(tmp,newContent,{encoding:'utf8',mode:0o600,flag:'wx'})
      writes.push({path,tmp,previous})
    }
    for(const row of writes){renameSync(row.tmp,row.path);committed.push(row)}
    // A restored older clear snapshot must not expose detail left behind by
    // newer forgotten/evicted episodes. Tombstones are merged, never reset.
    const live=storageDataPath(root,'life-memory','episodic.json')
    if(reconcileDetails&&existsSync(live))createLifeMemoryDetailStore({dataDir:root}).reconcile(expandVideoObservationGroups(JSON.parse(readFileSync(live,'utf8')).episodes||[]))
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

function mergeDetailRevocations(path,content){
 if(!existsSync(path))return content
 const old=JSON.parse(readFileSync(path,'utf8')),incoming=JSON.parse(content)
 if(old?.version!==1||incoming?.version!==1||!Array.isArray(old.ids)||!Array.isArray(incoming.ids))throw Error('深层遗忘记录格式不兼容')
 const ids=[...new Set([...old.ids,...incoming.ids])]
 if(ids.length>200000)throw Error('深层遗忘保护记录超出上限，拒绝覆盖历史数据')
 return JSON.stringify({version:1,ids})+'\n'
}
function mergeFadedEpisodes(path,content,{includePrivate=false}={}){
  if(!existsSync(path))return content
  const old=JSON.parse(readFileSync(path,'utf8')),incoming=JSON.parse(content)
  const oldEpisodes=expandVideoObservationGroups(old.episodes||[])
  const current=new Map(oldEpisodes.map(e=>[e.id,e]))
  incoming.episodes=expandVideoObservationGroups(incoming.episodes).map(e=>{
    const prior=current.get(e.id)
    return prior&&STAGES.indexOf(prior.stage)>STAGES.indexOf(e.stage)?prior:e
  })
  // Portable backups exclude private episodes: preserve the *local* private
  // fading copies during an ordinary restore instead of accidentally erasing.
  for(const e of oldEpisodes)if((e.kind==='private-social'||!includePrivate&&e.visibility==='private-session')&&!incoming.episodes.some(x=>x.id===e.id))incoming.episodes.push(e)
  incoming.episodes=packVideoObservationGroups(incoming.episodes)
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
  return buildLifeMemoryBackup(collectBackupFiles(root,{includePrivate:true}))
}
export async function createLifeMemoryBackupWithProgress(root,progress){
  const all=collectBackupFiles(root,{includePrivate:true})
  await progress('manifest')
  return buildLifeMemoryBackup(all)
}
function buildLifeMemoryBackup(all){
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
  // Deep attachments are separate files; use the same bounded count as the
  // shared portable-backup validator, retaining its path, byte and hash checks.
  if(keys.length>MAX_ITEMS||keys.length!==Object.keys(bundle.hashes).length)throw Error('记忆备份文件数量不合法')
  let bytes=0
  for(const name of keys){const content=bundle.files[name];if(!memoryItem(name)||!allowedPath(name)||typeof content!=='string'||digest(content)!==bundle.hashes[name])throw Error('记忆备份文件篡改或路径非法：'+name);bytes+=Buffer.byteLength(content);if(bytes>MAX_TOTAL||Buffer.byteLength(content)>MAX_FILE)throw Error('记忆备份文件过大')}
  if(!keys.includes('life-memory/episodic.json')||!keys.some(x=>x.startsWith('long-term-memory/')))throw Error('双层记忆备份缺少核心数据')
  // Reuse the full backup structural validation for all record types.
  const config={},sqlite={};validateBackup({format:FORMAT,schema:SCHEMA,files:bundle.files,config,sqlite,manifest:{algorithm:'sha256',files:bundle.hashes,config:digest(config),sqlite:digest(sqlite)}})
  return {count:keys.length,bytes,characterBound:Boolean(backupCharacter(bundle)),memory:backupMemoryOverview(bundle.files),archiveMonths:keys.filter(x=>x.startsWith('life-memory/archive/')).length,episodic:true,createdAt:bundle.createdAt,integrity:'sha256-verified'}
}
export function restoreLifeMemoryBackup(root,bundle){
 assertColdRestoreClear(root)
  inspectLifeMemoryBackup(bundle)
  const config={},sqlite={}
  return restoreBackupFiles(root,{format:FORMAT,schema:SCHEMA,files:bundle.files,config,sqlite,manifest:{algorithm:'sha256',files:bundle.hashes,config:digest(config),sqlite:digest(sqlite)}},{includePrivate:true})
}
