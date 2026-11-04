import test from 'node:test'
import assert from 'node:assert/strict'
import {assessTodoReply} from '../lib/social-todo-reply-contract.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const one={complete:true,created:true,createdCount:1,items:[{topic:'第一首'}]}
const two={complete:true,created:true,createdCount:2,items:[{topic:'第一首'},{topic:'第二首'}]}
const incoming='推荐这两首：BV1sMpv6PEJm 和 BV1AUuU6TEpz'

test('发布审计：说两首都记下但只有一条真实回执，必须拒绝承诺',()=>{
  assert.deepEqual(assessTodoReply({texts:['两首都已经记下啦'],todoDisposition:'accept',intakeResult:one,sourceText:incoming}),
    {ok:false,reason:'unsupported-todo-quantity'})
  assert.equal(assessTodoReply({texts:['这些都已经记下啦'],todoDisposition:'accept',intakeResult:one,sourceText:incoming}).ok,false)
  assert.equal(assessTodoReply({texts:['两首都已经记下啦'],todoDisposition:'accept',intakeResult:two,sourceText:incoming}).ok,true)
  assert.equal(assessTodoReply({texts:['第二首记下了'],todoDisposition:'accept',intakeResult:one}).ok,true)
})
test('发布审计：一句话中的先前否定，不能掩盖后续虚假的已入账承诺',()=>{
  assert.equal(assessTodoReply({texts:['之前还没记下，现在已经记下了'],todoDisposition:'none'}).ok,false)
  assert.equal(assessTodoReply({texts:['还没记下第一首，但是第二首记下了'],todoDisposition:'none'}).ok,false)
  assert.equal(assessTodoReply({texts:['我还没记下来，待会儿再决定'],todoDisposition:'none'}).ok,true)
})
test('发布审计：入账条数与承诺不符时，只允许同一个模型重新措辞',async()=>{
  let calls=0, intakeCalls=0
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
    calls++
    return JSON.stringify({items:[{id:'0',action:'reply',
      reply:calls===1?'两首都已经记下啦':'先记下一首，另一首我还想核对一下。',
      todoDisposition:'accept',mood:'neutral',intensity:0}]})
  }})
  try{
    const result=await batcher.generate({kind:'comment',uid:'10007',text:incoming,allowTodoIntake:true,
      onTodoProposal:async()=>{intakeCalls++;return one}})
    assert.equal(result,'先记下一首，另一首我还想核对一下。')
    assert.equal(calls,2)
    assert.equal(intakeCalls,1)
  }finally{batcher.stop()}
})
