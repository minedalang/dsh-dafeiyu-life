import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHmac} from 'node:crypto'
import {discussionAccountTag,readVideoDiscussionDiagnostics} from '../lib/video-discussion-diagnostics.mjs'

const credential={dedeuserid:'3456677',sessdata:'some-private-login-secret'}
const tag=createHmac('sha256',credential.sessdata).update(credential.dedeuserid).digest('hex').slice(0,16)
const bv='BV1xxxxxxxxx'
const now=new Date(2026,10,4,12)
const day='2026-11-04'
const event=(kind,values={})=>({v:1,at:new Date(2026,10,4,11).toISOString(),account:tag,kind,bvid:bv,status:'read',count:4,...values})
function fixture(rows){
 const home=mkdtempSync(join(tmpdir(),'discussion-accept-'));const dir=join(home,'video-discussion-reads')
 mkdirSync(dir);writeFileSync(join(dir,day+'.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 return {home,dir,cleanup:()=>rmSync(home,{recursive:true,force:true})}
}
test('public read, valid thread, failure, and subjective note are visible with verified counts',()=>{
 const f=fixture([event('comment_list_read'),event('comment_thread_read',{root:'123'}),event('comment_list_read',{status:'partial_failure',count:2}),event('provisional_fish_reaction',{reaction:'curious',question:'为什么不同人理解不一样？'})]);
 try{
  assert.equal(discussionAccountTag(credential),tag)
  const r=readVideoDiscussionDiagnostics({stateDir:f.home,credential,now})
  assert.equal(r.ok,true);assert.equal(r.accountReady,true)
  assert.deepEqual(r.summary,{readLists:1,emptyLists:0,failedLists:1,readThreads:1,failedThreads:0,provisionalNotes:1,noteRejections:0})
  const note=r.events.find(x=>x.kind==='provisional_fish_reaction')
  assert.equal(note.subjective,true);assert.equal(note.verified,false)
  assert.equal(r.events.find(x=>x.kind==='comment_thread_read').root,'123')
  assert.ok(r.events.every(x=>!Object.hasOwn(x,'account')))
  assert.ok(r.events.every(x=>!Object.hasOwn(x,'sessdata')))
 }finally{f.cleanup()}
})
test('rejected note requests expose only enum reason, and no success is invented',()=>{
 const f=fixture([event('comment_list_read'),event('provisional_note_rejected',{status:'rejected',reason:'invalid_question',raw:'PRIVATE DO NOT SHOW'}),event('provisional_note_rejected',{status:'rejected',reason:'arbitrary_private_text'}),event('provisional_note_rejected',{status:'read',reason:'duplicate'})]);
 try {
  const r=readVideoDiscussionDiagnostics({stateDir:f.home,credential,now});
  assert.equal(r.summary.readLists,1);
  assert.equal(r.summary.noteRejections,1);
  assert.equal(r.summary.provisionalNotes,0);
  const failure=r.events.find(e=>e.kind==='provisional_note_rejected');
  assert.equal(failure.reason,'invalid_question');
  assert.equal(failure.status,'rejected');
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
 } finally {f.cleanup()}
})
test('wrong account and no-login cannot inspect previous account receipts',()=>{
 const f=fixture([event('comment_list_read')]);
 try{
  const different=readVideoDiscussionDiagnostics({stateDir:f.home,credential:{dedeuserid:'2',sessdata:'different'},now})
  assert.equal(different.events.length,0)
  assert.equal(different.summary.readLists,0)
  const missing=readVideoDiscussionDiagnostics({stateDir:f.home,now})
  assert.equal(missing.accountReady,false);assert.equal(missing.events.length,0)
 }finally{f.cleanup()}
})
test('only allowed event types, valid BV and well-formed statuses are visible',()=>{
 const f=fixture([event('comment_list_read',{bvid:'../credential'}),event('deleted'),event('comment_list_read',{status:'faked'}),event('comment_list_read',{status:'read',count:0})]);
 try{
  const r=readVideoDiscussionDiagnostics({stateDir:f.home,credential,now})
  assert.equal(r.events.length,1);assert.equal(r.summary.emptyLists,1)
  assert.match(r.hint,/没有记录不能证明/)
 }finally{f.cleanup()}
})
test('oversized file reads only last bounded suffix, rather than entire history',()=>{
 const f=fixture([])
 try{
  const file=join(f.dir,day+'.jsonl')
  writeFileSync(file,'x'.repeat(275000)+'\n'+JSON.stringify(event('comment_list_read'))+'\n')
  const r=readVideoDiscussionDiagnostics({stateDir:f.home,credential,now})
  assert.equal(r.truncated,true);assert.equal(r.summary.readLists,1)
 }finally{f.cleanup()}
})
test('diagnostics endpoint and management view are read only',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(index,/req\.method === 'GET' && path === '\/api\/bili-duty\/video-discussion-diagnostics'/)
 assert.match(index,/readVideoDiscussionDiagnostics\(\{stateDir,credential:dmCred\(stateDir\)\}\)/)
 assert.match(ui,/id="discussion-read-summary"/)
 assert.match(ui,/没有记录不代表鱼鱼决定不看/)
 assert.match(js,/request\('\/video-discussion-diagnostics'\)/)
 assert.doesNotMatch(js,/request\('\/video-discussion-diagnostics',\s*\{/)
})
