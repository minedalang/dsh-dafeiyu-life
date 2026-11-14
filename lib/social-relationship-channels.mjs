/**
 * dev.74 · Account-scoped evidence for WHERE a relationship actually happens.
 * Completely separate from the legacy (global) familiarity projection and
 * from SocialPolicyGate. Persist only verified event hashes, channel,
 * direction and time. Never persist a message body or infer a DM invitation
 * from a public comment, a whitelist flag or a relationship score.
 */
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {existsSync,lstatSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
const require=createRequire(import.meta.url)
const UID=/^[1-9]\d{0,18}$/
const DAY=86_400_000,WINDOW=180*DAY
const hash=text=>createHash('sha256').update(text).digest('hex')
const limitTo=(value,min,max)=>Math.min(max,Math.max(min,Math.floor(Number(value)||min)))

export function evaluateDmOpenness(evidence,{now=Date.now(),restricted=false}={}){
  if(restricted)return {state:'restricted',eligible:false,reason:'recipient-boundary'}
  if(!evidence||!Number(evidence.dm?.incoming)&&!Number(evidence.dm?.outgoing))
    return {state:'not_established',eligible:false,reason:'no-private-channel'}
  const dm=evidence.dm
  // Historical public interactions and a single private greeting are not an
  // invitation to start unsolicited private conversations. At least two real
  // conversations across two dates and BOTH directions are necessary.
  const stable=dm.incoming>=2&&dm.outgoing>=2&&dm.activeDays>=2&&
    dm.lastAt>0&&now-dm.lastAt>=0&&now-dm.lastAt<=60*DAY&&
    dm.firstAt>0&&dm.lastAt-dm.firstAt>=DAY
  return stable?{state:'established',eligible:true,reason:'verified-bidirectional-private-history'}:
    {state:'not_established',eligible:false,reason:'private-habit-not-established'}
}

export function createSocialRelationshipChannels({dataDir,now=Date.now}={}){
  if(!dataDir)throw TypeError('account-scoped relationship data directory required')
  const dir=join(dataDir,'relationship-channels')
  mkdirSync(dir,{recursive:true,mode:0o700})
  if(!lstatSync(dir).isDirectory()||lstatSync(dir).isSymbolicLink())throw Error('unsafe-relationship-channels-dir')
  const file=join(dir,'evidence.sqlite3')
  if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))throw Error('unsafe-relationship-channels-db')
  const {DatabaseSync}=require('node:sqlite')
  const db=new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
  CREATE TABLE IF NOT EXISTS verified_events(
    key TEXT PRIMARY KEY,uid TEXT NOT NULL,channel TEXT NOT NULL,
    direction TEXT NOT NULL,at INTEGER NOT NULL,day TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS channel_uid_time ON verified_events(uid,at);
  CREATE INDEX IF NOT EXISTS channel_time ON verified_events(at);`)
  const insert=db.prepare('INSERT OR IGNORE INTO verified_events(key,uid,channel,direction,at,day) VALUES(?,?,?,?,?,?)')
  const select=db.prepare('SELECT channel,direction,at,day FROM verified_events WHERE uid=? AND at>=? AND at<=? ORDER BY at ASC')
  const ids=db.prepare('SELECT uid,MAX(at) AS last_at FROM verified_events WHERE at>=? AND at<=? GROUP BY uid ORDER BY last_at DESC LIMIT ?')
  let closed=false,lastPrune=0
  function observe({uid,source='comment',direction='incoming',eventId='',at=now()}={}){
    const id=String(uid||''),key=String(eventId||''),when=Number(at),current=now()
    if(closed||!UID.test(id)||!['comment','dm'].includes(source)||!['incoming','outgoing'].includes(direction)||
      !key||key.length>280||!Number.isSafeInteger(when)||when<946684800000||when>current+DAY)
      return {ok:false,reason:'invalid-channel-observation'}
    // Before dev.74, non-scoped history cannot provide reliable DM qualification.
    if(when<current-WINDOW)return {ok:true,added:0,expired:true}
    const dedup=hash([id,source,direction,key].join('\0'))
    const day=new Date(when).toISOString().slice(0,10)
    const result=insert.run(dedup,id,source,direction,when,day)
    if(current-lastPrune>DAY){db.prepare('DELETE FROM verified_events WHERE at<?').run(current-WINDOW);lastPrune=current}
    return {ok:true,added:Number(result.changes)||0,duplicate:!result.changes}
  }
  function get(uid,{at=now()}={}){
    const id=String(uid||'');if(!UID.test(id))return null
    const events=select.all(id,at-WINDOW,at)
    if(!events.length)return null
    const summarize=channel=>{
      const rows=events.filter(e=>e.channel===channel)
      return {incoming:rows.filter(e=>e.direction==='incoming').length,
        outgoing:rows.filter(e=>e.direction==='outgoing').length,
        activeDays:new Set(rows.map(e=>e.day)).size,
        firstAt:Number(rows[0]?.at)||0,lastAt:Number(rows.at(-1)?.at)||0}
    }
    const value={uid:id,comment:summarize('comment'),dm:summarize('dm'),total:{
      count:events.length,activeDays:new Set(events.map(e=>e.day)).size,
      incoming:events.filter(e=>e.direction==='incoming').length,
      outgoing:events.filter(e=>e.direction==='outgoing').length,
      firstAt:Number(events[0]?.at)||0,lastAt:Number(events.at(-1)?.at)||0}}
    return {...value,dmOpenness:evaluateDmOpenness(value,{now:at}),
      channelFamiliarity:{public: value.comment.activeDays>=2&&value.comment.incoming&&value.comment.outgoing?'ongoing':value.comment.activeDays?'encountered':'none',
        private:value.dm.activeDays>=2&&value.dm.incoming&&value.dm.outgoing?'ongoing':value.dm.activeDays?'encountered':'none'}}
  }
  function list({limit=100,at=now(),requireDm=false}={}){
    const rows=ids.all(at-WINDOW,at,limitTo(limit,1,200))
    return rows.map(row=>get(row.uid,{at})).filter(row=>row&&(!requireDm||row.dm.incoming>0||row.dm.outgoing>0))
  }
  function clear(uid){const id=String(uid||'');if(!UID.test(id))throw Error('invalid-uid');return {removed:Number(db.prepare('DELETE FROM verified_events WHERE uid=?').run(id).changes)||0}}
  function close(){if(!closed){closed=true;db.close()}}
  return {file,observe,get,list,clear,close}
}
