import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {decideMentions,parseMentionTargets} from '../lib/mentions.mjs';
import {effectiveModelSelection} from '../lib/model-routing.mjs';

async function rig(overrides={}) {
 const dataDir=await mkdtemp(join(tmpdir(),'v230-'));
 let time=Date.now(), id=0;
 const inbox=[],sent=[],calls=[];
 const cfg={enabled:true,strangerEnabled:true,strangerMaxReplies:1,strangerFirstFixed:true,
  strangerText:'你好',approvalEnabled:true,approvalPhrase:'白饭🍚',approvedTotalLimit:3,
  approvedDailyLimit:2,whitelist:['900'],whitelistCooldownSeconds:0,maxPerPoll:10,maxPerHour:99,...overrides};
 const handler=createDmAutoReply({dataDir,getConfig:()=>cfg,fetchIncoming:async()=>inbox,selfUid:'999',now:()=>time,
  send:async x=>{sent.push(x);return {ok:true}},generateReply:async x=>{calls.push(x);return 'AI: '+x.text},logger:{warn(){},error(){}}});
 const add=(uid,text)=>inbox.push({senderUid:String(uid),text,messageId:String(++id),timestampMs:time,incoming:true});
 return {dataDir,cfg,handler,inbox,sent,calls,add,advance:ms=>time+=ms};
}
test('限额→申请白饭→人工通过→每天限额与累计限额',async()=>{
 const x=await rig();await x.handler.poll();
 x.add('100','你好'); assert.equal((await x.handler.poll()).sent,1);
 assert.match(x.sent[0].text,/白饭🍚/);
 x.add('100','你在吗');assert.equal((await x.handler.poll()).sent,0);
 x.add('100','白饭🍚');assert.equal((await x.handler.poll()).sent,0);
 assert.equal((await x.handler.listApprovals())[0].status,'pending');
 assert.equal((await x.handler.reviewApproval('100','approve')).ok,true);
 assert.equal((await x.handler.listApprovals())[0].status,'approved');
 x.add('100','第一句');assert.equal((await x.handler.poll()).sent,1);
 x.add('100','第二句');assert.equal((await x.handler.poll()).sent,1);
 x.add('100','第三句');assert.equal((await x.handler.poll()).sent,0);
 x.advance(86400_000);
 x.add('100','第四句');assert.equal((await x.handler.poll()).sent,1);
 x.add('100','第五句');assert.equal((await x.handler.poll()).sent,0);
 assert.equal((await x.handler.listApprovals())[0].total,3);
 assert.equal(x.calls.length,4); // 首条陌生人私信现在也由同一轮 AI 回复/意图调用处理
});
test('老白名单无限额，不受审批配额和全局每日配额影响',async()=>{
 const x=await rig({approvedDailyLimit:1,approvedTotalLimit:1,maxPerDay:1});await x.handler.poll();
 for(let n=0;n<4;n++){x.add('900','第'+n+'条');assert.equal((await x.handler.poll()).sent,1)}
 assert.equal(x.sent.length,4);
 assert.equal((await x.handler.listApprovals()).length,0);
});
test('旧历史保留；不同 UID 的历史不会混在一起',async()=>{
 const x=await rig({whitelist:['900','901'],historyLimit:2});await x.handler.poll();
 for(let i=0;i<5;i++){x.add('900','话题'+i);await x.handler.poll()}
 x.add('901','另一位');await x.handler.poll();
 x.add('900','继续');await x.handler.poll();
 const call=x.calls.at(-1);assert.equal(call.uid,'900');assert.match(call.olderContext,/话题0/);
 assert.doesNotMatch(call.olderContext,/另一位/);
 const data=JSON.parse(await readFile(join(x.dataDir,'dm-autoreply-state.json'),'utf8'));
 assert.ok(data.people['900'].olderContext.length>0);
});
test('审批权限可被撤销，不影响可信白名单',async()=>{
 const x=await rig();await x.handler.poll();x.add('100','一');await x.handler.poll();x.add('100','白饭');await x.handler.poll();
 assert.equal((await x.handler.reviewApproval('100','approve')).ok,true);
 assert.equal((await x.handler.reviewApproval('100','revoke')).ok,true);
 x.add('100','再见');assert.equal((await x.handler.poll()).sent,0);
});
test('AI 可只选一个、多选或不@，名单外昵称无效',()=>{
 const targets=parseMentionTargets('甲|123\n乙|456\n丙|789');
 const choose=(selectedNames,shouldMention=true)=>decideMentions({mode:'ai_select',targets,shouldMention,selectedNames});
 assert.deepEqual(choose(['甲']).targets.map(x=>x.name),['甲']);
 assert.deepEqual(choose(['乙','丙']).targets.map(x=>x.name),['乙','丙']);
 assert.equal(choose([]).shouldMention,false);
 assert.deepEqual(choose(['陌生人']).targets,[]);
 assert.equal(choose(['甲'],false).shouldMention,false);
 assert.equal(decideMentions({mode:'ai',targets,shouldMention:true}).targets.length,3);
});
test('独立模型路由与任意文本思考深度被安全 YAML 转义',()=>{
 const q=v=>"'"+String(v).replaceAll("'","''")+"'";
 const sel={provider:'deepseek-account',model:'default',reasoningEffort:'low'};
 const video=effectiveModelSelection(sel,{model:'video-model',reasoningEffort:'16384'},q).join('\n');
 const chat=effectiveModelSelection(sel,{model:'chat-model',reasoningEffort:'thinking_mode'},q).join('\n');
 assert.match(video,/video-model/);assert.match(video,/reasoningEffort: 16384/);
 assert.match(chat,/chat-model/);assert.match(chat,/thinking_mode/);
 assert.ok(!video.includes('chat-model'));
 assert.throws(()=>effectiveModelSelection(sel,{model:'a\nb'},q));
});
