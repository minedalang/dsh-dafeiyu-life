import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDmPollCursor} from '../lib/dm-poll-cursor.mjs'

const MIN=60_000
function withCursor(priority, callback){
  const dir=mkdtempSync(join(tmpdir(),'fish-dm-rescan-'))
  let clock=1_800_000_000_000
  try{
    let cursor=createDmPollCursor({dataDir:dir,now:()=>clock,getPriority:()=>priority})
    const setClock=n=>{clock=n}
    callback({cursor,now:()=>clock,setClock,dir,reopen:()=>createDmPollCursor({dataDir:dir,now:()=>clock,getPriority:()=>priority})})
  }finally{rmSync(dir,{recursive:true,force:true})}
}

for(const [role,quietMin] of [['owner',120],['friend',360],['familiar',480],['other',720]]){
  test(`unchanged ${role} session avoids extra detail fetch until ${quietMin}m`,()=>withCursor(role,({cursor,now,setClock,reopen})=>{
    const old={uid:'210228238',lastTs:1800000000,unread:0}
    assert.equal(cursor.shouldRead(old),true)
    cursor.observed(old);cursor.commit()
    setClock(now()+(quietMin-1)*MIN)
    assert.equal(reopen().shouldRead(old),false)
    setClock(now()+2*MIN)
    assert.equal(reopen().shouldRead(old),true)
  }))
}

test('a changed latest message timestamp is read immediately even with platform unread cleared elsewhere',()=>withCursor('other',({cursor})=>{
  const old={uid:'210228238',lastTs:1800000000,unread:0}
  cursor.observed(old);cursor.commit()
  assert.equal(cursor.shouldRead({...old,lastTs:1800000500,unread:0}),true)
  assert.equal(cursor.shouldRead({...old,unread:1}),true)
}))

test('unchanged unread hint uses bounded 5m safety rescan without hiding real changed sessions',()=>withCursor('friend',({cursor,now,setClock})=>{
  const row={uid:'210228238',lastTs:1800000000,unread:1}
  cursor.observed(row);cursor.commit()
  setClock(now()+MIN)
  assert.equal(cursor.shouldRead(row),false)
  setClock(now()+3*MIN)
  assert.equal(cursor.shouldRead(row),false)
  setClock(now()+2*MIN)
  assert.equal(cursor.shouldRead(row),true)
  assert.equal(cursor.shouldRead({...row,lastTs:1800000001}),true)
}))
