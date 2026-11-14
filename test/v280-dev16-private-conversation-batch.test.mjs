import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPrivateConversationExperiences} from '../lib/private-conversation-experiences.mjs'
import {allowedPath} from '../lib/data-backup.mjs'

const A='0123456789abcdef', B='fedcba9876543210'
const setup=({answer,initial=1_800_000_000_000}={})=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-private-batch-'))
 let clock=initial,tag=A,invokeCount=0
 const events=[],prompts=[]
 const worker=createPrivateConversationExperiences({dataDir:dir,now:()=>clock,getAccountTag:()=>tag,
  getConfig:()=>({mainSessionMemoryEnabled:true}),
  invokeModel:async(prompt)=>{invokeCount++;prompts.push(prompt);return typeof answer==='function'?await answer({prompt,invokeCount}):answer??'{"experiences":[]}'},
  recordEvents:async(rows)=>{events.push(...rows);return {ok:true}},logger:{warn:()=>{}}})
 return {worker,events,prompts,dir,advance:ms=>clock+=ms,scope:x=>tag=x,invoked:()=>invokeCount,dispose:()=>rmSync(dir,{recursive:true,force:true})}
}
function replyFor(prompt,{kind='mutual',text='我记得这次和对方围绕游戏里有意思的角色一起讨论过，交流气氛比较轻松。'}={}){
 const turns=JSON.parse(prompt.match(/<conversation_data>(\[.*?\])<\/conversation_data>/s)[1]);
 return JSON.stringify({experiences:[{kind,text,evidence:turns.map(x=>x.id)}]})
}
test('收集所有可信对话，不用关键词筛选；安静期才调用 AI，成功清理临时原文',async()=>{
 const s=setup({answer:({prompt})=>replyFor(prompt)})
 try{
  assert.equal((await s.worker.observe({uid:'123',role:'friend',eventId:'one',text:'今天小猫在晒太阳',at:1_800_000_000_000})).ok,true)
  assert.equal((await s.worker.observe({uid:'123',role:'friend',direction:'outgoing',eventId:'two',text:'我也看见了，真有趣',at:1_800_000_001_000})).ok,true)
  assert.equal((await s.worker.tick()).processed,0)
  assert.equal(s.invoked(),0)
  s.advance(21*60_000)
  const result=await s.worker.tick()
  assert.equal(result.created,1);assert.equal(s.invoked(),1);assert.equal(s.events.length,1)
  assert.match(s.events[0].key,/^private:friend-dm:[a-f0-9]{20}$/)
  assert.equal(s.events[0].subjectUid,'123');assert.equal(s.events[0].privacyReviewed,true)
  assert.equal(s.worker.status().pendingMessages,0)
  assert.ok(!readFileSync(s.worker.file,'utf8').includes('小猫在晒太阳'))
  assert.equal((await s.worker.tick()).processed,0)
 }finally{s.dispose()}
})
test('不同 UID 和账号分域；绝不把两个对象放进同一次模型上下文',async()=>{
 const s=setup({answer:({prompt})=>replyFor(prompt,{kind:'reported',text:'对方在本次交流中提到了关于绘画的个人兴趣，我没有据此推断我们以前一起画过画。'})})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'alpha秘密 画画',at:1_800_000_000_000})
  await s.worker.observe({uid:'456',role:'friend',eventId:'x',text:'beta秘密 游戏',at:1_800_000_000_000})
  s.scope(B);await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'gamma秘密 音乐',at:1_800_000_000_000})
  s.advance(21*60_000)
  assert.equal((await s.worker.tick()).processed,1);assert.equal(s.prompts.length,1)
  assert.match(s.prompts[0],/gamma秘密/);assert.doesNotMatch(s.prompts[0],/alpha秘密|beta秘密/)
  s.scope(A);await s.worker.tick();await s.worker.tick()
  assert.equal(s.prompts.length,3)
  assert.ok(s.prompts.slice(1).every(x=>!x.includes('gamma秘密')))
 }finally{s.dispose()}
})
test('无有效经历允许真正沉默，不重试，不写长期记忆',async()=>{
 const s=setup({answer:'{"experiences":[]}'})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'晚上好',at:1_800_000_000_000})
  s.advance(21*60_000);assert.equal((await s.worker.tick()).created,0)
  assert.equal(s.worker.status().emptySummaries,1);assert.equal(s.worker.status().pendingSegments,0)
  assert.equal(s.events.length,0)
 }finally{s.dispose()}
})
test('技术失败保留原片段并退避，恢复成功后只产生一次事件',async()=>{
 const s=setup({answer:({prompt,invokeCount})=>{if(invokeCount===1)throw Error('not available');return replyFor(prompt)}})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'游戏角色好像又更新了',at:1_800_000_000_000})
  await s.worker.observe({uid:'123',role:'friend',direction:'outgoing',eventId:'y',text:'是呀那个新角色挺有趣',at:1_800_000_001_000})
  s.advance(21*60_000);assert.equal((await s.worker.tick()).reason,'retry-pending')
  assert.equal(s.worker.status().pendingSegments,1)
  assert.equal((await s.worker.tick()).processed,0);assert.equal(s.invoked(),1)
  s.advance(6*60_000);assert.equal((await s.worker.tick()).created,1)
  assert.equal(s.worker.status().pendingSegments,0);assert.equal(s.events.length,1)
 }finally{s.dispose()}
})
test('证据引用必须准确，不能将单方说法冒充双方共同经历',async()=>{
 const s=setup({answer:({prompt})=>replyFor(prompt)})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'我们以前聊过那个视频吗？',at:1_800_000_000_000})
  await s.worker.markSettled({uid:'123',role:'friend'})
  assert.equal((await s.worker.tick()).reason,'retry-pending')
  assert.equal(s.events.length,0)
 }finally{s.dispose()}
})
test('输入去重、跨重启恢复，已总结输入不能反复总结',async()=>{
 const s=setup({answer:({prompt})=>replyFor(prompt,{kind:'reported',text:'这次交流里对方提出了一个与创作有关的问题，尚无证据表明以前已经共同完成过作品。'})})
 try{
  const item={uid:'123',role:'friend',eventId:'x',text:'我们以后可以聊画画吗',at:1_800_000_000_000}
  await s.worker.observe(item);assert.equal((await s.worker.observe(item)).duplicate,true)
  await s.worker.markSettled({uid:'123',role:'friend'})
  const another=createPrivateConversationExperiences({dataDir:s.dir,now:()=>1_800_000_000_000,getAccountTag:()=>A,
   getConfig:()=>({mainSessionMemoryEnabled:true}),invokeModel:async p=>replyFor(p,{kind:'reported',text:'对方提议过将来交流绘画话题，但没有证明以前已经一起创作过作品。'}),
   recordEvents:async rows=>{s.events.push(...rows);return {ok:true}}})
  assert.equal((await another.tick()).created,1)
  assert.equal((await another.observe(item)).duplicate,true)
  assert.equal((await another.tick()).processed,0)
  assert.equal(s.events.length,1)
 }finally{s.dispose()}
})
test('私密临时缓冲不允许进入通用备份',()=>{
 assert.equal(allowedPath('life-memory/private-conversation-buffer.json'),false)
})
test('模型返回引用不存在的证据时拒绝生成事实',async()=>{
 const s=setup({answer:'{"experiences":[{"kind":"reported","text":"对方表示希望未来一起讨论创作，有明确的聊天证据。","evidence":["invented"]}]}'})
 try{await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'有空我们聊聊作品',at:1_800_000_000_000});
  await s.worker.markSettled({uid:'123'});assert.equal((await s.worker.tick()).reason,'retry-pending');assert.equal(s.events.length,0)
 }finally{s.dispose()}
})
test('容量达到阈值便安排提炼，不必等安静期，也不逐条调用模型',async()=>{
 const s=setup({answer:'{"experiences":[]}'})
 try{
  for(let i=0;i<14;i++)await s.worker.observe({uid:'123',role:'friend',eventId:'turn-'+i,text:'消息内容 '+i,at:1_800_000_000_000+i})
  assert.equal(s.worker.status().readySegments,1)
  assert.equal(s.invoked(),0)
  assert.equal((await s.worker.tick()).processed,1)
  assert.equal(s.invoked(),1)
 }finally{s.dispose()}
})
test('模型执行期间切换账号，不会跨账号投影私密记忆',async()=>{
 let release
 const pending=new Promise(resolve=>{release=resolve})
 const s=setup({answer:async({prompt})=>{await pending;return replyFor(prompt,{kind:'reported',text:'这次交流里对方提到了一个新的创作话题，但没有证据证明我们此前一起完成过作品。'})}})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'以后我们可以一起研究设计吗',at:1_800_000_000_000})
  await s.worker.markSettled({uid:'123'})
  const work=s.worker.tick()
  await new Promise(resolve=>setImmediate(resolve))
  s.scope(B);release()
  assert.equal((await work).reason,'account-changed')
  assert.equal(s.events.length,0)
  s.scope(A);assert.equal(s.worker.status().pendingSegments,1)
  assert.equal((await s.worker.tick()).created,1)
 }finally{s.dispose()}
})
test('短期原文过期应清除，保留聚合过期诊断，不复活此前对话',async()=>{
 const s=setup()
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'x',text:'一些很久以前的私人交谈内容',at:1_800_000_000_000})
  s.advance(49*3600_000)
  await s.worker.tick()
  assert.equal(s.worker.status().pendingMessages,0)
  assert.equal(s.worker.status().expiredDropped,1)
  assert.ok(!readFileSync(s.worker.file,'utf8').includes('私人交谈内容'))
 }finally{s.dispose()}
})
test('记忆提炼数量和成功时间只显示当前账号的统计，不混入另一账号',async()=>{
 const s=setup({answer:'{"experiences":[]}'})
 try{
  await s.worker.observe({uid:'123',role:'friend',eventId:'one',text:'你好',at:1_800_000_000_000})
  await s.worker.markSettled({uid:'123'})
  assert.equal((await s.worker.tick()).created,0)
  assert.equal(s.worker.status().emptySummaries,1)
  const doneA=s.worker.status().lastSummarizedAt
  s.scope(B)
  assert.equal(s.worker.status().emptySummaries,0)
  assert.equal(s.worker.status().lastSummarizedAt,0)
  await s.worker.observe({uid:'123',role:'friend',eventId:'two',text:'新的话题',at:1_800_000_000_000})
  assert.equal(s.worker.status().pendingSegments,1)
  s.scope(A)
  assert.equal(s.worker.status().emptySummaries,1)
  assert.equal(s.worker.status().lastSummarizedAt,doneA)
  assert.equal(s.worker.status().pendingSegments,0)
 }finally{s.dispose()}
})
