import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeAsrMirrors,installAsrPythonPackages,ASR_INSTALL_TIMEOUT_EXIT_CODE} from '../lib/asr-install.mjs'
import {readLifePlannerDiagnostics} from '../lib/life-planner-status.mjs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('quick share save no longer references the removed daily limit and validates only the selected mode',()=>{
  const ui=read('lib/management-console.js')
  const start=ui.indexOf("$('quick-share-save').addEventListener")
  const end=ui.indexOf('// First Start: versioned welcome gate',start)
  assert.ok(start>=0&&end>start)
  const handler=ui.slice(start,end)
  assert.doesNotMatch(handler,/\blimit\b/)
  assert.match(handler,/!?\[['"]paused['"],['"]autonomous['"]\]\.includes\(choice\)/)
  assert.match(handler,/quickConfirmSave\('social'/)
})

test('ASR install exposes the official faster-whisper, PyPI and model source links',()=>{
  const html=read('lib/management-console.html')
  for(const href of [
    'https://github.com/SYSTRAN/faster-whisper',
    'https://pypi.org/project/faster-whisper/',
    'https://huggingface.co/Systran'
  ]) {
    assert.ok(html.includes(href),href)
  }
  assert.match(html,/PyPI 镜像连续 180 秒无输出会自动切换/)
  assert.match(html,/依赖安装和模型下载是两个独立阶段/)
})

test('ASR mirror list accepts HTTPS mirrors only and removes duplicates',()=>{
  assert.deepEqual(normalizeAsrMirrors('https://pypi.tuna.tsinghua.edu.cn/simple'),[
    'https://pypi.tuna.tsinghua.edu.cn/simple',
    'https://mirrors.ustc.edu.cn/pypi/simple',
    'https://mirrors.aliyun.com/pypi/simple'
  ])
  assert.deepEqual(normalizeAsrMirrors('http://insecure.example/simple'),[
    'https://pypi.tuna.tsinghua.edu.cn/simple',
    'https://mirrors.ustc.edu.cn/pypi/simple',
    'https://mirrors.aliyun.com/pypi/simple'
  ])
})

test('ASR child process timeout terminates a stalled installer and resolves the attempt',()=>{
  const index=read('index.js')
  const start=index.indexOf('const spawnTo = (cmd, args')
  const end=index.indexOf('const runAsrInstall',start)
  const runner=index.slice(start,end)
  assert.match(runner,/idleTimer\s*=\s*setTimeout/)
  assert.match(runner,/totalTimer\s*=\s*setTimeout/)
  assert.match(runner,/c\.kill\(\)/)
  assert.match(runner,/ASR_INSTALL_TIMEOUT_EXIT_CODE/)
  assert.match(runner,/c\.once\('close'/)
})

test('a stalled uv mirror is abandoned without waiting on pip at the same mirror; next mirror can succeed',async()=>{
  const calls=[],logs=[]
  const result=await installAsrPythonPackages({
    mirrors:['https://mirror-one.example/simple','https://mirror-two.example/simple'],
    uvCmd:'uv',python:'python.exe',packages:['faster-whisper','yt-dlp','av>=12,<17'],
    sink:line=>logs.push(line),
    spawnTo:async(cmd,args,options)=>{
      calls.push({cmd,args,options})
      if(cmd==='uv'&&args.some(x=>x.includes('mirror-one.example')))return ASR_INSTALL_TIMEOUT_EXIT_CODE
      if(cmd==='uv'&&args.some(x=>x.includes('mirror-two.example')))return 1
      if(cmd==='python.exe'&&args.some(x=>x.includes('mirror-two.example')))return 0
      throw Error('unexpected fallback')
    }
  })
  assert.equal(result.ok,true)
  assert.equal(result.runner,'pip')
  assert.equal(result.mirror,'https://mirror-two.example/simple')
  assert.equal(calls.length,3)
  assert.equal(calls[0].cmd,'uv')
  assert.equal(calls[1].cmd,'uv')
  assert.equal(calls[2].cmd,'python.exe')
  assert.ok(calls.every(x=>x.options.idleTimeoutMs===180_000&&x.options.totalTimeoutMs===15*60_000&&x.options.timeoutAction.includes('切换下一个镜像')))
  assert.ok(!calls[0].args.includes('--timeout'),'uv network timeout is configured via supported UV_HTTP_* environment variables')
  assert.equal(calls[0].options.env.UV_HTTP_TIMEOUT,'20')
  assert.equal(calls[0].options.env.UV_HTTP_CONNECT_TIMEOUT,'10')
  assert.equal(calls[0].options.env.UV_HTTP_RETRIES,'1')
  assert.ok(calls[2].args.includes('--timeout')&&calls[2].args.includes('20'))
  assert.ok(logs.some(x=>String(x).includes('切换下一个镜像')))
})

test('Life planner diagnostics never read Episode without a verified, unblocked account scope',()=>{
  let listCalls=0,healthCalls=0
  const result=readLifePlannerDiagnostics({
    accountTag:'',accountBlocked:false,
    episodes:{list(){listCalls++;throw Error('must not read')},health(){healthCalls++;throw Error('must not read')}},
    eligibleSources(){throw Error('must not read')}
  })
  assert.equal(listCalls,0)
  assert.equal(healthCalls,0)
  assert.deepEqual(result.lifeEpisodes,[])
  assert.equal(result.lifeEpisodeHealth,null)
  assert.deepEqual(result.lifeEpisodeStatus,{
    accountReady:false,listAvailable:false,sourcesAvailable:false,healthAvailable:false,reason:'account-not-ready'
  })
  const blocked=readLifePlannerDiagnostics({
    accountTag:'a'.repeat(16),accountBlocked:true,
    episodes:{list(){listCalls++;throw Error('must not read')},health(){healthCalls++;throw Error('must not read')}}
  })
  assert.equal(listCalls,0,'a blocked account must not open its Episode file')
  assert.equal(healthCalls,0,'a blocked account must not calculate Episode health')
  assert.equal(blocked.lifeEpisodeStatus.reason,'account-not-ready')
})

test('Life planner diagnostics read only the current verified scope and isolate optional Episode failures',()=>{
  const account='a'.repeat(16)
  let listCalls=0,healthCalls=0,sourceCalls=0
  const result=readLifePlannerDiagnostics({
    accountTag:account,accountBlocked:false,
    episodes:{
      list(){listCalls++;return [{id:'current-account-episode'}]},
      health({eligibleSources}){healthCalls++;assert.deepEqual(eligibleSources,['eligible-current']);return {active:1}}
    },
    eligibleSources(){sourceCalls++;return ['eligible-current']}
  })
  assert.equal(listCalls,1)
  assert.equal(healthCalls,1)
  assert.equal(sourceCalls,1)
  assert.deepEqual(result.lifeEpisodes,[{id:'current-account-episode'}])
  assert.deepEqual(result.lifeEpisodeHealth,{active:1})
  assert.equal(result.lifeEpisodeStatus.reason,'ready')
  assert.equal(JSON.stringify(result).includes(account),false)

  let damagedSourceCalls=0,damagedHealthCalls=0
  const damaged=readLifePlannerDiagnostics({
    accountTag:account,accountBlocked:false,
    episodes:{list(){throw Error('corrupt ledger')},health(){damagedHealthCalls++;throw Error('corrupt ledger')}},
    eligibleSources(){damagedSourceCalls++;return []}
  })
  assert.equal(damagedSourceCalls,0,'do not continue Episode diagnostics after the ledger read fails')
  assert.equal(damagedHealthCalls,0)
  assert.deepEqual(damaged.lifeEpisodes,[])
  assert.equal(damaged.lifeEpisodeHealth,null)
  assert.equal(damaged.lifeEpisodeStatus.reason,'episode-storage-unavailable')
})

test('autonomous planner route returns core planner counters before adding isolated optional diagnostics',()=>{
  const index=read('index.js')
  const start=index.indexOf("if(req.method==='GET'&&path==='/api/bili-duty/autonomous-planner')")
  const end=index.indexOf('// 大肥鱼主 Session',start)
  const route=index.slice(start,end)
  assert.match(route,/const plannerStatus=autonomousPlanner\.status\(\)/)
  assert.match(route,/readLifePlannerDiagnostics\(/)
  assert.match(route,/accountTag:trustedLifeAccountTag\(\),accountBlocked:accountBinding\.status\(\)\.blocked/)
  assert.match(route,/return sendJson\(res,200,\{\.\.\.plannerStatus,\.\.\.diagnostics\}\)/)
  assert.doesNotMatch(route,/lifeEpisodes:universalLifeEpisodes\.list/)
})

test('management decision meter explains an unavailable Episode without hiding planner counts',()=>{
  const ui=read('lib/management-console.js')
  assert.match(ui,/当前账号尚未完成核验，Life Episode 历史暂不可读；调度次数与心跳独立可用/)
  assert.match(ui,/Episode 附加诊断暂不可读/)
})
