import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {memoryGardenSnapshot} from '../lib/memory-garden-view.mjs'
import {memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
import {recordInterestEvents,interestMemoryRows,interestNeuralEvidence} from '../lib/life-interests.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createEmotionalState} from '../lib/emotional-state.mjs'
const A='a'.repeat(16),B='b'.repeat(16),DAY=86400000,NOW=Date.parse('2026-11-25T10:00:00Z'),bv=i=>'BV'+String(i).padStart(10,'0')
const cfg={mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:120,mainSessionMemoryAutoBili:true}
const h=s=>createHash('sha256').update(s).digest('hex'),eid=k=>'e-'+h(k).slice(0,18),cid=k=>'c-'+h(k).slice(0,18)
const selected=(i,at,tag=A)=>({kind:'watch',key:'selected:'+i,bvid:bv(i),title:'今天做白饭料理 '+i,tier:'selected',time:new Date(at).toISOString(),day:new Date(at).toISOString().slice(0,10),accountTag:tag})
const social=(uid='1234',tag=A)=>({kind:'social',key:`social:${uid}:${bv(1)}:5678`,actorUid:uid,bvid:bv(1),at:NOW-1000,text:'这段评论真的很有意思',accountTag:tag})
const setup=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-neural-proof-'));let time=NOW,tag=A,g;const reopen=()=>{g?.close();g=createLifeMemoryGateway({dataDir:dir,getConfig:()=>cfg,getAccountTag:()=>tag,now:()=>time,logger:{warn(){}}});return g};try{reopen();await fn({dir,get g(){return g},reopen,clock:t=>time=t,account:t=>tag=t})}finally{g?.close();rmSync(dir,{recursive:true,force:true})}}
const rows=(g,extras={})=>g.videoRecallGroups(g.semanticCandidates({domain:'main-session',limit:3200,...extras}))
const proof=(x,gardenRows=[],interestEvidence=[],episodeRows=rows(x.g))=>x.g.neuralEvidenceSnapshot({accountTag:A,gardenRows,interestEvidence,episodeRows})
const garden=(x,events=[])=>memoryGardenSnapshot({interests:interestMemoryRows(x.dir,NOW),people:[{uid:'1234',count:2,lastAt:NOW-1000,name:'测试对象'}],memories:events,limit:10000}).rows
const projection=(x,gardenRows,interestEvidence,limit=10000)=>{const episodes=rows(x.g);return memoryNeuralProjection({gardenRows,episodes,limit,showAll:true,verifiedGraph:proof(x,gardenRows,interestEvidence,episodes)})}
test('真实兴趣事件和反思候选身份、互动 UID 通过统一 Gateway 投影；历史数据不靠相似度猜测',()=>setup(x=>{
 const picks=[selected(1,NOW-1.5*DAY),selected(2,NOW-.5*DAY),selected(3,NOW-2000)]
 for(const e of picks)recordInterestEvents(x.dir,[e],NOW,{accountTag:A})
 x.g.recordEvents([...picks,social(),social('2222',B),{...selected(4,NOW-1000,B)}])
 const r={id:'reflection-1',text:'我从真实经历中总结的认识',source:'life-reflection',sourceKey:'life-reflection:'+cid(picks[0].key)+':0',evidenceKeys:[cid(picks[0].key),cid('unavailable'),cid(social('2222',B).key)],createdAt:new Date(NOW).toISOString()}
 const gr=garden(x,[r]),interest=interestNeuralEvidence(x.dir,A,NOW)
 assert.equal(interest.length,3);const snapshot=proof(x,gr,interest)
 assert.equal(snapshot.links.filter(e=>e.type==='interest').length,3,JSON.stringify(snapshot))
 assert.equal(snapshot.links.filter(e=>e.type==='relationship').length,1);assert.equal(snapshot.links.filter(e=>e.type==='source').length,1)
 assert.equal(proof(x,gr,[{...interest[0],at:interest[0].at+1}]).links.filter(e=>e.type==='interest').length,0)
 const p=projection(x,gr,interest);assert.equal(p.edgeCounts.interest,3);assert.equal(p.edgeCounts.relationship,1);assert.equal(p.edgeCounts.source,1)
 assert.ok(!JSON.stringify(p.edges).includes('observed-person:'));assert.ok(!JSON.stringify(p.edges).includes(eid(picks[0].key)))
 const small=projection(x,gr,interest,1);assert.equal(small.evidenceTotals.interest,3);assert.equal(small.edgeCounts.interest,0)
 x.account(B);assert.deepEqual(proof(x,gr,interest),{links:[],emotions:[]})
}))
test('旧版兴趣只有可核验账号和完全匹配原事件才连接；同 BV 主人私密观察不接替公开证据',()=>setup(x=>{
 const events=[selected(1,NOW-1.5*DAY),selected(2,NOW-.5*DAY),selected(3,NOW-1000)].map(e=>({...e,key:`watch:${e.day}:${e.bvid}`}))
 for(const e of events)recordInterestEvents(x.dir,[e],NOW,{accountTag:A})
 const file=join(x.dir,'life-memory','interests.json'),doc=JSON.parse(readFileSync(file,'utf8'));for(const r of doc.entries)for(const e of r.evidence){delete e.episodeId;if(e.bvid===bv(3))delete e.account}writeFileSync(file,JSON.stringify(doc))
 x.g.recordEvents([...events,{...events[0],key:'public-visual-new',time:new Date(NOW-500).toISOString(),experience:{source:'bili-life',metadata:true,vision:true,visualReceipt:{source:'low-resolution-preview',frameCount:1,firstAtMs:0,lastAtMs:0},visualSceneNotes:['真实采样观察']}},{...events[0],key:'private-visual-new',time:new Date(NOW-100).toISOString(),experience:{source:'main-session',metadata:true}}])
 const gr=garden(x),snapshot=proof(x,gr,interestNeuralEvidence(x.dir,A,NOW)),links=snapshot.links.filter(e=>e.type==='interest');assert.equal(links.length,2)
 assert.ok(links.some(e=>e.to===eid('public-visual-new')));assert.ok(!links.some(e=>e.to===eid('private-visual-new')))
}))
test('持久模型关系可视化只映射真实清晰端点、类型强度，遗忘后失效',()=>setup(x=>{
 const events=[selected(1,NOW-1000),selected(2,NOW-2000)];x.g.recordEvents(events)
 const sources=events.map(e=>({...x.g.reflectionEvidence([e.key])[0],quote:e.title}));assert.equal(x.g.recordAssociations({accountTag:A,batchId:h('batch'),proposals:[{type:'concept',sources}]}).added,1)
 const p=projection(x,[],[]);assert.equal(p.evidenceTotals.association,1);assert.equal(p.associationTypes.concept,1);assert.equal(p.edges[0].associationType,'concept');assert.equal(p.edges[0].strength,1)
 x.reopen();assert.equal(projection(x,[],[]).evidenceTotals.association,1);x.clock(NOW+61*DAY);assert.equal(projection(x,[],[]).evidenceTotals.association,0)
}))
test('已有评论模型回执绑定准确事件，无额外模型调用，不给旧记录或私信补造情绪',()=>setup(async x=>{
 const e=social();x.g.recordEvents([e,{...social('9999'),key:`social:9999:${bv(1)}:5678`}]);let calls=0
 const mood=createEmotionalState({dataDir:x.dir,now:()=>NOW})
 const batch=createInteractionBatcher({delayMs:1,invoke:async()=>{calls++;return JSON.stringify({items:[{id:'0',action:'reply',reply:'好有趣！',mood:'joyful',intensity:2}]})},getPersona:()=>'',onEmotion:o=>mood.update(o),onEmotionContext:o=>{if(o.observation)assert.equal(x.g.recordEpisodeEmotion(o.observation).ok,true)}})
 try{await batch.generate({kind:'comment',uid:'1234',bvid:bv(1),incomingRpid:'5678',text:e.text,verifiedCommentSource:true,emotionAccountTag:A});assert.equal(calls,1)
 assert.equal(proof(x).emotions.length,1);assert.equal(proof(x).emotions[0].id,eid(e.key));const p=projection(x,[],[]);assert.equal(p.emotionCount,1);assert.equal(p.nodes.find(n=>n.emotion).emotion,'joyful')
 const filtered=memoryNeuralProjection({episodes:rows(x.g),kind:'emotion',limit:1,showAll:true,verifiedGraph:proof(x)});assert.equal(filtered.matched,1);assert.equal(filtered.nodes[0].emotion,'joyful');assert.equal(memoryNeuralProjection({episodes:rows(x.g),kind:'emotion',showAll:false,verifiedGraph:{links:[],emotions:[]}}).matched,0)
 assert.equal(x.g.recordEpisodeEmotion({accountTag:A,eventKey:e.key,mood:'sad',intensity:2,at:NOW}).duplicate,true)
 assert.equal(x.g.recordEpisodeEmotion({accountTag:A,eventKey:'social:1234:'+bv(1)+':1111',mood:'sad',intensity:2,at:NOW}).ok,false)
 assert.equal(x.g.recordEpisodeEmotion({accountTag:B,eventKey:e.key,mood:'sad',intensity:2,at:NOW}).ok,false)
 await batch.generate({kind:'dm',uid:'9999',bvid:bv(1),incomingRpid:'5678',text:'私人交流',verifiedCommentSource:true,emotionAccountTag:A});assert.equal(proof(x).emotions.length,1)
 x.reopen();assert.equal(proof(x).emotions.length,1);x.clock(NOW+500*DAY);assert.equal(proof(x).emotions.length,0);assert.equal(projection(x,[],[]).emotionCount,0)
 }finally{batch.stop()}
}))

test('emotion relation needs two independent live same-mood comment receipts and an explicit reflected proposal; removal revokes only that edge',()=>setup(async x=>{
 const a=social(),b={...social('4321'),key:`social:4321:${bv(2)}:5679`,bvid:bv(2),text:'今天的这段交流让我想起有趣的作品'};x.g.recordEvents([a,b]);const batchId=h('emotion-pair');
 const sources=()=>[a,b].map(e=>{const row=x.g.reflectionEvidence([e.key])[0];return {...row,quote:e.text,...(row.associationEmotion?{emotion:row.associationEmotion}:{})}})
 const record=(type='emotion',s=sources(),id=batchId)=>x.g.recordAssociations({accountTag:A,proposals:[{type,sources:s}],batchId:id})
 assert.equal(record().rejected,1);assert.equal(x.g.recordEpisodeEmotion({accountTag:A,eventKey:a.key,mood:'joyful',intensity:2,at:NOW}).ok,true);assert.equal(record().rejected,1)
 assert.equal(x.g.recordEpisodeEmotion({accountTag:A,eventKey:b.key,mood:'joyful',intensity:1,at:NOW}).ok,true)
 assert.equal(record('emotion',sources().map(({emotion,...e})=>e)).rejected,1)
 assert.equal(record('emotion',sources().map(e=>({...e,emotion:{...e.emotion,mood:'sad'}}))).rejected,1)
 assert.equal(record('emotion').added,1);assert.equal(record('concept',sources(),h('normal-pair')).added,1)
 assert.equal(projection(x,[],[]).associationTypes.emotion,1);x.reopen();assert.equal(projection(x,[],[]).associationTypes.emotion,1)
 const doc=JSON.parse(readFileSync(x.g.file,'utf8'));delete doc.episodes.find(e=>e.key===b.key).emotionObservation;writeFileSync(x.g.file,JSON.stringify(doc));const p=projection(x,[],[]);assert.equal(p.associationTypes.emotion,0);assert.equal(p.associationTypes.concept,1)
}))

test('局部覆盖只来自准确当前清晰公开代表经历，不转移旧缺口、私密或他号数据',()=>setup(x=>{
 const event=(id,at,tag=A,source='bili-life')=>({...selected(1,at,tag),key:'video-explore:'+id,autonomousSelected:true,experience:{source,metadata:true,vision:false,evidenceSchema:'life-video-evidence/v1',partialVisualReceipt:{source:'low-resolution-preview',sampledTimesMs:[1000,2000,3000],describedTimesMs:[1000,3000],notes:['局部画面'],interpretation:'partial-model-observation-not-semantic-proof'}}})
 x.g.recordEvents([event('public',NOW-1000),{...event('other',NOW-1000,B),bvid:bv(2)},{...event('private',NOW-500,A,'main-session'),bvid:bv(3)}]);
 let p=projection(x,[],[]);const covered=p.nodes.filter(n=>n.partialCoverage);assert.equal(covered.length,1);assert.equal(covered[0].bvid,bv(1));assert.deepEqual(covered[0].partialCoverage,{sampledCount:3,describedCount:2,missingTimesMs:[2000]});assert.ok(!Object.hasOwn(covered[0].partialCoverage,'id'))
 x.g.recordEvents([{...selected(1,NOW),key:'new-representative'}]);p=projection(x,[],[]);assert.ok(!p.nodes.some(n=>n.partialCoverage),'旧局部不能冒充新代表');
 x.account(B);assert.ok(!projection(x,[],[]).nodes.some(n=>n.partialCoverage),'原账号证据不能继续交付');
 x.account(A);x.clock(NOW+500*DAY);assert.ok(!projection(x,[],[]).nodes.some(n=>n.partialCoverage),'遗忘后无覆盖数据')
}))
