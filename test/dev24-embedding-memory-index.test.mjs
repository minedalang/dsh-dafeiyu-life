import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEmbeddingMemoryIndex,visualParentIndexRows,visualCorpusRows} from '../lib/embedding-memory-index.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'

const makeVector=text=>{
  const v=new Float32Array(1024),s=String(text)
  if(/猫|cat|小猫/.test(s))v[0]=1
  if(/歌|音乐|music|song/.test(s))v[1]=1
  if(/计划|project|plan/.test(s))v[2]=1
  if(/query|instruct/i.test(s)&&!/猫|cat|小猫|歌|音乐|music|song|计划|project|plan/.test(s))v[3]=1
  return v
}
const fakeProvider={
  async embedDocuments(texts){return texts.map(makeVector)},
  async embedQuery(text){return makeVector(text)},
}

test('本地向量索引支持持久化、语义排序和当前候选权限边界',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-embedding-index-'))
  try{
    const index=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider})
    assert.equal((await index.initialize()),false)
    const corpus=[
      {id:'memory:cat',text:'鱼鱼以前聊过小猫和猫咪的事情'},
      {id:'memory:music',text:'鱼鱼曾经听过一首歌'},
      {id:'episode:plan',text:'鱼鱼参与过一个长期计划'},
    ]
    const built=await index.rebuild(corpus)
    assert.equal(built.ok,true)
    assert.equal(index.status().indexed,3)
    const result=await index.search('这只猫咪最近怎么样',corpus,{limit:3,minScore:.1})
    assert.equal(result.ready,true)
    assert.equal(result.items[0].id,'memory:cat')
    const narrowed=await index.search('这只猫咪最近怎么样',[corpus[1]],{limit:3,minScore:.1})
    assert.deepEqual(narrowed.items.map(x=>x.id),[])
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('向量索引清单不保存记忆原文；sync 会增量更新并移除已删除 ID',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-embedding-index-'))
  try{
    const index=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider})
    await index.rebuild([{id:'memory:secret',text:'主人不想公开的私人细节'},{id:'memory:old',text:'以前的一段旧经历'}])
    const root=join(dir,'embedding-memory-index'),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'))
    const raw=JSON.stringify(manifest)
    assert.equal(raw.includes('主人不想公开的私人细节'),false)
    assert.equal(raw.includes('以前的一段旧经历'),false)
    assert.equal(manifest.entries.length,2)
    const result=await index.sync([{id:'memory:secret',text:'主人不想公开的私人细节已经更新'},{id:'memory:new',text:'新的一首音乐'}])
    assert.equal(result.ok,true)
    assert.equal(result.indexed,2)
    assert.equal(result.embedded,2)
    const after=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'))
    assert.deepEqual(after.entries.map(x=>x.id).sort(),['memory:new','memory:secret'])
    assert.equal(JSON.stringify(after).includes('主人不想公开的私人细节已经更新'),false)
    const files=await readdir(root)
    assert.equal(files.some(x=>x==='manifest.json'),true)
    const removed=await index.remove(['memory:secret'])
    assert.equal(removed.removed,1)
    const finalManifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'))
    assert.deepEqual(finalManifest.entries.map(x=>x.id),['memory:new'])
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('向量维度错误会使索引构建失败而不标记为 ready',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-embedding-index-'))
  try{
    const index=createEmbeddingMemoryIndex({dataDir:dir,provider:{embedDocuments:async()=>[new Float32Array(3)],embedQuery:async()=>new Float32Array(3)}})
    const result=await index.rebuild([{id:'memory:bad',text:'不合法向量'}])
    assert.equal(result.ok,false)
    assert.equal(index.status().ready,false)
  }finally{await rm(dir,{recursive:true,force:true})}
})


test('Life 记忆进入 forgotten 后通知清理对应本地向量',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-life-forget-'))
  try{
    let clock=Date.parse('2026-01-01T00:00:00.000Z'),removed=[]
    const life=createLifeMemoryGateway({dataDir:dir,now:()=>clock,onEpisodesRemoved:ids=>removed.push(...ids)})
    const key='private:owner-session:aaaaaaaaaaaaaaaaaaaa'
    const saved=life.recordEvents([{kind:'private-social',key,privacyReviewed:true,sensitivity:'low',visibility:'owner-private',subjectUid:'owner',text:'鱼鱼曾有一次需要尊重边界的私密交流'}])
    assert.equal(saved.added,1)
    clock+=200*24*60*60*1000
    const decayed=life.decay()
    assert.ok(decayed.changed>0)
    assert.equal(removed.length,1)
    assert.match(removed[0],/^e-/)
    life.close()
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('删除索引与后台重建串行化，删除后不得恢复旧向量',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-embedding-clear-race-'))
  try{
    let release,markStarted
    const started=new Promise(resolve=>{markStarted=resolve})
    const wait=new Promise(resolve=>{release=resolve})
    const provider={
      async embedDocuments(texts){markStarted();await wait;return texts.map(makeVector)},
      async embedQuery(text){return makeVector(text)},
    }
    const index=createEmbeddingMemoryIndex({dataDir:dir,provider})
    const build=index.rebuild([{id:'memory:old',text:'应该被彻底删除的旧向量'}])
    await started
    const clearing=index.clear()
    release()
    assert.equal((await build).ok,true)
    assert.equal(await clearing,true)
    assert.equal(index.status().ready,false)
    assert.equal(index.status().indexed,0)
    assert.deepEqual(await readdir(join(dir,'embedding-memory-index')),[])
    const restored=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider})
    assert.equal(await restored.initialize(),false)
  }finally{await rm(dir,{recursive:true,force:true})}
})

test('deep derived vectors are explicitly indexed, never lazily recreated by stale query candidates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-visual-vector-'))
 try{
  const index=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider}),deep={id:'visual-detail:e-123456789012345678',text:'画面中的小猫'}
  assert.equal((await index.rebuild([{id:'episode:old',text:'计划'}])).ok,true)
  const ordinary={id:'episode:new',text:'猫咪'}
  assert.ok((await index.search('猫咪',[ordinary,deep],{minScore:.1})).items.some(x=>x.id===ordinary.id))
  assert.equal(index.status().indexed,2)
  await index.upsert([deep]);assert.ok((await index.search('猫咪',[deep],{minScore:.1})).items.some(x=>x.id===deep.id))
  await index.remove([deep.id]);assert.equal((await index.search('猫咪',[deep],{minScore:.1})).items.length,0);assert.equal(index.status().indexed,2)
 }finally{await rm(dir,{recursive:true,force:true})}
})


test('fragment derivatives have independent stable keys, grouped search and atomic parent replacement/removal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-fragment-vectors-'))
 try{
  const index=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider}),a='e-'+'a'.repeat(18),b='e-'+'b'.repeat(18)
  const part=(fragmentId,note)=>({fragmentId,note})
  const A={id:a,text:'室内猫咪',parts:[part('frame-01','小猫靠着门'),part('frame-02','猫咪睡觉')]},B={id:b,text:'另一只猫咪',parts:[part('frame-01','猫咪喝水')]}
  const corpus=visualCorpusRows([A,B]);assert.deepEqual(corpus.map(x=>x.id),['visual-detail:'+a,'visual-detail:'+b,'visual-fragment:'+a+':frame-01','visual-fragment:'+b+':frame-01','visual-fragment:'+a+':frame-02'])
  assert.equal((await index.sync([{id:'episode:'+a,text:'猫咪'},...corpus])).ok,true)
  assert.equal(index.status().visualFragmentsIndexed,3);assert.equal(index.status().visualFragmentsRequestedAtSync,3)
  const result=await index.search('猫咪',corpus,{groupVisualFragments:true,limit:10,minScore:.1,readOnly:true})
  assert.equal(result.items.filter(x=>x.id.startsWith('visual-fragment:'+a+':')).length,1);assert.equal(result.items.filter(x=>x.id.startsWith('visual-fragment:'+b+':')).length,1)
  const changed={...A,parts:[part('frame-03','猫咪坐在木桌上')]}
  assert.equal((await index.replaceVisualParent(a,visualParentIndexRows(changed))).ok,true)
  assert.equal(index.status().visualFragmentsIndexed,2)
  assert.deepEqual((await index.search('猫咪',visualParentIndexRows(A).filter(x=>x.id.startsWith('visual-fragment:')),{minScore:.1})).items,[],'query cannot recreate removed fragment vectors')
  assert.equal((await index.removeVisualParents([a],{includeEpisode:true})).removed,3)
  assert.equal(index.status().visualFragmentsIndexed,1)
  const loaded=createEmbeddingMemoryIndex({dataDir:dir,provider:fakeProvider});assert.equal(await loaded.initialize(),true);assert.equal(loaded.status().visualFragmentsIndexed,1)
  assert.equal((await loaded.search('猫咪',visualParentIndexRows(B),{minScore:.1})).items.length,2)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('existing index capacity protects ordinary memory; unindexed visual fragments cannot crowd out stored search rows',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-fragment-capacity-'))
 try{
  const provider={embedDocuments:async texts=>texts.map(()=>[1,0]),embedQuery:async()=>[1,0]}
  const index=createEmbeddingMemoryIndex({dataDir:dir,dimension:2,provider}),a='e-'+'a'.repeat(18)
  const base=Array.from({length:9999},(_,i)=>({id:'episode:'+i,text:'普通经历'+i})),frag={id:'visual-fragment:'+a+':frame-01',text:'猫咪'}
  assert.equal((await index.sync([...base,frag])).ok,true);assert.equal(index.status().indexed,10000)
  const next={id:'episode:next',text:'新普通经历'};assert.equal((await index.upsert([next])).ok,true);assert.equal(index.status().indexed,10000);assert.equal(index.status().visualFragmentsIndexed,0)
  const unindexed=Array.from({length:10002},(_,i)=>({id:'visual-fragment:'+a+':missing-'+i,text:'不存在的向量'}))
  const result=await index.search('经历',[...unindexed,next],{minScore:.1,readOnly:true})
  assert.deepEqual(result.items.map(x=>x.id),[next.id]);assert.equal(index.status().indexed,10000)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('historical association ranks only supplied current hash-matched episode vectors without embedding again',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-related-'));try{
  let calls=0;const index=createEmbeddingMemoryIndex({dataDir:dir,provider:{embedDocuments:async texts=>{calls++;return texts.map(makeVector)},embedQuery:async()=>{throw Error('no query embedding allowed')}}});
  const row=(n,text)=>({id:'episode:e-'+String(n).padStart(18,'0'),text});const seed=row(1,'猫'),related=row(2,'小猫'),stale=row(3,'猫咪'),foreign=row(4,'猫'),music=row(5,'音乐');
  assert.equal((await index.rebuild([seed,related,stale,foreign,music])).ok,true);const before=calls;
  const result=index.rankRelatedEpisodes([seed],[seed,related,{...stale,text:'已经修改的猫咪'},music]);assert.equal(result.ready,true);assert.equal(result.indexed,3);assert.deepEqual(result.items.map(x=>x.id),[related.id]);assert.equal(calls,before);
  assert.equal(index.rankRelatedEpisodes([{...seed,text:'已变更'}],[related]).ready,false);assert.equal(calls,before);
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('fresh unindexed seed uses exactly one local read-only query without persisting new vectors',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-related-fresh-'));try{
  let docs=0,queries=0;const index=createEmbeddingMemoryIndex({dataDir:dir,provider:{embedDocuments:async texts=>{docs++;return texts.map(makeVector)},embedQuery:async text=>{queries++;return makeVector(text)}}});
  const row=(n,text)=>({id:'episode:e-'+String(n).padStart(18,'0'),text});const seed=row(1,'新遇见的猫'),related=row(2,'小猫'),music=row(3,'音乐'),stale=row(4,'猫');await index.rebuild([related,music,stale]);const before=docs;
  const result=await index.rankRelatedEpisodesWithQuery([seed],[related,music,{...stale,text:'改变后的猫'}]);assert.equal(result.ready,true);assert.equal(result.indexed,2);assert.deepEqual(result.items.map(x=>x.id),[related.id]);assert.equal(queries,1);assert.equal(docs,before);assert.equal(index.status().indexed,3);
  await index.rankRelatedEpisodesWithQuery([seed],[{...stale,text:'改变后的猫'}]);assert.equal(queries,1);
 }finally{await rm(dir,{recursive:true,force:true})}
})
