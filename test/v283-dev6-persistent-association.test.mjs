import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection,__test as reflectionTest} from '../lib/life-reflection.mjs'
import {createMemoryRetriever,publicVisualAssociationContext} from '../lib/memory-retriever.mjs'
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
test('reflection source changes during model call reject association independently of ordinary reflection',()=>setup(async x=>{
 const life=createLifeReflection({dataDir:x.dir,getConfig:()=>cfg,getAccountTag:()=>A,memoryGateway:x.g,now:()=>NOW,commitMemories:()=>({added:0,rows:[]}),invokeModel:async prompt=>{const rows=JSON.parse(prompt.split('<candidate_data>').at(-1).split('</candidate_data>')[0]);const doc=JSON.parse(readFileSync(x.g.file,'utf8'));doc.episodes=doc.episodes.filter(e=>e.key!=='assoc-test:2');writeFileSync(x.g.file,JSON.stringify(doc));return JSON.stringify({memories:[],associations:[{type:'concept',candidate_ids:rows.map(r=>r.id),evidence_quotes:[events[0].title,events[1].title]}]})},logger:{warn(){}}})
 life.addEvents(events.slice(0,2));const r=await life.reflect({force:true});assert.equal(r.ok,true);assert.equal(r.associationAdded,0);assert.equal(x.g.status().associations.active,0)
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
