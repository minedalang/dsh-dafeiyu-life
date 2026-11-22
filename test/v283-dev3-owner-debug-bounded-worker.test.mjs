import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ownerDebugLocalVision,ownerDebugTimeoutMessage,OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS} from '../lib/owner-video-debug-local-vision.mjs'

const sourceClient={cfg:{command:'python3',args:['/trusted/bili-duty/mcp_server.py'],cwd:'/trusted/bili-duty',
  env:{BILI_DUTY_HOME:'/trusted/bili-duty',BILI_VISION_ENABLED:'1',BILI_VISION_MODE:'independent_local',
    BILI_MCP_TOOLS:'',BILI_JS_MCP_ADAPTER:'1',BILI_JS_READ_GATE_TOKEN:'a'.repeat(64),BILI_VISION_MODEL:'qwen3.5:2b'}}}
const BV='BV1234567890'

test('owner local video Debug creates a one-shot vision-only MCP, without borrowing the shared adapter proof',async()=>{
  let launched,calls=0,stops=0,opts
  const original=JSON.stringify(sourceClient.cfg)
  const stages=[]
  const result=await ownerDebugLocalVision(sourceClient,{bvid:BV},{onStage:phase=>stages.push(phase),makeClient:c=>{
    launched=c
    return {async call(tool,args,options){calls++;opts={tool,args,options};
      c.onStderr('DSH_OWNER_DEBUG_STAGE:frames-rea');
      c.onStderr('ding\nDSH_OWNER_DEBUG_STAGE:model-running\n');
      c.onStderr('DSH_OWNER_DEBUG_STAGE:password=PRIVATE\n');
      return {ok:true,bvid:BV,status:'analyzed'}},
      async stopAndWait(x){stops++;assert.equal(x.timeoutMs,3000)}}
  }})
  assert.equal(result.ok,true)
  assert.equal(calls,1)
  assert.equal(stops,1)
  assert.equal(opts.tool,'bili_preview_vision')
  assert.equal(opts.options.timeoutMs,420000)
  assert.equal(OWNER_DEBUG_LOCAL_VISION_TIMEOUT_MS,420000)
  assert.deepEqual(stages,['worker-starting','frames-reading','model-running'])
  assert.equal(launched.env.DSH_OWNER_VIDEO_DEBUG_STAGE,'1')
  assert.equal(launched.env.BILI_MCP_TOOLS,'bili_preview_vision')
  assert.equal(launched.env.BILI_JS_MCP_ADAPTER,'0')
  assert.equal(launched.env.BILI_JS_READ_GATE_TOKEN,'')
  assert.equal(launched.env.BILI_VISION_MODEL,'qwen3.5:2b')
  assert.deepEqual(launched.args,sourceClient.cfg.args)
  assert.equal(JSON.stringify(sourceClient.cfg),original,'the actual shared MCP configuration is unchanged')
})

test('owner local Debug always closes its own worker on timeout/failure, without touching shared worker',async()=>{
  let stops=0,calls=0
  await assert.rejects(ownerDebugLocalVision(sourceClient,{bvid:BV},{makeClient:()=>({
    async call(){calls++;throw Error('MCP tools/call 超时（420000ms）')},
    async stopAndWait(){stops++},
  })}),/超时/)
  assert.equal(calls,1)
  assert.equal(stops,1)
  assert.equal(sourceClient.proc,undefined)
})

test('owner local Debug fails closed for unverified environment and invalid timeouts',async()=>{
  for(const value of [null,{}, {cfg:{...sourceClient.cfg,env:{...sourceClient.cfg.env,BILI_VISION_MODE:'independent_dsh'}}}])
    await assert.rejects(ownerDebugLocalVision(value,{bvid:BV}),/未经核验/)
  await assert.rejects(ownerDebugLocalVision(sourceClient,{bvid:BV},{timeoutMs:420001}),/超时参数无效/)
})

test('production owner Debug pathways use one-shot worker; Life still uses normal gated call',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(index,/const callOwnerVideoDebugVision=async \(args,\{onStage\}=\{\}\)=>/)
  assert.match(index,/if\(resolvedVisionMode\(\)!=='independent_local'\)return call\('bili_preview_vision',args\)/)
  assert.match(index,/const source=await ensureMcp\(\).*verified production executable/)
  assert.match(index,/ownerDebugLocalVision\(source,args,\{onStage,timeoutMs:/)
  assert.match(index,/dryRun\?args=>callOwnerVideoDebugVision\(args,\{onStage:onVisualStage\}\)/)
  assert.match(index,/try\{visual=parseMaybeJson\(await callOwnerVideoDebugVision\(/)
  assert.match(index,/setTimeout\(\(\)=>\{[\s\S]*?job\.status='error';job\.stage='视频感知处理超出 8 分钟'/)
  assert.match(index,/job\.error=ownerDebugTimeoutMessage\(job\)/)
  assert.doesNotMatch(ui,/请点击「检查中断的 B站读取预约」/)
  assert.match(ui,/已达到核查门槛/)
  assert.match(ui,/不需要手动解锁/)
  assert.match(ui,/最后确认：/)
  assert.match(index,/visualDiagnostic:\s*current\.visualDiagnostic/)
})


test('8m watchdog reports only the last verified phase, never fabricates root cause',()=>{
  const now=600_000
  const model=ownerDebugTimeoutMessage({visualDiagnostic:{phase:'model-running',at:400_000}},now)
  assert.match(model,/Ollama 视觉推理/)
  assert.match(model,/200 秒/)
  assert.match(model,/不能据此断言模型自身故障/)
  const unknown=ownerDebugTimeoutMessage({visualDiagnostic:{phase:'video:SECRET',at:400_000}},now)
  assert.doesNotMatch(unknown,/SECRET/)
  assert.match(unknown,/原因|底层错误/)
})

test('whole-worker deadline includes Python startup, terminates only owned worker',async()=>{
  let stops=0
  await assert.rejects(ownerDebugLocalVision(sourceClient,{bvid:BV},{timeoutMs:1000,
    makeClient:()=>({call:()=>new Promise(()=>{}),stopAndWait:async()=>{stops++}})}),
    error=>error.code==='owner_debug_worker_deadline'&&error.phase==='worker-starting')
  assert.equal(stops,1)
})

test('Python reports fixed operational stages only for the one-shot Debug',()=>{
  const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  assert.match(py,/if os\.environ\.get\('DSH_OWNER_VIDEO_DEBUG_STAGE'\) != '1'/)
  assert.match(py,/sys\.stderr\.write\('DSH_OWNER_DEBUG_STAGE:'/)
  assert.match(py,/_owner_debug_stage\('frames-settled'\)/)
  assert.match(py,/_owner_debug_stage\('model-running'\)/)
  assert.match(py,/platform_read\.close\(\)/)
})
