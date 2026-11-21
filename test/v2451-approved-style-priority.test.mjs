import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';

test('后台评论带已批准的风格记忆和强制风格规则，不会被长背景挤走',async()=>{
 let prompt=''; const batcher=createInteractionBatcher({delayMs:1,invoke:async(x)=>{prompt=x;return JSON.stringify({items:[{id:'0',action:'skip',reply:''}]})},
 getPersona:()=> '【公开评论强制风格】不套表达模板\n【已批准的评论表达习惯】\n- 不先引用再评价\n'+'角色背景 '.repeat(3000)});
 const response=await batcher.generate({kind:'comment',mode:'at',text:'来看看',canSkip:true});
 assert.equal(response,'SKIP');assert.match(prompt,/已批准的评论表达习惯/);assert.match(prompt,/不先引用再评价/);
 batcher.stop();
});
test('主动评论和后台评论均包含禁止泛化填充语的约束',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const batch=readFileSync(new URL('../lib/interaction-batch.mjs',import.meta.url),'utf8');
 assert.match(index,/生成原创主评论时可参考实际读到的热评/);assert.match(index,/不要使用“这个笑死”等泛化情绪填充语/);assert.match(index,/不能虚构热评、画面或字幕/);assert.match(index,/已批准的 style 成长记忆要优先遵守/);
 assert.match(batch,/不要机械插入白饭/);assert.match(batch,/不要用“这个笑死”等空泛的情绪填充语/);assert.match(batch,/勿编造看到的画面/);
});
