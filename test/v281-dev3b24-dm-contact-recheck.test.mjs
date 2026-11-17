import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessDmContactRecheck} from '../lib/dm-contact-recheck.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {readFileSync} from 'node:fs';
const T=1900000000000;
const UID='202573574',SELF='7777777',ID=UID+':evt-1';
const remote=()=>[{key:'evt-1',ts:(T-10000)/1000,fromMe:false,kind:1,text:'嗨，你最近怎么样？'}];
const person=()=>({seen:[ID],history:[{role:'user',text:'嗨，你最近怎么样？',at:T-10000}],olderContext:[],lastRepliedAt:T-86400000,
  approval:{status:'approved',reply:{status:'sent'}},stranger:{status:'sent',count:4}});
const config=()=>({enabled:true,whitelist:[],p6Enabled:true,p6MaxBubbles:1,whitelistCooldownSeconds:0,maxPerHour:40,maxPerPoll:3});
const classify=(override={})=>assessDmContactRecheck({uid:UID,accountUid:SELF,person:person(),rawMessages:remote(),now:T,...override});
const dirRun=async cb=>{const dir=await mkdtemp(join(tmpdir(),'dm-recheck-'));try{return await cb(dir)}finally{await rm(dir,{force:true,recursive:true})}};
const writeDb=async(dir,p=person())=>writeFile(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,people:{[UID]:p},sentAt:[]}), 'utf8');
const engine=(dir,extras={})=>createDmAutoReply({dataDir:dir,selfUid:SELF,now:()=>T,getConfig:config,
  fetchIncoming:async()=>[],fetchContactSnapshot:async()=>remote(),
  generateReply:async()=>({action:'reply',messages:['你好呀，刚看到消息。']}),
  send:async()=>({ok:true,receiptId:'receipt-1'}),logger:{warn(){},error(){}},...extras});

test('平台未读不等于未处理；只重查最近72小时同账号同人未确认回复的消息',()=>{
 assert.equal(classify().state,'eligible');
 assert.equal(classify().alreadySeen,true);
 assert.equal(classify({rawMessages:[...remote(),{key:'self',ts:T/1000,fromMe:true,kind:1,text:'已经回复'}]}).state,'platform-replied');
 assert.equal(classify({person:{...person(),lastRepliedAt:T}}).state,'local-replied');
 assert.equal(classify({person:{...person(),lastInboundOutcome:{inboundAt:T-10000,status:'send-unknown'}}}).state,'outcome-unknown');
 assert.equal(classify({person:{...person(),manualRecheck:{accountUid:SELF,sourceMessageId:ID,status:'model-skip'}}}).state,'already-reviewed');
 assert.equal(classify({person:{...person(),dmContactBoundaries:{[SELF]:{status:'stop'}}}}).state,'opted-out');
 assert.equal(classify({rawMessages:[{...remote()[0],ts:(T-73*3600000)/1000}]}).state,'out-of-window');
 assert.equal(classify({permissionAllowed:false}).state,'permission-denied');
 assert.equal(classify({rawMessages:[...remote(),{key:'evt-2',ts:T/1000,fromMe:false,kind:9,text:'[非文字消息]'}]}).state,'unsupported-latest');
 assert.equal(classify({accountUid:UID}).state,'invalid');
 assert.equal(classify({rawMessages:[{...remote()[0],kind:2,text:'[收到图片]'}]}).state,'unsupported-latest');
});

test('只读检查不改变 seen/history，不调用模型或外发，也不推进普通游标',()=>dirRun(async dir=>{
 await writeDb(dir);let generated=0,sent=0,scanned=0;
 const inst=engine(dir,{generateReply:async()=>{generated++;return {action:'skip'}},send:async()=>{sent++},onScanSettled:()=>scanned++});
 const before=await readFile(join(dir,'dm-autoreply-state.json'),'utf8');
 const v=await inst.inspectContact(UID);
 assert.equal(v.state,'eligible');assert.match(v.token,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(v).includes('你最近怎么样'));
 assert.equal(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'),before);
 assert.equal(generated,0);assert.equal(sent,0);assert.equal(scanned,0);
}));

test('已 seen 且未回复可由主人确认后交给模型一次；平台确认后不重发',()=>dirRun(async dir=>{
 await writeDb(dir);let sent=0,generated=0,scanned=0;
 const inst=engine(dir,{generateReply:async()=>{generated++;return {action:'reply',messages:['你好呀，刚看到消息。']}},
   send:async()=>{sent++;return {ok:true,receiptId:'receipt-'+sent}},onScanSettled:()=>scanned++});
 const preview=await inst.inspectContact(UID);
 const bad=await inst.poll({manualUid:UID,manualToken:'0'.repeat(64)});
 assert.equal(bad.state,'preview-stale');assert.equal(sent,0);
 const outcome=await inst.poll({manualUid:UID,manualToken:preview.token});
 assert.equal(outcome.sent,1);assert.equal(outcome.manualStatus,'delivered');assert.equal(generated,1);
 assert.equal(scanned,0,'不能提交普通后台私信的会话游标');
 const after=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
 assert.equal(after.people[UID].history.filter(x=>x.role==='user').length,1,'旧入站正文不可重复写历史');
 assert.equal(after.people[UID].manualRecheck.status,'delivered');
 assert.equal((await inst.inspectContact(UID)).state,'local-replied');
 assert.equal((await inst.poll({manualUid:UID,manualToken:preview.token})).state,'local-replied');
 assert.equal(sent,1);
}));

test('模型思考时若有人已通过平台回复，则发信前二次核验阻止重复',()=>dirRun(async dir=>{
 await writeDb(dir);let remoteNow=remote(),sent=0;
 const inst=engine(dir,{fetchContactSnapshot:async()=>remoteNow,
   generateReply:async()=>{remoteNow=[...remote(),{key:'response',ts:T/1000,fromMe:true,kind:1,text:'刚才已经回过'}];
     return {action:'reply',messages:['你好呀']}},
   send:async()=>{sent++;return {ok:true,receiptId:'should-not-send'}}});
 const preview=await inst.inspectContact(UID);
 const result=await inst.poll({manualUid:UID,manualToken:preview.token});
 assert.equal(result.sent,0);assert.equal(sent,0);
 assert.equal(result.manualStatus,'send-blocked');
}));

test('模型思考期间发生账号切换时不发送',()=>dirRun(async dir=>{
 await writeDb(dir);let account=SELF,sent=0;
 const inst=engine(dir,{selfUid:()=>account,generateReply:async()=>{account='99999';
   return {action:'reply',messages:['刚看到啦']};},send:async()=>{sent++;return {ok:true,receiptId:'invalid'}}});
 const preview=await inst.inspectContact(UID);
 const res=await inst.poll({manualUid:UID,manualToken:preview.token});
 assert.equal(res.sent,0);assert.equal(sent,0);assert.equal(res.manualStatus,'send-blocked');
}));

test('模型主动沉默保持原决定且相同消息不允许重复请求',()=>dirRun(async dir=>{
 await writeDb(dir);let called=0;
 const inst=engine(dir,{generateReply:async()=>{called++;return {action:'skip'}},send:async()=>{throw Error('must not send')}});
 const p=await inst.inspectContact(UID);
 const outcome=await inst.poll({manualUid:UID,manualToken:p.token});
 assert.equal(outcome.sent,0);assert.equal(outcome.manualStatus,'model-skip');
 assert.equal((await inst.inspectContact(UID)).state,'already-reviewed');assert.equal(called,1);
}));

test('账号切换或平台限流读取错误绝不能产生手动发信',()=>dirRun(async dir=>{
 await writeDb(dir);let account=SELF,sent=0;
 const changed=engine(dir,{selfUid:()=>account,fetchContactSnapshot:async()=>{account='8888888';return remote()},send:async()=>{sent++}});
 assert.equal((await changed.inspectContact(UID)).state,'account-changed');
 account=SELF;
 const throttled=engine(dir,{fetchContactSnapshot:async()=>{throw Error('HTTP 200 code=-509')},send:async()=>{sent++}});
 await assert.rejects(throttled.inspectContact(UID),/-509/);
 assert.equal(sent,0);
}));

test('陌生人禁止补发；已核验主人可以按统一 Life 双确认复核',()=>dirRun(async dir=>{
 const p=person();delete p.approval;await writeDb(dir,p);
 const inst=engine(dir,{getConfig:()=>({...config(),strangerEnabled:true})});
 assert.equal((await inst.inspectContact(UID)).state,'permission-denied');
 const owner=engine(dir,{getConfig:()=>({...config(),ownerUid:UID,whitelist:[UID]})});
 const preview=await owner.inspectContact(UID);
 assert.equal(preview.state,'eligible');assert.match(preview.token,/^[a-f0-9]{64}$/);
 const after=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
 assert.equal(after.people[UID].manualRecheck,undefined,'预览不能提前生成发送占位');
}));

test('统一 Life 的主人手动复核仍须两次核验，不自动发送，成功后原回执阻止重复',()=>dirRun(async dir=>{
 const p=person();delete p.approval;await writeDb(dir,p);
 let sends=0,decisions=0;
 const owner=engine(dir,{getConfig:()=>({...config(),ownerUid:UID,whitelist:[UID]}),
   generateReply:async()=>{decisions++;return {action:'reply',messages:['看到啦']};},
   send:async()=>{sends++;return {ok:true,receiptId:'owner-reviewed-'+sends}}});
 const preview=await owner.inspectContact(UID);
 assert.equal(preview.state,'eligible');assert.equal(sends,0);assert.equal(decisions,0);
 const result=await owner.poll({manualUid:UID,manualToken:preview.token});
 assert.equal(result.manualStatus,'delivered');assert.equal(sends,1);assert.equal(decisions,1);
 assert.equal((await owner.inspectContact(UID)).state,'local-replied');
 assert.equal((await owner.poll({manualUid:UID,manualToken:preview.token})).state,'local-replied');
 assert.equal(sends,1,'不能因第二次点击而重复发送');
}));

test('用户界面需有逐联系人按钮、二次确认、服务端单人限流/同源保护',()=>{
 const root=new URL('../',import.meta.url);
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.match(ui,/检查遗漏私信/);assert.match(ui,/dm-contact-check/);assert.match(ui,/dm-contact-reconsider/);
 assert.match(ui,/confirmAction\(/);assert.match(server,/fetchDmContactSnapshot\(uid\)/);
 assert.match(server,/dmFetch\(cred,target,50,\{readBudget:biliReadBudget\}\)/);
 assert.match(server,/accountBinding\.enterPlatformOperation\(\)/);
});

test('manual recheck accepts verified Bilibili dynamic share-card kinds',()=>{
 const dynamic={...remote()[0],kind:7,text:'[分享动态] 今天做的饭 https://t.bilibili.com/1234567890123456'}
 assert.equal(classify({rawMessages:[dynamic]}).state,'eligible')
 const webpage={...remote()[0],kind:13,text:'[网页卡片] 好友动态 https://t.bilibili.com/1234567890123456'}
 assert.equal(classify({rawMessages:[webpage]}).state,'eligible')
})
