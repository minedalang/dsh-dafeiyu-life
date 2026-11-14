import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerDmAgent,parseAgentStep,selectSearchVideos,allowAgentStep} from '../lib/owner-dm-agent.mjs'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
import {HEADLESS_DENY_TOOLS,writeSecureHeadlessOverlay,assertSafeHeadlessLaunch} from '../lib/headless-security.mjs'
const bv='BV1xx411c7mD',other='BV17x411w7KC'
const withDir=(fn)=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev4-'));return Promise.resolve(fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}))}
const config=(more={})=>({masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,...more})
const row=(text,id='msg-1',uid='123',now=Date.now())=>({incoming:true,senderUid:uid,messageId:id,timestampMs:now,text})

test('模型只能返回固定白名单 JSON，工具和文件命令均无效',()=>{
  assert.deepEqual(parseAgentStep('{"action":"watch","bvid":"'+bv+'"}').action,'watch')
  assert.equal(parseAgentStep('{"action":"shell","text":"rm -rf /"}'),null)
  assert.equal(parseAgentStep('{"action":"deleteFile"}'),null)
  assert.equal(selectSearchVideos({data:{result:[{bvid:bv,title:'猫咪'},{bvid:other,title:'宇宙'}]}}).length,2)
})

test('写操作后端必须检查独立权限和本条最新主人指令',()=>{
  const cfg=config({ownerDmActionsEnabled:true,ownerDmLikeEnabled:true,ownerDmCommentPublishEnabled:true})
  assert.equal(allowAgentStep({action:'like'},'先不要点赞',cfg).ok,false)
  assert.equal(allowAgentStep({action:'like'},'给这个点赞',cfg).ok,true)
  assert.equal(allowAgentStep({action:'like'},'给这个点赞',{...cfg,ownerDmLikeEnabled:false}).ok,false)
  assert.equal(allowAgentStep({action:'comment_publish',text:'凭空生成'},'发布评论：真实内容',cfg).ok,false)
  assert.equal(allowAgentStep({action:'message',uid:'456',text:'你好'},'主人说话',cfg).ok,false)
})

test('第一轮只建立收件箱基线、只认主人 UID、同一消息不重复执行',()=>withDir(async dir=>{
  let model=0,sent=0,reads=0
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>config(),invokeModel:async()=>{model++;return JSON.stringify({action:'watch',bvid:bv})},executeRead:async()=>{reads++;return {ok:true,summary:'读取成功'}},executeWrite:async()=>{throw Error('不应写')},send:async()=>{sent++;return {ok:true}}})
  agent.primeInbox([row('历史消息','old')])
  assert.equal((await agent.processMessage(row('历史消息','old'))).skipped,'duplicate')
  assert.equal((await agent.processMessage(row('查看视频','outsider','456'))).handled,false)
  assert.equal((await agent.processMessage(row('看看 '+bv))).ok,true)
  assert.equal((await agent.processMessage(row('看看 '+bv))).skipped,'duplicate')
  assert.equal(reads,1) // repeated read action is not executed twice
  assert.equal(sent,1);assert.equal(model,2)
}))

test('搜索返回真实 BV 链接、下一轮可以使用刚才找到的目标',()=>withDir(async dir=>{
  let times=0;const sent=[];const performed=[]
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>config(),invokeModel:async()=>{
    times++;return times===1?JSON.stringify({action:'search',query:'天文'}):times===2?JSON.stringify({action:'reply',text:'找到了一个视频'}):times===3?JSON.stringify({action:'watch'}):JSON.stringify({action:'reply',text:'读完了'})
  },executeRead:async(step)=>{performed.push(step);return step.action==='search'?{ok:true,summary:'搜索成功',data:{result:[{bvid:bv,title:'宇宙科普'}]}}:{ok:true,summary:'已读取资料'}},executeWrite:async()=>{throw Error('不应写')},send:async msg=>{sent.push(msg.text);return {ok:true}}})
  agent.primeInbox([])
  await agent.processMessage(row('找一条天文视频发给我'))
  assert.match(sent[0],new RegExp('https://www.bilibili.com/video/'+bv))
  await agent.processMessage(row('现在就看刚才那条','msg-2'))
  assert.equal(performed.at(-1).bvid,bv)
}))

test('主 Session 上下文严格限定选定在线会话，可非唤醒注入已确认经历',()=>withDir(async dir=>{
  const calls=[]
  const agent={id:'home123',followup:async()=>{},inject:async m=>{calls.push(m)},session:{deriveMessages:()=>[
    {role:'system',content:[{type:'text',text:'secret system'}]},
    {role:'user',content:[{type:'text',text:'我想看看天文视频'}]},
    {role:'tool',content:[{type:'text',text:'private tool content'}]},
    {role:'assistant',content:[{type:'text',text:'我也很好奇星空'}]},
    {role:'user',source:{kind:'plugin:dafeiyu'},content:[{type:'text',text:'内部注入'}]},
  ]}}
  const bridge=createMainSessionBridge({dataDir:dir,agents:{get:id=>id==='home123'?agent:null,list:()=>[agent]},getConfig:()=>({mainSessionId:'home123'}),getWatched:()=>[],getComments:()=>({rows:[]})})
  const result=await bridge.ownerDmContext({turns:3})
  assert.equal(result.available,true)
  assert.equal(result.lines.length,2)
  assert.ok(result.lines.join(' ').includes('天文'))
  assert.equal(result.lines.join(' ').includes('secret'),false)
  const injected=await bridge.injectOwnerDmExperience({type:'watch',summary:'已读取标题',bvid:bv})
  assert.equal(injected.ok,true);assert.equal(calls.length,1)
  assert.equal(calls[0].source.kind,'plugin:dafeiyu-owner-dm-experience')
}))

test('专用模型 overlay 不可插入 MCP 工具',()=>withDir(dir=>{
  const content=[...HEADLESS_DENY_TOOLS.flatMap(id=>['- id: '+id,'  disabled: true','']),...['credentials','authorization','deepseek-account'].flatMap(id=>['- id: '+id,'  disabled: false',''])].join('\n')
  const f=join(dir,'headless-owner-dm-agent-overlay.yml')
  writeSecureHeadlessOverlay(f,content,{kind:'ownerDmAgent',stateDir:dir})
  assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',f],f,{kind:'ownerDmAgent',stateDir:dir})
  assert.throws(()=>writeSecureHeadlessOverlay(f,content+'\n- insert:\n    - id: mcp-bili-duty\n',{kind:'ownerDmAgent',stateDir:dir}),/插入了非预期插件|不应挂载/)
}))

test('dev.4 主人私信的角色情绪只在 B站确认投递成功后回写，不给失败发送制造成功情绪',()=>withDir(async dir=>{
  const emotions=[]
  const make=(send)=>createOwnerDmAgent({dataDir:dir,getConfig:()=>config(),
    invokeModel:async()=>JSON.stringify({action:'reply',text:'今天很高兴见到你',mood:'warm',intensity:1}),
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send,
    onReplyEmotion:x=>{emotions.push(x);return {ok:true}}})
  const success=make(async()=>({ok:true}));success.primeInbox([])
  assert.equal((await success.processMessage(row('谢谢鱼鱼','w1'))).ok,true)
  assert.deepEqual(emotions.map(x=>x.mood),['warm'])
  assert.equal((await success.processMessage(row('谢谢鱼鱼','w1'))).skipped,'duplicate')
  const failed=make(async()=>({ok:false,error:'transport unknown'}))
  const result=await failed.processMessage(row('感谢你啦','w2'))
  assert.equal(result.ok,false)
  assert.deepEqual(emotions.map(x=>x.mood),['warm'])
  assert.equal(parseAgentStep('{"action":"reply","text":"嗨","mood":"joyful","intensity":3}').intensity,0)
}))

test('P6-A shared burst protocol is reused by owner DM and sends 2–3 separate bubbles with per-bubble receipts',()=>withDir(async dir=>{
  const sent=[],confirmed=[];let prompt=''
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>config({dmP6Enabled:true,dmP6MaxBubbles:3}),
    invokeModel:async value=>{prompt=value;return JSON.stringify({action:'reply',messages:['我刚刚看到那个视频了。','评论区有个人的观点还挺有意思的。','我还想再跟你聊聊这个。']})},
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
    send:async value=>{sent.push(value);return {ok:true,receiptId:'owner-r'+sent.length}},
    onConfirmedReply:async value=>confirmed.push(value),logger:{warn(){}}})
  agent.primeInbox([])
  const result=await agent.processMessage(row('鱼鱼，最近怎么样？','burst-1'))
  assert.equal(result.ok,true)
  assert.equal(result.burst.status,'confirmed')
  assert.equal(result.burst.planned,3)
  assert.equal(result.burst.confirmed,3)
  assert.deepEqual(sent.map(x=>x.text),['我刚刚看到那个视频了。','评论区有个人的观点还挺有意思的。','我还想再跟你聊聊这个。'])
  assert.equal(new Set(sent.map(x=>x.eventId)).size,3)
  assert.match(prompt,/统一自然多气泡协议/)
  assert.equal(confirmed.length,1)
  assert.equal(confirmed[0].text,sent.map(x=>x.text).join('\n'))
  const status=agent.status().recent.at(-1)
  assert.equal(status.status,'done')
}))

test('owner-DM P6-A stops after an unknown later receipt and never replays the confirmed first bubble',()=>withDir(async dir=>{
  const sent=[]
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>config({dmP6Enabled:true,dmP6MaxBubbles:3}),
    invokeModel:async()=>JSON.stringify({action:'reply',messages:['第一条已发内容','第二条结果未知','第三条不应发送']}),
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
    send:async value=>{sent.push(value);return sent.length===1?{ok:true,receiptId:'confirmed-1'}:{ok:false,error:'timeout'}}})
  agent.primeInbox([])
  const result=await agent.processMessage(row('和我聊聊最近的事','burst-unknown'))
  assert.equal(result.ok,false)
  assert.equal(result.burst.status,'partial-unknown')
  assert.equal(result.burst.confirmed,1)
  assert.deepEqual(sent.map(x=>x.text),['第一条已发内容','第二条结果未知'])
  assert.equal((await agent.processMessage(row('和我聊聊最近的事','burst-unknown'))).skipped,'duplicate')
  assert.equal(sent.length,2)
}))

test('owner-DM uses the shared P6-A off switch and falls back to one bubble',()=>withDir(async dir=>{
  const sent=[]
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>config({dmP6Enabled:false,dmP6MaxBubbles:3}),
    invokeModel:async()=>JSON.stringify({action:'reply',messages:['只发第一条','不应发第二条','不应发第三条']}),
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
    send:async value=>{sent.push(value);return {ok:true,receiptId:'single'}}})
  agent.primeInbox([])
  const result=await agent.processMessage(row('随便聊聊','burst-off'))
  assert.equal(result.ok,true)
  assert.deepEqual(sent.map(x=>x.text),['只发第一条'])
  assert.equal(result.burst.planned,1)
}))
