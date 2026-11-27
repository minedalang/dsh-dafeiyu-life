import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createBackup,restoreBackupFiles,createLifeMemoryBackup,restoreLifeMemoryBackup,allowedPath} from '../lib/data-backup.mjs'
import {createLifeReflection,__test as reflectionTest} from '../lib/life-reflection.mjs'
import {createMemoryRetriever,publicVisualAssociationContext} from '../lib/memory-retriever.mjs'
import {createNeuralActivationTracker,projectNeuralActivation,memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
const A='a'.repeat(16),B='b'.repeat(16),DAY=86400000,NOW=Date.parse('2026-11-25T10:00:00Z')
const cfg={mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:120,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2}
const bv=i=>'BV'+String(i).padStart(10,'0')
const watch=(i,title,tag=A,source='bili-life')=>({kind:'watch',key:'assoc-test:'+i,bvid:bv(i),title,at:NOW-i*1000,accountTag:tag,experience:{source,metadata:true,preview:true,vision:true,visualReceipt:{source:'low-resolution-preview',frameCount:1,firstAtMs:0,lastAtMs:0},visualSceneNotes:[title]}})
const events=[watch(1,'雨后的城市街道'),watch(2,'旧车站的独自等待'),watch(3,'海边放飞纸飞机'),watch(4,'另一个账号的作品',B),watch(5,'主人私密画面',A,'main-session')]
const receipt=s=>createHash('sha256').update(s).digest('hex')
const setup=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-assoc-'));let clock=NOW,tag=A,g;const reopen=()=>{g?.close();g=createLifeMemoryGateway({dataDir:dir,getConfig:()=>cfg,getAccountTag:()=>tag,now:()=>clock,logger:{warn(){}}});return g};try{reopen().recordEvents(events);await fn({dir,get g(){return g},reopen,setTime:t=>clock=t,setAccount:t=>tag=t})}finally{g?.close();rmSync(dir,{recursive:true,force:true})}}
const src=(g,i)=>{const e=g.reflectionEvidence(['assoc-test:'+i])[0];return {...e,quote:events[i-1].title}}
const propose=(g,a,b,type='concept')=>({type,sources:[src(g,a),src(g,b)]})
const ids=g=>g.semanticCandidates({domain:'bili-explore',limit:3200}).map(x=>x.id)
const add=(g,proposals,key='batch-one')=>g.recordAssociations({accountTag:A,proposals,batchId:receipt(key)})
const link=(g,a,excludeIds=[])=>g.associationCandidates({accountTag:A,seedIds:[src(g,a).id],eligibleIds:ids(g),excludeIds,limit:3})
test('real Gateway: exact source snapshots, persistence, independent review receipts, no copied text',()=>setup(async x=>{
 const p=propose(x.g,1,2);assert.equal(add(x.g,[p]).added,1);assert.equal(add(x.g,[p]).duplicates,1)
 assert.equal(add(x.g,[p],'batch-two').reinforced,1);const row=JSON.parse(readFileSync(x.g.file,'utf8')).associations[0];assert.equal(row.receipts.length,2);assert.ok(!JSON.stringify(row).includes('雨后的城市街道'))
 x.reopen();assert.equal(x.g.status().associations.active,1);const path=link(x.g,1)[0];assert.equal(path.memoryId,src(x.g,2).id);assert.equal(x.g.validateAssociationPath({accountTag:A,...path}),true)
 x.setAccount(B);assert.equal(x.g.validateAssociationPath({accountTag:A,...path}),false);assert.equal(x.g.status().associations.active,0)
 x.setAccount(A);assert.equal(x.g.status().associations.active,1)
}))
test('reject forged, stale, same-BV, private, foreign, emotion-without-proof and invalid quotes',()=>setup(async x=>{
 const p=propose(x.g,1,2);const privateId=x.g.semanticCandidates({domain:'main-session',limit:3200}).find(e=>e.bvid===bv(5)).id
 const invalid=[{...p,type:'emotion'},{...p,sources:[{...p.sources[0],quote:'编造的完全不存在描述'},p.sources[1]]},{...p,sources:[{...p.sources[0],text:'旧版本内容'},p.sources[1]]},{...p,sources:[p.sources[0],p.sources[0]]},{...p,sources:[p.sources[0],{...p.sources[1],id:privateId}]}]
 for(const proposal of invalid)assert.equal(add(x.g,[proposal]).rejected,1)
 x.setAccount(B);assert.equal(add(x.g,[p]).ok,false);x.setAccount(A);assert.equal(x.g.status().associations.active,0)
}))
test('bounded two-hop activation, no cycles, no hidden bridge, path revalidation after source deletion',()=>setup(async x=>{
 const a=src(x.g,1),b=src(x.g,2),c=src(x.g,3)
 assert.equal(add(x.g,[propose(x.g,1,2,'context'),propose(x.g,2,3,'contrast')]).added,2)
 const paths=link(x.g,1);assert.deepEqual(paths.map(p=>p.memoryId),[b.id,c.id]);assert.deepEqual(paths[1].types,['context','contrast']);assert.ok(paths[1].score<paths[0].score)
 assert.deepEqual(x.g.associationCandidates({accountTag:A,seedIds:[a.id],eligibleIds:[a.id,c.id]}),[])
 assert.equal(x.g.validateAssociationPath({accountTag:A,...paths[1],types:['concept','contrast']}),false)
 const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==b.id);writeFileSync(x.g.file,JSON.stringify(doc));assert.equal(x.g.validateAssociationPath({accountTag:A,...paths[1]}),false);assert.equal(x.g.status().associations.active,0);assert.deepEqual(JSON.parse(readFileSync(x.g.file,'utf8')).associations,[])
}))
test('relation expires independently; no recall-based revival',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,2,'temporal')]).added,1);const path=link(x.g,1)[0];x.setTime(NOW+61*DAY);assert.equal(x.g.validateAssociationPath({accountTag:A,...path}),false);assert.equal(x.g.status().associations.active,0)
 // Old evidence is not an archive lookup and cannot be restored by reading.
 assert.equal(x.g.status().associations.active,0)
}))
test('actual reflection reuses one model call; optional associations survive zero new insights',()=>setup(async x=>{
 let calls=0;const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),invokeModel:async prompt=>{calls++;assert.match(prompt,/可选关联记忆/);const rows=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);const a=rows.find(r=>r.text.includes(events[0].title)),b=rows.find(r=>r.text.includes(events[1].title));assert.ok(a.associationTime&&b.associationTime);return JSON.stringify({memories:[],associations:[{type:'concept',candidate_ids:[a.id,b.id],evidence_quotes:[events[0].title,events[1].title]}]})},logger:{warn(){}}})
 life.addEvents(events.slice(0,2));const result=await life.reflect({force:true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.created,0);assert.equal(result.associationAdded,1);assert.equal(calls,1);assert.equal(x.g.status().associations.active,1);assert.equal(life.status().recentPublicRun.associationAdded,1)
}))
test('reflection source changes during model call reject the entire stale batch before any writes',()=>setup(async x=>{
 const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),invokeModel:async prompt=>{const rows=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.key!=='assoc-test:2');writeFileSync(x.g.file,JSON.stringify(doc));return JSON.stringify({memories:[],associations:[{type:'concept',candidate_ids:rows.map(r=>r.id),evidence_quotes:[events[0].title,events[1].title]}]})},logger:{warn(){}}})
 life.addEvents(events.slice(0,2));const r=await life.reflect({force:true});assert.equal(r.ok,false);assert.equal(r.failureCode,'reflection-validation-failed');assert.equal(life.status().pending,2);assert.equal(x.g.status().associations.active,0)
}))
test('unified visual retrieval uses persisted relation only in association-enabled scene and revalidates proof',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(query,o)=>x.g.recall({query,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 const input={accountTag:A,bvids:[bv(1)],limit:2,recentFallback:false}
 const direct=await retriever.contextualVisualRecall({...input,associate:false});assert.equal(direct.length,1)
 const rows=await retriever.contextualVisualRecall({...input,associate:true});assert.equal(rows.length,2);assert.equal(rows[1].bvid,bv(3));assert.deepEqual(rows[1].associationProof.types,['contrast']);assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows}),true)
 const projection=publicVisualAssociationContext(rows);assert.equal(projection[1].associationBasis,'historical-model-proposed-relation');assert.ok(!Object.hasOwn(projection[1],'associationProof'))
 assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows:[rows[0],{...rows[1],associationProof:{...rows[1].associationProof,types:['context']}}]}),false)
 x.setAccount(B);assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows}),false)
}))

test('cross-batch reflection considers previously reviewed clear evidence without another call or ordinary insight pollution',()=>setup(async x=>{
 let calls=0,commits=[];const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:rows=>{commits.push(rows);return {added:0,rows:[]}},invokeModel:async prompt=>{
  calls++;const current=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);if(calls===1){assert.ok(!prompt.includes('<association_history>'));return JSON.stringify({memories:[]})}
  const history=JSON.parse(prompt.split('<association_history>').at(-1).split('</association_history>')[0]);assert.equal(history.length,2);assert.ok(history.every(h=>h.evidenceCoverage==='complete'&&h.associationTime));assert.equal(current.length,1);assert.ok(!history.some(h=>h.text.includes('另一个账号')||h.text.includes('主人私密')))
  const a=current[0],b=history.find(h=>h.text.includes(events[0].title)),c=history.find(h=>h.text.includes(events[1].title));return JSON.stringify({memories:[{candidate_ids:[b.id],insight:'我发现过去的经历很有意义',behavior:'以后我会继续观察生活细节',kind:'experience'}],trait_proposals:[{trait:'curiosity',direction:1,candidate_ids:[b.id]}],associations:[{type:'concept',candidate_ids:[a.id,b.id],evidence_quotes:[events[2].title,events[0].title]},{type:'context',candidate_ids:[b.id,c.id],evidence_quotes:[events[0].title,events[1].title]}]})
 },logger:{warn(){}}})
 life.addEvents(events.slice(0,2));assert.equal((await life.reflect({force:true})).ok,true);life.addEvents([events[2]]);const r=await life.reflect({force:true});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.associationHistoryInput,2);assert.equal(r.modelInput,1);assert.equal(r.processed,1);assert.equal(r.associationAdded,1);assert.equal(r.qualityAccepted,0);assert.equal(calls,2);assert.deepEqual(commits,[[],[]]);assert.equal(x.g.status().associations.active,1);assert.equal(life.status().recentPublicRun.associationHistoryInput,2)
}))
test('historical association evidence forgotten during the second model call is not resurrected',()=>setup(async x=>{
 let calls=0;const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),invokeModel:async prompt=>{
  if(++calls===1)return JSON.stringify({memories:[]});const current=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]),history=JSON.parse(prompt.split('<association_history>').at(-1).split('</association_history>')[0]);const old=history.find(r=>r.text.includes(events[0].title));const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.key!=='assoc-test:1');writeFileSync(x.g.file,JSON.stringify(doc));return JSON.stringify({memories:[],associations:[{type:'concept',candidate_ids:[current[0].id,old.id],evidence_quotes:[events[2].title,events[0].title]}]})
 },logger:{warn(){}}});life.addEvents(events.slice(0,2));await life.reflect({force:true});life.addEvents([events[2]]);const r=await life.reflect({force:true});assert.equal(r.ok,true);assert.equal(r.associationAdded,0);assert.equal(r.associationRejected,1);assert.equal(x.g.status().associations.active,0)
}))

test('historical candidate sample is bounded, current-account only, complete, and never uses candidate metadata',()=>setup(async x=>{
 const old=events.slice(0,2).map(e=>({...reflectionTest.normalizeCandidate(e,NOW),status:'reviewed',text:'伪造历史候选正文'}));const foreign=reflectionTest.normalizeCandidate(events[3],NOW),owner=reflectionTest.normalizeCandidate(events[4],NOW);const pointers=[...old,{...foreign,status:'reviewed'},{...owner,status:'reviewed'}];const e=x.g.reflectionEvidence(['assoc-test:3'])[0];const batch=[{id:'c-new',key:'assoc-test:3',associationStage:'clear',evidenceCoverage:'complete'}],byKey=new Map([[batch[0].key,e]]);
 const result=reflectionTest.historicalAssociationRows(pointers,batch,byKey,x.g);assert.equal(result.length,2);assert.ok(result.every(r=>!r.text.includes('伪造')&&!r.text.includes('另一个账号')&&!r.text.includes('主人私密')));assert.ok(result.every(r=>r.source.visibility==='public-event'));
 x.setAccount(B);const next=reflectionTest.historicalAssociationRows(pointers,batch,byKey,x.g);assert.equal(next.length,1);assert.match(next[0].text,/另一个账号/);
 const fakePointers=Array.from({length:110},(_,i)=>({id:'c-'+i,key:'key-'+i,kind:'watch',visibility:'public-event',status:'reviewed'}));let looked=0;const gateway={reflectionEvidence:keys=>{looked=keys.length;return keys.map((key,i)=>({key,id:'e-'+i,visibility:'public-event',kind:'watch',stage:'clear',at:NOW,text:'证据'.repeat(300)}))}};const bounded=reflectionTest.historicalAssociationRows(fakePointers,batch,byKey,gateway);assert.equal(looked,96);assert.equal(bounded.length,4);assert.ok(bounded.reduce((n,r)=>n+r.text.length+180,0)<=3200)
}))

test('semantic history can select beyond the old 96 pointer sample, never rank missing/private/foreign rows, keeps budget',()=>setup(async x=>{
 const old=Array.from({length:130},(_,i)=>({id:'c-'+i,key:'key-'+i,kind:'watch',visibility:'public-event',status:'reviewed'}));const batch=[{id:'c-new',key:'new',associationStage:'clear',evidenceCoverage:'complete'}],source={id:'e-new',text:'本次证据',visibility:'public-event',stage:'clear'},byKey=new Map([['new',source]]);
 const gateway={reflectionEvidence:keys=>keys.filter(k=>k!=='key-0').map(k=>({key:k,id:'e-'+k,visibility:k==='key-1'?'owner-private':'public-event',kind:'watch',stage:k==='key-2'?'fuzzy':'clear',at:NOW,text:'有效的历史证据'+k}))};
 const baseline=reflectionTest.historicalAssociationRows(old,batch,byKey,gateway);let picked='';const result=reflectionTest.historicalAssociationRows(old,batch,byKey,gateway,(seeds,rows)=>{assert.deepEqual(seeds,[source]);assert.equal(rows.length,127);assert.ok(rows.every(r=>r.stage==='clear'&&r.visibility==='public-event'));picked=rows.at(-1).id;return {ready:true,indexed:rows.length,items:[{id:'episode:e-key-0',score:1},{id:'episode:'+picked,score:.9}]}});
 assert.equal(result[0].source.id,picked);assert.equal(result.semanticCount,1);assert.equal(result.indexed,127);assert.equal(result.length,4);assert.ok(!baseline.some(r=>r.source.id===picked));assert.ok(result.reduce((n,r)=>n+r.text.length+180,0)<=3200);
}))

test('asynchronous local history ranking revalidates source before the public model and records true selected count',()=>setup(async x=>{
 let calls=0,rankCalls=0;const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),rankAssociationHistory:async(seeds,history)=>{rankCalls++;assert.equal(seeds.length,1);assert.equal(history.length,2);const deleted=history.find(e=>e.key==='assoc-test:1'),kept=history.find(e=>e.key==='assoc-test:2');const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==deleted.id);writeFileSync(x.g.file,JSON.stringify(doc));return {ready:true,indexed:2,items:[{id:'episode:'+deleted.id,score:1},{id:'episode:'+kept.id,score:.9}]}},invokeModel:async prompt=>{if(++calls===1)return JSON.stringify({memories:[]});const history=JSON.parse(prompt.split('<association_history>').at(-1).split('</association_history>')[0]);assert.equal(history.length,1);assert.match(history[0].text,/旧车站/);assert.ok(!history[0].text.includes(events[0].title));return JSON.stringify({memories:[]})},logger:{warn(){}}});life.addEvents(events.slice(0,2));assert.equal((await life.reflect({force:true})).ok,true);life.addEvents([events[2]]);const r=await life.reflect({force:true});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.associationSemanticInput,1);assert.equal(r.associationHistoryInput,1);assert.equal(rankCalls,1);assert.equal(calls,2);assert.equal(life.status().recentPublicRun.associationSemanticInput,1)
}))


test('real public visual recall returns a bounded activation receipt; graph projects only live paths, never raw identities',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(query,o)=>x.g.recall({query,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 let tag=A,clock=NOW;const tracker=createNeuralActivationTracker({getAccountTag:()=>tag,validateRecall:o=>retriever.validateContextualVisualRecall(o),validatePath:o=>x.g.validateAssociationPath(o),now:()=>clock})
 const input={accountTag:A,bvids:[bv(1)],limit:2,recentFallback:false};assert.equal(tracker.read(A),null)
 const direct=await retriever.contextualVisualRecall({...input,associate:false});assert.equal(tracker.record({accountTag:A,rows:direct}),false);assert.equal(tracker.diagnostic(A).state,'no-association')
 const rows=await retriever.contextualVisualRecall({...input,associate:true});assert.equal(rows[1].recallRoute,'association');assert.equal(tracker.record({accountTag:B,rows}),false)
 const forged=[rows[0],{...rows[1],associationProof:{...rows[1].associationProof,types:['context']}}];assert.equal(tracker.record({accountTag:A,rows:forged}),false);assert.equal(tracker.diagnostic(A).state,'rejected')
 assert.equal(tracker.record({accountTag:A,rows}),true);assert.equal(tracker.record({accountTag:A,rows}),false)
 const receipt=tracker.read(A);assert.equal(tracker.diagnostic(A).state,'verified');assert.equal(tracker.diagnostic(A).verified,1);assert.equal(receipt.at,NOW);assert.ok(!JSON.stringify(receipt).includes(events[0].title));assert.deepEqual(receipt.types,['contrast'])
 const episodes=x.g.videoRecallGroups(x.g.semanticCandidates({domain:'main-session',limit:3200}));const steps=x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes});const projected=projectNeuralActivation(receipt,steps,episodes)
 assert.equal(projected.steps.length,1);assert.equal(projected.steps[0].associationType,'contrast');assert.ok(!JSON.stringify(projected).includes(receipt.fromId));assert.ok(!JSON.stringify(projected).includes(A));assert.ok(!JSON.stringify(projected).includes(receipt.edgeIds[0]));
 const graph=memoryNeuralProjection({episodes,showAll:true,limit:10000,verifiedGraph:x.g.neuralEvidenceSnapshot({accountTag:A,episodeRows:episodes})});const step=projected.steps[0];assert.ok(graph.edges.some(e=>e.type==='association'&&e.associationType===step.associationType&&[e.from,e.to].includes(step.from)&&[e.from,e.to].includes(step.to)))
 assert.deepEqual(x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:[]}),[]);assert.equal(projectNeuralActivation(receipt,[],episodes),null)
 // After 24 hours, account changes or forgetting, nothing can be replayed.
 clock=NOW+86400000;assert.equal(tracker.read(A),null);assert.equal(tracker.diagnostic(A).state,'expired');clock=NOW;assert.equal(tracker.record({accountTag:A,rows:[...rows]}),true);tag=B;assert.equal(tracker.read(B),null);assert.equal(tracker.diagnostic(B).observed,0);tag=A;assert.equal(tracker.read(A),null)
 assert.equal(tracker.record({accountTag:A,rows:[...rows]}),true);const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==receipt.memoryId);writeFileSync(x.g.file,JSON.stringify(doc));assert.equal(tracker.read(A),null);assert.deepEqual(x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes}),[])
}))

test('two-hop path projection preserves actual order; no invented bridge or private representative',()=>setup(x=>{
 assert.equal(add(x.g,[propose(x.g,1,2,'context'),propose(x.g,2,3,'contrast')]).added,2)
 const path=link(x.g,1).find(p=>p.memoryId===src(x.g,3).id);const receipt={...path,accountTag:A,at:NOW,id:'receipt'}
 const episodes=x.g.videoRecallGroups(x.g.semanticCandidates({domain:'main-session',limit:3200}));const steps=x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes});assert.deepEqual(steps.map(p=>p.type),['context','contrast']);assert.equal(steps[0].to,steps[1].from)
 const projected=projectNeuralActivation(receipt,steps,episodes);assert.equal(projected.steps[0].to,projected.steps[1].from)
 assert.equal(projectNeuralActivation(receipt,steps.slice().reverse(),episodes),null)
 assert.deepEqual(x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes.filter(e=>e.id!==src(x.g,2).id)}),[])
 x.setAccount(B);assert.deepEqual(x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes}),[])
}))


test('release compatibility: existing association identities survive both schema-2 backups and reopen, without cross-account activation',()=>setup(async x=>{
 const p=propose(x.g,1,2);assert.equal(add(x.g,[p]).added,1)
 const before=JSON.parse(readFileSync(x.g.file,'utf8')).associations
 const business=createBackup({root:x.dir,config:{},version:'2.8.3-dev.12'})
 const memory=createLifeMemoryBackup(x.dir)
 for(const [bundle,restore] of [[business,restoreBackupFiles],[memory,restoreLifeMemoryBackup]]){
  const dest=mkdtempSync(join(tmpdir(),'dsh-assoc-upgrade-'))
  let restored,tag=A
  try{
   restore(dest,bundle);restored=createLifeMemoryGateway({dataDir:dest,getConfig:()=>cfg,getAccountTag:()=>tag,now:()=>NOW})
   assert.deepEqual(JSON.parse(readFileSync(restored.file,'utf8')).associations,before)
   assert.equal(restored.status().associations.active,1)
   assert.equal(link(restored,1)[0].memoryId,src(restored,2).id)
   tag=B;assert.equal(restored.status().associations.active,0)
   assert.deepEqual(restored.associationCandidates({accountTag:A,seedIds:before[0].ends,eligibleIds:before[0].ends,limit:2}),[])
  }finally{restored?.close();rmSync(dest,{recursive:true,force:true})}
 }
}))

test('owner and friend on-demand public recalls publish the same verified path, never private text or an actor identity',()=>setup(async x=>{
 const {createSocialContextAssembler}=await import('../lib/social-context-assembler.mjs')
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(q,o)=>x.g.recall({query:q,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 let epoch=1,role='friend',tag=A,calls=0
 const tracker=createNeuralActivationTracker({getAccountTag:()=>tag,getEpoch:()=>epoch,validateRecall:o=>retriever.validateContextualVisualRecall(o),validatePath:o=>x.g.validateAssociationPath(o),now:()=>NOW})
 const q=events[0].title,opts={accountTag:A,isCurrent:()=>tag===A&&epoch===1,limit:6,onVisualRecall:rows=>{calls++;assert.equal(tracker.record({accountTag:A,rows,channel:'owner-dm'}),true)}}
 const owner=await retriever.ownerContextualSearch([q],opts)
 assert.equal(owner.ok,true);assert.ok(owner.items.some(e=>e.summary.includes(bv(3))));assert.equal(calls,1);assert.equal(tracker.read(A).channel,'owner-dm')
 await retriever.ownerContextualSearch([q],{...opts,limit:1});assert.equal(calls,1,'truncated endpoint must not publish')
 const policy={actor:()=>({role}),memoryScope:()=> 'public',canViewIdentity:()=>false,canViewRelationship:()=>false}
 let privateRead=async()=> '仅私信上下文文字'
 const assembler=createSocialContextAssembler({policy,memoryRetriever:retriever,getAccountTag:()=>tag,getAccountEpoch:()=>epoch,getPrivateLifeContext:(...args)=>privateRead(...args),onVisualRecall:({accountTag,rows})=>{calls++;assert.equal(tracker.record({accountTag,rows,channel:'friend-dm'}),true)},logger:{warn(){}}})
 const input={uid:'123456789',kind:'dm',text:q,recallQueries:[q],timestampMs:NOW+1}
 const run=extra=>assembler.message({...input,...extra},{mode:'compact',requested:['memory']})
 const dm=await run({});assert.match(dm.memoryContext,new RegExp(bv(3)));assert.equal(calls,2)
 const receipt=tracker.read(A);assert.equal(receipt.channel,'friend-dm');assert.doesNotMatch(JSON.stringify(receipt),/123456789|仅私信上下文文字|雨后的城市街道/)
 const episodes=x.g.videoRecallGroups(x.g.semanticCandidates({domain:'main-session',limit:3200}));const projected=projectNeuralActivation(receipt,x.g.associationActivationSteps({accountTag:A,receipt,episodeRows:episodes}),episodes)
 assert.equal(projected.channel,'friend-dm');assert.doesNotMatch(JSON.stringify(projected),/123456789|仅私信上下文文字/)
 await run({privacyGuard:true});assert.equal(calls,2)
 await assembler.message(input,{mode:'compact',requested:[]});assert.equal(calls,2)
 role='stranger';await run({});assert.equal(calls,2);role='friend'
 privateRead=async()=>{epoch++;return 'scope changed'}
 const stale=await run({});assert.equal(stale.memoryContext,'');assert.equal(calls,2);assert.equal(tracker.read(A),null,'same account but changed binding generation')
}))

test('main chat uses explicit visual recall only, verified receipt source stays bounded; epoch invalidates even same account',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(q,o)=>x.g.recall({query:q,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 const rows=await retriever.contextualVisualRecall({accountTag:A,queries:[events[0].title],limit:2,associate:true,recentFallback:false})
 assert.equal(rows.length,2);assert.equal(rows[1].recallRoute,'association')
 let epoch=1;const tracker=createNeuralActivationTracker({getAccountTag:()=>A,getEpoch:()=>epoch,validateRecall:o=>retriever.validateContextualVisualRecall(o),validatePath:o=>x.g.validateAssociationPath(o),now:()=>NOW})
 assert.equal(tracker.record({accountTag:A,rows,channel:'arbitrary text'}),false)
 assert.equal(tracker.record({accountTag:A,rows,channel:'main-chat'}),true);assert.equal(tracker.read(A).channel,'main-chat')
 epoch++;assert.equal(tracker.read(A),null)
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const main=code.slice(code.indexOf('getVideoAssociationRecall:async (query'),code.indexOf('getVideoDetailRecall:',code.indexOf('getVideoAssociationRecall:async (query')))
 assert.match(main,/associate:true,recentFallback:false/);assert.match(main,/!isCurrent\(\)\|\|epoch!==accountBinding\.generation\(\)/);assert.match(main,/observePublicRecall\(scope,rows,'main-chat'\)/)
 assert.match(code,/onVisualRecall:rows=>\{if\(isCurrent\(\)\)observePublicRecall\(scope,rows,'owner-dm'\)\}/)
 assert.match(code,/onVisualRecall:\(\{accountTag,rows\}\)=>observePublicRecall\(accountTag,rows,'friend-dm'\)/)
}))

test('real immediate second search yields transient dashed path; no persistent edge, no forged proof, expires or revokes',()=>setup(async x=>{
 const other=watch(6,'雨后的城市街道与路灯倒影');x.g.recordEvents([other])
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(q,o)=>x.g.recall({query:q,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 const rows=await retriever.contextualVisualRecall({accountTag:A,bvids:[bv(1)],limit:2,associate:true,recentFallback:false})
 assert.equal(rows.length,2,JSON.stringify(rows));assert.equal(rows[1].bvid,bv(6));assert.ok(rows[1].immediateProof);assert.equal(rows[1].associationProof,undefined)
 assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows}),true)
 const projection=publicVisualAssociationContext(rows);assert.equal(projection[1].associationBasis,undefined);assert.ok(!Object.hasOwn(projection[1],'immediateProof'))
 let clock=NOW,epoch=1;const tracker=createNeuralActivationTracker({getAccountTag:()=>A,getEpoch:()=>epoch,validateRecall:o=>retriever.validateContextualVisualRecall(o),validatePath:o=>x.g.validateAssociationPath(o),validateImmediate:o=>retriever.validateImmediateRecall(o),now:()=>clock})
 const fake=[rows[0],{...rows[1],immediateProof:{...rows[1].immediateProof}}];assert.equal(tracker.record({accountTag:A,rows:fake}),false)
 const {immediateProof:discarded,...unproved}=rows[1];assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows:[rows[0],unproved]}),false);assert.equal(retriever.validateContextualVisualRecall({accountTag:A,rows:[rows[1]]}),false)
 assert.equal(tracker.record({accountTag:A,rows,channel:'main-chat'}),true);const r=tracker.read(A);assert.equal(r.mode,'immediate');assert.deepEqual(r.edgeIds,[]);assert.doesNotMatch(JSON.stringify(r),/雨后|路灯/)
 const episodes=x.g.videoRecallGroups(x.g.semanticCandidates({domain:'main-session',limit:3200}));const steps=x.g.associationActivationSteps({accountTag:A,receipt:r,episodeRows:episodes});const projected=projectNeuralActivation(r,steps,episodes);assert.equal(projected.mode,'immediate');assert.equal(projected.steps[0].associationType,'immediate');assert.doesNotMatch(JSON.stringify(projected),new RegExp(r.fingerprint+'|'+r.fromId+'|'+A))
 assert.equal(x.g.status().associations.active,0);const graph=memoryNeuralProjection({episodes,showAll:true,limit:10000,verifiedGraph:x.g.neuralEvidenceSnapshot({accountTag:A,episodeRows:episodes})});assert.ok(!graph.edges.some(e=>e.type==='association'))
 assert.deepEqual(x.g.associationActivationSteps({accountTag:A,receipt:r,episodeRows:[]}),[])
 clock+=300000;assert.equal(tracker.read(A).id,r.id);assert.equal(tracker.reflectionHints(A).length,1);clock=NOW+86400000;assert.equal(tracker.read(A),null);clock=NOW+300000
 epoch++;assert.deepEqual(tracker.reflectionHints(A),[]);assert.equal(tracker.record({accountTag:A,rows:[...rows]}),true)
 const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==r.memoryId);writeFileSync(x.g.file,JSON.stringify(doc));assert.equal(tracker.read(A),null);assert.deepEqual(tracker.reflectionHints(A),[])
}))

test('immediate recall prioritizes a live reviewed endpoint in existing reflection, only a model proposal can persist it',()=>setup(async x=>{
 const other=watch(6,'雨后的城市街道与路灯倒影');x.g.recordEvents([other]);const a=src(x.g,1),b=x.g.reflectionEvidence([other.key])[0]
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(q,o)=>x.g.recall({query:q,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o)})
 const tracker=createNeuralActivationTracker({getAccountTag:()=>A,validateRecall:o=>retriever.validateContextualVisualRecall(o),validateImmediate:o=>retriever.validateImmediateRecall(o),now:()=>NOW})
 let calls=0;const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),getAssociationHints:()=>tracker.reflectionHints(A),rankAssociationHistory:()=>({ready:true,indexed:2,items:[{id:'episode:'+src(x.g,2).id,score:.99}]}),invokeModel:async prompt=>{
  calls++;if(calls===1)return JSON.stringify({memories:[]})
  const history=JSON.parse(prompt.split('<association_history>').at(-1).split('</association_history>')[0]),current=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);assert.ok(history[0].text.includes(events[0].title));assert.equal(current.length,1);assert.equal(x.g.status().associations.active,0)
  return JSON.stringify({memories:[],associations:[{type:'context',candidate_ids:[current[0].id,history[0].id],evidence_quotes:[other.title,events[0].title]}]})
 },logger:{warn(){}}})
 life.addEvents(events.slice(0,2));assert.equal((await life.reflect({force:true})).ok,true)
 const rows=await retriever.contextualVisualRecall({accountTag:A,bvids:[bv(1)],limit:2,associate:true,recentFallback:false});assert.equal(rows[1].memoryId,b.id);assert.equal(tracker.record({accountTag:A,rows}),true);assert.deepEqual(tracker.reflectionHints(A),[{fromId:a.id,memoryId:b.id}]);assert.equal(x.g.status().associations.active,0)
 life.addEvents([other]);const result=await life.reflect({force:true});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.associationAdded,1);assert.equal(calls,2);assert.equal(x.g.status().associations.active,1)
}))

// Real retrieval + tracker + reviewed candidates; model alone decides whether
// to retain a relation. No old candidate is reset or fed to insight generation.
async function reviewedPairFixture(x,decide,{config={},clock=NOW}={}){
 const other=watch(6,'雨后的城市街道与路灯倒影');x.g.recordEvents([other])
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(q,o)=>x.g.recall({query:q,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 let at=clock,epoch=0,tag=A,calls=0,insights=0,moods=0,traits=0
 const settings={...cfg,...config},tracker=createNeuralActivationTracker({getAccountTag:()=>tag,getEpoch:()=>epoch,validateRecall:o=>retriever.validateContextualVisualRecall(o),validateImmediate:o=>retriever.validateImmediateRecall(o),now:()=>at})
 const life=createLifeReflection({dataDir:x.dir,getConfig:()=>settings,getAccountTag:()=>tag,memoryGateway:x.g,now:()=>at,commitMemories:()=>{insights++;return {added:0,rows:[]}},onEmotion:()=>{moods++},getPersonalityEnabled:()=>true,onPersonalityObservations:()=>{traits++},getAssociationHints:()=>tracker.reflectionHints(tag),claimAssociationHint:(t,h)=>tracker.claimReflectionHint(t,h),validateAssociationClaim:c=>tracker.validateReflectionClaim(c),invokeModel:async prompt=>{calls++;if(!prompt.includes('【旧记忆联想评估】'))return JSON.stringify({memories:[]});const rows=JSON.parse(prompt.split('<association_history>')[1].split('</association_history>')[0]);assert.equal(rows.length,2);return decide(rows,{switchAwayAndBack:()=>{epoch+=2},settings,life})},logger:{warn(){}}})
 life.addEvents([events[0],other]);assert.equal((await life.reflect({force:true})).ok,true)
 const recall=async()=>{const rows=await retriever.contextualVisualRecall({accountTag:A,bvids:[bv(1)],limit:2,associate:true,recentFallback:false});assert.equal(rows[1]?.bvid,bv(6));return tracker.record({accountTag:A,rows})}
 assert.equal(await recall(),true)
 const proposal=rows=>JSON.stringify({associations:[{type:'context',candidate_ids:rows.map(r=>r.id),evidence_quotes:rows.map(r=>r.text.includes(other.title)?other.title:events[0].title)}]})
 return {life,tracker,settings,recall,proposal,setTime:t=>{at=t;x.setTime(t)},counts:()=>({calls,insights,moods,traits})}
}
test('two already reviewed episodes get one relation-only model turn under normal interval, unchanged old candidates and no growth side effects',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,rows=>f.proposal(rows));const before=JSON.parse(readFileSync(f.life.file,'utf8')).candidates
 assert.equal(f.life.status().pending,0);assert.equal(f.life.status().associationReviewPending,true);assert.equal(f.life.status().canAutoReflect,false);assert.equal(f.life.status().autoReflectBlockedReason,'interval')
 assert.equal((await f.life.reflect()).skipped,'interval');f.setTime(NOW+3600001);assert.equal(f.life.status().canAutoReflect,true)
 const r=await f.life.reflect();assert.equal(r.associationAdded,1,JSON.stringify(r));assert.equal(r.associationOnly,true);assert.equal(x.g.status().associations.active,1);assert.deepEqual(JSON.parse(readFileSync(f.life.file,'utf8')).candidates,before)
 assert.deepEqual(f.counts(),{calls:2,insights:1,moods:0,traits:1});assert.equal(f.life.status().associationReviewPending,false);assert.equal(f.life.status().recentAssociationRun.added,1);assert.equal(f.life.status().recentPublicRun.processed,2)
 assert.equal((await f.life.reflect({force:true})).processed,0);assert.equal(f.counts().calls,2)
}))
test('old relation review respects quota/disabled auto; declined pair is not retried on repeated recall',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,()=>JSON.stringify({associations:[]}),{config:{mainSessionReflectionDailyBatches:1}});f.setTime(NOW+3600001)
 f.settings.mainSessionReflectionAuto=false;assert.equal((await f.life.reflect()).skipped,'manual');f.settings.mainSessionReflectionAuto=true
 const r=await f.life.reflect();assert.equal(r.diagnosis,'association-no-relation');assert.equal(f.life.status().runsToday,1);assert.equal(await f.recall(),true);assert.equal(f.life.status().associationReviewPending,false);assert.equal(x.g.status().associations.active,0);assert.equal(f.counts().calls,2)
}))
test('old relation review rejects scope generation changes even when account returns to same value',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,(rows,ctx)=>{ctx.switchAwayAndBack();return f.proposal(rows)});const r=await f.life.reflect({force:true});assert.equal(r.skipped,'association-source-changed');assert.equal(x.g.status().associations.active,0);assert.equal(f.life.status().associationReviewPending,false);assert.deepEqual(f.counts(),{calls:2,insights:1,moods:0,traits:1})
}))
test('old relation malformed model output consumes existing slot without applying insights or retrying',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,()=>JSON.stringify({associations:[],memories:[{insight:'不应写入'}],mood_update:{mood:'joyful',intensity:3}}));f.setTime(NOW+3600001);const r=await f.life.reflect();assert.equal(r.skipped,'association-review-failed');assert.equal(f.life.status().failedRunsToday,1);assert.equal(f.life.status().associationReviewPending,false);assert.equal(await f.recall(),true);assert.equal(f.life.status().associationReviewPending,false);assert.equal(x.g.status().associations.active,0);assert.deepEqual(f.counts(),{calls:2,insights:1,moods:0,traits:1})
}))
test('ordinary new batch has priority over old relation-only review; source deletion before review cancels',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,()=>{throw Error('old model must not run')});f.life.addEvents(events.slice(1,3));f.setTime(NOW+3600001);const r=await f.life.reflect();assert.equal(r.processed,2);assert.equal(f.counts().calls,2);assert.equal(f.life.status().associationReviewPending,true)
 const d=JSON.parse(readFileSync(x.g.file,'utf8'));d.episodes=d.episodes.filter(e=>e.key!=='assoc-test:6');writeFileSync(x.g.file,JSON.stringify(d));assert.equal(f.life.status().associationReviewPending,false);assert.equal((await f.life.reflect({force:true})).processed,0)
}))
test('old relation review refuses forged evidence; new ordinary batch can exhaust the shared daily limit',()=>setup(async x=>{
 const f=await reviewedPairFixture(x,rows=>JSON.stringify({associations:[{type:'concept',candidate_ids:rows.map(r=>r.id),evidence_quotes:['从未出现的伪造文字','从未出现的伪造文字']}]}),{config:{mainSessionReflectionDailyBatches:1}})
 f.life.addEvents(events.slice(1,3));f.setTime(NOW+3600001);assert.equal((await f.life.reflect()).processed,2);f.setTime(NOW+7200002);assert.equal(f.life.status().autoReflectBlockedReason,'daily-limit');assert.equal((await f.life.reflect()).skipped,'daily-limit');assert.equal(f.counts().calls,2)
 const r=await f.life.reflect({force:true});assert.equal(r.associationRejected,1);assert.equal(x.g.status().associations.active,0)
}))

test('ordinary public reflection retains concurrently arriving candidates and rejects changed account generation before writes',()=>setup(async x=>{
 let epoch=0,commits=0,moods=0,traits=0,stage=0
 const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,getAccountEpoch:()=>epoch,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>{commits++;return {added:0,rows:[]}},onEmotion:()=>{moods++},getPersonalityEnabled:()=>true,onPersonalityObservations:()=>{traits++},invokeModel:async()=>{
  if(stage===0){life.addEvents([events[2]]);return JSON.stringify({memories:[]})}
  epoch+=2;return JSON.stringify({memories:[],mood_update:{mood:'joyful',intensity:2}})
 },logger:{warn(){}}})
 life.addEvents(events.slice(0,2));const first=await life.reflect({force:true});assert.equal(first.ok,true);assert.equal(first.pending,1);assert.equal(life.list('pending')[0].key,events[2].key)
 stage=1;const second=await life.reflect({force:true});assert.equal(second.ok,false);assert.equal(life.status().pending,1);assert.equal(commits,1);assert.equal(moods,0);assert.equal(traits,1)
}))

test('ordinary reflection receives per-interaction emotion receipts and can propose a genuine sixth relation without extra model calls',()=>setup(async x=>{
 const a={kind:'social',key:`social:1234:${bv(7)}:12345`,actorUid:'1234',bvid:bv(7),at:NOW-1000,text:'这次讨论的场景很令人愉快',accountTag:A},b={...a,key:`social:4321:${bv(8)}:12346`,actorUid:'4321',bvid:bv(8),text:'这次交流里的发现非常有趣'}
 x.g.recordEvents([a,b]);for(const e of [a,b])assert.equal(x.g.recordEpisodeEmotion({accountTag:A,eventKey:e.key,mood:'joyful',intensity:2,at:NOW}).ok,true)
 let calls=0;const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),invokeModel:async prompt=>{calls++;const rows=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.associationEmotion?.mood==='joyful'));return JSON.stringify({memories:[],associations:[{type:'emotion',candidate_ids:rows.map(r=>r.id),evidence_quotes:[a.text,b.text]}]})},logger:{warn(){}}})
 life.addEvents([a,b]);const r=await life.reflect({force:true});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.associationAdded,1);assert.equal(calls,1);assert.equal(x.g.status().associations.active,1)
}))


test('24h recall history is bounded, selectable, separates ordinary observations, and invalidates forgotten paths',()=>{
 let clock=NOW,epoch=1,tag=A,live=true
 const tracker=createNeuralActivationTracker({getAccountTag:()=>tag,getEpoch:()=>epoch,now:()=>clock,validateRecall:()=>true,validatePath:()=>live})
 const rows=()=>[{memoryId:'seed',recallRoute:'direct'},{memoryId:'target',recallRoute:'association',associationProof:{fromId:'seed',memoryId:'target',edgeIds:['edge'],types:['concept']}}]
 for(let i=0;i<23;i++){clock++;assert.equal(tracker.record({accountTag:A,rows:rows(),channel:'main-chat'}),true)}
 const recent=tracker.recent(A);assert.equal(recent.paths.length,20);assert.equal(recent.activities.length,20);const selected=recent.paths.at(-1).id
 assert.equal(tracker.read(A,selected).id,selected);assert.equal(tracker.read(A,'not-found'),null)
 assert.equal(tracker.recordPublicEpisodes({accountTag:A,ids:['seed']}),true);assert.equal(tracker.diagnostic(A).state,'ordinary-recall');assert.equal(tracker.diagnostic(A).verified,23)
 assert.equal(tracker.recent(A).activities[0].state,'ordinary-recall');assert.doesNotMatch(JSON.stringify(tracker.recent(A)),/seed|target|edgeIds|accountTag/)
 live=false;assert.equal(tracker.read(A,selected),null);assert.equal(tracker.recent(A).paths.length,0);assert.ok(tracker.recent(A).activities.some(a=>a.state==='invalidated'))
 live=true;assert.equal(tracker.record({accountTag:A,rows:rows()}),true);epoch++;assert.equal(tracker.recent(A).paths.length,0);assert.equal(tracker.recent(A).activities.length,0)
 tag=B;assert.equal(tracker.read(A),null)
})


test('real recall history survives tracker restart, rechecks live evidence and refuses changed identity/epoch',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 let clock=NOW,epoch=1,identity='character-A';const historyFile=join(x.dir,'neural-recall-activity.json')
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg,getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(query,o)=>x.g.recall({query,...o}),getVisualExperiences:o=>x.g.recentVisualExperienceContext(o),getVisualDetailCandidates:o=>x.g.visualDetailCandidates(o),getAssociations:o=>x.g.associationCandidates(o),validateAssociationPath:o=>x.g.validateAssociationPath(o)})
 const make=()=>createNeuralActivationTracker({historyFile,getHistoryIdentity:()=>identity,getAccountTag:()=>A,getEpoch:()=>epoch,now:()=>clock,validateRecall:o=>retriever.validateContextualVisualRecall(o),validatePath:o=>x.g.validateAssociationPath(o),validateImmediate:o=>retriever.validateImmediateRecall(o)})
 const rows=await retriever.contextualVisualRecall({accountTag:A,bvids:[bv(1)],limit:2,associate:true,recentFallback:false});let t=make();assert.equal(t.record({accountTag:A,rows,channel:'main-chat'}),true)
 const saved=t.read(A);assert.equal(allowedPath('neural-recall-activity.json'),false);assert.doesNotMatch(readFileSync(historyFile,'utf8'),/雨后|纸飞机|BV000|私密/)
 clock+=6*60_000;t=make();assert.equal(t.read(A,saved.id).id,saved.id);assert.equal(t.recent(A).paths.length,1);assert.equal(t.diagnostic(A).observed,0)
 const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==saved.memoryId);writeFileSync(x.g.file,JSON.stringify(doc));assert.equal(t.read(A,saved.id),null);assert.deepEqual(JSON.parse(readFileSync(historyFile,'utf8')).paths,[])
 identity='character-B';t=make();assert.deepEqual(t.recent(A),{paths:[],activities:[]});epoch++;assert.equal(t.read(A),null)
 // Malformed observation cache cannot be taken as a verified path or prevent memory reads.
 writeFileSync(historyFile,'bad json');assert.equal(make().read(A),null);assert.equal(readFileSync(historyFile,'utf8'),'bad json')
}))

test('ordinary explicit recall can deliver one existing public edge within unused quota; manual search does not activate it',()=>setup(async x=>{
 assert.equal(add(x.g,[propose(x.g,1,3,'contrast')]).added,1)
 const a=src(x.g,1),b=src(x.g,3);let calls=0,epoch=1
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>({...cfg,mainSessionMemoryMaxItems:4,mainSessionMemoryMaxChars:3000}),getEpisodeCandidates:o=>x.g.semanticCandidates(o),getEpisodes:(query,o)=>x.g.recall({query,...o}).filter(e=>e.id===a.id),getAssociations:o=>{calls++;return x.g.associationCandidates(o)},validateAssociationPath:o=>x.g.validateAssociationPath(o),getAssociationScope:()=>({accountTag:A,epoch})})
 const ordinary=await retriever.retrieve('雨后的城市街道','chat',{includeSelf:true});assert.ok(ordinary.publicAssociationProof);assert.equal(ordinary.publicAssociationProof.memoryId,b.id);assert.deepEqual(ordinary.episodeIds,[a.id,b.id]);assert.match(ordinary.context,/可选关联经历/);assert.equal(calls,1);assert.equal(ordinary.usedModel,false)
 const tracker=createNeuralActivationTracker({getAccountTag:()=>A,now:()=>NOW,validatePath:o=>x.g.validateAssociationPath(o)})
 assert.equal(tracker.recordPublicEpisodes({accountTag:A,ids:ordinary.episodeIds,proof:ordinary.publicAssociationProof}),true);assert.equal(tracker.read(A).memoryId,b.id)
 assert.equal(tracker.recordPublicEpisodes({accountTag:A,ids:[]}),true);assert.equal(tracker.diagnostic(A).state,'no-hit');assert.equal(tracker.read(A).memoryId,b.id)
 assert.equal(tracker.recordPublicEpisodes({accountTag:A,ids:[a.id],proof:ordinary.publicAssociationProof}),false);assert.equal(tracker.diagnostic(A).state,'rejected')
 const manual=await retriever.retrieve('雨后的城市街道','manual',{includeSelf:true});assert.equal(manual.publicAssociationProof,undefined);assert.equal(calls,1)
 const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.id!==b.id);writeFileSync(x.g.file,JSON.stringify(doc));assert.equal((await retriever.retrieve('雨后的城市街道','chat',{includeSelf:true})).publicAssociationProof,undefined);assert.equal(tracker.read(A),null)
}))
