import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {unifiedOwnerDmCutover} from '../lib/unified-dm-cutover.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {subagentActionMenu,acceptedSubagentReadKinds} from '../lib/life-subagent-continuity.mjs'
const account='a'.repeat(16)
const fresh=()=>{const dir=mkdtempSync(join(tmpdir(),'life-dm-unified-'));return {dir,finish:()=>rmSync(dir,{recursive:true,force:true})}}
test('new owner / friend / permitted stranger links share the same read-only ledger, no other-host reads or dynamic writes',()=>{
 const x=fresh();try{
  const store=createLifeSharedBiliLinks({stateDir:x.dir,getAccountTag:()=>account})
  for(const role of ['owner','friend','stranger']){
   const r=store.offerFromMessage({uid:'123456',role,messageId:'message-'+role,text:'https://t.bilibili.com/1234567890123456'})
   assert.equal(r.created,1,role)
   const row=store.get(r.ids[0],account)
   assert.equal(row.senderRole,role)
   assert.equal(store.recordInteraction(r.ids[0],'like_shared_dynamic','verified',account).ok,false)
  }
  assert.equal(store.offerFromMessage({uid:'123456',role:'stranger',messageId:'evil',text:'https://evil.example/'}).created,0)
  assert.equal(store.offerFromMessage({uid:'123456',role:'stranger',messageId:'evil2',text:'https://t.bilibili.com.evil.example/1234567890123456'}).created,0)
  assert.equal(store.get('f'.repeat(24),'b'.repeat(16)),null)
 }finally{x.finish()}
})
test('first upgrade fences old owner messages, persists cutoff and rejects unsafe state',()=>{
 const x=fresh();try{
  const now=1794810000000
  const first=unifiedOwnerDmCutover(x.dir,()=>now)
  assert.equal(first,now)
  assert.equal(unifiedOwnerDmCutover(x.dir,()=>now+6000),now)
  assert.equal(readFileSync(join(x.dir,'unified-life-dm-owner-cutover.json'),'utf8').includes('ownerText'),false)
 }finally{x.finish()}
})
test('model can request an approved shared_link read without granting an arbitrary web tool',()=>{
 const menu=subagentActionMenu({agent:'dm',readKinds:['shared_link']})
 assert.deepEqual(acceptedSubagentReadKinds(['shared_link'],menu),['shared_link'])
 assert.equal(acceptedSubagentReadKinds(['web'],menu),null)
 assert.equal(acceptedSubagentReadKinds(['shared_link'],subagentActionMenu({agent:'dm'})),null)
})
test('one Life DM model turn chooses read first, same model continues after trusted Bilibili proof',async()=>{
 const calls=[],lookups=[]
 const batch=createInteractionBatcher({delayMs:0,getContextMode:()=> 'full',getPersona:()=> '鱼鱼',
  invoke:async prompt=>{calls.push(prompt);return calls.length===1
    ?JSON.stringify({items:[{id:'0',action:'skip',contextRequests:['shared_link'],reply:''}]})
    :JSON.stringify({items:[{id:'0',action:'reply',messages:['看了你的动态，画面很有趣！'],topicState:'settled'}]})},
  prepareContexts:async()=>[{availableContexts:[]}],
  loadRequestedContexts:async(rows,requests)=>{lookups.push({rows,requests});return [{sharedLinkContext:'{"verified":true,"kind":"dynamic","title":"真实的动态"}'}]}})
 const done=batch.generate({kind:'dm',uid:'123456',text:'分享给你 https://t.bilibili.com/1234567890123456',
  messages:['分享给你 https://t.bilibili.com/1234567890123456'],history:[],socialAutonomy:true,
  availableContexts:['shared_link'],sharedLinkId:'x'.repeat(24),sharedLinkScope:account,canSkip:true})
 const result=await done
 assert.equal(calls.length,2)
 assert.equal(lookups.length,1)
 assert.deepEqual(lookups[0].requests,[['shared_link']])
 assert.match(calls[1],/真实的动态/)
 assert.equal(result.action,'reply')
 assert.ok(result.messages.includes('看了你的动态，画面很有趣！'))
})
test('host retires owner specialist and keyword command execution before generic DM pipeline',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=host.indexOf('async function getNewDmMessages('),end=host.indexOf('function dmChatPrompt(',start)
 const segment=host.slice(start,end)
 assert.match(segment,/unifiedOwnerDmCutover/)
 assert.doesNotMatch(segment,/ownerDmAgent\.processMessages|runOwnerDmAction\(|parseOwnerDmTodo\(|parseOwnerDmAction\(/)
 assert.match(host,/const generated=await interactionBatcher.generate\(\{kind:'dm'/)
})
test('unsaved-settings save bar reuses native click without viewport jump',()=>{
 const source=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const part=source.split("saveHintAction?.addEventListener('click',()=>{")[1].split('finishSettingsSave=')[0]
 assert.match(part,/own\[0\]\.save\.click\(\)/)
 assert.doesNotMatch(part,/scrollIntoView|\.focus\(|data-tab|revealTarget/)
})
test('stranger shared-link intake is after DM reply eligibility, never before inbox policy',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const i=host.indexOf('onIncoming:async({uid,text,messageId,time})=>{')
 const j=host.indexOf('generateReply: async (req) => {',i)
 assert.ok(i>0&&j>i)
 const callback=host.slice(i,j)
 assert.match(callback,/if\(\['owner','friend'\]\.includes\(role\)/)
 assert.doesNotMatch(callback,/\['owner','friend','stranger','known'\]/)
 const reply=host.slice(j,host.indexOf('generateContinuation:',j))
 assert.match(reply,/offerPrivateBiliLinkToLife\(\{uid:req\.uid,role:tier/)
})
