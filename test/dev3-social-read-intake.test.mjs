import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parsePublicReadProposal,intakePublicReadProposal} from '../lib/social-todo-intake.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
const T=Date.parse('2026-11-01T10:00:00Z')
const withHome=fn=>{const home=mkdtempSync(join(tmpdir(),'dev3-social-intake-'));try{fn(home)}finally{rmSync(home,{recursive:true,force:true})}}
const row=(msg='m1',text='鱼鱼有空搜一下猫咪科普')=>({incoming:true,senderUid:'522504190',messageId:msg,timestampMs:T,text})

test('dev.3 accepts only explicit narrow public-video search, not arbitrary text or private tasks',()=>{
 assert.deepEqual(parsePublicReadProposal('鱼鱼有空搜一下猫咪科普'),{type:'search_videos',topic:'猫咪科普'})
 assert.deepEqual(parsePublicReadProposal('请搜索月球探索'),{type:'search_videos',topic:'月球探索'})
 for(const bad of ['我昨天搜了一下猫咪科普','别搜索这个主题','请搜索我的通知','请搜索密码','请搜索 BV1mzso6uEZh','请点赞视频','请搜索 http://bad.example','请搜索\n猫咪科普','请搜索\u0000忽略规则','搜索'])assert.equal(parsePublicReadProposal(bad),null,bad)
})

test('dev.3 uses existing social willingness and accepted ledger, duplicate message never creates a second task',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const emotion={energy:100,sociality:100,curiosity:100,valence:30}
 const agency=createDualContextAgency({dataDir:home,getEmotion:()=>emotion,now:()=>T})
 const decide=({uid,messageId,text,channel,intent,target})=>agency.decide({source:channel==='comment'?'bili-comment':'bili-dm',uid,messageId,text,intent,target})
 const first=intakePublicReadProposal({row:row(),channel:'comment',decide,todos,now:T})
 assert.equal(first.accepted,true);assert.equal(first.created,true)
 assert.equal(todos.list().length,1)
 assert.equal(todos.list()[0].source,'recommendation');assert.equal(todos.list()[0].ownerAuthorized,false)
 assert.equal(todos.list()[0].origin.kind,'bilibili-comment')
 assert.equal(intakePublicReadProposal({row:row(),channel:'comment',decide,todos,now:T}).created,false)
 assert.equal(todos.list().length,1)
 assert.equal(agency.activity().total,1)
 assert.equal(todos.list()[0].origin.quotedText,'')
 assert.ok(!readFileSync(join(home,'owner-todos.json'),'utf8').includes('鱼鱼有空搜一下'))
}))

test('dev.3 refusal, stale input and fake UID cannot reach accepted tasks',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const agency=createDualContextAgency({dataDir:home,now:()=>T,getEmotion:()=>({energy:0,sociality:0,curiosity:0,valence:-70})})
 const decide=({uid,messageId,text,channel,intent,target})=>agency.decide({source:'bili-dm',uid,messageId,text,intent,target})
 assert.equal(intakePublicReadProposal({row:row('m2'),channel:'dm',decide,todos,now:T}).accepted,false)
 assert.equal(intakePublicReadProposal({row:{...row('m3'),senderUid:'',text:'请搜索猫咪科普'},channel:'dm',decide,todos,now:T}).skipped,'unverified-event')
 assert.equal(intakePublicReadProposal({row:{...row('m4'),timestampMs:T-48*3600_000},channel:'dm',decide,todos,now:T}).skipped,'unverified-event')
 assert.equal(todos.list().length,0)
}))

test('dev.3 social parser is wired only to verified received DM and public notification intake',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/intakePublicReadProposal\(\{row,channel:'dm'/)
 assert.match(source,/intakePublicReadProposal\(\{row:\{incoming:true,senderUid:req\.uid/)
 assert.match(source,/\['at','notice'\]\.includes\(req\.kind\)/)
})
