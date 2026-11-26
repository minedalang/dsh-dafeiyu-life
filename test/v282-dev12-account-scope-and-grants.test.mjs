import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {tmpdir} from 'node:os'
import {createAccountBinding} from '../lib/account-binding.mjs'
import {currentLifeAccountScope} from '../lib/account-life-scope.mjs'
import {createAccountSocialGrants} from '../lib/account-social-grants.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
const c=(uid,session='session')=>({dedeuserid:String(uid),sessdata:session+'-'+uid,bili_jct:'csrf',buvid3:'x'})
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-v282-dev12-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const make=dir=>createAccountBinding({dataDir:dir,verifier:async cred=>({uid:cred.dedeuserid})})
const seed=(dir,uid='10001')=>{writeFileSync(join(dir,'bili_credential.json'),JSON.stringify(c(uid)));return make(dir)}
const switchAccount=async(dir,old,to)=>{
 old.stage(c(to));await old.activate({expectedUid:to})
 const active=make(dir)
 active.acknowledgeRestart()
 assert.equal(active.status().reason,'review-required')
 assert.equal(active.resume({expectedUid:to}).blocked,false)
 return active
}
const saved={friendDirectory:JSON.stringify([{uid:'88888',name:'老朋友',dm:true,mention:true,atInvite:true}]),
 mentionTargets:'88888',mentionProfiles:'[{"uid":"88888"}]',dmWhitelist:'88888',commentAtWhitelist:'88888',
 lifeProactiveFriendDmEnabled:true,lifeNaturalDmOutreachEnabled:true,dmStrangerAutonomyEnabled:true,
 dmStrangerOnce:true,commentAtEnabled:true,friendAtFeedbackEnabled:true,
 socialVideoRecommendationsAuthorizedV2:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,
 lifePublicInteractionEnabled:true,socialAutoSend:true}

test('same verified UID keeps Life evidence tag across rotating cookies and restart',()=>home(dir=>{
 const account=seed(dir)
 const first=currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')})
 assert.equal(first,discussionAccountTag(c('10001')))
 const rotated=currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001','rotated')})
 assert.equal(rotated,first)
 assert.notEqual(discussionAccountTag(c('10001','rotated')),first)
 assert.equal(currentLifeAccountScope({dataDir:dir,accountBinding:make(dir),credential:c('10001','other')}),first)
 assert.equal(currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('20002')}),'')
}))

test('switch A -> B -> A preserves scoped Life tag; pending switch never reads it',()=>home(async dir=>{
 let account=seed(dir)
 const a=currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')})
 account.stage(c('20002'))
 assert.equal(currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')}),'')
 await account.activate({expectedUid:'20002'})
 account=make(dir);account.acknowledgeRestart()
 assert.equal(currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('20002')}),'')
 account.resume({expectedUid:'20002'})
 const b=currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('20002')})
 assert.notEqual(b,a)
 account=await switchAccount(dir,account,'10001')
 assert.equal(currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001','new-cookie')}),a)
}))

test('damaged or unsafe Life scope files fail closed rather than generating a new identity',()=>home(dir=>{
 const account=seed(dir)
 const scope=currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')})
 const file=join(dir,'accounts','10001','life-account-scope.json')
 writeFileSync(file,'not-json')
 assert.throws(()=>currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')}),/损坏/)
 writeFileSync(file,JSON.stringify({version:1,uid:'20002',tag:scope}))
 assert.throws(()=>currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')}),/不匹配/)
 rmSync(file)
 // A file symlink requires special Windows privileges; exercise that case where
 // available, but do not make a normal Windows full run fail in test setup.
 let fileLink=false
 try {symlinkSync(join(dir,'bili_credential.json'),file,'file');fileLink=true}
 catch(error) {
  if(process.platform!=='win32'||!['EPERM','EACCES','ENOTSUP'].includes(error?.code))throw error
 }
 if(fileLink) {
  assert.throws(()=>currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')}),/不安全/)
  rmSync(file)
 }
 // Windows directory junctions need no file-symlink privilege. They are real
 // reparse-point traversal attempts and MUST be rejected by the same scope gate.
 const folder=join(dir,'accounts','10001'),outside=join(dir,'outside-life-scope')
 mkdirSync(outside)
 const sentinel=join(outside,'life-account-scope.json'),trusted={version:1,uid:'10001',tag:scope}
 writeFileSync(sentinel,JSON.stringify(trusted))
 rmSync(folder,{recursive:true,force:true})
 symlinkSync(outside,folder,process.platform==='win32'?'junction':'dir')
 assert.throws(()=>currentLifeAccountScope({dataDir:dir,accountBinding:account,credential:c('10001')}),/不安全/)
 assert.deepEqual(JSON.parse(readFileSync(sentinel,'utf8')),trusted,'must not rewrite linked target')
}))

test('first legacy account retains explicit friend grants, B starts denied and restores own grants on return',()=>home(async dir=>{
 let account=seed(dir)
 const a=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 assert.equal(JSON.parse(a.effective(saved).friendDirectory)[0].uid,'88888')
 account=await switchAccount(dir,account,'20002')
 const b=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 const effective=b.effective(saved)
 assert.equal(effective.friendDirectory,'[]')
 assert.equal(effective.dmWhitelist,'')
 assert.equal(effective.commentAtWhitelist,'')
 for(const key of ['lifeNaturalDmOutreachEnabled','lifeProactiveFriendDmEnabled','dmStrangerAutonomyEnabled','commentAtEnabled','socialAutoSend'])
  assert.equal(effective[key],false,key)
 const fresh={friendDirectory:JSON.stringify([{uid:'99999',dm:true}]),lifeProactiveFriendDmEnabled:true}
 assert.equal(b.saveExplicit(fresh),true)
 assert.equal(JSON.parse(b.effective(saved).friendDirectory)[0].uid,'99999')
 assert.equal(b.effective(saved).dmWhitelist,'')
 account=await switchAccount(dir,account,'10001')
 const restored=createAccountSocialGrants({dataDir:dir,accountBinding:account}).effective({friendDirectory:'[]'})
 assert.equal(JSON.parse(restored.friendDirectory)[0].uid,'88888')
 assert.equal(restored.lifeNaturalDmOutreachEnabled,true)
 assert.equal(readFileSync(join(dir,'accounts','20002','social-grants.json'),'utf8').includes('99999'),true)
}))

test('new first-time UID may not automatically migrate old unbound social settings',()=>home(async dir=>{
 let account=make(dir)
 account.stage(c('20002'));await account.activate({expectedUid:'20002'})
 account=make(dir);account.acknowledgeRestart();account.resume({expectedUid:'20002'})
 assert.equal(account.legacyOriginalAccount(),false)
 const grants=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 assert.equal(grants.effective(saved).friendDirectory,'[]')
 assert.equal(grants.effective(saved).lifeNaturalDmOutreachEnabled,false)
}))

test('blocked switch cannot write permissions and damaged social grants cannot be treated as fresh grants',()=>home(async dir=>{
 const account=seed(dir)
 const grants=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 grants.effective(saved)
 account.stage(c('20002'))
 assert.equal(grants.effective(saved).friendDirectory,'[]')
 assert.throws(()=>grants.saveExplicit({friendDirectory:saved.friendDirectory}),/冻结/)
 account.cancel()
 const file=join(dir,'accounts','10001','social-grants.json')
 writeFileSync(file,JSON.stringify({version:1,uid:'20002',values:saved}))
 assert.throws(()=>grants.effective(saved),/归属不匹配/)
}))

test('Life opportunities accepts trusted stable account scope without changing independent diagnostics credential validation',()=>home(dir=>{
 let uid='a'.repeat(16)
 const options={stateDir:dir,getCredential:()=>c('10001'),getAccountTag:()=>uid}
 const store=createLifeOpportunities(options)
 assert.equal(store.rememberVerifiedVideoVisual({ok:true,bvid:'BV1234567890',source:'decoded-public-video',frameCount:3,depth:'standard'})?.ok,true)
 const file=join(dir,'life-opportunities',uid+'.json')
 assert.equal(JSON.parse(readFileSync(file,'utf8')).visualReads.length,1)
 uid='b'.repeat(16)
 assert.equal(createLifeOpportunities(options).hasVerifiedVideoVisual('BV1234567890'),false)
}))

test('production wiring enforces both verified Life provenance and per-account management grants',()=>{
 const root=new URL('../',import.meta.url)
 const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(src,/currentLifeAccountScope\(\{dataDir:stateDir,accountBinding,credential:dmCred\(stateDir\)\}\)/)
 assert.match(src,/getAccountTag:trustedLifeAccountTag/)
 assert.match(src,/scopedSocialGrants\.effective\(loadCfg\(\)\)/)
 assert.match(src,/scopedSocialGrants\.saveExplicit\(patch\)/)
})


test('unbound setup can stage friend settings without granting the first newly bound UID',()=>home(async dir=>{
 let account=make(dir)
 const grants=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 assert.equal(grants.effective(saved).friendDirectory,saved.friendDirectory)
 assert.equal(grants.saveExplicit({friendDirectory:saved.friendDirectory}),false)
 account.stage(c('20002'));await account.activate({expectedUid:'20002'})
 account=make(dir);account.acknowledgeRestart();account.resume({expectedUid:'20002'})
 assert.equal(createAccountSocialGrants({dataDir:dir,accountBinding:account}).effective(saved).friendDirectory,'[]')
}))

test('real management GET and POST reflect current UID grants, not the global previous account roster',()=>home(async dir=>{
 writeFileSync(join(dir,'config.json'),JSON.stringify(saved))
 let account=seed(dir)
 const a=createAccountSocialGrants({dataDir:dir,accountBinding:account})
 assert.equal(a.effective(saved).friendDirectory,saved.friendDirectory)
 account=await switchAccount(dir,account,'20002')
 let route
 const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(dir,...(parts[0]==='bili-duty'?parts.slice(1):parts)):undefined},logger:{info(){},warn(){}},
  tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){route=x;return {dispose(){}}}},effect(f){return f()},settings:{describe(){return []}}}
 apply(ctx,{})
 const call=async(method,url,body)=>{
  const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
  req.method=method;req.url=url;req.headers={host:'localhost'}
  let status=0,content
  await route.handler(req,{writeHead(code){status=code},end(text){content=JSON.parse(text)}})
  return {status,content}
 }
 const before=await call('GET','/api/bili-duty/config')
 assert.equal(before.status,200)
 assert.equal(before.content.config.friendDirectory,'[]')
 assert.equal(before.content.config.lifeNaturalDmOutreachEnabled,false)
 const custom=JSON.stringify([{uid:'99999',name:'B的联系人',dm:true,recommend:'dm'}])
 const updated=await call('POST','/api/bili-duty/config',{friendDirectory:custom,commentAtEnabled:false})
 assert.equal(updated.status,200,JSON.stringify(updated.content))
 assert.equal(JSON.parse(updated.content.config.friendDirectory)[0].uid,'99999')
 const after=await call('GET','/api/bili-duty/config')
 assert.equal(JSON.parse(after.content.config.friendDirectory)[0].uid,'99999')
 const recorded=JSON.parse(readFileSync(join(dir,'accounts','20002','social-grants.json'),'utf8'))
 assert.equal(recorded.uid,'20002')
 assert.equal(JSON.parse(recorded.values.friendDirectory)[0].uid,'99999')
 const recordA=JSON.parse(readFileSync(join(dir,'accounts','10001','social-grants.json'),'utf8'))
 assert.equal(JSON.parse(recordA.values.friendDirectory)[0].uid,'88888')
}))


test('restored account must not convert portable old config to a new trusted social roster',()=>home(dir=>{
 const account=seed(dir)
 writeFileSync(join(dir,'restore-freeze.json'),JSON.stringify({version:1,reviewRequired:true,at:'2026-11-19T00:00:00.000Z'}))
 assert.equal(account.status().blocked,true)
 account.resume({expectedUid:'10001'})
 assert.equal(account.legacyOriginalAccount(),false)
 assert.equal(createAccountSocialGrants({dataDir:dir,accountBinding:account}).effective(saved).friendDirectory,'[]')
 assert.equal(make(dir).legacyOriginalAccount(),false,'restore restriction must persist after restart')
}))

test('fresh first UID receives recommendation grants only with explicit consent, no inherited roster',()=>home(async dir=>{
 let a=createAccountBinding({dataDir:dir,verifier:async cred=>({uid:cred.dedeuserid,username:'测试鱼'})});
 a.stage(c('20002'));await a.activate({expectedUid:'20002'});a=make(dir);a.acknowledgeRestart();a.resume({expectedUid:'20002'});
 assert.equal(a.status().activeUsername,'测试鱼');
 const g=createAccountSocialGrants({dataDir:dir,accountBinding:a});assert.equal(g.canApplyInitialRecommendations(),true);
 assert.equal(g.effective(saved).commentAtEnabled,false);g.applyInitialRecommendations();assert.equal(g.canApplyInitialRecommendations(),false);
 assert.equal(g.effective(saved).lifePublicInteractionEnabled,true);assert.equal(g.effective(saved).dmWhitelist,'');assert.equal(g.effective(saved).dmStrangerAutonomyEnabled,false);assert.throws(()=>g.applyInitialRecommendations());
 const b=await switchAccount(dir,a,'30003');const next=createAccountSocialGrants({dataDir:dir,accountBinding:b});assert.equal(next.canApplyInitialRecommendations(),false);assert.equal(next.effective(saved).lifePublicInteractionEnabled,false);
}))
