import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

async function fixture(t,{hostMode='none'}={}){
  const home=mkdtempSync(join(tmpdir(),'dev9-host-save-'))
  t.after(()=>rmSync(home,{recursive:true,force:true}))
  let handler
  const user={};let updates=0
  const settings={
    describe(){return hostMode==='none'?[]:[{ns:'dafeiyu-life',revision:1,user:{...user},value:{perDay:10,mentionName:'',overlayMcp:false,...user}}]},
    async update(ns,patch){assert.equal(ns,'dafeiyu-life');updates++;if(hostMode==='stale')return;Object.assign(user,patch)}
  }
  apply({get:key=>key==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:callback=>callback(),settings},{})
  async function call(method,path,body){
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8855',origin:'http://127.0.0.1:8855'}
    let status,bodyText=''
    await handler(req,{writeHead(code){status=code},end(value){bodyText=String(value||'')}})
    return {status,data:JSON.parse(bodyText)}
  }
  return {call,home,updates:()=>updates}
}
async function saveChangedMemory(app){
  const initial=await app.call('GET','onboarding/quick/options')
  assert.equal(initial.status,200)
  const m=initial.data.memory
  const command={kind:'memory',choice:'curious',revision:m.revision,previewOnly:false,confirm:'APPLY_QUICK_MEMORY'}
  return {response:await app.call('POST','onboarding/quick/save',command),before:m}
}

test('宿主完全不可写：本地文件和运行配置回读一致，原生镜像明确未同步',async t=>{
  const app=await fixture(t,{hostMode:'none'}),{response,before}=await saveChangedMemory(app)
  assert.equal(response.status,200)
  assert.equal(response.data.localVerified,true)
  assert.equal(response.data.host.ok,false)
  assert.equal(response.data.host.role,'optional-native-mirror')
  assert.match(response.data.host.error,/没有可写/)
  const after=(await app.call('GET','config')).data.config
  assert.equal(after.mainSessionMemoryEnabled,true)
  assert.equal(after.mainSessionMemoryHalfLifeDays,45)
  assert.equal(after.mainSessionReflectionAuto,true)
})

test('宿主更新接口成功但用户层没有变化：不伪称已同步，也不丢本地配置',async t=>{
  const app=await fixture(t,{hostMode:'stale'}),{response,before}=await saveChangedMemory(app)
  assert.equal(response.status,200)
  assert.equal(response.data.localVerified,true)
  assert.equal(response.data.host.ok,false)
  assert.ok(app.updates()>=1)
  assert.match(response.data.host.error,/读回来还是旧值/)
  const after=(await app.call('GET','config')).data.config
  assert.equal(after.mainSessionMemoryEnabled,true)
  assert.equal(after.mainSessionMemoryHalfLifeDays,45)
})

test('宿主镜像更新且回读成功：本地确认和宿主确认均真实',async t=>{
  const app=await fixture(t,{hostMode:'success'}),{response}=await saveChangedMemory(app)
  assert.equal(response.status,200)
  assert.equal(response.data.localVerified,true)
  assert.equal(response.data.host.ok,true)
  assert.ok(app.updates()>=1)
})
