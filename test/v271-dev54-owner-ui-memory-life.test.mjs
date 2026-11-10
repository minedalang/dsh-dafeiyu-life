import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memoryNeuralProjection,neuralProjectionKey} from '../lib/memory-neural-projection.mjs';
import {buildLifeTimeline} from '../lib/life-timeline.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('模糊 trace 不参与搜索，食物查询不会命中无关视频兴趣汇总',()=>{
 const trace={id:'trace',text:'我隐约记得曾在评论区与人交流过',stage:'trace',gardenKind:'experience',gardenEvidence:'fading-life-episode'};
 const interest={id:'interest',text:'大肥鱼在最近90天对游戏有17条自主选看线索',gardenKind:'interest',gardenEvidence:'selected-video-trend',tags:['游戏']};
 const food={id:'food',text:'大肥鱼喜欢吃水果',gardenKind:'fact',gardenEvidence:'identity-memory'};
 const p=memoryNeuralProjection({gardenRows:[trace,interest,food],query:'肥鱼喜欢吃',showAll:true,
   semanticMatchIds:[neuralProjectionKey(trace),neuralProjectionKey(interest),neuralProjectionKey(food)],
   semanticScores:{[neuralProjectionKey(trace)]:.98,[neuralProjectionKey(interest)]:.93,[neuralProjectionKey(food)]:.81}});
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(trace)).matched,false);
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(interest)).matched,false);
 assert.equal(p.nodes.find(x=>x.id===neuralProjectionKey(food)).matched,true);
});
test('搜索结果按综合相关性排序，完整词组优先',()=>{
 const a={id:'A',text:'我曾在评论区讨论过游戏',gardenKind:'experience'};
 const b={id:'B',text:'评论区交流过游戏机制',gardenKind:'experience'};
 const p=memoryNeuralProjection({gardenRows:[a,b],query:'评论区交流',showAll:true});
 assert.equal(p.nodes[0].id,neuralProjectionKey(b));
});
test('只有实际探索证明的 BV/UID 才有时间线链接',()=>{
 const at=Date.now()-30_000,bv='BV19SJi6VEj1',uid='1234567';
 const rows=buildLifeTimeline({now:Date.now(),days:2,lifeDecisions:[
  {at,mode:'active',action:'inspect_opportunity',result:'verified-metadata',verifiedReadKind:'video-metadata'},
  {at:at+700,mode:'active',action:'reflect',result:'completed'}],
  explorationEvidence:[{at:at+150,action:'inspect-opportunity',bvid:bv,title:'真实标题',creatorUid:uid}],
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
