/**
 * dev.9: relationship familiarity is NOT an authorization role.
 * Verified incoming/outgoing metadata only; never store a stranger persona,
 * message body, DM text, or model-generated feelings.
 * Future 2.6.1 schedulers may read `get()` as a bounded preference hint,
 * but must separately consult SocialPolicyGate for any communication.
 */
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
const DAY=86400000, UID=/^[1-9]\d{0,18}$/, require=createRequire(import.meta.url)
const idOk=x=>UID.test(String(x||''))
const hash=s=>createHash('sha256').update(String(s)).digest('hex')
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n))
function scoreOf(p,{now=Date.now(),whitelisted=false,owner=false}={}){
 if(owner)return 100
 const days=Number(p?.active_days)||0,events=Number(p?.events)||0
 const both=(Number(p?.incoming)||0)>0&&(Number(p?.outgoing)||0)>0
 const baseline=Math.min(96,8+7*Math.min(12,days)+Math.min(32,events)*.8+(both?9:0))
 const quiet=Number(p?.last_at)>0?Math.floor(Math.max(0,now-Number(p.last_at))/DAY):0
 const decayed=Math.max(0,Math.round(baseline-Math.max(0,quiet-2)*1.5))
 return clamp(whitelisted?Math.max(64,decayed):decayed,0,96)
}
function stageOf(p,{owner=false,now=Date.now()}={}){
 if(owner)return 'owner'
 const days=Number(p?.active_days)||0,events=Number(p?.events)||0
 const twoWay=(Number(p?.incoming)||0)>0&&(Number(p?.outgoing)||0)>0
 const span=(Number(p?.last_at)||0)-(Number(p?.first_at)||0)
 const quiet=(now-(Number(p?.last_at)||0))/DAY
 if(quiet>120)return 'new'
 if(quiet>60)return days>=3?'known':'new'
 if(twoWay&&days>=6&&events>=12&&span>=14*DAY)return quiet>30?'familiar':'friend' // social friend, NOT whitelist privilege
 if(twoWay&&days>=3&&events>=5)return 'familiar'
 if(days>=2&&events>=3)return 'known'
 return 'new'
}
const stageLabel={owner:'主人',friend:'自然发展的好友',familiar:'逐渐熟悉',known:'见过几次',new:'刚认识'}
export function createSocialRelationshipIndex({dataDir,now=Date.now,logger=console}={}){
 if(!dataDir)throw TypeError('missing relationship dataDir')
 const dir=join(dataDir,'social-relationships');mkdirSync(dir,{recursive:true,mode:0o700})
 if(lstatSync(dir).isSymbolicLink())throw Error('拒绝使用符号链接关系目录')
 const file=join(dir,'relationships.sqlite3')
 if(existsSync(file)){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('关系索引文件不安全')}
 let DatabaseSync
 try{({DatabaseSync}=require('node:sqlite'))}catch{throw Error('关系索引需要 Node.js 22.16+ 的 node:sqlite；不会降低社交权限作为兼容手段')}
 const db=new DatabaseSync(file)
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
 CREATE TABLE IF NOT EXISTS people(uid TEXT PRIMARY KEY,first_at INTEGER NOT NULL,last_at INTEGER NOT NULL,active_days INTEGER NOT NULL DEFAULT 0,events INTEGER NOT NULL DEFAULT 0,incoming INTEGER NOT NULL DEFAULT 0,outgoing INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS daily(uid TEXT NOT NULL,day TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,dm INTEGER NOT NULL DEFAULT 0,comment INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(uid,day));
 CREATE TABLE IF NOT EXISTS seen(key TEXT PRIMARY KEY,uid TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS people_last ON people(last_at DESC,uid);
 CREATE INDEX IF NOT EXISTS seen_at ON seen(at);
 CREATE INDEX IF NOT EXISTS daily_day ON daily(day);`)
 // Forward-compatible local cache: public display names are optional, short-lived,
 // and never used as identity evidence or authorization. Existing dev.9 DBs migrate in place.
 const columns=new Set(db.prepare('PRAGMA table_info(people)').all().map(row=>row.name))
 if(!columns.has('nickname'))db.exec("ALTER TABLE people ADD COLUMN nickname TEXT NOT NULL DEFAULT ''")
 if(!columns.has('nickname_at'))db.exec('ALTER TABLE people ADD COLUMN nickname_at INTEGER NOT NULL DEFAULT 0')
 const insert=db.prepare('INSERT OR IGNORE INTO people(uid,first_at,last_at) VALUES(?,?,?)')
 const hasEvent=db.prepare('SELECT 1 AS yes FROM seen WHERE key=?')
 const newEvent=db.prepare('INSERT OR IGNORE INTO seen(key,uid,at) VALUES(?,?,?)')
 const dayGet=db.prepare('SELECT * FROM daily WHERE uid=? AND day=?')
 const dayPut=db.prepare('INSERT INTO daily(uid,day,n,dm,comment) VALUES(?,?,?,?,?) ON CONFLICT(uid,day) DO UPDATE SET n=excluded.n,dm=excluded.dm,comment=excluded.comment')
 const update=db.prepare('UPDATE people SET first_at=CASE WHEN first_at=0 THEN ? ELSE MIN(first_at,?) END,last_at=MAX(last_at,?),active_days=active_days+?,events=events+?,incoming=incoming+?,outgoing=outgoing+? WHERE uid=?')
 const byUid=db.prepare('SELECT * FROM people WHERE uid=?')
 const putNickname=db.prepare('UPDATE people SET nickname=?,nickname_at=? WHERE uid=?')
 let lastClean=0,closed=false
 function prune(t=now()){
  if(t-lastClean<DAY||closed)return
  // Retain short-lived evidence hashes for retry dedup, not message text.
  db.prepare('DELETE FROM seen WHERE at<?').run(t-90*DAY)
  db.prepare('DELETE FROM daily WHERE day<?').run(new Date(t-180*DAY).toISOString().slice(0,10))
  // Old unprivileged strangers are removed from the index rather than tracked forever.
  // Privileged users with no interaction can be reconstructed from configured roster.
  db.prepare('DELETE FROM people WHERE last_at<?').run(t-180*DAY)
  // Public nickname cache expires independently of the relationship itself.
  db.prepare("UPDATE people SET nickname='',nickname_at=0 WHERE nickname_at>0 AND nickname_at<?").run(t-7*DAY)
  lastClean=t
 }
 function observe({uid,source='comment',direction='incoming',eventId='',at=now()}={}){
  const id=String(uid||''),timestamp=Number(at),raw=String(eventId||'')
  if(!idOk(id)||!['dm','comment'].includes(source)||!['incoming','outgoing'].includes(direction)||!raw||raw.length>280||!Number.isSafeInteger(timestamp)||timestamp<946684800000||timestamp>now()+DAY)return {ok:false,reason:'invalid-observation'}
  const key=hash(`${id}\0${source}\0${direction}\0${raw}`)
  if(hasEvent.get(key))return {ok:true,duplicate:true}
  const day=new Date(timestamp).toISOString().slice(0,10),daily=dayGet.get(id,day)
  // Up to 8 quality-neutral observations per person/day. Burst spam cannot farm affinity.
  const accepted=(!daily||daily.n<8)?1:0
  if(!accepted)return {ok:true,added:0,limited:true}
  db.exec('BEGIN IMMEDIATE')
  try{
   newEvent.run(key,id,timestamp)
   if(accepted){
    insert.run(id,timestamp,timestamp)
    dayPut.run(id,day,(daily?.n||0)+1,(daily?.dm||0)+(source==='dm'?1:0),(daily?.comment||0)+(source==='comment'?1:0))
    update.run(timestamp,timestamp,timestamp,daily?0:1,1,direction==='incoming'?1:0,direction==='outgoing'?1:0,id)
   }
   db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
  prune()
  return {ok:true,added:accepted,limited:accepted===0}
 }
 function whitelistSet(directory){try{return new Map(JSON.parse(normalizeFriendDirectory(directory)).map(x=>[x.uid,x.name||'']))}catch{return new Map()}}
 function get(uid,{friendDirectory='',ownerUid='',at=now()}={}){
  const id=String(uid||'');if(!idOk(id))return null
  const white=whitelistSet(friendDirectory),whitelisted=white.has(id),owner=id===String(ownerUid||'')
  const row=byUid.get(id)
  if(!row&&!whitelisted&&!owner)return null
  const score=scoreOf(row,{now:at,whitelisted,owner}),stage=stageOf(row,{owner,now:at})
  const nicknameAge=at-(Number(row?.nickname_at)||0)
  const cachedName=nicknameAge>=0&&nicknameAge<=7*DAY?String(row?.nickname||''):''
  return {uid:id,stage,stageLabel:stageLabel[stage],score,whitelisted,permissionRole:owner?'owner':whitelisted?'friend':'stranger',socialFriend:stage==='friend',count:Number(row?.events)||0,activeDays:Number(row?.active_days)||0,incoming:Number(row?.incoming)||0,outgoing:Number(row?.outgoing)||0,firstAt:Number(row?.first_at)||0,lastAt:Number(row?.last_at)||0,name:cachedName||white.get(id)||'',nickname:cachedName,nicknameAt:Number(row?.nickname_at)||0}
 }
 function list({friendDirectory='',ownerUid='',query='',cursor='',limit=30,at=now()}={}){
  const cap=clamp(Math.floor(Number(limit)||30),1,50),white=whitelistSet(friendDirectory),owner=String(ownerUid||'')
  const q=String(query||'').trim().slice(0,48),exact=idOk(q)?q:''
  const matched=q&&!exact?[...white.entries()].filter(([,name])=>name.toLocaleLowerCase().includes(q.toLocaleLowerCase())).map(([uid])=>uid):[]
  // This is only a UI visibility seed. It does not record an interaction or grant permission.
  const specials=[...new Set([...white.keys(),...(idOk(owner)?[owner]:[])])]
  for(const uid of specials)insert.run(uid,0,0)
  let anchor=null
  if(cursor)try{const row=JSON.parse(Buffer.from(cursor,'base64url').toString());if(Number.isSafeInteger(row.at)&&row.at>0&&Number.isFinite(row.score)&&Number.isFinite(row.lastAt)&&idOk(row.uid))anchor=row}catch{}
  const epoch=anchor?.at||at
  const whitePlaceholders=specials.length?specials.map(()=>'?').join(','):"''"
  const base='8+7*MIN(12,active_days)+MIN(32,events)*0.8+CASE WHEN incoming>0 AND outgoing>0 THEN 9 ELSE 0 END-MAX(0,(?-last_at)/86400000-2)*1.5'
  const rank=`CASE WHEN uid=? THEN 100 WHEN uid IN (${whitePlaceholders}) THEN MAX(64,MIN(96,${base})) ELSE MAX(0,MIN(96,${base})) END`
  const binds=[owner,...specials,epoch,epoch]
  let filter=''
  if(q){const ids=exact?[q]:matched;if(!ids.length)return {ok:true,rows:[],nextCursor:'',total:0,limit:cap}
   filter=`WHERE uid IN (${ids.map(()=>'?').join(',')})`}
  let cursorFilter=''
  if(anchor){cursorFilter='WHERE (rank_score < ? OR (rank_score = ? AND (last_at < ? OR (last_at = ? AND uid > ?))))'
}
  const rows=db.prepare(`SELECT uid,rank_score,last_at FROM (SELECT uid,last_at,${rank} AS rank_score FROM people ${filter}) ${cursorFilter} ORDER BY rank_score DESC,last_at DESC,uid ASC LIMIT ?`).all(...binds,...(q?(exact?[q]:matched):[]),...(anchor?[anchor.score,anchor.score,anchor.lastAt,anchor.lastAt,anchor.uid]:[]),cap+1)
  const total=Number(db.prepare(`SELECT COUNT(*) AS n FROM people ${filter}`).get(...(q?(exact?[q]:matched):[])).n)||0
  const more=rows.length>cap,visible=rows.slice(0,cap)
  const page=visible.map(row=>get(row.uid,{friendDirectory,ownerUid,at:epoch})).filter(Boolean)
  const last=visible.at(-1)
  const nextCursor=more&&last?Buffer.from(JSON.stringify({at:epoch,score:last.rank_score,lastAt:last.last_at,uid:last.uid})).toString('base64url'):''
  return {ok:true,rows:page,nextCursor,total,limit:cap,privacy:'UID 与最小互动元数据；可选 7 天公开昵称缓存，仅供管理页展示；不保存陌生人私信正文或画像'}
 }
 // Only store a name for an already observed UID; never create a relationship
 // from a profile lookup. This record is display metadata, not a personality.
 function cacheNickname(uid,nickname,{at=now()}={}){
  const id=String(uid||''),timestamp=Number(at)
  if(!idOk(id)||!Number.isSafeInteger(timestamp)||timestamp<=0||timestamp>now()+DAY)return {ok:false,reason:'invalid-nickname-cache'}
  if(!byUid.get(id))return {ok:false,reason:'unknown-uid'}
  const name=String(nickname||'').replace(/[\x00-\x1f\x7f<>]/g,' ').trim().slice(0,60)
  putNickname.run(name,timestamp,id)
  return {ok:true,nickname:name}
 }
 function clear(uid){const id=String(uid||'');if(!idOk(id))throw Error('UID 无效')
  db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM seen WHERE uid=?').run(id);db.prepare('DELETE FROM daily WHERE uid=?').run(id);const r=db.prepare('DELETE FROM people WHERE uid=?').run(id);db.exec('COMMIT');return {removed:Number(r.changes)||0}}catch(e){db.exec('ROLLBACK');throw e}}
 function close(){if(!closed){db.close();closed=true}}
 return {observe,get,list,cacheNickname,clear,close,file,/** 2.6.1 autonomous planning consumes hints only; not permissions. */ preferenceHint:(uid,opts)=>{const row=get(uid,opts);return row?{uid:row.uid,stage:row.stage,score:row.score}:null}}
}
export const __test={scoreOf,stageOf}
