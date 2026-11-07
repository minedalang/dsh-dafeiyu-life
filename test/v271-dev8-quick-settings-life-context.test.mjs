import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createFirstStart} from '../lib/first-start.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

test('旧用户每版本只需查看一次快速设置，不会重置登录或业务运行门禁',t=>{
  const dir=mkdtempSync(join(tmpdir(),'quick-v2-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const credential=join(dir,'bili-credential.json');writeFileSync(credential,'existing')
  writeFileSync(join(dir,'first-start-v1.json'),JSON.stringify({version:1,completed:true,welcomeSeen:true,biliCredentialHash:createHash('sha256').update('existing').digest('hex'),skipped:[]}))
  const gate=createFirstStart({stateDir:dir,credentialPath:credential,headlessSync:{hasAnyVerified:()=>true}})
  assert.equal(gate.isReady(),true);assert.equal(gate.status().quickSetupSeen,false)
  assert.equal(gate.status().requiredReady,true)
  gate.acknowledgeQuickSetup()
  assert.equal(gate.status().quickSetupSeen,true)
  assert.equal(gate.isReady(),true)
  assert.equal(readFileSync(credential,'utf8'),'existing')
  assert.equal(gate.status().skipped.length,0)
})

test('从零安装的快速设置确认不替代必需 B站与模型验证',t=>{
 const dir=mkdtempSync(join(tmpdir(),'quick-new-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const gate=createFirstStart({stateDir:dir,credentialPath:join(dir,'absent'),headlessSync:{hasAnyVerified:()=>false}})
 assert.equal(gate.status().quickSetupSeen,false)
 gate.acknowledgeQuickSetup()
 assert.equal(gate.status().quickSetupSeen,true)
 assert.equal(gate.isReady(),false)
 assert.throws(()=>gate.complete([]),/不能跳过/)
})

test('上下文读取失败记录 blocked 技术原因，不请求模型、不批准任何动作',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'life-ctx-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let modelCalls=0;const stages=[]
 const actor=createLifeWillingness({dataDir:dir,getAccountTag:()=> 'a'.repeat(16),enabled:()=>true,
  getContext:()=>{throw Error('/private/user/path/password')},
  beginTrace:()=>({step:(a,b)=>stages.push({type:a,...b}),finish:b=>stages.push({type:'finish',...b})}),
  invokeModel:async()=>{modelCalls++;return '{"action":"act","candidateId":"observe","reason":"OK"}'}})
 const answer=await actor.decide({sourceKey:'verified-test-context:1',scene:'main',
  candidates:[{id:'observe',kind:'reflect',label:'整理近期经历'}]})
 assert.equal(answer.reason,'life-context-unavailable')
 assert.equal(modelCalls,0)
 assert.ok(stages.some(x=>x.type==='blocked'&&x.layer==='context'))
 assert.equal(JSON.stringify(stages).includes('/private'),false)
})

test('可选上下文降级允许正常选择且只留脱敏分类，无外发授权变化',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'life-partial-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const stages=[]
 const actor=createLifeWillingness({dataDir:dir,getAccountTag:()=> 'a'.repeat(16),enabled:()=>true,
  getContext:()=>({voice:'原设人格',world:{publicInterests:[]},degradedStages:['interests','growth-or-emotion','/secret']}),
  beginTrace:()=>({step:(type,fields)=>stages.push({type,...fields}),finish:()=>{}}),
  invokeModel:async()=>'{"action":"defer","reason":"稍后再看"}'})
 const answer=await actor.decide({sourceKey:'verified-test-context:2',scene:'main',
  candidates:[{id:'observe',kind:'reflect',label:'反思已证实的经历'}]})
 assert.equal(answer.action,'defer');assert.equal(answer.ok,false)
 assert.equal(stages.filter(x=>x.code==='life-context-degraded').length,2)
 assert.equal(JSON.stringify(stages).includes('/secret'),false)
})

test('快速设置统一入口不复制配置字段，记忆方案与记忆参数同栏并可展开精确值',()=>{
 const html=read('lib/management-console.html'),js=read('lib/management-console.js'),server=read('index.js')
 assert.match(html,/🚀 快速设置<\/button>/)
 assert.match(html,/id="fs-quick-ack"/)
 for(const target of ['life-agent','life','social','models'])assert.match(html,new RegExp('class="quick-setting-card" data-open-tab="'+target+'"'))
 const memory=html.indexOf('id="life-memory-settings"'),profile=html.indexOf('id="life-organic-presets"'),controls=html.indexOf('id="settings-memory"')
 assert.ok(memory>=0&&memory<profile&&profile<controls)
 assert.equal(html.split('id="life-organic-presets"').length-1,1)
 assert.match(html,/id="life-organic-parameters-details"/)
 assert.match(js,/describeOrganicParameters/)
 assert.match(js,/onboarding\/quick\/seen/)
 assert.match(server,/firstStart\.acknowledgeQuickSetup/)
 assert.match(js,/!state\.quickSetupSeen/)
 assert.match(server,/degradedStages/)
})
