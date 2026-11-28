import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions, fetchMsgs, readOwnerConversation } from '../lib/dm.mjs';
import {executeMainSessionPrivateRead,ownerTurnMode,projectPrivateReadForRole} from '../lib/life-agent-read-runtime.mjs';
import {createLifeWillingness} from '../lib/life-willingness.mjs';
import {resolveSessionDmTarget} from '../lib/manual-dm-contact.mjs';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('私信只读请求遇到瞬时网络失败会重试一次', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      throw new TypeError('fetch failed', { cause });
    }
    return { status: 200, json: async () => ({ code: 0, data: { session_list: [] } }) };
  };
  try {
    const rows = await listSessions({ sessdata: 'test', bili_jct: 'test', buvid3: 'test', dedeuserid: 1 });
    assert.deepEqual(rows, []);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('私信网络错误包含目标主机与底层错误码，不再只显示 fetch failed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED' });
    throw new TypeError('fetch failed', { cause });
  };
  try {
    await assert.rejects(
      listSessions({ sessdata: 'test', bili_jct: 'test', buvid3: 'test', dedeuserid: 1 }),
      /host=api\.vc\.bilibili\.com.*ECONNREFUSED/
    );
  } finally { globalThis.fetch = original; }
});


test('主人指定私信读取复用真实正文解析，返回方向且不暴露凭据',async()=>{
 const original=globalThis.fetch;let calls=0
 globalThis.fetch=async(url,opts)=>{calls++;assert.match(url,/talker_id=42&session_type=1&size=10/);assert.equal(opts.method,undefined);return {status:200,json:async()=>({code:0,data:{messages:[{msg_type:1,sender_uid:42,timestamp:2,msg_key:2,content:JSON.stringify({content:'老大的真实中文私信'})},{msg_type:1,sender_uid:7,timestamp:1,msg_key:1,content:JSON.stringify({content:'鱼鱼你好'})}]}})}}
 try{const cred={sessdata:'private-test',dedeuserid:7};const args={talker_uid:'42',confirm:true};const deps={accountUid:'7',isCurrent:()=>true,chooseRead:({read})=>read(),readConversation:(uid,limit)=>fetchMsgs(cred,uid,limit)}
 const result=await readOwnerConversation(args,deps);assert.equal(result.ok,true);assert.deepEqual(result.messages.map(x=>[x.direction,x.text]),[['outgoing','鱼鱼你好'],['incoming','老大的真实中文私信']]);assert.doesNotMatch(JSON.stringify(result),/private-test/);assert.equal(calls,1)
 for(const bad of [{talker_uid:'42'},{...args,talker_uid:'7'},{...args,talker_uid:'9007199254740993'},{...args,limit:21}])assert.equal((await readOwnerConversation(bad,deps)).ok,false)
 assert.equal((await readOwnerConversation(args,{...deps,isCurrent:()=>false})).ok,false);assert.equal(calls,1)
 let current=true;const stale=await readOwnerConversation(args,{...deps,isCurrent:()=>current,readConversation:async()=>{current=false;return result.messages}});assert.equal(stale.ok,false);assert.equal(stale.messages,undefined)
 const deferred=await readOwnerConversation(args,{...deps,readConversation:async()=>{throw Object.assign(Error('private'),{name:'BiliReadDeferredError',retryAt:123})}});assert.equal(deferred.deferred,true);assert.equal(deferred.retryAt,123);assert.equal(deferred.messages,undefined)
 }finally{globalThis.fetch=original}
})

// Real Life willingness engine, fake model and transport; no live platform I/O.
test('主 Session 私信披露必须先取得原 Life 的一次性意愿，拒绝与技术失败不读取正文',async t=>{
 const home=mkdtempSync(join(tmpdir(),'main-private-choice-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 let current=true,chosen=false,reads=0,models=0,completed=0,answer='skip',prompt='',onModel=()=>{},onRead=()=>{}
 const actor=createLifeWillingness({dataDir:home,getAccountTag:()=> 'a'.repeat(16),getContext:()=>({voice:'鱼鱼可以拒绝',world:{},experience:{}}),
   invokeModel:async p=>{models++;prompt=p;onModel();if(answer==='error')throw Error('offline');return JSON.stringify({action:answer,candidateId:'private-read',reason:'自己的决定'})},
   onVerifiedAction:()=>completed++})
 const claim=()=>{if(chosen)return false;chosen=true;return true}
 const readConversation=async()=>{reads++;onRead();return [{fromMe:false,text:'第三方私密正文',ts:1}]}
 const request='请把 UID 42 的私信告诉我';const args={talker_uid:'42',limit:10,confirm:true}
 const deps={isCurrent:()=>current,accountUid:'7',readConversation,chooseRead:({uid,limit,read})=>executeMainSessionPrivateRead({willingness:actor,isCurrent:()=>current,claim,request,uid,limit,read})}
 assert.equal((await readOwnerConversation(args,{...deps,chooseRead:undefined})).reason,'life-private-read-unavailable')
 assert.equal((await readOwnerConversation({...args,confirm:false},deps)).ok,false);assert.equal(models,0)
 const refused=await readOwnerConversation(args,deps);assert.equal(refused.reason,'life-private-read-declined');assert.equal(refused.lifeAction,'skip');assert.equal(refused.messages,undefined);assert.equal(reads,0);assert.match(prompt,/隐私/);assert.ok(prompt.includes(request));assert.doesNotMatch(prompt,/第三方私密正文/)
 assert.equal((await readOwnerConversation({...args,limit:20},deps)).reason,'life-private-read-already-considered');assert.equal(models,1)
 chosen=false;answer='defer';assert.equal((await readOwnerConversation(args,deps)).reason,'life-private-read-deferred');assert.equal(reads,0)
 chosen=false;answer='error';assert.equal((await readOwnerConversation(args,deps)).reason,'life-private-read-unavailable');assert.equal(reads,0)
 chosen=false;answer='act';onModel=()=>{current=false};assert.equal((await readOwnerConversation(args,deps)).ok,false);assert.equal(reads,0)
 current=true;chosen=false;onModel=()=>{};onRead=()=>{current=false};assert.equal((await readOwnerConversation(args,deps)).messages,undefined);assert.equal(reads,1)
 current=true;chosen=false;onRead=()=>{};const accepted=await readOwnerConversation(args,deps);assert.equal(accepted.ok,true);assert.equal(accepted.messages[0].text,'第三方私密正文');assert.equal(reads,2);assert.equal(completed,0,'私信读取不可生成社交发送经历或继续行动')
 for(const f of readdirSync(home).filter(x=>x.endsWith('.json'))){const stored=readFileSync(join(home,f),'utf8');assert.ok(!stored.includes(request));assert.ok(!stored.includes('第三方私密正文'))}
})

test('私信意愿票据绑定准确联系人和范围、一次使用，不能混入其他 Life 机会',async t=>{
 const home=mkdtempSync(join(tmpdir(),'main-private-proof-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 const prompts=[];const actor=createLifeWillingness({dataDir:home,getAccountTag:()=> 'a'.repeat(16),getContext:()=>({voice:'鱼鱼',world:{}}),opportunityWindowMs:15,
   invokeModel:async p=>{prompts.push(p);return JSON.stringify({action:'act',candidateId:JSON.parse(p.match(/这轮候选：([^\n]+)/)[1])[0].id,reason:'愿意'})}})
 const target={tool:'bili_read_dm',uid:'42',limit:10}
 const a=actor.decide({scene:'main',trigger:'main-session-private-read',sourceKey:'private:one',isCurrent:()=>true,candidates:[{id:'private-read',kind:'session_private_read',label:'只读指定私信'}],evidence:{sessionPrivateRead:{...target,request:'私密主人请求'}}},{queueIfBusy:true})
 const b=actor.decide({scene:'main',trigger:'public-video',sourceKey:'public:one',candidates:[{id:'public-read',kind:'explore_video',label:'公开观察'}]},{queueIfBusy:true})
 const choice=await a;assert.equal(choice.ok,true);assert.equal(actor.verify(choice.proof,'session_private_read',{...target,uid:'43'}).ok,false);assert.equal(actor.verify(choice.proof,'session_private_read',{...target,limit:20}).ok,false);assert.equal(actor.verify(choice.proof,'explore_video').ok,false)
 assert.equal(actor.verify(choice.proof,'session_private_read',target).ok,true);assert.equal(actor.verify(choice.proof,'session_private_read',target).ok,false);actor.receipt(choice.proof,{status:'verified'});assert.equal(actor.verify(choice.proof,'session_private_read',target).ok,false)
 const other=await b;assert.equal(other.ok,true);actor.receipt(other.proof,{status:'not-sent'});assert.equal(prompts.length,2);assert.doesNotMatch(prompts[1],/私密主人请求/)
})


test('切换账号撤销私信读取，原只读意愿安全释放，不将旧正文交付新账号',async t=>{
 const home=mkdtempSync(join(tmpdir(),'main-private-switch-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 let scope='a'.repeat(16),reads=0;const first=scope
 const actor=createLifeWillingness({dataDir:home,getAccountTag:()=>scope,getContext:()=>({voice:'鱼鱼'}),invokeModel:async()=>JSON.stringify({action:'act',candidateId:'private-read',reason:'愿意'})})
 const result=await executeMainSessionPrivateRead({willingness:actor,isCurrent:()=>scope===first,claim:()=>true,request:'查看 UID 42 的私信',uid:'42',limit:10,read:async()=>{reads++;scope='b'.repeat(16);return {ok:true,messages:['旧账号私信']}}})
 assert.equal(result.ok,false);assert.equal(result.messages,undefined);assert.equal(reads,1)
 scope=first;assert.equal(actor.status().admission.held,false)
 const denied=await executeMainSessionPrivateRead({willingness:{decide:async()=>({ok:true,candidateId:'private-read',proof:{}}),verify:()=>({ok:true}),receipt:()=>({ok:false})},isCurrent:()=>true,claim:()=>true,uid:'42',limit:10,read:async()=>({ok:true,messages:['不应交付']})})
 assert.equal(denied.ok,false);assert.equal(denied.messages,undefined)
})

// Generic disclosure retains the same exact, process-local, one-use proof as DM.
test('dev70 generic private target binds tool and exact parameters, disallows aliases and unregistered targets',async t=>{
 const {registeredLifeTool}=await import('../lib/life-agent-read-runtime.mjs')
 const home=mkdtempSync(join(tmpdir(),'generic-private-proof-'));t.after(()=>rmSync(home,{recursive:true,force:true}))
 const actor=createLifeWillingness({dataDir:home,getAccountTag:()=> 'a'.repeat(16),getContext:()=>({voice:'鱼鱼'}),invokeModel:async()=>JSON.stringify({action:'act',candidateId:'private-read',reason:'愿意'})})
 assert.equal(registeredLifeTool('main-session','bili_read_dm').disclosure,'private');assert.equal(registeredLifeTool('main-session','bili_search').disclosure,undefined);assert.equal(registeredLifeTool('social','bili_read_dm'),null)
 const target={tool:'dafeiyu_life_recall',args:{query:'视频细节',detail_start_ms:0,detail_end_ms:20000}}
 const choice=await actor.decide({scene:'main',trigger:'main-session-private-read',sourceKey:'private:exact',isCurrent:()=>true,candidates:[{id:'private-read',kind:'session_private_read',label:'同意读取具体回忆'}],evidence:{sessionPrivateRead:target}},{queueIfBusy:true})
 assert.equal(choice.ok,true)
 for(const changed of [{...target,args:{...target.args,detail_end_ms:30000}},{...target,tool:'dafeiyu_memory_recall'},{...target,tool:'bili_search'}])assert.equal(actor.verify(choice.proof,'session_private_read',changed).ok,false)
 assert.equal(actor.verify(choice.proof,'session_private_read',{tool:target.tool,args:{detail_end_ms:20000,query:'视频细节',detail_start_ms:0}}).ok,true)
 assert.equal(actor.verify(choice.proof,'session_private_read',target).ok,false);actor.receipt(choice.proof,{status:'verified'})
 let reads=0;const read=async args=>{reads++;assert.deepEqual(args,{media_id:123,page:2});return {medias:['原接口未带 ok 字段的正常返回']}}
 const result=await executeMainSessionPrivateRead({willingness:actor,isCurrent:()=>true,claim:()=>true,tool:'bili_favorite_content',args:{page:2,media_id:123},read})
 assert.equal(result.medias.length,1);assert.equal(reads,1)
 assert.equal((await executeMainSessionPrivateRead({willingness:actor,isCurrent:()=>true,claim:()=>true,tool:'bili_search',args:{keyword:'公开'},read})).ok,false);assert.equal(reads,1)
 const blocked=await executeMainSessionPrivateRead({willingness:{decide:async()=>({ok:true,candidateId:'private-read',proof:{}}),verify:()=>({ok:true}),receipt:()=>({ok:false})},isCurrent:()=>true,claim:()=>true,tool:'bili_received_replies',args:{},read:async()=>({error:'不应交付的正文'})})
 assert.equal(blocked.ok,false);assert.doesNotMatch(JSON.stringify(blocked),/不应交付/)
})


test('dev78 role presentation retains genuine choice but omits internal reason and arbitrary prose',()=>{
 const raw={ok:false,reason:'life-private-read-declined',lifeAction:'skip',message:'内部检查',private:'secret'}
 const view=projectPrivateReadForRole(raw);assert.equal(view.choice,'prefer-not-to-share');assert.doesNotMatch(JSON.stringify(view),/life-private-read|内部检查|secret/)
 assert.deepEqual(projectPrivateReadForRole(raw,'work'),raw)
 assert.equal(projectPrivateReadForRole({ok:false,reason:'life-private-read-deferred',lifeAction:'defer'}).choice,'not-now')
 assert.equal(projectPrivateReadForRole({ok:false,reason:'life-private-read-declined',lifeAction:'blocked'}).choice,'unavailable')
 assert.equal(projectPrivateReadForRole({ok:false,reason:'dm-read-failed',error:'401'}).choice,'unavailable')
 assert.equal(projectPrivateReadForRole({ok:false,reason:'contact-needs-clarification',suggestedName:'老大'}).suggestedName,'老大')
 assert.equal(projectPrivateReadForRole({ok:false,reason:'invalid-detail-selector'}).reason,'invalid-detail-selector')
 const success={ok:true,messages:[{text:'实际正文'}]};assert.equal(projectPrivateReadForRole(success),success)
 assert.equal(ownerTurnMode('work: 看看私信'),'work');for(const s of [' work: 看看私信','引用 work: 看看私信','work:','WORK: 查看','\nwork: 查看'])assert.equal(ownerTurnMode(s),'life')
})


test('dev78 resolved owner and configured alias enter the original precise willingness gate; work is not a bypass',async t=>{
 const home=mkdtempSync(join(tmpdir(),'dev78-private-resolved-'));t.after(()=>rmSync(home,{recursive:true,force:true}));let reads=0,models=0,answer='skip',current=true,request='work: 查看我和你的私信'
 const actor=createLifeWillingness({dataDir:home,getAccountTag:()=> 'a'.repeat(16),getContext:()=>({voice:'鱼鱼'}),invokeModel:async()=>{models++;return JSON.stringify({action:answer,candidateId:'private-read',reason:'自主选择'})}})
 const resolve=contact=>resolveSessionDmTarget({request,contact,ownerUid:'42',accountUid:'7',runtimeDir:home,roster:[{uid:'43',name:'老大'}]})
 const run=async contact=>{const target=resolve(contact);if(!target.ok)return target;return readOwnerConversation({talker_uid:target.uid,limit:10,confirm:true},{accountUid:'7',isCurrent:()=>current&&resolve(contact).uid===target.uid,readConversation:async uid=>{reads++;return [{fromMe:false,text:'仅在同意后读取 '+uid}]},chooseRead:({uid,limit,read})=>executeMainSessionPrivateRead({willingness:actor,isCurrent:()=>current&&resolve(contact).uid===target.uid,claim:()=>true,request,uid,limit,read})})}
 const refusal=await run('owner');assert.equal(refusal.lifeAction,'skip');assert.equal(models,1);assert.equal(reads,0);assert.equal(projectPrivateReadForRole(refusal,ownerTurnMode(request)).reason,'life-private-read-declined')
 request='看看老大的私信';answer='act';const result=await run('老大');assert.equal(result.ok,true);assert.equal(result.talker_uid,'43');assert.equal(reads,1)
 request='看看陌生人的私信';assert.equal((await run('陌生人')).ok,false);assert.equal(models,2);assert.equal(reads,1)
 current=false;request='看看我和你的私信';assert.equal((await run('owner')).ok,false);assert.equal(reads,1)
})
