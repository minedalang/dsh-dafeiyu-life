import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,lstatSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDshVisionReview} from '../lib/dsh-vision-review.mjs'

const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')

test('3b.22 图片验收失败/重启只存结构化诊断，不持久化密钥、回文、reviewId',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-3b22-review-'))
 try{
  const file=join(dir,'dsh-vision-selftest-last-run.json'),route={provider:'muze-gpt',model:'gpt-6-luna',baseURL:'https://private.example/x?key=SECRET'}
  const mgr=createDshVisionReview({stateFile:file,getRoute:()=>route,probe:async()=>({
   ok:false,error:'DSH 验收失败',diagnosticCode:'provider_auth',diagnostics:{
     mcpPreflight:{status:'ready'},mcpImage:{status:'verified'},providerApi:{status:'not_confirmed'},modelAnswer:{status:'not_returned'},
   },answer:'PRIVATE_MODEL_ANSWER',stderr:'SECRET',headers:{authorization:'SECRET'},
  })})
  await assert.rejects(mgr.verify(),/DSH 验收失败/)
  assert.equal(mgr.status().status,'failed')
  const persisted=readFileSync(file,'utf8')
  for(const privateToken of ['SECRET','PRIVATE_MODEL_ANSWER','private.example','reviewId','stderr','headers','https:']){
   assert.equal(persisted.includes(privateToken),false,privateToken)
  }
  const obj=JSON.parse(persisted)
  assert.equal(obj.last.diagnosticCode,'provider_auth')
  assert.equal(obj.last.mcpImage,'verified')
  assert.equal(obj.last.preflight,'ready')
  assert.equal(lstatSync(file).isFile(),true)
  const restarted=createDshVisionReview({stateFile:file,getRoute:()=>route,probe:async()=>({ok:true,answer:'真图像描述'})})
  assert.equal(restarted.status().status,'idle')
  assert.equal(restarted.status().verified,false)
  assert.equal(restarted.status().lastRun.status,'failed')
  const result=await restarted.verify()
  assert.equal(restarted.review({reviewId:result.reviewId,accepted:true}).verified,true)
  assert.equal(JSON.parse(readFileSync(file)).last.status,'approved')
  const afterRestart=createDshVisionReview({stateFile:file,getRoute:()=>route,probe:async()=>{throw Error('not called')}})
  assert.equal(afterRestart.status().verified,false,'restart must never inherit manual approval')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('3b.22 诊断持久文件是 symlink 时拒绝落盘',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-3b22-symlink-'))
 try{
  const out=join(dir,'outside'),file=join(dir,'dsh-vision-selftest-last-run.json')
  writeFileSync(out,'DO NOT MODIFY')
  symlinkSync(out,file)
  const mgr=createDshVisionReview({stateFile:file,getRoute:()=>({provider:'p',model:'m'}),probe:async()=>({ok:true,answer:'描述'})})
  await mgr.verify()
  assert.equal(readFileSync(out,'utf8'),'DO NOT MODIFY')
  assert.equal(mgr.status().lastRun.status,'awaiting_review')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('3b.22 同源虚线只按真实 Provider/model 匹配；移动端使用标记而非穿插连线',()=>{
 const html=source('lib/management-console.html'),js=source('lib/management-console.js')
 assert.match(html,/id="headless-sync-links"/)
 assert.match(html,/headless-pair-link/)
 assert.match(html,/@media\(max-width:850px\)\{\.headless-sync-links\{display:none\}/)
 assert.match(js,/row\.dataset\.headlessPair=p\.id\+'\\u0000'\+model/)
 assert.match(js,/if\(!target\|\|source\.dataset\.connected!=='true'/)
 assert.match(js,/ResizeObserver\(queueHeadlessLinks\)/)
 assert.match(js,/setHeadlessLinkFocus/)
 assert.doesNotMatch(html,/id="dsh-vision-config-generate"/)
 assert.doesNotMatch(html,/id="dsh-vision-capabilities-guide"/)
 assert.doesNotMatch(js,/dshVisionModelSnippet|dsh-vision-config-copy/)
 assert.match(js,/补充图片与思考能力/)
})

test('3b.22 文字验证/同步/声明修改刷新真实图片状态；不允许未同步模型绕过禁用',()=>{
 const js=source('lib/management-console.js'),python=source('lib/vision_dsh.py'),index=source('index.js')
 assert.match(js,/await loadHeadlessModels\(\);await loadDshVisionStatus\(\);await loadFirstStart\(\)/)
 assert.match(js,/await loadHeadlessModels\(\);await loadDshVisionStatus\(\);syncMessage/)
 assert.match(js,/verifyButton\.disabled=mobileViewOnly\|\|!p\.synced/)
 assert.doesNotMatch(js,/verifyButton\.disabled=mobileViewOnly;verifyButton\.title/)
 assert.match(js,/const seq=\+\+dshVisionStatusRequestSeq/)
 assert.match(js,/if\(seq!==dshVisionStatusRequestSeq\)return null/)
 assert.match(js,/const timeoutMs=path==='\/dsh-vision\/verify'\?240000:120000/)
 assert.match(js,/dshVisionStatus\?\.route\?\.headlessVerified!==true/)
 assert.match(python,/async def _probe_mcp_stdio_tool/)
 assert.match(python,/await session\.list_tools\(\)/)
 assert.match(python,/await session\.call_tool\('bili_vision_selftest',\{\}\)/)
 assert.match(index,/stateFile:join\(stateDir,'dsh-vision-selftest-last-run\.json'\)/)
 assert.match(index,/child\.stderr\?\.resume\(\)/)
 assert.match(index,/if\(parsed&&typeof parsed==='object'&&typeof parsed\.ok==='boolean'\)/)
})
