import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'

const scope='0123456789abcdef',uid='202573574'
function setup(){const dir=mkdtempSync(join(tmpdir(),'fish-shared-link-'));let now=Date.now();
 const api=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>scope,now:()=>now});
 return {dir,api,setNow:v=>{now=v},close:()=>rmSync(dir,{recursive:true,force:true})}}

test('only supported authenticated sender roles create bounded share cues; public link references do not expose DM text',()=>{
 const x=setup();try{
  // The source store does not authorize incoming DM: the host's receive gate
  // controls whether a permitted stranger can contribute a read-only Life cue.
  assert.equal(x.api.offerFromMessage({uid,role:'unverified',text:'https://b23.tv/pjKd41b',messageId:'m1'}).created,0)
  const offered=x.api.offerFromMessage({uid,role:'friend',text:'菜做好了 https://b23.tv/pjKd41b。私密文字不保存',messageId:'m2'})
  assert.equal(offered.created,1)
  const row=x.api.list()[0]
  assert.equal(row.source,'friend-shared-bili-link');assert.equal(row.kind,'short');assert.equal(row.status,'pending')
  assert.equal('senderUid' in row,false);assert.equal('ref' in row,false);assert.equal('url' in row,false);assert.equal('text' in row,false)
  const repeated=x.api.offerFromMessage({uid,role:'friend',text:'菜做好了 https://b23.tv/pjKd41b。',messageId:'m2'})
  assert.equal(repeated.created,0);assert.deepEqual(repeated.ids,[row.id]);assert.equal(x.api.list().length,1)
 }finally{x.close()}
})

test('a dynamic read is accepted only with a verified ID and records author match without exposing UID',()=>{
 const x=setup();try{
  const offered=x.api.offerFromMessage({uid,role:'friend',text:'https://t.bilibili.com/1234567890123456',messageId:'m3'})
  const id=offered.ids[0]
  assert.equal(x.api.recordRead(id,{ok:true,kind:'dynamic',dynamicId:'1234567890123456',title:'刚做好的饭',summary:'图片展示了晚饭',authorUid:uid,authorName:'花花爱木兰',commentable:true,imageObservations:['一盘家常菜']},scope).ok,true)
  const row=x.api.list()[0]
  assert.equal(row.status,'inspected');assert.equal(row.authorMatchesSharer,true);assert.equal(row.commentable,true);assert.equal(row.title,'刚做好的饭')
  assert.equal('authorUid' in row,false);assert.equal('senderUid' in row,false)
 }finally{x.close()}
})

test('a verified third-party dynamic is recorded distinctly from its sharer',()=>{
 const x=setup();try{
  const offered=x.api.offerFromMessage({uid,role:'friend',text:'https://t.bilibili.com/1234567890123456',messageId:'m4'})
  x.api.recordRead(offered.ids[0],{ok:true,kind:'dynamic',dynamicId:'1234567890123456',title:'动态',summary:'公开内容',authorUid:'99887766',authorName:'其他作者'},scope)
  assert.equal(x.api.list()[0].authorMatchesSharer,false)
 }finally{x.close()}
})

test('interactions are one-shot; uncertain outcomes are not re-offered',()=>{
 const x=setup();try{
  const offered=x.api.offerFromMessage({uid,role:'friend',text:'https://t.bilibili.com/1234567890123456',messageId:'m5'})
  x.api.recordRead(offered.ids[0],{ok:true,kind:'dynamic',dynamicId:'1234567890123456',title:'动态',authorUid:uid},scope)
  x.api.recordInteraction(offered.ids[0],'like_shared_dynamic','accepted-unverified',scope)
  assert.equal(x.api.list().length,1)
  assert.equal(x.api.list()[0].interactions[0].status,'accepted-unverified')
  assert.equal(x.api.recordInteraction(offered.ids[0],'like_shared_dynamic','verified',scope).ok,false)
 }finally{x.close()}
})

test('自愿延期探索保留在原分享契机：账号/联系人/身份/目标核验，不改变冷却或证明观察',()=>{
 const x=setup();try{
  const id=x.api.offerFromMessage({uid,role:'owner',text:'https://www.bilibili.com/video/BV1mzso6uEZh',messageId:'interest1'}).ids[0];
  const apply=(goal='observe_video',u=uid,role='owner',tag=scope)=>x.api.recordExplorationIntent(id,{uid:u,role,goal},tag);
  assert.equal(apply('observe_video','99999').ok,false);assert.equal(apply('observe_video',uid,'stranger').ok,false);
  assert.equal(apply('observe_video',uid,'owner','fedcba9876543210').ok,false);assert.equal(apply('write').ok,false);
  assert.equal(apply().ok,true);assert.equal(apply().duplicate,true);
  const row=x.api.list()[0];assert.equal(row.id,id);assert.equal(row.deferredGoal,'observe_video');assert.equal(row.status,'pending');assert.equal(row.evidenceLevel,'');assert.equal('senderUid' in row,false);
  assert.equal(x.api.recordRead(id,{ok:true,kind:'video',bvid:'BV1mzso6uEZh',title:'公开视频'},scope).ok,true);
  assert.equal(x.api.get(id,scope).deferredExploration.goal,'observe_video');assert.equal(x.api.list()[0].deferredGoal,undefined);
  assert.equal(x.api.get(id,scope).evidenceLevel,'video-metadata-only');assert.equal(apply('read_link').ok,false);
  assert.equal(x.api.decide(id,'dismiss').ok,true);assert.equal(apply().ok,false);assert.equal(x.api.get(id,scope).deferredExploration,undefined);
 }finally{x.close()}
})

test('陌生人延期仅限公开链接核验，不会从视频链接取得主人视觉权限',()=>{
 const x=setup();try{
  const id=x.api.offerFromMessage({uid,role:'stranger',text:'https://www.bilibili.com/video/BV1mzso6uEZh',messageId:'interest2'}).ids[0];
  assert.equal(x.api.recordExplorationIntent(id,{uid,role:'stranger',goal:'observe_video'},scope).ok,false);
  assert.equal(x.api.recordDeferral(id,{nextAt:Date.now()+600_000},scope).ok,true);const next=x.api.get(id,scope).nextAt;
  assert.equal(x.api.recordExplorationIntent(id,{uid,role:'stranger',goal:'read_link'},scope).ok,true);
  assert.equal(x.api.get(id,scope).nextAt,next);assert.equal(x.api.list().length,0);
  x.setNow(next+1);assert.equal(x.api.list()[0].deferredGoal,'read_link');
  assert.equal(x.api.recordRead(id,{ok:true,kind:'video',bvid:'BV1mzso6uEZh',title:'公开视频'},scope).ok,true);
  assert.equal(x.api.get(id,scope).deferredExploration,undefined);
 }finally{x.close()}
})
