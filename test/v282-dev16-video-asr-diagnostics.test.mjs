import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=(p)=>readFileSync(new URL(p,import.meta.url),'utf8')

test('ASR outer MCP wall clock is not mislabeled as local inference',()=>{
  const code=source('../index.js')
  const consoleCode=source('../lib/management-console.js')
  const module=code.slice(code.indexOf('const executeWatchVideo = async'),code.indexOf("name:'bili_watch_video'"))
  for(const key of ['subtitleToolMs','asrToolMs','asrMcpTimings'])assert.ok(module.includes(key),key)
  assert.match(module,/asrToolMs=Date\.now\(\)-asrToolStarted/)
  assert.match(module,/mt\.spawnMs\+mt\.childAndPipeMs<=mt\.totalMs\+1000/)
  assert.match(consoleCode,/ASR MCP 调用/)
  assert.match(consoleCode,/MCP 调度\/传输等未归属等待/)
  assert.match(consoleCode,/asrToolMs-mt\.handlerMs/)
  assert.ok(!consoleCode.includes('Whisper: '+String('308.5')))
})

test('whole-video ASR is default; opt-in sampling must not alter permissions',()=>{
  const asr=source('../lib/asr.py')
  const mcp=source('../vendor/bilibili-mcp/mcp_server.py')
  assert.match(asr,/BILI_ASR_LONG_VIDEO_MODE', 'full'/)
  assert.match(asr,/!= 'sample'/)
  assert.match(mcp,/if os\.environ\.get\("BILI_ASR_ENABLED"\) != "1"/)
  assert.match(mcp,/await _run_bounded_asr_process/)
  assert.doesNotMatch(mcp,/await asyncio\.to_thread\(subprocess\.run,/)
  assert.match(mcp,/asyncio\.create_subprocess_exec/)
  assert.match(mcp,/if child\.returncode is None: child\.kill\(\)/)
})
