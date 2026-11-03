import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,existsSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const BV='BV1mzso6uEZh'
const withHome=fn=>{const path=mkdtempSync(join(tmpdir(),'dev3-accepted-todos-'));try{return fn(path)}finally{rmSync(path,{recursive:true,force:true})}}

test('dev.3 uses the original ledger for owner, natural-friend, and stranger accepted tasks, without storing stranger speech',()=>withHome(home=>{
 const at=Date.parse('2026-11-01T00:00:00Z'),todos=createOwnerTodoEngine({dataDir:home,now:()=>at})
 const manual=todos.add({type:'search_videos',topic:'数学',sourceKey:'owner-t1'},{source:'owner'});assert.equal(manual.ok,true)
 const rec=todos.syncRecommendations([{bvid:BV,uid:'522504190',source:'B站评论分享',senderName:'陌生人的昵称',sourceText:'不可信原话',at,accepted:true}],{requireAccepted:true});assert.equal(rec.added,1)
 const rows=todos.list();const social=rows.find(x=>x.source==='recommendation');assert.equal(social.origin.kind,'bilibili-comment');assert.equal(social.acceptance.kind,'social-willingness');assert.equal(social.ownerAuthorized,false)
 assert.equal(todos.page({filter:'all'}).total,2)
 assert.ok(!readFileSync(join(home,'owner-todos.json'),'utf8').includes('不可信原话'))
 assert.equal(todos.syncRecommendations([{bvid:BV,uid:'522504190',source:'B站评论分享',at,accepted:true}],{requireAccepted:true}).added,0)
}))

test('dev.3 stable paged lists and counts across all states without leaking pending write contents',()=>withHome(home=>{
 let tick=Date.parse('2026-11-01T00:00:00Z');const todos=createOwnerTodoEngine({dataDir:home,now:()=>tick})
 for(let i=0;i<46;i++){tick+=1000;assert.equal(todos.add({type:'search_videos',topic:'话题'+i}).ok,true)}
 const a=todos.page({limit:20,filter:'all'});assert.equal(a.items.length,20);assert.ok(a.nextCursor)
 const b=todos.page({limit:20,filter:'all',cursor:a.nextCursor});assert.equal(b.items.length,20)
 const c=todos.page({limit:20,filter:'all',cursor:b.nextCursor});assert.equal(c.items.length,6);assert.equal(c.nextCursor,null)
 assert.equal(new Set([...a.items,...b.items,...c.items].map(x=>x.id)).size,46)
 assert.equal(todos.page({filter:'finished',cursor:a.nextCursor}).ok,false)
 const last=c.items[0];todos.update(last.id,'dismiss');assert.equal(todos.page({filter:'active'}).counts.finished,1)
 const w=todos.add({type:'dm_friend',uid:'522504190',text:'私人消息正文',ownerAuthorized:true}).item
 assert.equal(todos.page({filter:'active',limit:50}).items.find(x=>x.id===w.id).text,undefined)
}))

test('dev.3 state transitions are bounded and persist, interrupted writes never automatically replay',()=>withHome(home=>{
 let tick=Date.parse('2026-11-01T00:00:00Z');const api=createOwnerTodoEngine({dataDir:home,now:()=>tick})
 const r=api.add({type:'search_videos',topic:'世界'}).item
 const w=api.add({type:'like_video',bvid:BV,ownerAuthorized:true}).item
 assert.equal(api.begin(r.id).ok,true);assert.equal(api.begin(w.id).ok,true)
 const restarted=createOwnerTodoEngine({dataDir:home,now:()=>tick+1000})
 assert.equal(restarted.recoverInterrupted().recovered,2)
 const recovered=restarted.list({includeClosed:true});assert.equal(recovered.find(x=>x.id===w.id).status,'uncertain');assert.equal(recovered.find(x=>x.id===r.id).status,'blocked')
 assert.equal(restarted.begin(w.id).ok,false)
 assert.equal(restarted.recoverInterrupted().recovered,0)
 assert.equal(restarted.update(r.id,'reopen').ok,true)
 assert.equal(restarted.begin(r.id).ok,true)
 assert.equal(restarted.finish(r.id,{ok:true}).item.status,'done')
 assert.equal(restarted.page({filter:'finished'}).total,1)
 assert.equal(restarted.page({filter:'finished'}).items[0].history.at(-1).to,'done')
}))

test('dev.3 empty todo ledger is never created solely by a status query or recovery check',()=>withHome(home=>{
 const a=createOwnerTodoEngine({dataDir:home});assert.equal(a.recoverInterrupted().recovered,0);assert.equal(a.page().total,0)
 assert.equal(existsSync(join(home,'owner-todos.json')),false)
}))

test('dev.3 production wiring and UI paged route are connected to the same ledger',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(index,/ownerTodos\.recoverInterrupted\(\)/);assert.match(index,/path === '\/api\/bili-duty\/owner-todos\/page'/)
 assert.match(js,/request\('\/owner-todos\/page\?filter='/);assert.match(js,/const sourceLabel=row\.origin\?\.kind/)
 assert.match(html,/id="owner-todo-next"/);assert.match(html,/id="owner-todo-prev"/)
})

test('dev.3 capacity never silently evicts an accepted active task',()=>withHome(home=>{
 const items=Array.from({length:500},(_,i)=>({id:randomUUID(),type:'search_videos',topic:'topic',title:'topic',status:'open',createdAt:1000+i,updatedAt:1000+i,source:'owner'}))
 writeFileSync(join(home,'owner-todos.json'),JSON.stringify({version:1,items,lastUpdatedAt:0,lastAutoReviewAt:0}))
 const api=createOwnerTodoEngine({dataDir:home})
 assert.equal(api.add({type:'search_videos',topic:'new'}).ok,false)
 assert.equal(api.list({includeClosed:true,limit:500}).length,500)
 assert.equal(api.update(items[0].id,'dismiss').ok,true)
 assert.equal(api.add({type:'search_videos',topic:'new'}).ok,true)
 assert.ok(api.list({includeClosed:true,limit:500}).some(x=>x.id===items[1].id))
}))
