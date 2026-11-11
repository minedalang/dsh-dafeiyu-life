import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
const TAG='c'.repeat(16)
function actor(t){
 const dir=mkdtempSync(join(tmpdir(),'dev59-life-social-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 let calls=0,scope=TAG
 const a=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,enabled:()=>true,
  invokeModel:async()=>{calls++;throw Error('should not invoke model for adopted decision')},getContext:async()=>({voice:'life'})})
 return {a,dir,calls:()=>calls,switchScope:s=>scope=s}
}
test('one DM Life-voice model choice seals exact recipient and two bubbles without another model call',t=>{
 const x=actor(t)
 const r=x.a.adoptSocialDecision({kind:'dm_reply',uid:'12345',sourceKey:'dm:12345:message7',messages:['你好啊','今天怎么样']})
 assert.equal(r.ok,true)
 assert.equal(x.calls(),0)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'99999',targetKey:'',text:'你好啊'}).ok,false)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'恶意改写'}).ok,false)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'你好啊'}).ok,true)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'你好啊'}).ok,false)
 assert.equal(x.a.receipt(r.proof,{status:'verified',receiptId:'msg:1'}).ok,true)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'今天怎么样'}).ok,true)
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'今天怎么样'}).ok,false)
 assert.equal(x.a.receipt(r.proof,{status:'verified',receiptId:'msg:2'}).ok,true)
 assert.equal(x.calls(),0)
})
test('comment proof binds account, target, thread and literal text; unknown result revokes',t=>{
 const x=actor(t),target='comment:video:BV1pXHK6mE6z:1234567:88888'
 const a=x.a.adoptSocialDecision({kind:'comment_reply',uid:'88888',sourceKey:target,targetKey:target,messages:['这段很有趣']})
 assert.equal(a.ok,true)
 assert.equal(x.a.verify(a.proof,'comment_reply',{uid:'88888',targetKey:target.replace('1234567','1234568'),text:'这段很有趣'}).ok,false)
 assert.equal(x.a.verify(a.proof,'comment_reply',{uid:'88888',targetKey:target,text:'这段很有趣'}).ok,true)
 x.a.receipt(a.proof,{status:'uncertain'})
 assert.equal(x.a.verify(a.proof,'comment_reply',{uid:'88888',targetKey:target,text:'这段很有趣'}).ok,false)
 assert.equal(x.calls(),0)
})
test('unverified or unsafe draft fails closed without a model call',t=>{
 const x=actor(t)
 for(const messages of [['@别人 快来'],[],[''],['a'.repeat(460)]])
  assert.equal(x.a.adoptSocialDecision({kind:'dm_reply',uid:'12345',sourceKey:'dm:12345:m',messages}).ok,false)
 assert.equal(x.calls(),0)
})
test('editing or wrong identity is not an alternative authorizer',t=>{
 const x=actor(t)
 const r=x.a.adoptSocialDecision({kind:'dm_reply',uid:'12345',sourceKey:'dm:12345:m2',messages:['Hi']})
 x.switchScope('e'.repeat(16))
 assert.equal(x.a.verify(r.proof,'dm_reply',{uid:'12345',targetKey:'',text:'Hi'}).ok,false)
 assert.equal(x.calls(),0)
})
