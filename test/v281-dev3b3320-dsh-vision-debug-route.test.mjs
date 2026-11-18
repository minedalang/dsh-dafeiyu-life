import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {callScopedDshVision} from '../lib/scoped-dsh-vision-read.mjs'

const env={BILI_VISION_DSH_ARGV:JSON.stringify(['C:/trusted/DSH.exe','--profile','headless','--patch','C:/home/headless-vision-overlay.yml']),
  BILI_VISION_ENABLED:'1',BILI_VISION_MODE:'independent_dsh',BILI_MCP_TOOLS:'bili_preview_vision',
  BILI_VISION_HOST_REQUIRED:'1'}
const args={bvid:'BV1234567890',perception_source:'adaptive',view_depth:'deep',capture_for_debug:true}
const read=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8')

test('DSH 视频 Debug 单次专用 MCP 获得真实路由与临时宿主能力、完成后释放令牌',async()=>{
  let closed=0,stopped=0,seen={}
  const result=await callScopedDshVision({command:'python',script:'C:/home/mcp_server.py',home:'C:/home',env,args,
    startHost:async()=>({env:{BILI_VISION_HOST_PORT:'18219',BILI_VISION_HOST_TOKEN:'f'.repeat(64)},close:async()=>{closed++}}),
    makeClient:cfg=>{seen.config=cfg;return {call:async(name,payload,options)=>{
      seen.name=name;seen.args=payload;seen.options=options
      return {ok:true,status:'analyzed',description:'真实图片模型回执'}
    },stop:()=>{stopped++}}}})
  assert.deepEqual(result,{ok:true,status:'analyzed',description:'真实图片模型回执'})
  assert.equal(seen.name,'bili_preview_vision')
  assert.deepEqual(seen.args,args)
  assert.equal(seen.config.env.BILI_VISION_DSH_ARGV,env.BILI_VISION_DSH_ARGV)
  assert.equal(seen.config.env.BILI_MCP_TOOLS,'bili_preview_vision')
  assert.equal(seen.config.env.BILI_VISION_HOST_TOKEN,'f'.repeat(64))
  assert.equal(seen.config.env.BILI_VISION_HOST_PORT,'18219')
  assert.equal(seen.options.timeoutMs,250000)
  assert.equal(stopped,1);assert.equal(closed,1)
})

test('没有真实 DSH 路由绝不启动 MCP 或宿主，也不误认为用户验收失败',async()=>{
  let starts=0
  await assert.rejects(()=>callScopedDshVision({command:'python',script:'C:/home/mcp_server.py',home:'C:/home',
    env:{...env,BILI_VISION_DSH_ARGV:''},startHost:async()=>{starts++}}),/执行路由未配置/)
  assert.equal(starts,0)
})

test('Windows 受限执行能力缺失，不允许回退到旧 Python Bridge',async()=>{
  let clientStarted=false
  await assert.rejects(()=>callScopedDshVision({command:'python',script:'mcp_server.py',home:'C:/home',env,
    makeClient:()=>{clientStarted=true},startHost:async()=>null}),/宿主执行能力不可用/)
  assert.equal(clientStarted,false)
})

test('MCP 返回失败、返回无效内容、抛出异常，均要关闭宿主与子进程',async()=>{
  for(const kind of ['mcp-failed','bad-result','exception']){
    let stopped=0,closed=0
    const makeClient=()=>({call:async()=>{
      if(kind==='exception')throw Error('runtime failed')
      return kind==='bad-result'?{status:'analyzed'}:{ok:false,status:'vision_config_error'}
    },stop:()=>stopped++})
    const opts={command:'python',script:'mcp_server.py',home:'C:/home',env,args,
      makeClient,startHost:async()=>({env:{BILI_VISION_HOST_TOKEN:'a'.repeat(64),BILI_VISION_HOST_PORT:'1278'},close:async()=>closed++})}
    if(kind==='mcp-failed')assert.deepEqual(await callScopedDshVision(opts),{ok:false,status:'vision_config_error'})
    else await assert.rejects(()=>callScopedDshVision(opts))
    assert.equal(stopped,1);assert.equal(closed,1)
  }
})

test('管理页区分保存、图片人工认可与真实视频全链路；保存相同路由不撤销已认可结果',()=>{
  const ui=read('lib/management-console.js'),host=read('index.js')
  assert.match(ui,/DSH 模型已保存，但还不能视为配置完成/)
  assert.match(ui,/图片验收不等于视频链路通过/)
  assert.match(host,/const scopedDshVision=toolName==='bili_preview_vision'/)
  assert.match(host,/callPluginScopedDshVision\(args,opts\)/)
  assert.match(host,/BILI_VISION_DSH_ARGV:JSON.stringify\(\[dsh.command,\.\.\.visionArgs\]\)/)
  assert.match(host,/BILI_VISION_HOST_REQUIRED:process.platform==='win32'\?'1':'0'/)
  assert.doesNotMatch(host,/dshVisionReview\.clear\(\)\s*\n\s*if\(body\?\.socialOutreachEnabled/)
})

test('真实 MCP 子进程握手能收到单次 DSH 路由与受限宿主令牌（不访问 B站）',async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const directory=mkdtempSync(join(tmpdir(),'dafeiyu-vision-scoped-mcp-'))
  const server=join(directory,'fake-mcp.mjs')
  writeFileSync(server,`let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let idx;while((idx=buffer.indexOf('\\n'))>=0){
 const line=buffer.slice(0,idx);buffer=buffer.slice(idx+1);if(!line)continue;
 const request=JSON.parse(line);if(request.id===undefined)continue;
 const payload=request.method==='initialize'?{capabilities:{},serverInfo:{name:'fake'}}:
 {content:[{type:'text',text:JSON.stringify({ok:true,status:'analyzed',
  route:process.env.BILI_VISION_DSH_ARGV,host:process.env.BILI_VISION_HOST_TOKEN,
  tool:request.params.name,tools:process.env.BILI_MCP_TOOLS})}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:payload})+'\\n')
}})`)
  try{
    let closed=0
    const returned=await callScopedDshVision({command:process.execPath,script:server,home:directory,env,args,
      startHost:async()=>({env:{BILI_VISION_HOST_PORT:'19201',BILI_VISION_HOST_TOKEN:'f'.repeat(64)},close:async()=>closed++})})
    assert.equal(returned.ok,true)
    assert.equal(returned.status,'analyzed')
    assert.equal(returned.route,env.BILI_VISION_DSH_ARGV)
    assert.equal(returned.host,'f'.repeat(64))
    assert.equal(returned.tool,'bili_preview_vision')
    assert.equal(returned.tools,'bili_preview_vision')
    assert.equal(closed,1)
  }finally{rmSync(directory,{recursive:true,force:true})}
})
