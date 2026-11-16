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

test('only approved-friend messages create bounded link opportunities; raw DM text and URL are not exposed',()=>{
 const x=setup();try{
  assert.equal(x.api.offerFromMessage({uid,role:'stranger',text:'https://b23.tv/pjKd41b',messageId:'m1'}).created,0)
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

test('a dynamic authored by someone other than the sharer cannot be offered for autonomous interaction',()=>{
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
  assert.equal(x.api.list().length,0)
 }finally{x.close()}
})
