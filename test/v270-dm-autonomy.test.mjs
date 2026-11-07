import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs';

const item=(patch={})=>({id:'0',action:'reply',reply:'你好呀',messages:['你好呀'],followUpMinutes:null,deferMinutes:null,
  todoDisposition:'none',suggestedTodo:null,mood:'neutral',intensity:0,...patch});

function batcherFor(output,{persona='LifeVoice唯一情绪来源：今天有点累；人格仍然温柔但不强迫社交。',now=()=>1_800_000_000_000}={}){
  let captured='';
  const batcher=createInteractionBatcher({
    invoke:async prompt=>{captured=prompt;return JSON.stringify({items:[output]})},
    getPersona:()=>persona,now,delayMs:0,
    logger:{warn(){},error(){}},
  });
  return {batcher,prompt:()=>captured};
}

const req={kind:'dm',uid:'123456',text:'最近在听一支乐队',socialAutonomy:true,threadKey:'dm:123456',relationshipStage:'familiar',
  trigger:'incoming',canSkip:true,authorization:'stranger'};

test('DM decision contract receives the same Life Voice once, relationship stage and unknown interests as evidence',async()=>{
  const x=batcherFor(item());
  const result=await x.batcher.generate(req);
  assert.equal(result.action,'reply');
  assert.equal(result.messages[0],'你好呀');
  const prompt=x.prompt();
  assert.equal(prompt.split('LifeVoice唯一情绪来源').length-1,1,'no duplicate mood/persona injection');
  assert.match(prompt,/"stage":"familiar"/);
  assert.match(prompt,/"status":"unknown"/);
  assert.match(prompt,/"socialDecisionContext"/);
  assert.doesNotMatch(prompt,/"lifeVoiceContext"\s*:/,'contract metadata must not copy Life Voice text a second time');
  x.batcher.stop();
});

test('DM autonomy accepts one to three natural bubbles and bounded delayed supplement',async()=>{
  const x=batcherFor(item({messages:['第一条','第二条','第三条'],reply:'',followUpMinutes:30}));
  const result=await x.batcher.generate(req);
  assert.deepEqual(result.messages,['第一条','第二条','第三条']);
  assert.equal(result.followUpMinutes,30);
  x.batcher.stop();
});

test('DM autonomy turns invalid proactive @ into silence, never an outgoing message',async()=>{
  const x=batcherFor(item({messages:['@陌生人 来看看'],reply:''}));
  const result=await x.batcher.generate(req);
  assert.equal(result.action,'skip');
  assert.equal(result.reason,'proactive-at-forbidden');
  x.batcher.stop();
});

test('DM autonomy defer is a bounded reconsideration, not a promise to send',async()=>{
  const x=batcherFor(item({action:'defer',reply:'',messages:[],deferMinutes:20}));
  const result=await x.batcher.generate(req);
  assert.equal(result.action,'defer');
  assert.equal(result.notBefore,1_800_000_000_000+20*60_000);
  x.batcher.stop();
});

test('scheduled DM can close or skip without being forced to continue',async()=>{
  for(const action of ['skip','close']){
    const x=batcherFor(item({action,reply:'',messages:[]}));
    const result=await x.batcher.generate({...req,trigger:'scheduled',scheduledPurpose:'silence-reconsideration'});
    assert.equal(result.action,action);
    x.batcher.stop();
  }
});

function dmProductionReplyAdapter(source){
  // Windows Git checkouts may contain CRLF. Locate the actual adapter by
  // structure instead of matching an LF-only snippet or the wrong variable case.
  const normalized=String(source).replace(/\r\n?/g,'\n');
  const match=normalized.match(/\bconst\s+dmAutoreply\s*=\s*createDmAutoReply\s*\(\s*\{[\s\S]*?\bgenerateReply\s*:\s*async\s*\(req\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\n\s*getVerifiedFacts\s*:/);
  assert.ok(match,'cannot locate the production DM reply adapter');
  return match[1];
}

test('DM production adapter locator works with both LF and Windows CRLF',async()=>{
  const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
  const lf=source.replace(/\r\n?/g,'\n');
  const crlf=lf.replace(/\n/g,'\r\n');
  assert.equal(dmProductionReplyAdapter(lf),dmProductionReplyAdapter(crlf));
});

test('DM production adapter no longer runs the separate numeric dual-context willingness gate',async()=>{
  const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
  const adapter=dmProductionReplyAdapter(source);
  assert.doesNotMatch(adapter,/dualContextAgency\.decide/);
  assert.match(adapter,/socialAutonomy:true/);
  assert.match(adapter,/relationshipStage/);
  assert.match(source,/canSendDm:\s*args=>socialPolicyGate\.canSendDm\(args\)/);
  assert.match(source,/async function getNewDmMessages\(\{probeOnly=false,forceUid=''/);
  assert.match(source,/if\(probeOnly\)\{[\s\S]{0,700}dmFetch\(cred,target,50/);
  assert.match(source,/dmPollCursor\.discard\(\)/);
  const dmSource=await readFile(new URL('../lib/dm-autoreply.mjs',import.meta.url),'utf8');
  assert.match(dmSource,/fetchIncoming\(\{probeOnly:true,forceUid:uid\}\)/);
});

test('DM UI keeps only historical approval fields while autonomy remains the reply policy',async()=>{
  const html=await readFile(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const source=await readFile(new URL('../index.js',import.meta.url),'utf8');
  assert.match(html,/允许鱼鱼自主考虑并多轮回复陌生人/);
  assert.doesNotMatch(html,/启用严格暗号审核（可选，默认关闭）/);
  assert.match(html,/历史严格审核记录（只读/);
  assert.match(source,/人工严格私信审批已停止/);
  assert.match(source,/dmStrangerOnce:\s*z\.boolean\(\)\.default\(false\)/);
  assert.match(source,/dmStrangerAutonomyEnabled:\s*z\.boolean\(\)\.default\(false\)/);
  assert.match(source,/dmApprovalEnabled:\s*z\.boolean\(\)\.default\(false\)/);
});

test('SocialPolicyGate is the DM send authority; relationship alone never grants DM permission',()=>{
  const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'100',friendDirectory:JSON.stringify([{uid:'200',name:'好友但未授权私信',dm:false}])};
  const gate=createSocialPolicyGate({getConfig:()=>cfg});
  const base={uid:'200',trusted:false,approved:false,strangerEnabled:false,approvalEnabled:false};
  assert.equal(gate.actor('200').role,'friend');
  assert.equal(gate.canSendDm(base).allowed,false,'friendship without DM permission is not enough');
  assert.equal(gate.canSendDm({...base,strangerEnabled:true}).allowed,true,'explicit stranger-DM consent makes the message eligible');
  assert.equal(gate.canSendDm({...base,strangerEnabled:true,approvalEnabled:true,approvalPending:true}).reason,'strict-approval-pending');
  assert.equal(gate.canSendDm({...base,strangerEnabled:true,approvalEnabled:true,strangerReplies:1,strangerMaxReplies:1}).reason,'strict-approval-reply-limit');
  assert.equal(gate.canSendDm({...base,strangerEnabled:true,legacyStrangerOnce:true,strangerReplies:1,strangerMaxReplies:1}).reason,
    'legacy-stranger-reply-limit','upgrade must not silently widen old one-shot stranger DM consent');
  assert.equal(gate.canSendDm({...base,strangerEnabled:true,approvalEnabled:false,strangerReplies:50,strangerMaxReplies:1}).allowed,true,
    'the one-shot cap is inactive when optional strict approval is off');
  assert.equal(gate.canSendDm({...base,approved:true}).allowed,true);
  cfg.dmWatch=false;
  assert.equal(gate.canSendDm({...base,trusted:true}).reason,'dm-watch-disabled');
});

test('B站私信回执提取只接受真实 msg_key，不伪造成功标识',async()=>{
  const {extractBiliDmReceiptId}=await import('../lib/dm-send-receipt.mjs');
  assert.equal(extractBiliDmReceiptId({success:true,data:{msg_key:'platform-key-1'}}),'platform-key-1');
  assert.equal(extractBiliDmReceiptId({success:true,data:{msg_key:{seqno:9,timestamp:123,dev_id:7}}}),'{"dev_id":7,"seqno":9,"timestamp":123}');
  assert.equal(extractBiliDmReceiptId({structuredContent:{data:{data:{msg_key:'platform-key-2'}}}}),'platform-key-2');
  assert.equal(extractBiliDmReceiptId({content:[{type:'text',text:'{"success":true,"data":{"msg_key":"platform-key-3"}}'}]}),'platform-key-3');
  assert.equal(extractBiliDmReceiptId({success:true,data:{code:0}}),'');
});
