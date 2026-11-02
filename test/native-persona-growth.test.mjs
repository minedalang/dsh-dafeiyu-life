import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from './helpers/ready-host.mjs'
import {buildGrowthContext, listGrowth, updateGrowthSuggestion} from '../lib/persona-growth.mjs'

const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const managerHtml=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const managerJs=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

function setup() {
  const home=mkdtempSync(join(tmpdir(),'dsh-growth-native-'))
  let handler
  const ctx={
    get:k=>k==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},
    webServer:{register(x){handler=x.handler;return {dispose(){}}}},
    effect:f=>f(),settings:{describe(){return []}}
  }
  apply(ctx,{})
  async function request(method,path,data,{origin,hostHeader='localhost'}={}) {
    const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:hostHeader,...(origin?{origin}:{})}
    let code,body
    const res={writeHead(c){code=c},end(t){try{body=JSON.parse(t)}catch{body=t}}}
    await handler(req,res)
    return {code,body}
  }
  return {request,dir:join(home,'bili-duty'),close:()=>rmSync(home,{recursive:true,force:true})}
}

test('native settings CRUD, approvals affect injected context, delete and undo work on existing growth db',async()=>{
  const x=setup()
  try{
    const initial=await x.request('GET','persona-growth')
    assert.equal(initial.code,200)
    assert.deepEqual(initial.body.data.entries,[])
    const add=await x.request('POST','persona-growth',{action:'add',text:'看到大肥鱼自己的二创时先自然找个嘴硬的角度，而不是以没有技术信息为由直接跳过。',type:'style'})
    assert.equal(add.code,200)
    assert.equal(add.body.result.status,'pending')
    assert.ok(existsSync(join(x.dir,'persona-growth','v1.json')))
    const before=buildGrowthContext(x.dir)
    assert.ok(!before.includes('嘴硬'))
    const blocked=await x.request('POST','persona-growth',{action:'approve',id:add.body.result.id})
    assert.equal(blocked.code,400,'没有提炼建议时，不能将原始反馈直接注入')
    const prematureRevise=await x.request('POST','persona-growth',{action:'revise',id:add.body.result.id,
      suggestion:'看到属于大肥鱼角色相关的视频时，尝试从自己的视角自然吐槽，不要机械地复述台词。'})
    assert.equal(prematureRevise.code,400,'人工反馈不能绕开模型建议直接编辑并审批')
    updateGrowthSuggestion(x.dir,add.body.result.id,{origin:'model',suggestion:'看到属于大肥鱼角色相关的视频时，尝试从自己的视角自然吐槽，不要机械地复述台词。'})
    const approved=await x.request('POST','persona-growth',{action:'approve',id:add.body.result.id})
    assert.equal(approved.code,200)
    assert.equal(approved.body.result.status,'approved')
    const after=await x.request('GET','persona-growth')
    assert.match(after.body.context,/机械地复述台词/)
    assert.match(buildGrowthContext(x.dir),/机械地复述台词/)
    const deleted=await x.request('POST','persona-growth',{action:'delete',id:add.body.result.id})
    assert.equal(deleted.code,200)
    assert.equal(listGrowth(x.dir).entries.length,0)
    const undone=await x.request('POST','persona-growth',{action:'undo'})
    assert.equal(undone.code,200)
    assert.equal(listGrowth(x.dir).entries.length,1)
  }finally{x.close()}
})

test('growth API rejects unexpected actions and remote origins without altering existing data',async()=>{
  const x=setup()
  try{
    const hostile=await x.request('POST','persona-growth',{action:'add',text:'恶意修改私有人设'}, {origin:'https://evil.example'})
    assert.equal(hostile.code,403)
    const noAction=await x.request('POST','persona-growth',{action:'overwritePersona',text:'假的角色背景'})
    assert.equal(noAction.code,400)
    const bad=await x.request('POST','persona-growth',{action:'add',text:'abc',type:'style'})
    assert.equal(bad.code,400)
    assert.deepEqual(listGrowth(x.dir).entries,[])
    assert.equal((await x.request('POST','persona-growth',{action:'sync'})).code,200)
  }finally{x.close()}
})

test('native DSH settings exposes a compact entry and management center owns growth operations',()=>{
  for (const keyword of ['行为与表达改进','直接提交待审核','不调用 AI，直接审核原始反馈','撤销最近修改','/persona-growth','AI 提炼建议','人生记忆']) {
    assert.ok((managerHtml+managerJs).includes(keyword),keyword)
  }
  assert.ok(client.includes('她会自己去 B站、把重要经历带回主 Session'))
  assert.ok(host.includes("path === '/api/bili-duty/persona-growth'"))
  assert.ok(host.includes("+ growthDoc"))
  assert.ok(client.includes("what: 'manage'"))
  assert.ok(host.includes("what === 'manage'"))
  assert.ok(host.includes("path === '/api/bili-duty/manage'"))
})
