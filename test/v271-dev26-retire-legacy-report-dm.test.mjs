import {symlinkOrSkip} from './test-platform-fixtures.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {planVideoReportRetirement,retireVideoReportConfig} from '../lib/legacy-video-report-retirement.mjs'
import {videoCommentGateCode,videoCommentReadiness} from '../lib/video-comment-readiness.mjs'
const source=(f)=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
const scoped=(run)=>{const dir=mkdtempSync(join(tmpdir(),'dsh-report-retirement-'));try{return run(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('old only preserves the saved original-comment permission and independent social authorizations',()=>{
  const saved={dmMode:'only',dmUid:123456,autoComment:true,friendDirectory:'[{"uid":"444","dm":true}]',ownerDmCommentPublishEnabled:true,_set:['autoComment','dmMode','dmUid','friendDirectory']}
  const r=planVideoReportRetirement(saved,{},true)
  assert.equal(r.config.autoComment,true)
  assert.equal(r.config.dmMode,undefined);assert.equal(r.config.dmUid,undefined)
  assert.deepEqual(r.config._set,['autoComment','friendDirectory'])
  assert.equal(r.config.friendDirectory,saved.friendDirectory)
  assert.equal(r.config.ownerDmCommentPublishEnabled,true)
})
test('all old report modes preserve explicit autonomous comment permission without report-DM delivery',()=>{
 for(const dmMode of ['off','only','both']){
  const r=planVideoReportRetirement({dmMode,dmUid:123,autoComment:true,_set:['autoComment','dmMode']},{},true)
  assert.equal(r.config.autoComment,true)
  assert.ok(!('dmMode' in r.config));assert.ok(!('dmUid' in r.config))
 }
})
test('host-only old report mode never overrides independently supplied original-comment permission',()=>{
 const r=planVideoReportRetirement({}, {dmMode:'only',dmUid:123,autoComment:true},true)
 assert.equal(r.config.autoComment,undefined)
 assert.equal(r.config.dmOwnerUid,undefined)
})
test('migration is durable, idempotent, and can no longer hide a report gate',()=>scoped(dir=>{
 const file=join(dir,'config.json')
 writeFileSync(file,JSON.stringify({dmMode:'only',dmUid:321,autoComment:true,_set:['autoComment','dmMode','dmUid'],memo:'untouched'}))
 const first=retireVideoReportConfig(dir,{host:{dmMode:'only'},legacyInstall:true})
 assert.equal(first.changed,true)
 const saved=JSON.parse(readFileSync(file,'utf8'))
 assert.equal(saved.autoComment,true);assert.equal(saved._videoReportRetired,1)
 assert.deepEqual(saved._set,['autoComment']);assert.equal(saved.memo,'untouched')
 const second=retireVideoReportConfig(dir,{host:{dmMode:'only'},legacyInstall:true})
 assert.equal(second.changed,false)
 assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),saved)
 const cfg={masterEnabled:true,autoComment:true,commentPerRound:5,commentDailyLimit:1000}
 assert.equal(videoCommentGateCode(cfg),'configured')
 assert.equal(videoCommentGateCode({...cfg,autoComment:true,dmMode:'only'}),'configured')
 assert.equal(videoCommentReadiness({...cfg,autoComment:true}).enabled,true)
}))
test('migration preserves explicitly disabled comment permission and does not create a new override',()=>scoped(dir=>{
  const file=join(dir,'config.json')
  writeFileSync(file,JSON.stringify({dmMode:'only',dmUid:432,autoComment:false,_set:['dmMode','dmUid','autoComment']}))
  const r=retireVideoReportConfig(dir,{host:{dmMode:'only',autoComment:true},legacyInstall:true})
  assert.equal(r.changed,true)
  const saved=JSON.parse(readFileSync(file,'utf8'))
  assert.equal(saved.autoComment,false)
  assert.deepEqual(saved._set,['autoComment'])
  assert.equal(videoCommentGateCode({masterEnabled:true,autoComment:saved.autoComment,commentPerRound:5,commentDailyLimit:1000}),'auto-comment-disabled')
}))
test('migration without saved comment permission does not force a value into settings',()=>scoped(dir=>{
  const r=retireVideoReportConfig(dir,{host:{dmMode:'only',autoComment:false},legacyInstall:true})
  assert.equal(r.changed,true)
  const saved=JSON.parse(readFileSync(join(dir,'config.json'),'utf8'))
  assert.equal(Object.hasOwn(saved,'autoComment'),false)
  assert.equal(Object.hasOwn(saved,'dmMode'),false)
  assert.equal(saved._videoReportRetired,1)
}))
test('migration refuses symlink config instead of mutating another file',t=>scoped(dir=>{
 const destination=join(dir,'other.json'),file=join(dir,'config.json')
 writeFileSync(destination,JSON.stringify({dmMode:'only',autoComment:true}))
 if (!symlinkOrSkip(t,destination,file)) return
 assert.throws(()=>retireVideoReportConfig(dir,{legacyInstall:true}),/不是安全的普通文件/)
 assert.equal(JSON.parse(readFileSync(destination,'utf8')).autoComment,true)
}))
test('retirement removes both user interfaces and automatic video DM tool, without removing direct authorized social DM',()=>{
 const index=source('index.js'),html=source('lib/management-console.html'),client=source('client.js')
 assert.doesNotMatch(index,/cfg\.dmMode|cfg\.dmUid|dmUidCache|warmDmUid/)
 assert.doesNotMatch(html,/id="bili-dm-mode"|id="bili-dm-uid"/)
 assert.doesNotMatch(client,/setDmMode|setDmUid|cfg\.dmMode|cfg\.dmUid/)
 const whitelist=index.slice(index.indexOf("const mcpWhitelist = (sourceMode='mixed') => {"),index.indexOf("const mcpWhitelist = (sourceMode='mixed') => {")+2100)
 assert.match(whitelist,/cfg\.autoComment && Number\(cfg\.commentPerRound\)>0 && Number\(cfg\.commentDailyLimit\)>0/)
 assert.doesNotMatch(whitelist,/list\.push\('bili_send_message'\)/)
 assert.match(index,/call\('bili_send_message_manual'/)
 assert.match(index,/const owner = Number\(cfg\.dmOwnerUid\) \|\| 0/)
 assert.match(index,/_videoReportRetired:1/)
})
