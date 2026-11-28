import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createVisionEnvironmentRepair} from '../lib/vision-environment-repair.mjs'

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'dev3312-')),home=join(root,'home'),a=join(root,'a','python.exe'),b=join(root,'b','python.exe'),req=join(root,'req.txt')
  for(const dir of [home,join(root,'a'),join(root,'b')])mkdirSync(dir,{recursive:true})
  for(const file of [a,b,req])writeFileSync(file,'fixture')
  return {root,home,a,b,req,clean(){rmSync(root,{recursive:true,force:true})}}
}
test('blocked first newly created interpreter recovers via distinct second healthy base',async()=>{
  const f=fixture();const calls=[];let published='',newPaths=[],installReady=false
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.a,configured:()=>f.b,
      probe:(p,{requiresMcp})=>{
        if(p===f.a||p===f.b)return {ok:!requiresMcp,reason:requiresMcp?'missing_mcp_dependencies':'healthy'}
        if(newPaths[0]===p)return {ok:false,reason:'runtime_permission_error'}
        return {ok:!requiresMcp||installReady,reason:'healthy'}
      },
      run:async(cmd,args)=>{
        calls.push({cmd,args})
        if(args[0]==='-m'&&args[1]==='venv'){
          const path=join(args[3],'Scripts','python.exe')
          mkdirSync(join(args[3],'Scripts'),{recursive:true});writeFileSync(path,'fake');newPaths.push(path)
        }
        if(args[0]==='-m'&&args[1]==='pip')installReady=true
        return {ok:true}
      },findUv:async()=>'',persist:async p=>{published=p;return true}})
    const r=await repair.run()
    assert.equal(r.state,'ready');assert.equal(r.reason,'healthy_installed')
    assert.equal(newPaths.length,2);assert.notEqual(newPaths[0],newPaths[1]);assert.equal(published,newPaths[1])
    assert.ok(calls.some(({cmd})=>cmd===f.b));assert.equal(existsSync(f.a),true)
  }finally{f.clean()}
})
test('all new interpreters rejected by ordinary permissions must never be persisted',async()=>{
  const f=fixture();let count=0,save=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.a,configured:()=>f.b,
      probe:(p,{requiresMcp})=>p===f.a||p===f.b?{ok:!requiresMcp,reason:'missing_mcp_dependencies'}:{ok:false,reason:'runtime_permission_error'},
      run:async(_cmd,args)=>{
        if(args[0]==='-m'&&args[1]==='venv'){
          mkdirSync(join(args[3],'Scripts'),{recursive:true});writeFileSync(join(args[3],'Scripts','python.exe'),'fake');count++
        }
        return {ok:true}
      },findUv:async()=>'',persist:async()=>{save++;return true}})
    const r=await repair.run()
    assert.equal(r.state,'failed');assert.equal(r.reason,'runtime_permission_error')
    assert.equal(count,2);assert.equal(save,0)
  }finally{f.clean()}
})
test('model page has opt-in health diagnostic, real visual switch, right pan and non-mutating category filters',()=>{
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const backend=readFileSync(new URL('index.js',root),'utf8')
  for(const id of ['vision-runtime-alert','vision-runtime-alert-open'])
    assert.match(html,new RegExp('id="'+id+'"'))
  assert.match(html,/id="models-vision-enabled"[^>]*type="checkbox"[^>]*role="switch"/)
  assert.match(ui,/checkVisionEnvironmentOnEntry\(\)/)
  assert.match(ui,/neuralScene\.dragMode==='pan'/)
  assert.match(ui,/neuralScene\.panX\+=dx\/geometry\.scale/)
  assert.match(ui,/sceneSVG\.addEventListener\('contextmenu'/)
  assert.match(ui,/neuralVisibleNodes=\(\)=>neuralNodes\.filter/)
  assert.match(backend,/dsh-vision\/runtime-health/)
  assert.match(backend,/probeVisionPythonAsync/)
  assert.doesNotMatch(backend,/runtime-health[\s\S]{0,100}\/dsh-vision\/repair/)
})

test('neural memory categories are only shown in interactive filters, without duplicated legend',()=>{
  const html=readFileSync(new URL('lib/management-console.html',new URL('../',import.meta.url)),'utf8')
  for(const label of ['蓝 · 生活经历','粉 · 人物互动','绿 · 后天兴趣','金 · 事实认识','紫 · 当时情绪'])
    assert.equal(html.split(label).length-1,0,`duplicate category label: ${label}`)
  assert.doesNotMatch(html,/id="neural-layout-mode"/)
  for(const kind of ["","experience","relationship","interest","fact","emotion"])assert.equal(html.split(`data-memory-kind="${kind}"`).length-1,1)
})

test('Ollama video observation retains Python repair and relocated-cache health alert',()=>{
  const root=new URL('../',import.meta.url)
  const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  assert.match(ui,/\$\('vision-python-auto-repair'\)\.hidden=native/);assert.match(ui,/native=visionIsNative\(\)/)
  assert.doesNotMatch(ui,/if\(visionIsLocal\(\)\)throw Error\('当前为 Ollama/)
  assert.match(ui,/local Ollama model still needs the same Python frame worker/)
  assert.match(ui,/result\.stage/)
  assert.match(index,/env:storagePyEnv\(\{BILI_DUTY_HOME:stateDir\}\)/)
  assert.match(index,/stage=check\.stage\|\|''/)
})
