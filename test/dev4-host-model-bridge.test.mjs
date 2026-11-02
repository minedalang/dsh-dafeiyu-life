import test from 'node:test'
import assert from 'node:assert/strict'
import {hostLlmService,resolveHostModelRoute,runHostModelText} from '../lib/host-model-call.mjs'

function mockLlm({providers=['claude','gpt'],chunks=[{type:'text-delta',text:'已完成'},{type:'finish',reason:{kind:'stop'}}]}={}){
  const requests=[]
  return {requests,listProviders:()=>providers.map(id=>({id})),async *stream(req){requests.push(req);for(const c of chunks)yield c}}
}
test('优先复用宿主 LLM 服务，不启动 headless',()=>{
  const llm=mockLlm();assert.equal(hostLlmService({get:key=>key==='llm'?llm:null}),llm)
  assert.equal(hostLlmService({get:()=>null}),null)
})
test('使用选定的自定义 provider/model，无工具、无 API key 或额外配置透传',async()=>{
  const llm=mockLlm()
  const text=await runHostModelText({llm,selection:{provider:'claude',model:'claude-haiku-5-5'},custom:{provider:'gpt',model:'gpt-6.1-terra'},prompt:'测试私密交流',maxChars:400})
  assert.equal(text,'已完成')
  assert.equal(llm.requests[0].provider,'gpt')
  assert.equal(llm.requests[0].model,'gpt-6.1-terra')
  assert.deepEqual(llm.requests[0].tools,[])
  assert.equal(llm.requests[0].messages[0].content[0].text,'测试私密交流')
  assert.equal('apiKey' in llm.requests[0],false)
  assert.equal('toolHistory' in llm.requests[0],false)
})
test('未注册 provider 立即报告 NO_ADAPTER，不偷偷用其他付费模型',async()=>{
  const llm=mockLlm({providers:['claude']})
  await assert.rejects(runHostModelText({llm,selection:{provider:'gpt',model:'gpt-6.1-terra'},prompt:'hello'}),/NO_ADAPTER/)
  assert.equal(llm.requests.length,0)
})
test('没有合法的默认路由时明确拒绝，不猜测模型',()=>{
  assert.throws(()=>resolveHostModelRoute(null,{}),/没有可用的默认 Provider/)
  assert.throws(()=>resolveHostModelRoute({provider:'gpt'},{}),/没有可用的默认 Provider/)
})
test('仅使用可见文本，不将 reasoning-delta 暴露到业务正文',async()=>{
  const llm=mockLlm({chunks:[{type:'reasoning-delta',text:'内部分析'},{type:'text-delta',text:'公开回答'},{type:'finish',reason:{kind:'stop'}}]})
  assert.equal(await runHostModelText({llm,selection:{provider:'gpt',model:'model'},prompt:'hi'}),'公开回答')
})
test('模型输出工具调用、错误、截断、空输出均拒绝',async()=>{
  const cases=[
    {chunks:[{type:'tool-call-delta',name:'tool-bash'}, {type:'finish',reason:{kind:'tool-calls'}}],error:/工具调用/},
    {chunks:[{type:'finish',reason:{kind:'error',failure:{message:'unsupported'}}}],error:/unsupported/},
    {chunks:[{type:'text-delta',text:'incomplete'},{type:'finish',reason:{kind:'max-tokens'}}],error:/token 上限/},
    {chunks:[{type:'finish',reason:{kind:'stop'}}],error:/返回空内容/},
  ]
  for(const {chunks,error} of cases)await assert.rejects(runHostModelText({llm:mockLlm({chunks}),selection:{provider:'gpt',model:'m'},prompt:'hi'}),error)
})
test('默认继承 DSH 当前选定模型，思考深度支持字符串档位',()=>{
  assert.deepEqual(resolveHostModelRoute({provider:'claude',model:'sonnet',reasoningEffort:'medium'},{}),{provider:'claude',model:'sonnet',reasoningEffort:'medium'})
  assert.throws(()=>resolveHostModelRoute({provider:'gpt',model:'m'},{reasoningEffort:'{"budget":3000}'}),/只支持字符串/)
})
