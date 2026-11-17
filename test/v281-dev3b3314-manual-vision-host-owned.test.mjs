import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {verifyManualVisionPacket,startManualVisionHostExecutor,MANUAL_VISION_PROMPT} from '../lib/vision-host-owned-executor.mjs'

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'dsh-host-vision-'))
  const home=join(root,'duty'),desktop=join(root,'desktop'),proof=join(home,'vision-proof')
  mkdirSync(proof,{recursive:true})
  mkdirSync(join(desktop,'resources'),{recursive:true})
  const exe=join(desktop,'DeepSeek Harness.exe')
  const asar=join(desktop,'resources','app.asar')
  writeFileSync(exe,'fixture')
  writeFileSync(asar,'fixture')
  const cli=join(asar,'dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js')
  const baseOverlay=join(home,'headless-vision-selftest-overlay.yml')
  writeFileSync(baseOverlay,'- insert:\n    - id: mcp-bili-vision-readonly\n          BILI_MCP_TOOLS: bili_vision_selftest\n')
  const id='a'.repeat(32)
  const privateOverlay=join(proof,id+'.yml')
  writeFileSync(privateOverlay,`- insert:\n    - id: mcp-bili-vision-readonly\n          BILI_MCP_TOOLS: bili_vision_selftest\n          BILI_VISION_PROOF_FILE: '${join(proof,id+'.json').replace(/\\/g,'/')}'\n`)
  const env={BILI_DUTY_HOME:home,BILI_VISION_DSH_WORKDIR:root}
  const args=['--expose-internals',cli,'--profile','headless']
  const packet=(tail, cwd=home)=>({exe,argv:[...args,...tail],cwd,timeoutMs:5000})
  return {root,home,exe,cli,baseOverlay,privateOverlay,env,packet,dispose(){rmSync(root,{recursive:true,force:true})}}
}

function fakeSpawn(log){
  return (_exe,_argv,opts)=>{
    log.push({argv:_argv,opts})
    const child=new EventEmitter()
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{}
    setImmediate(()=>{
      child.stdout.write(Buffer.from('fixture-dump'))
      child.stdout.end();child.stderr.end();child.emit('close',0)
    })
    return child
  }
}

test('manual host accepts only default, base and private fixed-image config/run',()=>{
  const f=fixture()
  try{
    const common={home:f.home,exe:f.exe,cli:f.cli,baseOverlay:f.baseOverlay,
      workdir:f.root,baseText:requireBase(f.baseOverlay),env:f.env}
    assert.equal(verifyManualVisionPacket(f.packet(['--dump-default-config']),common),'dump')
    assert.equal(verifyManualVisionPacket(f.packet(['--dump-config']),common),'dump')
    assert.equal(verifyManualVisionPacket(f.packet(['--patch',f.privateOverlay,'--dump-config']),common),'private_dump')
    assert.equal(verifyManualVisionPacket(f.packet(['--patch',f.privateOverlay,MANUAL_VISION_PROMPT]),common),'manual_image_review')
    assert.throws(()=>verifyManualVisionPacket(f.packet(['--patch',f.baseOverlay,'run-anything']),common))
    assert.throws(()=>verifyManualVisionPacket(f.packet(['--patch',f.privateOverlay,'--execute-shell']),common))
    assert.throws(()=>verifyManualVisionPacket(f.packet(['--patch',f.privateOverlay,'固定图片测试'],join(f.root,'unknown')),common))
  }finally{f.dispose()}
})
function requireBase(file){return requireSafeRead(file)}
import {readFileSync} from 'node:fs'
function requireSafeRead(file){return readFileSync(file,'utf8')}

test('host starts exactly a scoped DSH child, rejects absent token and forged executable',async()=>{
  const f=fixture(),calls=[]
  let server
  try{
    server=await startManualVisionHostExecutor({home:f.home,exe:f.exe,cli:f.cli,baseOverlay:f.baseOverlay,
      workdir:f.root,env:f.env,spawnImpl:fakeSpawn(calls)})
    const endpoint=`http://127.0.0.1:${server.env.BILI_VISION_HOST_PORT}/vision`
    const post=async(packet,token=server.env.BILI_VISION_HOST_TOKEN)=>await fetch(endpoint,{
      method:'POST',headers:{'X-Vision-Token':token,'Content-Type':'application/json'},
      body:JSON.stringify(packet)})
    const denied=await post(f.packet(['--dump-default-config']),'0'.repeat(64))
    assert.equal(denied.status,403)
    const fake=f.packet(['--dump-default-config']);fake.exe=join(f.root,'other.exe')
    assert.equal((await post(fake)).status,403)
    const result=await post(f.packet(['--patch',f.privateOverlay,'--dump-config']))
    assert.equal(result.status,200)
    const data=await result.json()
    assert.equal(data.kind,'process_result')
    assert.equal(data.exitCode,0)
    assert.equal(Buffer.from(data.out,'base64').toString('utf8'),'fixture-dump')
    assert.equal(calls.length,1)
    assert.equal(calls[0].opts.shell,false)
    assert.equal(calls[0].opts.env.ELECTRON_RUN_AS_NODE,'1')
  }finally{await server?.close();f.dispose()}
})

test('host rejects private overlay content changes; never allows public writable tools',()=>{
  const f=fixture()
  try{
    writeFileSync(f.privateOverlay,readFileSync(f.privateOverlay,'utf8')+'\n          BILI_MCP_TOOLS: tool-bash\n')
    assert.throws(()=>verifyManualVisionPacket(f.packet(['--patch',f.privateOverlay,MANUAL_VISION_PROMPT]),{
      home:f.home,exe:f.exe,cli:f.cli,baseOverlay:f.baseOverlay,workdir:f.root,
      baseText:readFileSync(f.baseOverlay,'utf8'),env:f.env}))
  }finally{f.dispose()}
})
