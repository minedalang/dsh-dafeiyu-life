import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEmbeddingMemoryIndex} from '../lib/embedding-memory-index.mjs'
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
