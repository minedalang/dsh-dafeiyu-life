/** Cross-channel social send cadence. A proposal never implies authorization.
 * The account-scoped ledger stores hashes + timestamps only, not social content.
 * Synchronous reservations serialize sends between the in-process DM/comment workers.
 */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
const UID=/^[1-9]\d{0,18}$/;
const CHANNELS=new Set(['dm','comment','at']);
const DAY=86400000;
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,40);
export function createSocialInteractionRhythm({dataDir,getAccountUid,now=Date.now,crossChannelMinutes=30,dailyPerPerson=0,getPolicy=null}={}){
  const bounds=(value,low,high,fallback)=>Number.isSafeInteger(Number(value))&&Number(value)>=low&&Number(value)<=high?Number(value):fallback;
  if(!dataDir||typeof getAccountUid!=='function')throw TypeError('account directory and verified identity provider required');
  const file=join(dataDir,'social-rhythm.json');
  const owner=()=>String(getAccountUid()||'');
  function load(account){
    if(!UID.test(account))throw Error('social-rhythm-account-unverified');
    if(!existsSync(file))return {version:1,accountHash:hash(account),entries:[]};
    const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>350000)throw Error('unsafe-social-rhythm-file');
    const x=JSON.parse(readFileSync(file,'utf8'));
    if(x.version!==1||x.accountHash!==hash(account)||!Array.isArray(x.entries)||x.entries.length>4000)throw Error('social-rhythm-account-mismatch');
    return x;
  }
  function save(db){
    const dir=dirname(file);mkdirSync(dir,{recursive:true,mode:0o700});
    if(lstatSync(dir).isSymbolicLink())throw Error('unsafe-social-rhythm-dir');
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('unsafe-social-rhythm-file');
    const t=now();db.entries=db.entries.filter(x=>x.at>t-2*DAY).slice(-4000);
    const txt=JSON.stringify(db)+'\n';if(Buffer.byteLength(txt)>350000)throw Error('social-rhythm-full');
    const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,txt,{flag:'wx',mode:0o600});renameSync(tmp,file);
  }
  function reserve({uid,channel,burst=false,verifiedReply=false}={}){
    const account=owner(),id=String(uid||'');
    if(!UID.test(account)||!UID.test(id)||id===account||!CHANNELS.has(channel))return {ok:false,reason:'invalid-or-unverified-actor'};
    // Read new settings for every reservation, including after a delayed wakeup.
    // Cross-channel cadence remains protected by cooldown and unresolved send transactions.
    // The old per-person daily count is retired; historical values are ignored.
    const policy=typeof getPolicy==='function'?getPolicy()||{}:{};
    const cooldown=bounds(policy.crossChannelMinutes??crossChannelMinutes,0,1440,30);
    const db=load(account),t=now(),key=hash(account+'\0'+id);
    const recent=db.entries.filter(x=>x.uidHash===key&&x.at>t-DAY&&x.state!=='aborted');
    // A crash or indeterminate platform result must not lead to automatic retries.
    if(recent.some(x=>x.state==='reserved'||x.state==='uncertain'))return {ok:false,reason:'prior-outcome-unresolved'};
    const last=recent.filter(x=>x.state==='sent').at(-1);
    // Cross-channel cadence prevents unsolicited back-to-back contact, NOT a response
    // to a separately verified new incoming comment. Independent platform gates
    // and unresolved send transactions remain in force for all replies.
    if(last&&last.channel!==channel&&t-last.at<cooldown*60_000&&verifiedReply!==true)
      return {ok:false,reason:'cross-channel-cooldown',retryAt:last.at+cooldown*60_000};
    // A same-channel burst is only allowed when the caller explicitly holds a P6
    // authorization; ordinary sends still pass all independent per-channel gates.
    const reservationId=randomUUID();db.entries.push({id:reservationId,uidHash:key,channel,at:t,state:'reserved',burst:burst===true});save(db);
    return {ok:true,id:reservationId};
  }
  function settle(id,{outcome,receiptId=''}={}){
    if(!['sent','aborted','uncertain'].includes(outcome))return {ok:false,reason:'invalid-outcome'};
    const db=load(owner()),entry=db.entries.find(x=>x.id===id);
    if(!entry||entry.state!=='reserved')return {ok:false,reason:'not-reserved'};
    if(outcome==='sent'&&!String(receiptId||'').trim())return {ok:false,reason:'missing-platform-receipt'};
    entry.state=outcome;entry.at=now();if(outcome==='sent')entry.receiptHash=hash(owner()+'\0'+receiptId);
    save(db);return {ok:true};
  }
  function status(){const db=load(owner());return {ok:true,entries:db.entries.length,sent:db.entries.filter(x=>x.state==='sent').length};}
  return {reserve,settle,status,file};
}
