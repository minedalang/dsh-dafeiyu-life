import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {prepareLifeCommentReply} from '../lib/life-willingness.mjs';

const payload = item => JSON.stringify({items:[{id:'0',mood:'joyful',intensity:2,...item}]});
const request = {kind:'comment',uid:'123456',text:'鱼鱼你在做什么呀',
  threadKey:'comment:BV1abcdefghij:123456789',canSkip:true};
const create = (invoke,mode='full') => createInteractionBatcher({
  invoke,getPersona:()=> '鱼鱼的同一个 Life Voice',getContextMode:()=>mode,delayMs:0,
  logger:{warn(){}},
});

test('评论多气泡不外发：完整与精简模式都会拒绝拆句提案',async()=>{
  for(const mode of ['full','compact']){
    let calls=0;
    const batch=create(async()=>{calls++;return payload({action:'reply',messages:['抓到啦！','尾巴轻点揉哦！']});},mode);
    try {
      const result=await batch.generate({...request,lifeCommentMessages:true});
      assert.equal(calls,1);
      assert.deepEqual(result,{action:'skip',messages:[],reason:'public-burst-not-allowed'});
      assert.deepEqual(prepareLifeCommentReply({action:'reply',messages:['抓到啦！','尾巴轻点揉哦！']},{p6Enabled:true,maxBubbles:2}).messages,['抓到啦！']);
    } finally {batch.stop()}
  }
});

test('保留普通旧文本调用，不因只给 messages 而抛弃回复',async()=>{
  const batch=create(async()=>payload({action:'reply',messages:['有内容的第一条','独立第二条']}));
  try {assert.equal(await batch.generate(request),'有内容的第一条');}
  finally {batch.stop()}
});

test('原来的 reply 字符串仍可授权，模型真正空正文则绝不补固定话术',async()=>{
  const batch=create(async()=>payload({action:'reply',reply:'真的抓到啦'}));
  try {assert.deepEqual(await batch.generate({...request,lifeCommentMessages:true}),{action:'reply',messages:['真的抓到啦']});}
  finally {batch.stop()}
  const empty=create(async()=>payload({action:'reply',messages:[]}));
  try {assert.deepEqual(await empty.generate({...request,lifeCommentMessages:true}),{action:'reply',messages:[]});
    assert.deepEqual(prepareLifeCommentReply({action:'reply',messages:[]}).messages,[])}
  finally {empty.stop()}
});

test('自主沉默与暂缓仍保留，不生成第二次授权或假正文',async()=>{
  for(const action of ['skip','defer','close']){
    const batch=create(async()=>payload({action,messages:[]}));
    try {
      const result=await batch.generate({...request,lifeCommentMessages:true});
      if(action==='skip')assert.equal(result,'SKIP');
      else assert.deepEqual(result,{action});
    } finally {batch.stop()}
  }
});

test('仅实际评论回复生成入口使用结构化保留标志，其他调用保持兼容',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  // If a local variable is renamed, still require the exact call contract.
  assert.match(source,/interactionBatcher\.generate\(\{\.\.\.visualReq,lifeCommentMessages:true,lifeEpisodeContext:commentEpisodeContext/);
  assert.match(source,/if\(!lines\.length\)\{/);
});
