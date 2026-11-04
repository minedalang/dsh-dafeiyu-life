import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {buildReplyMemeContext,findReplyMemeMatches,createInteractionMemeLookup} from '../lib/interaction-meme-memory.mjs';

const memes=[
  {name:'鱼来',aliases:'牛来、🐟鱼来,召唤大肥鱼',kind:'梗',meaning:'在大肥鱼评论区反复喊鱼来，通常是召唤大肥鱼接梗。',confidence:'有文字依据',review_status:'approved'},
  {name:'饭桶鱼',aliases:'',kind:'梗',meaning:'只是测试不应串到其他用户。',confidence:'有文字依据',review_status:'approved'},
  {name:'没审核的梗',aliases:'',meaning:'未经审核',review_status:'pending'},
  {name:'被拒绝的梗',aliases:'',meaning:'已拒绝',review_status:'rejected'},
  {name:'模糊的梗',aliases:'',meaning:'尚不确定的来源',confidence:'待核实',review_status:'approved'},
];
test('回复时准确检索梗名称及别名、无匹配不注入',()=>{
  assert.match(buildReplyMemeContext({text:'🐟鱼来！🐟鱼来！'},memes),/召唤大肥鱼接梗/);
  assert.match(buildReplyMemeContext({text:'牛来！'},memes),/鱼来/);
  assert.equal(buildReplyMemeContext({text:'今天天气真好'},memes),'');
  assert.equal(buildReplyMemeContext({text:'没审核的梗 和 被拒绝的梗'},memes),'');
  const raw=buildReplyMemeContext({text:'模糊的梗'},memes);
  assert.match(raw,/待核实/);
  assert.match(raw,/不得当作事实/);
});
test('不让无关视频热评触发梗，允许当前楼层直接上文触发',()=>{
  assert.equal(buildReplyMemeContext({text:'你好',context:'本视频热门评论：鱼来，给我饭桶鱼'},memes),'');
  assert.match(buildReplyMemeContext({text:'它是什么？',memeSourceText:'上一层说鱼来鱼来'},memes),/鱼来/);
  assert.match(buildReplyMemeContext({kind:'dm',text:'这是怎么回事',history:[{role:'user',text:'大家都说鱼来'},{role:'assistant',text:'还没查过'}]},memes),/鱼来/);
  assert.equal(findReplyMemeMatches({text:'你好',history:[{role:'assistant',text:'鱼来'}]},memes).length,0);
});
test('批量私信与评论只带各自梗知识，没命中的没有梗',async()=>{
  const received=[];
  const batcher=createInteractionBatcher({delayMs:1,batchSize:3,invoke:async prompt=>{received.push(prompt);const item=JSON.parse(prompt.split('消息：').at(-1))[0];return JSON.stringify({items:[{id:'0',action:item.text.includes('鱼来')||item.text.includes('饭桶鱼')?'reply':'skip',reply:item.uid==='100'?'来啦':'你好'}]})},
    getPersona:()=>'',prepareMemeContexts:async b=>b.map(x=>buildReplyMemeContext(x,memes))});
  try{
    const output=await Promise.all([
      batcher.generate({kind:'comment',uid:'100',text:'鱼来鱼来'}),
      batcher.generate({kind:'dm',uid:'200',text:'饭桶鱼来了'}),
      batcher.generate({kind:'dm',uid:'300',text:'下午好'})
    ]);
    assert.deepEqual(output,['来啦','你好','SKIP']);
    assert.equal(received.length,3);
    const items=received.map(text=>JSON.parse(text.split('消息：').at(-1))[0]);
    assert.match(items[0].memeContext,/鱼来/);
    assert.doesNotMatch(items[0].memeContext,/饭桶鱼/);
    assert.match(items[1].memeContext,/饭桶鱼/);
    assert.doesNotMatch(items[1].memeContext,/鱼来/);
    assert.equal(items[2].memeContext,'');
  }finally{batcher.stop()}
});
test('缓存根据梗库文件修改更新、总开关关闭时不检索',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fish-meme-'));
  try{
    const file=join(dir,'meme-memory.sqlite3');await writeFile(file,'data');
    let enabled=true,loads=0,entries=[memes[0]];
    const lookup=createInteractionMemeLookup({dataDir:dir,isEnabled:()=>enabled,readEntries:async()=>{loads++;return entries},ttlMs:20000});
    assert.match((await lookup.forBatch([{text:'鱼来'}]))[0],/鱼来/);
    assert.match((await lookup.forBatch([{text:'鱼来'}]))[0],/鱼来/);
    assert.equal(loads,1,'数据库没有改动不应反复调用 Python');
    entries=[memes[1]];await writeFile(file,'data-updated-larger');
    assert.equal((await lookup.forBatch([{text:'鱼来'}]))[0],'');
    assert.match((await lookup.forBatch([{text:'饭桶鱼'}]))[0],/饭桶鱼/);
    assert.equal(loads,2,'SQLite 文件变化应更新缓存');
    enabled=false;
    assert.deepEqual(await lookup.forBatch([{text:'饭桶鱼'}]),['']);
    assert.equal(loads,2);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('读取失败不影响互动 AI 继续生成；没有数据库也不会启动检索',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fish-meme-none-'));
  try{
    let loads=0;
    const lookup=createInteractionMemeLookup({dataDir:dir,readEntries:async()=>{loads++;throw Error('broken')},logger:{warn:()=>{}}});
    assert.deepEqual(await lookup.forBatch([{text:'鱼来'}]),['']);
    assert.equal(loads,0);
    await writeFile(join(dir,'meme-memory.sqlite3'),'data');
    assert.deepEqual(await lookup.forBatch([{text:'鱼来'}]),['']);
    assert.equal(loads,1);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('评论自动与人工回复都携带原始父评论，配置与入口均连接',()=>{
  const comment=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8');
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  assert.equal((comment.match(/memeSourceText:x\.context/g)||[]).length,3);
  assert.match(index,/getMeme:async\(item\)=>\(await interactionMemeLookup\.forBatch\(\[item\]\)\)/);
  assert.match(index,/prepareContexts:\(batch,\{mode\}=\{\}\)=>socialContextAssembler\?\.batch\(batch,\{mode\}\)/);
  assert.match(index,/cfg\.memeMemoryEnabled===true/);
});
