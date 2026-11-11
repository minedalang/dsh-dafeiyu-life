import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,symlinkSync,statSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createModelInvocationJournal} from '../lib/model-invocation-journal.mjs'

const create=(t)=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-model-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let account='a'.repeat(16)
  return {dir,getAccount:()=>account,setAccount:s=>{account=s},
    journal:createModelInvocationJournal({dataDir:dir,getAccountTag:()=>account,now:()=>Date.parse('2026-11-10T08:00:00Z')})}
}
test('model journal never stores prompts, credentials, provider error body or raw platform UID',t=>{
  const {dir,journal}=create(t)
  assert.equal(journal.record({scene:'interaction',provider:'host',model:'unknown',durationMs:80,error:Error('502 secret-cookie user private content')}),true)
  const row=journal.recent()[0]
  assert.equal(row.errorKind,'gateway-or-upstream')
  assert.equal(row.tokenUsage,'not-reported')
  assert.equal(row.coverage,'host-model-call')
  const raw=readFileSync(join(dir,'model-invocations','a'.repeat(16)+'.jsonl'),'utf8')
  assert.doesNotMatch(raw,/secret-cookie|private content|user private/)
  assert.equal(journal.record({scene:'private message 1234567890',provider:'https://secret/path',model:'modelName',durationMs:Infinity}),true)
  assert.equal(journal.recent().at(-1).scene,'other')
  assert.equal(journal.recent().at(-1).provider,'unavailable')
  assert.equal(journal.recent().at(-1).durationMs,0)
})
test('model journal returns only current verified account and fails closed without account',t=>{
  const {journal,setAccount}=create(t)
  journal.record({scene:'interaction'})
  setAccount('b'.repeat(16))
  assert.deepEqual(journal.recent(),[])
  assert.equal(journal.record({scene:'memory',expectedScope:'a'.repeat(16)}),false, 'an in-flight old account call cannot be logged under a new account')
  assert.deepEqual(journal.recent(),[])
  assert.equal(journal.record({scene:'memory'}),true)
  setAccount('a'.repeat(16))
  assert.equal(journal.recent().length,1)
  setAccount('')
  assert.deepEqual(journal.recent(),[])
  assert.equal(journal.record({scene:'interaction'}),false)
})
test('model journal retains bounded recent history and rotates rather than silently stopping',t=>{
  const {dir,journal}=create(t)
  for(let n=0;n<5000;n++)assert.equal(journal.record({scene:'interaction',model:'model',trigger:'host',durationMs:n}),true)
  const prefix=join(dir,'model-invocations','a'.repeat(16)+'.jsonl')
  assert.ok(existsSync(prefix+'.old'))
  assert.ok(statSync(prefix).size<512*1024+500)
  assert.ok(statSync(prefix+'.old').size<512*1024+500)
  const rows=journal.recent(30)
  assert.equal(rows.length,30)
  assert.equal(rows.at(-1).durationMs,4999)
})
test('model journal refuses symlink journal and does not modify pointed-to target',t=>{
  const {dir,journal}=create(t)
  journal.record()
  const account='a'.repeat(16)
  const target=join(dir,'payload.txt')
  const path=join(dir,'model-invocations',account+'.jsonl.old')
  symlinkSync(target,path)
  assert.equal(journal.record(),false)
  assert.deepEqual(journal.recent(),[])
  assert.equal(existsSync(target),false)
})
test('management UI and host API show only account-scoped host call coverage',()=>{
  const root=new URL('../',import.meta.url)
  const index=readFileSync(new URL('index.js',root),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  assert.match(index,/path === '\/api\/bili-duty\/model-invocations'/)
  assert.match(index,/videoHeadlessCallsNotCovered:true/)
  assert.match(js,/request\('\/model-invocations'\)/)
  assert.match(js,/视频 Headless 内部模型次数不包含/)
  assert.match(html,/id="models-invocation-recent"/)
})
