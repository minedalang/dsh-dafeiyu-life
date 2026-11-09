import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const file=async path=>readFile(new URL(path,import.meta.url),'utf8');

test('main Session uses living Life Voice without fixed owner-selected tone cards',async()=>{
  const js=await file('../index.js'),html=await file('../lib/management-console.html'),ui=await file('../lib/management-console.js');
  assert.match(js,/const voice=lifeVoiceContext\(\{scene:'main',maxChars:8500\}\)/);
  assert.match(js,/return `\$\{voice\}\\n\\n【你是谁】/);
  assert.doesNotMatch(js,/mainChatStyleHint|mainChatStylePreset|mainChatStylePlayfulness|mainChatStyleWarmth|mainChatStyleBrevity/);
  assert.doesNotMatch(html,/name="main-chat-style-choice"|俏皮碎碎念|温柔日常/);
  assert.doesNotMatch(ui,/loadMainChatStyle|selectedMainChatStyle/);
  assert.match(html,/肥鱼的表达是怎样形成的/);
  assert.match(html,/查看当前情绪/);
  assert.match(html,/查看人格成长证据/);
});

test('Life Voice combines current emotion and verified growth without claiming actual model behavior',()=>{
  const prompt=composeLifeVoiceContext({scene:'main',persona:'肥鱼基础人格',
    growth:'从真实经历形成的观点',personality:'稳定成长的倾向',emotion:'当前心情是好奇',maxChars:3000});
  assert.match(prompt,/【核心人设（主人设置）】\n肥鱼基础人格/);
  assert.match(prompt,/【已认可的成长风格】\n从真实经历形成的观点/);
  assert.match(prompt,/【当前有效的成长人格】\n稳定成长的倾向/);
  assert.match(prompt,/【当前连续情绪】\n当前心情是好奇/);
  assert.doesNotMatch(prompt,/俏皮度 [0-4]\/4|温柔度 [0-4]\/4/);
});

test('real owner Bilibili DMs are routed to separate owner DM agent before ordinary P6-A',async()=>{
  const src=await file('../index.js');
  assert.match(src,/const ownerRows=cfg\.ownerDmAgentEnabled===true\?incoming\.filter/);
  assert.match(src,/await ownerDmAgent\.processMessages\(ownerRows\)/);
  assert.match(src,/const remaining=incoming\.filter\(row=>!ownerRows\.includes\(row\)\)/);
});

test('P6-A diagnostic distinguishes model three, configured two, actual two, no private text or UID',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'dsh-p6-diag-'));
  const inbox=[];const sends=[];const now=()=>1790000000000;
  const config={enabled:true,p6Enabled:true,p6MaxBubbles:2,whitelist:['200'],whitelistCooldownSeconds:0};
  const agent=createDmAutoReply({dataDir,selfUid:'999',now,logger:{warn(){},error(){}},getConfig:()=>config,
    fetchIncoming:async()=>inbox,
    generateReply:async()=>({action:'reply',messages:['第一句测试','第二句测试','第三句测试']}),
    send:async item=>{sends.push(item);return {ok:true,receiptId:'platform-'+sends.length}}});
  await agent.poll();inbox.push({incoming:true,senderUid:'200',messageId:'evt-1',timestampMs:now(),text:'这是主人隐私之外的普通私信'});
  const result=await agent.poll();assert.equal(result.sent,2);
  assert.deepEqual(sends.map(x=>x.text),['第一句测试','第二句测试']);
  const diag=agent.status().p6LastTurn;
  assert.equal(diag.proposed,3);assert.equal(diag.planned,2);assert.equal(diag.confirmed,2);assert.equal(diag.status,'confirmed');
  const stored=JSON.parse(await readFile(join(dataDir,'dm-autoreply-state.json'),'utf8'));
  assert.deepEqual(stored.p6LastTurn,diag);
  assert.doesNotMatch(JSON.stringify(diag),/evt-1|200|主人隐私|第一句测试/);
});
