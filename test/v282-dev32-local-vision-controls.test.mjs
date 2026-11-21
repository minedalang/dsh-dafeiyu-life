import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLocalVisionModelManager} from '../lib/local-vision-model-manager.mjs'
const load=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('local Ollama thinking settings remain independent while low-res boards stay fixed at 12 tiles',()=>{
  const html=load('lib/management-console.html')
  const js=load('lib/management-console.js')
  const source=load('index.js')
  for(const token of ['local-vision-thinking','local-vision-thinking-save','local-vision-model'])assert.ok(html.includes(token),token)
  assert.match(js,/visionLocalThinking:mode/)
  assert.doesNotMatch(html,/id="bili-vision-board-tiles"/)
  assert.match(js,/request\('\/video-vision\/plan',\{visionFrames:frames\}\)/)
  assert.match(source,/visionLocalThinking: z\.string\(\)/)
  assert.match(source,/BILI_VISION_LOCAL_THINKING/)
  assert.match(source,/toolName==='bili_preview_vision'&&resolvedVisionMode\(\)==='independent_local'/)
  assert.match(source,/localVisionModels\.inspectThinking/)
  assert.match(js,/boardReports\.slice\(0,12\)/)
})

test('local visual acceptance displays a single truthful status and hides the warning after approval',()=>{
  const html=load('lib/management-console.html')
  const js=load('lib/management-console.js')
  for(const id of ['local-vision-status','local-vision-review-inline','local-vision-review-label','local-vision-review-jump','local-vision-status-tail']){
    assert.equal([...html.matchAll(new RegExp('\\bid="'+id+'"','g'))].length,1,`duplicate DOM id: ${id}`)
  }
  assert.match(html,/class="local-vision-review-inline" hidden/, 'review banner starts hidden')
  assert.match(html,/\.local-vision-review-inline\[hidden\][^}]*\{display:none!important\}/, 'CSS must not override hidden state')
  assert.match(js,/const needsReview=state\.running===true&&model\?\.installed===true&&model\?\.verified!==true/)
  assert.match(js,/\$\('local-vision-review-inline'\)\.hidden=!needsReview/)
  assert.match(js,/await request\('\/local-vision\/review',\{model:id,reviewId:record\.reviewId,accepted\}\)/)
  assert.match(js,/await loadLocalVisionStatus\(\)/)
  assert.match(js,/本地视觉状态读取失败；请检查连接后刷新。/)
  assert.match(js,/\$\('local-vision-review-inline'\)\.hidden=true/)
  assert.match(js,/badge\.textContent='后台状态读取失败 · 无法确认已启用'/)
})

test('Ollama thinking capability metadata controls named levels; missing metadata remains unknown',async()=>{
  let mode='known'
  const manager=createLocalVisionModelManager({fetchImpl:async(url,opts)=>({
    ok:true,status:200,json:async()=> mode==='known'?{thinking:{values:[false,true,'low','medium'],default:'medium'}}:{}
  })})
  const known=await manager.inspectThinking('qwen3.5-4b')
  assert.deepEqual(known.values,[false,true,'low','medium'])
  assert.equal(known.known,true)
  mode='unknown'
  const unknown=await manager.inspectThinking('minicpm-v4.7-1b')
  assert.equal(unknown.known,false)
  assert.equal(unknown.ok,true)
  const bad=await manager.inspectThinking('untrusted:model')
  assert.equal(bad.ok,false)
})

test('manual local visual selftest forwards configured thinking and token allowance to Ollama',async()=>{
  const calls=[]
  const manager=createLocalVisionModelManager({fetchImpl:async(url,opts={})=>{
    const path=new URL(url).pathname
    const body=opts.body?JSON.parse(opts.body):{}
    calls.push({path,body})
    if(path==='/api/tags')return {ok:true,json:async()=>({models:[{name:'qwen3.5:4b',digest:'a'.repeat(64)}]})}
    if(path==='/api/show')return {ok:true,json:async()=>({thinking:{values:[false,true,'low','medium','high']}})}
    if(path==='/api/chat')return {ok:true,json:async()=>({message:{content:'看到了图片中的角色。'},done_reason:'stop'})}
    throw Error('Unexpected path '+path)
  }})
  const enabled=await manager.verifyId('qwen3.5-4b',{thinkingMode:'on'})
  assert.equal(enabled.ok,true)
  const first=calls.filter(x=>x.path==='/api/chat').at(-1).body
  assert.equal(first.think,true)
  assert.equal(first.options.num_predict,8192)
  const disabled=await manager.verifyId('qwen3.5-4b',{thinkingMode:'off'})
  assert.equal(disabled.ok,true)
  const second=calls.filter(x=>x.path==='/api/chat').at(-1).body
  assert.equal(second.think,false)
  assert.equal(second.options.num_predict,4096)
  assert.match(load('index.js'),/localVisionModels\.verifyId\(id,\{thinkingMode:cfg\.visionLocalThinking/)
})
