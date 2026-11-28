import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memoryNeuralProjection,neuralProjectionKey} from '../lib/memory-neural-projection.mjs';
import {buildLifeTimeline} from '../lib/life-timeline.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('模糊 trace 不参与搜索，语义候选不由饮食词表二次否决，类别仍保持真实',()=>{
 const trace={id:'trace',text:'我隐约记得曾在评论区与人交流过',stage:'trace',gardenKind:'experience',gardenEvidence:'fading-life-episode'};
 const interest={id:'interest',text:'大肥鱼在最近90天对游戏有17条自主选看线索',gardenKind:'interest',gardenEvidence:'selected-video-trend',tags:['游戏']};
 const food={id:'food',text:'大肥鱼喜欢吃水果',gardenKind:'fact',gardenEvidence:'identity-memory'};
 const p=memoryNeuralProjection({gardenRows:[trace,interest,food],query:'肥鱼喜欢吃',showAll:true,
   semanticMatchIds:[neuralProjectionKey(trace),neuralProjectionKey(interest),neuralProjectionKey(food)],
   semanticScores:{[neuralProjectionKey(trace)]:.98,[neuralProjectionKey(interest)]:.93,[neuralProjectionKey(food)]:.81}});
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(trace)).matched,false);
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(interest)).matched,true);
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(interest)).source,'selected-video-trend');
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(interest)).kind,'interest');
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(interest)).similarity,.93);
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(food)).matched,true);
});
test('语义关联不依赖主题关键词或笼统兴趣措辞，未命中不伪造相似度',()=>{
 const rows=[{id:'interest-a',text:'近期自主选看有关茶道的作品',gardenKind:'interest',gardenEvidence:'selected-video-trend',tags:['茶道']},{id:'interest-b',text:'近期自主选看有关天文的作品',gardenKind:'interest',gardenEvidence:'selected-video-trend',tags:['天文']}];
 for(const q of ['喜欢吃什么','最近有什么兴趣','那种热气腾腾的东西']){
  const a=neuralProjectionKey(rows[0]),b=neuralProjectionKey(rows[1]);
  const p=memoryNeuralProjection({gardenRows:rows,query:q,showAll:true,semanticMatchIds:[a],semanticScores:{[a]:.82}});
  assert.equal(p.nodes.find(x=>x.id===a).similarity,.82);
  assert.equal(p.nodes.find(x=>x.id===b).similarity,undefined);
 }
 const host=read('index.js');assert.doesNotMatch(host,/const foodIntent=|const foodTopic=/);
});
test('搜索结果按综合相关性排序，完整词组优先',()=>{
 const a={id:'A',text:'我曾在评论区讨论过游戏',gardenKind:'experience'};
 const b={id:'B',text:'评论区交流过游戏机制',gardenKind:'experience'};
 const p=memoryNeuralProjection({gardenRows:[a,b],query:'评论区交流',showAll:true});
 assert.equal(p.nodes[0].id,neuralProjectionKey(b));
});
test('只有实际探索证明的 BV/UID 才有时间线链接',()=>{
 const at=Date.now()-30_000,bv='BV19SJi6VEj1',uid='1234567',ref='a'.repeat(16);
 const rows=buildLifeTimeline({now:Date.now(),days:2,lifeDecisions:[
  {at,mode:'active',action:'inspect_opportunity',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:ref},
  {at:at+700,mode:'active',action:'reflect',result:'completed'}],
  explorationEvidence:[{at:at-150,action:'inspect-opportunity',cueRef:ref,bvid:bv,title:'真实标题',creatorUid:uid}],
  comments:[{time:new Date(at+1200).toISOString(),bvid:bv,kind:'reply',recipientUid:uid,snippet:'真实公开回复'}]});
 const v=rows.find(x=>x.type==='life-read');assert.equal(v.bvid,bv);assert.equal(v.creatorUid,uid);
 const c=rows.find(x=>x.type==='comment');assert.equal(c.uid,uid);
 assert.equal(rows.find(x=>x.type==='life-reflection').bvid,undefined,'不得推断反思针对某 BV');
});
test('恢复调度必须显式 gate，管理页面包含真实运行状态',()=>{
 const planner=read('lib/autonomous-planner.mjs'),api=read('index.js'),ui=read('lib/management-console.html');
 assert.match(planner,/const ensureStarted=\(\)=>/);assert.match(api,/autonomousPlanner\.ensureStarted\(\)/);
 assert.match(planner,/cfg\.autonomousPlannerEnabled===true/);
 assert.match(ui,/models-default-provider/);
 assert.doesNotMatch(ui,/id="life-evidence-atlas"/);
});

test('来自评论线索的真实 begin_exploration 核验元数据能关联唯一视频，不能误接附近搜索或冲突 BV',()=>{
 const now=Date.now(),at=now-10_000,chosen='BV1abcde1234',other='BV1abcde1235',cueRef='f'.repeat(16);
 const decisions=[{at,mode:'active',action:'begin_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata',continuation:cueRef}];
 const evidence=[ {at:at-40,action:'inspect-video',cueRef,bvid:chosen,title:'这一轮真正核验的标题'},
   {at:at-50,action:'search',bvid:other,title:'另一条搜索结果'}];
 const rows=buildLifeTimeline({now,days:2,lifeDecisions:decisions,explorationEvidence:evidence});
 const read=rows.find(x=>x.type==='life-read');
 assert.equal(read?.bvid,chosen);assert.equal(read?.title,'这一轮真正核验的标题');
 assert.equal(read?.url,'https://www.bilibili.com/video/'+chosen);
 const ambiguous=buildLifeTimeline({now,days:2,lifeDecisions:decisions,
   explorationEvidence:[...evidence,{at:at-80,action:'inspect-video',cueRef,bvid:other,title:'同时核验的第二条'}]});
 const second=ambiguous.find(x=>x.type==='life-read');
 assert.equal(second,undefined,'冲突的 BV 来源无法核实，不生成匿名视频核验卡片');
 const wrong=buildLifeTimeline({now,days:2,lifeDecisions:decisions,explorationEvidence:[
  {at:at-1,action:'inspect-video',cueRef:'e'.repeat(16),bvid:other,title:'相近但不是本次读取'}]});
 assert.equal(wrong.find(x=>x.type==='life-read'),undefined,'时间相近但来源不符不得关联视频');
});
