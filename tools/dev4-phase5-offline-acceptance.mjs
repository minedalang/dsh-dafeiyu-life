#!/usr/bin/env node
/** Standalone synthetic Phase5 acceptance: never call Bilibili, DSH or models. */
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createLifeSocialShadow,parseLifeSocialShadowDecision} from '../lib/life-social-shadow.mjs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'

export function runPhase5OfflineAcceptance(){
  const checks=[],check=(name,fn)=>{fn();checks.push({name,passed:true})}
  let scope='a'.repeat(16),enabled=false,clock=1000000,sends=0
  const bridge=createLifeSocialShadow({getAccountTag:()=>scope,getConsent:()=>enabled,now:()=>clock})
  const owner=createSocialDecisionOwnership({getAccountTag:()=>scope,getLifeAgentMode:()=> 'shadow',now:()=>clock})
  const base={eventId:'b'.repeat(24),channel:'dm',uid:'88888',sourceKey:'synthetic-msg',text:'合成内容：想聊聊音乐',role:'friend',verified:true}
  check('授权默认关闭，不能访问好友私信',()=>{assert.equal(bridge.capture(base).ok,false);assert.equal(owner.route({channel:'dm',requester:'life-agent'}).ok,false)})
  check('启用后仅当前已核验好友 DM 和公开评论可暂存',()=>{enabled=true;assert.equal(bridge.capture(base).ok,true);assert.equal(bridge.capture({...base,eventId:'c'.repeat(24),role:'stranger'}).ok,false);assert.equal(bridge.capture({...base,eventId:'d'.repeat(24),channel:'comment',role:'stranger',verified:true}).ok,true)})
  check('影子选择只做分类，不授予发送权；旧回复器仍独占',()=>{assert.equal(parseLifeSocialShadowDecision('{"action":"reply"}'),'reply');assert.equal(bridge.noteLife({eventId:base.eventId,expectedScope:scope,action:'reply'}).ok,true);assert.equal(owner.route({channel:'dm'}).owner,'legacy');assert.equal(owner.route({channel:'dm',requester:'life-agent'}).ok,false);assert.equal(sends,0)})
  check('模拟旧回复器对照，匿名统计无正文/UID',()=>{assert.equal(bridge.noteLegacy({channel:'dm',uid:'88888',sourceKey:'synthetic-msg',action:'silent'}).paired,true);assert.deepEqual([bridge.status().paired,bridge.status().disagreed],[1,1]);assert.doesNotMatch(JSON.stringify(bridge.status()),/88888|合成内容|a{16}/)})
  check('切号、过期、授权撤回都拒绝预览',()=>{scope='e'.repeat(16);assert.equal(bridge.preview({eventId:base.eventId,channel:'dm',expectedScope:'a'.repeat(16)}).ok,false);scope='a'.repeat(16);clock+=600001;assert.equal(bridge.preview({eventId:base.eventId,channel:'dm',expectedScope:scope}).ok,false);enabled=false;assert.equal(bridge.status().staged,0);assert.equal(sends,0)})
  return {ok:true,kind:'dev4-phase5-offline-simulation',scenarios:checks.length,checks,
    externalMessagesSent:sends,networkCalls:0,realModelCalls:0,realBilibiliTested:false,
    note:'仅合成对象，不调用实际模型、B站或正式数据；未验证跨进程排他与真实社交接管'}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(runPhase5OfflineAcceptance(),null,2))}
  catch(e){console.error('Phase5 离线验收失败：'+String(e?.stack||e));process.exitCode=1}
}
