import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialRelationshipChannels,evaluateDmOpenness} from '../lib/social-relationship-channels.mjs'
import {createLifeFriendInitiatives} from '../lib/life-friend-initiatives.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
import {createSocialRelationshipIndex} from '../lib/social-relationship-index.mjs'
const DAY=86_400_000, NOW=Date.parse('2026-11-11T12:00:00Z'),A='a'.repeat(16)
function using(t){const home=mkdtempSync(join(tmpdir(),'dsh-3d-'));t.after(()=>rmSync(home,{recursive:true,force:true}));const channels=createSocialRelationshipChannels({dataDir:join(home,'account-A'),now:()=>NOW});t.after(()=>channels.close());return {home,channels}}
function evidence(channels,uid,channel,direction,n,day=0){for(let i=0;i<n;i++){
 const r=channels.observe({uid,source:channel,direction,eventId:`${uid}-${channel}-${direction}-${day}-${i}`,at:NOW-(5-day)*DAY});assert.equal(r.ok,true)
}}
function establish(channels,uid){evidence(channels,uid,'dm','incoming',1,0);evidence(channels,uid,'dm','outgoing',1,0);evidence(channels,uid,'dm','incoming',1,3);evidence(channels,uid,'dm','outgoing',1,3)}
function engine(t,channels,{whitelist='[]',legacy=false,natural=false}={}){
 const home=mkdtempSync(join(tmpdir(),'dsh-life-3d-'));t.after(()=>rmSync(home,{recursive:true,force:true}));let blocked=false
 const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',dmOwnerUid:'999',dmWatch:true,
   lifeProactiveFriendDmEnabled:legacy,lifeNaturalDmOutreachEnabled:natural,friendDirectory:whitelist,
   autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:100}
 const e=createLifeFriendInitiatives({dataDir:home,getAccountTag:()=>A,getConfig:()=>cfg,getDmBoundary:()=>blocked,
   getRelationships:()=>channels.list().map(row=>({uid:row.uid,stage:'known',incoming:row.total.incoming,
     outgoing:row.total.outgoing,count:row.total.count,activeDays:row.total.activeDays,lastAt:row.total.lastAt,dmOpenness:row.dmOpenness})),now:()=>NOW})
 return {e,cfg,setBlocked:value=>blocked=value}
}
test('公开评论来往多日、熟悉度再高，仍不可主动私信',t=>{
 const {channels}=using(t),uid='34567'
 for(let day=0;day<5;day++){evidence(channels,uid,'comment','incoming',2,day);evidence(channels,uid,'comment','outgoing',2,day)}
 const r=channels.get(uid);assert.equal(r.channelFamiliarity.public,'ongoing');assert.equal(r.channelFamiliarity.private,'none');assert.equal(r.dmOpenness.eligible,false)
 const {e}=engine(t,channels,{natural:true});assert.ok(e.eligible().length===1);assert.equal(e.eligible()[0].outboundEnabled,false)
 assert.equal(e.mark(e.eligible()[0].id,{action:'reserve'}).reason,'private-contact-not-open')
})
test('陌生人主动私信仅一次，不能产生随时主动联系的资格',t=>{
 const {channels}=using(t);evidence(channels,'34567','dm','incoming',1,1)
 assert.equal(channels.get('34567').dmOpenness.state,'not_established')
 assert.equal(engine(t,channels,{natural:true}).e.eligible().length,0)
})
test('私人渠道多日双向交流建立资格，但默认不授予任何发送权限',t=>{
 const {channels}=using(t);establish(channels,'34567')
 assert.equal(channels.get('34567').dmOpenness.state,'established')
 const a=engine(t,channels);assert.equal(a.e.eligible()[0].outboundEnabled,false)
 const b=engine(t,channels,{natural:true});assert.equal(b.e.eligible()[0].outboundEnabled,true)
 const policy=createSocialPolicyGate({getConfig:()=>({...b.cfg,dmWatch:true})})
 assert.equal(policy.canInitiateDm({uid:'34567',dmOpenness:'established'}).allowed,true)
 assert.equal(policy.canInitiateDm({uid:'34567',dmOpenness:'not_established'}).allowed,false)
 assert.equal(policy.canSendDm({uid:'34567'}).allowed,false,'主动私信授权不得悄悄变成陌生人入站回复授权')
})
test('已有白名单授权也不得绕过 DM 资格；关闭或拒联立即撤销外发候选',t=>{
 const {channels}=using(t);establish(channels,'34567')
 const x=engine(t,channels,{legacy:true,whitelist:'[{"uid":"34567","dm":true}]'})
 assert.equal(x.e.eligible()[0].outboundEnabled,true)
 x.setBlocked(true);assert.equal(x.e.eligible()[0].outboundEnabled,false)
 x.setBlocked(false);x.cfg.dmWatch=false;assert.equal(x.e.eligible()[0].outboundEnabled,false)
})
test('新渠道账本账号隔离，旧版综合关系索引不能升级成私人联系资格',t=>{
 const {home,channels}=using(t);establish(channels,'34567')
 const other=createSocialRelationshipChannels({dataDir:join(home,'account-B'),now:()=>NOW});t.after(()=>other.close())
 assert.equal(other.get('34567'),null)
 const old=createSocialRelationshipIndex({dataDir:home,now:()=>NOW});t.after(()=>old.close())
 for(let day=0;day<6;day++)old.observe({uid:'34567',source:'comment',direction:day%2?'incoming':'outgoing',eventId:'legacy-'+day,at:NOW-(6-day)*DAY})
 assert.equal(old.get('34567').dmOpenness,undefined)
 assert.equal(other.get('34567'),null)
})
test('来源幂等、无私信正文、关系清除后无法再发起私信',t=>{
 const {channels}=using(t);establish(channels,'34567');assert.equal(channels.get('34567').dmOpenness.eligible,true)
 const r=channels.observe({uid:'34567',source:'dm',direction:'incoming',eventId:'34567-dm-incoming-0-0',at:NOW-5*DAY})
 assert.equal(r.duplicate,true)
 assert.doesNotMatch(readFileSync(channels.file).toString(),/private-message-body-secret/)
 assert.equal(channels.clear('34567').removed>0,true)
 assert.equal(channels.get('34567'),null)
})
test('强制拒联优先于一切熟悉度、私信资格',()=>{
 const evidence={dm:{incoming:20,outgoing:20,activeDays:20,firstAt:NOW-50*DAY,lastAt:NOW}}
 assert.equal(evaluateDmOpenness(evidence,{now:NOW,restricted:true}).state,'restricted')
 assert.equal(evaluateDmOpenness(evidence,{now:NOW,restricted:true}).eligible,false)
})

// Old interaction failures must not become a voluntary dismissal of an
// authenticated incoming DM. The persisted diagnostic is observable without
// storing message text in the relationship evidence ledger.

test('预留主动私信机会后撤回私人联系授权，发送前重新核验立即封锁',t=>{
 const {channels}=using(t);establish(channels,'34567')
 const x=engine(t,channels,{natural:true})
 const candidate=x.e.eligible()[0]
 assert.equal(x.e.mark(candidate.id,{action:'reserve'}).ok,true)
 assert.equal(x.e.lookup(candidate.id,{allowReserved:true}).outboundEnabled,true)
 x.cfg.lifeNaturalDmOutreachEnabled=false
 assert.equal(x.e.lookup(candidate.id,{allowReserved:true}).outboundEnabled,false)
 x.cfg.lifeNaturalDmOutreachEnabled=true;x.setBlocked(true)
 assert.equal(x.e.lookup(candidate.id,{allowReserved:true}).outboundEnabled,false)
})
