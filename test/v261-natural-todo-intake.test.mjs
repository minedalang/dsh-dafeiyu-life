import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateOwnerAiTodo} from '../lib/owner-ai-todo.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const T=Date.parse('2026-11-02T10:00:00Z'),OWNER='210228238'
const withDir=async fn=>{const d=mkdtempSync(join(tmpdir(),'v261-natural-todo-'));try{return await fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
const agentArgs=(dir,invokeModel,decideAgency=()=>({decision:'allow'}))=>({
 dataDir:dir,now:()=>T,getConfig:()=>({masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmOwnerUid:OWNER}),
 invokeModel,executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send:async()=>({ok:true}),decideAgency,
 onTodoSuggested:async({uid,messageId,at,task})=>createOwnerTodoEngine({dataDir:dir,now:()=>T}).add({...task,origin:{kind:'owner-dm',uid,messageId,at,quotedText:''},sourceKey:`owner-ai:${uid}:${messageId}`},{source:'owner'})
})
const row=(text,id,at=T-1000)=>({incoming:true,senderUid:OWNER,messageId:`${OWNER}:${id}`,timestampMs:at,text})
test('原证据安全校验保留：否定、引用、虚构主题不能变为待办',()=>{
 for(const text of ['不要去听孙燕姿的歌','转发：推荐你听孙燕姿的歌','我听过孙燕姿'])
  assert.equal(validateOwnerAiTodo({type:'search_videos',topic:'孙燕姿的歌',evidence:text},text),null)
})
test('同一主人跨轮提出提议时允许受限指代；不允许借模型和其他 UID 的话造任务',()=>{
 const task={type:'search_videos',topic:'孙燕姿 歌曲',evidence:'那首歌有空了解一下',contextEvidence:'我喜欢孙燕姿的歌'}
 assert.equal(validateOwnerAiTodo(task,'那首歌有空了解一下',{priorOwnerMessages:['我喜欢孙燕姿的歌']})?.topic,'孙燕姿 歌曲')
 assert.equal(validateOwnerAiTodo(task,'那首歌有空了解一下',{priorOwnerMessages:['我喜欢周杰伦的歌']}),null)
 assert.equal(validateOwnerAiTodo(task,'今天挺开心',{priorOwnerMessages:['我喜欢孙燕姿的歌']}),null)
 assert.equal(validateOwnerAiTodo({...task,contextEvidence:'AI说喜欢孙燕姿的歌'},'那首歌有空了解一下',{priorOwnerMessages:['我喜欢孙燕姿的歌']}),null)
})
test('主人明确接受自然提议时用原模型一次调用入队，重复轮询不重复',()=>withDir(async d=>{
 let calls=0
 const agent=createOwnerDmAgent(agentArgs(d,async()=>{calls++;return JSON.stringify({action:'reply',text:'这个我有兴趣，改天看看。',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'孙燕姿的歌',evidence:'你有空听听孙燕姿的歌'}})}))
 agent.primeInbox([])
 assert.equal((await agent.processMessage(row('你有空听听孙燕姿的歌','one'))).ok,true)
 const rows=createOwnerTodoEngine({dataDir:d,now:()=>T}).list()
 assert.equal(rows.length,1);assert.equal(rows[0].type,'search_videos')
 assert.equal(rows[0].origin.quotedText,'');assert.equal(rows[0].ownerAuthorized,false)
 assert.equal((await agent.processMessage(row('你有空听听孙燕姿的歌','one'))).skipped,'duplicate')
 assert.equal(calls,1)
 assert.equal(agent.status().recent.at(-1)?.todoIntake,'saved')
}))
test('模型拒绝/仅口头说“记下”不能绕过真实入库与自主意愿',()=>withDir(async d=>{
 const agent=createOwnerDmAgent(agentArgs(d,async()=>JSON.stringify({action:'reply',text:'我记到待办了',todoDisposition:'refuse'})))
 agent.primeInbox([])
 const res=await agent.processMessage(row('你有空听听孙燕姿的歌','two'))
 assert.match(res.reply,/还没有真正放进待办/)
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))
test('同一人后续指代能建任务，但其他人的旧内容不能提供任务主题',()=>withDir(async d=>{
 let call=0
 const agent=createOwnerDmAgent(agentArgs(d,async()=>{
  call++;return JSON.stringify(call===1?{action:'reply',text:'哦，你说的孙燕姿呀。'}:{action:'reply',text:'这个我有点好奇。',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'孙燕姿 歌曲',evidence:'那首歌有空了解一下',contextEvidence:'刚刚说的孙燕姿的歌'}})
 }))
 agent.primeInbox([])
 await agent.processMessage(row('刚刚说的孙燕姿的歌','a',T-90_000))
 await agent.processMessage(row('那首歌有空了解一下','b'))
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,1)
}))
test('模型明确接受但虚构主题时不能由程序猜出替代任务',()=>withDir(async d=>{
 const agent=createOwnerDmAgent(agentArgs(d,async()=>JSON.stringify({action:'reply',text:'我想试试',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'虚构主题',evidence:'不存在的原话'}})))
 agent.primeInbox([])
 await agent.processMessage(row('推荐你有时候听听孙燕姿的歌','fallback'))
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))

test('即使带合法的 suggestedTodo，模型明确延期或拒绝仍不可入队',()=>withDir(async d=>{
 const agent=createOwnerDmAgent(agentArgs(d,async()=>JSON.stringify({action:'reply',text:'我想先缓缓。',todoDisposition:'defer',suggestedTodo:{type:'search_videos',topic:'孙燕姿 歌曲',evidence:'你有空听听孙燕姿的歌'}})))
 agent.primeInbox([])
 await agent.processMessage(row('你有空听听孙燕姿的歌','deferred'))
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
 assert.equal(agent.status().recent.at(-1).todoIntake,'model-defer')
}))

test('同轮 20 秒内连续两条私信组成的请求也允许核验同一 UID 前半段主题',()=>withDir(async d=>{
 const agent=createOwnerDmAgent(agentArgs(d,async()=>JSON.stringify({action:'reply',text:'我有点兴趣。',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'孙燕姿 歌曲',evidence:'那首歌有空了解一下',contextEvidence:'我喜欢孙燕姿的歌'}})))
 agent.primeInbox([])
 const a=row('我喜欢孙燕姿的歌','first',T-15_000)
 const b=row('那首歌有空了解一下','second',T-1_000)
 await agent.processMessage(a,[b])
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,1)
}))

test('截图场景：分两条输入的陶喆建议与更正应被视作一个主人提议',()=>withDir(async d=>{
  let model=0
  const agent=createOwnerDmAgent(agentArgs(d,async()=>{model++;return JSON.stringify({action:'reply',text:'好呀，我有点想了解一下',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'陶喆的歌',evidence:'肥鱼 有空听听陶喆的歌'}})}))
  agent.primeInbox([])
  const result=await agent.processMessages([row('歌','second',T-3000),row('肥鱼 有空听听陶喆的喝','first',T-49_000)])
  assert.equal(result.length,1)
  assert.equal(result[0].merged,2)
  assert.equal(model,1)
  const todos=createOwnerTodoEngine({dataDir:d,now:()=>T}).list()
  assert.equal(todos.length,1)
  assert.equal(todos[0].topic,'陶喆的歌')
  assert.equal(agent.status().recent.at(-1)?.todoIntake,'saved')
}))
test('模型漏了 suggestedTodo 不再从错字句式猜出待办',()=>withDir(async d=>{
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'想找找看',todoDisposition:'accept'})))
  agent.primeInbox([])
  await agent.processMessage(row('肥鱼 有空听听陶喆的喝\n歌','one'))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))
test('模型明确拒绝时即使同时返回建议字段也不得入库',()=>withDir(async d=>{
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'这次先不啦',todoDisposition:'refuse',suggestedTodo:{type:'search_videos',topic:'陶喆的歌',evidence:'有空听听陶喆的歌'}})))
  agent.primeInbox([])
  await agent.processMessage(row('有空听听陶喆的歌','one'))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
  assert.equal(agent.status().recent.at(-1).todoIntake,'model-refuse')
}))
test('受限回退不把模型虚构主题或历史话语当当前授权',()=>withDir(async d=>{
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'先不算已安排',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'周杰伦的歌',evidence:'有空听听周杰伦的歌'}})))
  agent.primeInbox([])
  await agent.processMessage(row('有空听听陶喆的歌','one'))
  const tasks=createOwnerTodoEngine({dataDir:d,now:()=>T}).list()
  // Do not create a substitute task from a fixed natural-language parser.
  assert.equal(tasks.length,0)
}))

test('模型没有决定接受时，即使原话可被静态提取也不强制生成待办',()=>withDir(async d=>{
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'有空我可以看看，但现在先不决定。'})))
  agent.primeInbox([])
  await agent.processMessage(row('有空听听陶喆的歌','one'))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
  assert.equal(agent.status().recent.at(-1).todoIntake,'no-proposal')
}))
test('模型明确 none 不能因为附带候选误创建待办',()=>withDir(async d=>{
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'先聊聊',todoDisposition:'none',suggestedTodo:{type:'search_videos',topic:'陶喆的歌',evidence:'有空听听陶喆的歌'}})))
  agent.primeInbox([])
  await agent.processMessage(row('有空听听陶喆的歌','one'))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
  assert.equal(agent.status().recent.at(-1).todoIntake,'no-proposal')
}))
test('当前主人私信的只读待办权限关闭时，即使模型 accept 也不创建',()=>withDir(async d=>{
  const args=agentArgs(d,async()=>({action:'reply',text:'这次还没安排',todoDisposition:'accept'}))
  args.getConfig=()=>({...agentArgs(d,()=>{}).getConfig(),ownerDmReadCommandsEnabled:false})
  const agent=createOwnerDmAgent(args)
  agent.primeInbox([])
  await agent.processMessage(row('有空听听陶喆的歌','one'))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
  assert.equal(agent.status().recent.at(-1).todoIntake,'read-permission-off')
}))

test('老模型只口头表达意愿不再由正则转换成待办',()=>withDir(async d=>{
  let choices=0
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'好呀，等有空我去找陶喆的歌听听。还没听过的话我就不瞎夸哦～'}),()=>{choices++;return {decision:'allow'}}))
  agent.primeInbox([])
  await agent.processMessage(row('肥鱼 有空听听陶喆的喝\n歌','one'))
  assert.equal(choices,0)
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))
test('未承诺或明确不愿意时不得根据口头聊天和用户提议强制入队',()=>withDir(async d=>{
  const messages=['好呀，听说陶喆的歌挺有意思。','有空我可以看看，但现在先不决定。','我不打算去找陶喆的歌。']
  let i=0
  const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:messages[i++]})))
  agent.primeInbox([])
  for(let j=0;j<messages.length;j++)await agent.processMessage(row('有空听听陶喆的歌',String(j)))
  assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))

test('主人只推荐歌手而没有歌曲或 BV，原同轮 AI 明确接受后可记入搜索待办',()=>withDir(async d=>{
 let calls=0
 const agent=createOwnerDmAgent(agentArgs(d,async prompt=>{
  calls++
  assert.match(prompt,/只给出明确的歌手或乐队名字/)
  return {action:'reply',text:'这位歌手我还想多了解一下～',todoDisposition:'accept',
   suggestedTodo:{type:'search_videos',topic:'方大同',evidence:'推荐你听方大同'}}
 }))
 agent.primeInbox([])
 const result=await agent.processMessage(row('推荐你听方大同','artist-only'))
 assert.equal(result.ok,true)
 assert.equal(calls,1)
 const todos=createOwnerTodoEngine({dataDir:d,now:()=>T}).list()
 assert.equal(todos.length,1)
 assert.equal(todos[0].type,'search_videos')
 assert.equal(todos[0].topic,'方大同')
 assert.equal(agent.status().recent.at(-1)?.todoIntake,'saved')
}))

test('主人只推荐艺人但鱼鱼明确拒绝时，不将建议强制入队',()=>withDir(async d=>{
 const agent=createOwnerDmAgent(agentArgs(d,async()=>({action:'reply',text:'今天暂时不想找。',todoDisposition:'refuse',
  suggestedTodo:{type:'search_videos',topic:'方大同',evidence:'推荐你听方大同'}})))
 agent.primeInbox([])
 await agent.processMessage(row('推荐你听方大同','artist-declined'))
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))

test('自然表达不含旧触发词也可见原待办能力；模型无提案不自动建任务',()=>withDir(async d=>{
 let calls=0
 const agent=createOwnerDmAgent(agentArgs(d,async prompt=>{calls++;assert.match(prompt,/suggestedTodo/);return {action:'reply',text:'好奇归好奇，先聊聊天。',todoDisposition:'none'}}))
 agent.primeInbox([])
 await agent.processMessage(row('方大同的声音很值得一品呢','natural'))
 assert.equal(calls,1)
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list().length,0)
}))

test('旧提示触发词未出现时，模型仍可提出有真实证据的自然建议',()=>withDir(async d=>{
 const text='我建议试试方大同的歌';let calls=0
 const agent=createOwnerDmAgent(agentArgs(d,async prompt=>{calls++;assert.match(prompt,/suggestedTodo/);return {action:'reply',text:'这位歌手我有些好奇。',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'方大同的歌',evidence:text}}}))
 agent.primeInbox([])
 await agent.processMessage(row(text,'natural-accept'))
 assert.equal(calls,1)
 assert.equal(createOwnerTodoEngine({dataDir:d,now:()=>T}).list()[0]?.topic,'方大同的歌')
}))
