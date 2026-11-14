import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const security=readFileSync(new URL('../lib/headless-security.mjs',import.meta.url),'utf8')
const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
test('two headless paths share a tool-disabling overlay',()=>{
  assert.match(code, /HEADLESS_DENY_TOOLS/)
  for(const id of ['tool-fs','tool-bash','tool-pwsh','tool-subagent','tool-workflow','tool-session-query','agent-instructions']) assert.ok(security.includes(`'${id}'`),id)
  assert.match(code,/for \(const id of HEADLESS_DENY_TOOLS\)/)
  assert.match(code,/ensureOverlay\(true\)/)
  assert.match(code,/if \(!overlay\) return \{ started:false/)
})
test('dynamic sync is opt in and performed after comment receipt',()=>{
  assert.match(code,/commentSyncDynamic: z\.boolean\(\)\.default\(true\)/)
  assert.match(code,/BILI_SYNC_DYNAMIC/)
  assert.match(client,/AI 决定是否将评论同步到动态/)
  assert.match(python,/out\["dynamic_sync"\] = await _dynamic_after_comment/)
  assert.match(python,/if rpid == 0 and \(out\.get\("rpid"\)/)
  assert.match(python,/await asyncio\.to_thread\(post\)/)
  assert.ok(!python.includes('llm.generate('),'dynamic must not call an LLM')
})
test('host and MCP do not load workspace files into model prompts',()=>{
  const start=code.indexOf('function dmChatPrompt(')
  const end=code.indexOf('async function invokeInteractionPrompt(',start)
  assert.ok(start>0&&end>start)
  assert.ok(!code.slice(start,end).includes("join(ws, 'AGENTS.md')"))
  assert.ok(code.includes('BILI_DUTY_HOME: '))
  assert.ok(python.includes('BILI_DM_TARGET_UID'))
})
