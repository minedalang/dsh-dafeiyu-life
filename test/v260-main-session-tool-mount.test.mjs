import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLongTermMemory } from '../lib/long-term-memory.mjs'
import { createOwnerTodoEngine } from '../lib/owner-todos.mjs'

// A basic register(spec) mock accepts specs with no output. The real DSH
// registrar reads output.render immediately, so recreate that behavior here.
function rig(enabled) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dafeiyu-tool-output-'))
  const warnings = [], tools = [], listeners = new Map()
  const session = { id: 'main', snapshotEvents: () => [{ type: 'user/message', data: { message: { content: '以后有空看看这个视频' } } }] }
  const agent = { id: 'main', session, ctx: {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register(spec) {
      // These accesses reproduce the missing output.render startup error.
      assert.equal(spec.output.schema.type, 'object', `${spec.name} output schema is missing`)
      assert.equal(typeof spec.output.render, 'function', `${spec.name} render is missing`)
      assert.equal(Array.isArray(spec.output.render({}, { ok: true })), true)
      tools.push(spec)
      return () => {}
    } },
  } }
  const todos = createOwnerTodoEngine({ dataDir })
  const memory = createLongTermMemory({
    dataDir, dshHome: dataDir,
    agents: { get: () => agent, list: () => [agent] },
    getConfig: () => ({ mainSessionId: 'main', mainSessionMemoryEnabled: enabled }),
    defineTool: opts => opts,
    getExperienceRecall: () => [{kind: 'watch', day: '2026-10-26', bvid: 'BV19SJi6VEj1', summary: '读过字幕'}],
    getTodoEngine: () => todos,
    logger: { warn: message => warnings.push(String(message)) },
  })
  return { memory, tools, warnings, listeners, cleanup() { memory.stop(); rmSync(dataDir, { recursive: true, force: true }) } }
}

test('主 Session 关闭长期记忆也能在真实宿主式注册器中挂载五个工具', async () => {
  const r = rig(false)
  try {
    r.memory.start()
    const expected = ['dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute']
    assert.deepEqual(r.tools.map(t => t.name), expected)
    assert.deepEqual(r.warnings, [])
    for(const tool of r.tools) {
      const rendered = tool.output.render({}, { ok:true, items:[] })
      assert.equal(rendered[0].type,'text')
      assert.deepEqual(JSON.parse(rendered[0].text), {ok:true,items:[]})
    }
    const recalled = await r.tools[0].execute({ query:'猫咪' })
    assert.equal(recalled.ok,true)
    assert.equal(recalled.experiences[0].summary,'读过字幕')
    const add = await r.tools[2].execute({ type:'watch_video', bvid:'BV19SJi6VEj1', title:'以后看看' })
    assert.equal(add.ok,true)
    assert.equal((await r.tools[1].execute({})).items.length, 1)
    const unauthorized = await r.tools[2].execute({ type:'like_video', bvid:'BV19SJi6VEj1' })
    assert.equal(unauthorized.ok,false)
  } finally { r.cleanup() }
})

test('开启长期记忆时两项已有记忆工具和五项新增工具均完整提供输出渲染', () => {
  const r = rig(true)
  try {
    r.memory.start()
    assert.deepEqual(r.tools.map(t => t.name), ['dafeiyu_remember','dafeiyu_memory_recall','dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute'])
    assert.deepEqual(r.warnings, [])
    for(const tool of r.tools) assert.equal(typeof tool.output.render,'function',tool.name)
  } finally { r.cleanup() }
})

// Issue #6 (DSH 0.2.1-rc.4): the registrar validates output at mount time,
// and createSuccessResult uses the rendered content as an array of blocks.
// Exercise all seven real execute paths; a registration-only mock misses the
// strict output.schema / output.render mismatch on successful writes.
test('Issue #6：DSH 0.2.1 输出 DSL、七项工具真实回执及 content.some 均兼容', async () => {
  const r = rig(true)
  try {
    r.memory.start()
    const byName=Object.fromEntries(r.tools.map(t=>[t.name,t]))
    assert.equal(Object.keys(byName).length,7)
    const remembered=await byName.dafeiyu_remember.execute({text:'主人明确表示喜欢清茶',fact_key:'主人.偏好.饮料',importance:.98})
    assert.equal(remembered.ok,true)
    assert.ok(remembered.id,'记忆写入回执包含 id，不应因 output schema 过窄而拒绝')
    const added=await byName.dafeiyu_todo_add.execute({type:'watch_video',bvid:'BV19SJi6VEj1',title:'以后看看'})
    assert.equal(added.ok,true)
    const listed=await byName.dafeiyu_todo_list.execute({})
    assert.equal(listed.ok,true)
    const id=listed.items[0].id
    const cases=[
      ['dafeiyu_remember',remembered],
      ['dafeiyu_memory_recall',await byName.dafeiyu_memory_recall.execute({query:'清茶'})],
      ['dafeiyu_life_recall',await byName.dafeiyu_life_recall.execute({query:'猫咪'})],
      ['dafeiyu_todo_list',listed],
      ['dafeiyu_todo_add',added],
      ['dafeiyu_todo_update',await byName.dafeiyu_todo_update.execute({id,action:'defer',hours:24})],
      ['dafeiyu_todo_execute',await byName.dafeiyu_todo_execute.execute({id})],
    ]
    const authorTypes=new Set(['string','number','integer','boolean','null','array','object','json'])
    for(const [name,value] of cases){
      const spec=byName[name]
      assert.ok(spec.output?.schema,`${name}: missing output.schema`)
      assert.ok(authorTypes.has(spec.output.schema.type),`${name}: invalid author schema type`)
      assert.equal(typeof spec.output.render,'function',`${name}: missing output.render`)
      assert.equal(typeof value,'object',`${name}: execute must return structured result`)
      if(spec.output.schema.type==='object'&&spec.output.schema.additionalProperties===false){
        for(const key of Object.keys(value))assert.ok(key in (spec.output.schema.properties||{}),`${name}: output schema excludes ${key}`)
      }
      const content=spec.output.render({},value)
      assert.ok(Array.isArray(content),`${name}: render must return content blocks array`)
      assert.equal(content.some(b=>b.type==='image'),false,`${name}: content.some must work`)
      assert.ok(content.every(b=>b.type==='text'&&typeof b.text==='string'),`${name}: invalid text block`)
    }
    assert.deepEqual(r.warnings,[])
  } finally {r.cleanup()}
})
