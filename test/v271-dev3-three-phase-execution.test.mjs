import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,delimiter} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHmac} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {readToolAction,createReadActionExecutionGate,ReadActionHeldError} from '../lib/read-action-execution-gate.mjs'

const BV='BV1abcde1234', python=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
const pyDir=fileURLToPath(new URL('../vendor/bilibili-mcp/',import.meta.url))
const pyEnv={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONPATH:[pyDir,process.env.PYTHONPATH].filter(Boolean).join(delimiter)}
const scope='12345:1:'+createHmac('sha256','test-three-phase-cookie').update('12345').digest('hex').slice(0,16)
const py=script=>spawnSync(python,['-c',script],{encoding:'utf8',timeout:9000,env:pyEnv,windowsHide:true,detached:process.platform==='win32'})
const home=async fn=>{const h=mkdtempSync(join(tmpdir(),'dev3-three-phases-'));try{writeFileSync(join(h,'account-binding.json'),JSON.stringify({activeUid:'12345',generation:1,reviewRequired:false,restartRequired:false}));writeFileSync(join(h,'bili_credential.json'),JSON.stringify({dedeuserid:'12345',sessdata:'test-three-phase-cookie'}));return await fn(h)}finally{rmSync(h,{recursive:true,force:true})}}

test('safe public/account read identifiers agree across JS and Python',()=>{
  const cases=[
    ['bili_preview_frames',{bvid:BV}],['bili_user_info',{uid:12345}],
    ['bili_hot_videos',{pn:2,ps:30}],['bili_hot_buzzwords',{page_num:2,page_size:30}],
    ['bili_weekly_hot',{week:8}],['bili_rank',{category:'music',day:7}],
    ['bili_favorite_lists',{uid:0}],['bili_favorite_content',{media_id:5544,page:2,keyword:'科技'}],
    ['bili_home_recommendations',{}],['bili_unread_messages',{}],
    ['bili_received_replies',{}],['bili_received_at_and_likes',{}]
  ]
  const source=`import json\nfrom read_action_gate import read_action\ncases=json.loads(${JSON.stringify(JSON.stringify(cases))})\nprint(json.dumps([read_action(n,a) for n,a in cases],ensure_ascii=False))`
  const r=py(source);assert.equal(r.status,0,r.stderr||String(r.error))
  const pythonActions=JSON.parse(r.stdout)
  for(let i=0;i<cases.length;i++){
    const action=readToolAction(...cases[i]);assert.deepEqual([action.operation,action.target],pythonActions[i])
    assert.equal(action.privacyDomain||'public',i>=6?'account':'public')
  }
})

test('ambiguous or malformed read action parameters are rejected before network',()=>{
  for(const [name,args] of [
    ['bili_preview_frames',{bvid:'bad'}],['bili_user_info',{uid:0}],
    ['bili_hot_videos',{pn:0}],['bili_hot_buzzwords',{page_size:51}],
    ['bili_weekly_hot',{week:-1}],['bili_rank',{category:'invalid'}],
    ['bili_favorite_content',{page:1}],['bili_favorite_content',{media_id:1,page:0}],
  ])assert.throws(()=>readToolAction(name,args))
  assert.equal(readToolAction('bili_send_message',{receiver_uid:12345,text:'hello'}),null)
  assert.equal(readToolAction('bili_preview_vision',{bvid:BV}),null,'parent vision agent must not receive a frame lock')
})

test('account-private reservation blocks independent Python, allows verified Node adapter only',()=>home(async dir=>{
  const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=>scope})
  await gate.run(readToolAction('bili_favorite_lists',{uid:0}),async()=>{
    for(const [adapter,expected] of [[false,'HELD'],[true,'ENTERED']]){
      const source=`from read_action_gate import public_read_reservation,ReadReservationHeld\ntry:\n with public_read_reservation('bili_favorite_lists',{'uid':0},home=${JSON.stringify(dir)},adapter=${adapter?'True':'False'}):print('ENTERED')\nexcept ReadReservationHeld:print('HELD')`
      const r=py(source);assert.equal(r.status,0,r.stderr||String(r.error));assert.match(r.stdout,new RegExp(expected))
    }
    await assert.rejects(gate.run(readToolAction('bili_favorite_lists',{uid:0}),async()=>{}),ReadActionHeldError)
    await assert.rejects(gate.run({...readToolAction('bili_favorite_lists',{uid:0}),privacyDomain:'owner-private'},async()=>{}))
    return {ok:true}
  })
  assert.equal(gate.status().active,0)
  assert.equal(gate.status().recent[0].operation,'bili_favorite_lists')
}))

test('vision locks only real low-resolution frame fetch, not nested independent DSH',()=>{
  const server=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  assert.match(server,/def _fetch_preview_frames_reserved\(bvid\):[\s\S]*?public_read_reservation\('bili_preview_frames'/)
  assert.match(server,/asyncio\.to_thread\(_fetch_preview_frames_reserved, bvid\)/)
  assert.match(server,/mode == 'independent_dsh':\s+from vision_dsh import describe_with_dsh/)
  assert.doesNotMatch(server,/@_gate_read\('bili_preview_vision'\)/)
})

test('all five outbound types pass through real network-edge reservation without granting privileges',()=>{
  const server=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
  const source=readFileSync(new URL('../vendor/bilibili-mcp/outbound_action_gate.py',import.meta.url),'utf8')
  assert.match(server,/_coordinated_send\('dm'/)
  assert.match(server,/_coordinated_send\('comment'/)
  assert.match(server,/_coordinated_send\('dynamic-comment'/)
  assert.match(server,/_coordinated_relation\('follow'/)
  assert.match(server,/_coordinated_relation\('unfollow'/)
  assert.match(source,/if kind not in _KINDS/)
  assert.match(source,/scope = _account_scope\(home\)/)
  assert.match(source,/raise OutboundHeld/)
  assert.match(source,/marker\.rmdir\(\)/)
  assert.doesNotMatch(source,/asyncio\.sleep|auto_retry|retry_send/)
})
