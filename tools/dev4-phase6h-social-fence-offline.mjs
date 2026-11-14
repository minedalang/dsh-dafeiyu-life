/**
 * Synthetic offline acceptance only: no B站, no network, no model, no DSH_HOME.
 * Uses child Node processes to exercise a real filesystem cross-process lane.
 */
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const moduleUrl=pathToFileURL(fileURLToPath(new URL('../lib/social-handoff-fence.mjs',import.meta.url))).href
const childCode=`import {createSocialHandoffFence} from ${JSON.stringify(moduleUrl)};
const gate=createSocialHandoffFence({dataDir:process.argv[1],getAccountTag:()=>process.argv[3]});
const result=process.argv[2]==='reserve'?gate.reserve({channel:'dm'}):gate.check({channel:'dm'});
console.log(JSON.stringify(result.ok?{ok:true,reason:'reserved'}:{ok:false,reason:result.reason}));`
const child=(dir,action,scope=A)=>{
  const p=spawnSync(process.execPath,['--input-type=module','-e',childCode,dir,action,scope],{
    encoding:'utf8',timeout:10000,env:{...process.env,DSH_HOME:''}
  })
  assert.equal(p.status,0,p.stderr||'子进程验证失败')
  return JSON.parse(p.stdout.trim())
}
export function runPhase6hSocialFenceOffline(){
  const dir=mkdtempSync(join(tmpdir(),'dsh-phase6h-offline-'))
  const scenarios=[]
  const ok=(name,fn)=>{fn();scenarios.push({name,passed:true})}
  try{
    const gate=createSocialHandoffFence({dataDir:dir,getAccountTag:()=>A})
    ok('跨进程排他：一个进程退出后同账号同渠道不能抢占',()=>{
      assert.equal(child(dir,'reserve').ok,true)
      assert.equal(child(dir,'reserve').reason,'handoff-fence-held')
      assert.equal(gate.check({channel:'dm'}).reason,'handoff-fence-held')
    })
    ok('崩溃后保守冻结：进程已消失仍不自动恢复',()=>{
      assert.equal(gate.inspect().channels.dm.held,true)
      assert.equal(gate.inspect().channels.dm.needsReview,true)
      assert.equal(gate.check({channel:'dm'}).ok,false)
    })
    ok('不同 B站登录账号、不同社交渠道分别隔离',()=>{
      assert.equal(child(dir,'check',B).ok,true)
      assert.equal(gate.check({channel:'comment'}).ok,true)
    })
    ok('伪造人工复核和 Life Agent 权限无法解锁或抢权',()=>{
      assert.equal(gate.reviewNoSend({channel:'dm',confirmation:'yes'}).ok,false)
      assert.equal(gate.reserve({channel:'comment',requester:'life-agent'}).ok,false)
      assert.equal(gate.inspect().handoffEnabled,false)
    })
    ok('人工核实无外发且原进程已退出才可恢复旧通道',()=>{
      const res=gate.reviewNoSend({channel:'dm',confirmation:'我已确认该预约从未触发平台发送'})
      assert.equal(res.ok,true,JSON.stringify(res))
      assert.equal(gate.check({channel:'dm'}).owner,'legacy')
    })
    return {ok:true,scenarios,childProcessesUsed:true,networkCalls:0,modelCalls:0,externalMessagesSent:0,
      socialHandoffEnabled:false,realBilibiliTested:false}
  }finally{rmSync(dir,{recursive:true,force:true})}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{console.log(JSON.stringify(runPhase6hSocialFenceOffline(),null,2))}catch(e){console.error(e);process.exitCode=1}
}
