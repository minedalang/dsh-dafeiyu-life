import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions, fetchMsgs, readOwnerConversation } from '../lib/dm.mjs';

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
 try{const cred={sessdata:'private-test',dedeuserid:7};const args={talker_uid:'42',confirm:true};const deps={accountUid:'7',isCurrent:()=>true,readConversation:(uid,limit)=>fetchMsgs(cred,uid,limit)}
 const result=await readOwnerConversation(args,deps);assert.equal(result.ok,true);assert.deepEqual(result.messages.map(x=>[x.direction,x.text]),[['outgoing','鱼鱼你好'],['incoming','老大的真实中文私信']]);assert.doesNotMatch(JSON.stringify(result),/private-test/);assert.equal(calls,1)
 for(const bad of [{talker_uid:'42'},{...args,talker_uid:'7'},{...args,talker_uid:'9007199254740993'},{...args,limit:21}])assert.equal((await readOwnerConversation(bad,deps)).ok,false)
 assert.equal((await readOwnerConversation(args,{...deps,isCurrent:()=>false})).ok,false);assert.equal(calls,1)
 let current=true;const stale=await readOwnerConversation(args,{...deps,isCurrent:()=>current,readConversation:async()=>{current=false;return result.messages}});assert.equal(stale.ok,false);assert.equal(stale.messages,undefined)
 const deferred=await readOwnerConversation(args,{...deps,readConversation:async()=>{throw Object.assign(Error('private'),{name:'BiliReadDeferredError',retryAt:123})}});assert.equal(deferred.deferred,true);assert.equal(deferred.retryAt,123);assert.equal(deferred.messages,undefined)
 }finally{globalThis.fetch=original}
})
