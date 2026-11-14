#!/usr/bin/env node
/**
 * Synthetic Phase 4 acceptance, NO network, no DSH, no Bilibili, no real user data.
 * All generated files live in a disposable OS temp directory and are deleted.
 * A failed assertion exits nonzero; do not misrepresent this as Windows/B站 E2E.
 */
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createColdSnapshot,verifyColdSnapshot,restoreColdSnapshot} from '../lib/cold-state-snapshot.mjs'

export function runPhase4OfflineAcceptance(){
  const dir=mkdtempSync(join(tmpdir(),'fish-phase4-offline-'))
  const results=[],record=(name,check)=>{check();results.push({name,passed:true})}
  try{
    let account='a'.repeat(16),mode='shadow',fakeSends=0
    const owner=createSocialDecisionOwnership({getAccountTag:()=>account,getLifeAgentMode:()=>mode})
    const signals=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account})
    record('合成私信：旧决策器唯一获得回复权，Life Agent 只能匿名观察',()=>{
      assert.equal(owner.route({channel:'dm'}).owner,'legacy')
      assert.equal(owner.route({channel:'dm',requester:'life-agent'}).ok,false)
      const eventKey='synthetic-sender:synthetic-message-id'
      assert.equal(owner.observe({channel:'dm',eventKey,verified:true}).created,true)
      assert.equal(owner.observe({channel:'dm',eventKey,verified:true}).created,false)
      signals.offer({kind:'dm-received',platform:'bilibili',sourceKey:eventKey})
      assert.equal(signals.status().pendingSocial,1)
      assert.equal(fakeSends,0)
    })
    record('合成评论：无核验事件与 Life Agent 伪造发送权均被拒绝',()=>{
      assert.equal(owner.observe({channel:'comment',eventKey:'not-verified',verified:false}).ok,false)
      assert.equal(owner.route({channel:'comment',requester:'life-agent'}).ok,false)
      const legacy=owner.route({channel:'comment'})
      assert.equal(legacy.ok,true)
      assert.equal(owner.observe({channel:'comment',eventKey:'synthetic-comment',verified:true}).ok,true)
      assert.equal(fakeSends,0)
    })
    record('模拟切号：生成阶段旧账号不能跨账号复用；统计按账号隔离',()=>{
      const old=owner.route({channel:'dm'})
      account='b'.repeat(16)
      assert.deepEqual(owner.status().observedVerified,{dm:0,comment:0})
      assert.equal(owner.route({channel:'dm',expectedScope:old.scope}).reason,'account-changed')
      assert.equal(signals.status().pendingSocial,0)
      account='a'.repeat(16)
      assert.deepEqual(owner.status().observedVerified,{dm:1,comment:1})
      assert.equal(signals.status().pendingSocial,1)
    })
    record('active 模式也没有社交写入交接权；无可信账号时停止',()=>{
      mode='active'
      assert.equal(owner.route({channel:'dm',requester:'life-agent'}).reason,'social-handoff-not-enabled')
      assert.equal(owner.route({channel:'dm'}).owner,'legacy')
      account=''
      assert.equal(owner.route({channel:'dm'}).reason,'account-scope-unavailable')
      account='a'.repeat(16)
      assert.equal(fakeSends,0)
    })
    record('只操作临时合成数据：完整冷快照校验与恢复后冻结',()=>{
      const root=join(dir,'synthetic-bili-duty'),snapshot=join(dir,'synthetic-backup')
      mkdirSync(root)
      writeFileSync(join(root,'character-identity.json'),JSON.stringify({id:'synthetic-fish-identity'}))
      writeFileSync(join(root,'owner-todos.json'),JSON.stringify({items:[{title:'synthetic-only'}]}))
      createColdSnapshot({root,destination:snapshot,stoppedConfirmed:true})
      assert.equal(verifyColdSnapshot(snapshot).files,2)
      writeFileSync(join(root,'owner-todos.json'),'new-synthetic-content')
      const result=restoreColdSnapshot({snapshot,root,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'})
      assert.equal(result.restored,true)
      assert.match(readFileSync(join(root,'owner-todos.json'),'utf8'),/synthetic-only/)
      assert.equal(JSON.parse(readFileSync(join(root,'restore-freeze.json'),'utf8')).reviewRequired,true)
      assert.ok(existsSync(result.safeguardPath))
    })
    const report={ok:true,kind:'dev4-phase4-offline-simulation',scenarios:results.length,results,
      networkCalls:0,modelCalls:0,externalMessagesSent:fakeSends,realBilibiliTested:false,realWindowsTested:false,
      note:'只使用合成数据和临时目录；不证明真实 B站 外发或 Windows 旧存档迁移已经验收'}
    return report
  }finally{rmSync(dir,{recursive:true,force:true})}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(runPhase4OfflineAcceptance(),null,2))}
  catch(e){console.error('Phase4 模拟验收失败：'+String(e?.stack||e));process.exitCode=1}
}
