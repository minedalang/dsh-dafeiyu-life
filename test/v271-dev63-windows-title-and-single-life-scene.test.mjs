import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {readOwnedVideoLedger} from '../lib/video-owned-ledger.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const UID='3747574597028931',BV='BV14kWt6DE6H'
const title='大肥鱼学歌一天花了我80块token！？ · 鱼鱼🐟'
const python=process.env.DSH_PYTHON||'python'
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'dsh-dev63-title-'))
 // Create the same column names that the current MCP reader uses. Never use a
 // production user's private database or open a network connection.
 const script=`import sys,sqlite3\np=sys.argv[1]\nc=sqlite3.connect(p)\nc.execute('CREATE TABLE selected_videos (bvid TEXT,day TEXT,round_id TEXT,account TEXT,status TEXT,recorded_at_ms INTEGER)')\nc.execute('CREATE TABLE seen_observations (bvid TEXT,day TEXT,title TEXT,up TEXT,status TEXT,account TEXT,recorded_at_ms INTEGER)')\nc.execute('CREATE TABLE comment_receipts (bvid TEXT,account TEXT)')\nc.execute('INSERT INTO selected_videos VALUES (?,?,?,?,?,?)',('BV14kWt6DE6H','2026-11-11','a'*24,'3747574597028931','挑中',1794400000000))\nc.execute('INSERT INTO seen_observations VALUES (?,?,?,?,?,?,?)',('BV14kWt6DE6H','2026-11-11',sys.argv[2],'大肥鱼','挑中','3747574597028931',1794400000000))\nc.commit();c.close()`
 execFileSync(python,['-c',script,join(dir,'video-actions.sqlite3'),title],{windowsHide:true,timeout:3500})
 return dir
}

test('Windows GBK/CP936 Python stdout must round-trip the exact Chinese title, punctuation and emoji',()=>{
 const dir=fixture()
 try{
  const script=fileURLToPath(new URL('../lib/video-owned-ledger-read.py',import.meta.url))
  // Force a Windows-style non-UTF-8 stdout code page even when tests run on Linux.
  const wire=execFileSync(python,[script,dir,UID],{env:{...process.env,PYTHONIOENCODING:'cp936'},windowsHide:true,timeout:3500})
  assert.equal(wire.includes(Buffer.from([0x80])),false,'wire should be ASCII-only escaped JSON')
  assert.ok([...wire].every(x=>x<128),'wire must be portable across any system code page')
  const fromWire=JSON.parse(wire.toString('utf8'))
  assert.equal(fromWire.rows.find(x=>x.bvid===BV).title,title)
  const hostRead=readOwnedVideoLedger({home:dir,uid:UID,python,timeout:3500})
  assert.equal(hostRead.ok,true)
  assert.equal(hostRead.rows[0].title,title)
  const timeline=buildLifeTimeline({watched:hostRead.rows,days:30,now:Date.parse('2026-11-12T01:00:00Z')})
  assert.equal(timeline.find(x=>x.bvid===BV)?.title,title)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('a legacy damaged title is not presented as a verified Chinese video title',()=>{
 const rows=buildLifeTimeline({watched:[{bvid:BV,day:'2026-11-11',title:'��ѧһ컨 80 token',picked:true}],
  now:Date.parse('2026-11-12T01:00:00Z'),days:7})
 assert.equal(rows.length,1)
 assert.match(rows[0].title,/标题编码异常/)
 assert.equal(rows[0].bvid,BV)
})

test('Fish Life is the only animated fish and the one live status container',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const panel=html.slice(html.indexOf('<section id="panel-life-agent"'),html.indexOf('<div class="life-now-timeline"'))
 assert.ok(panel.length>0)
 for(const id of ['life-now-title','life-now-detail','life-now-time','life-integration-refresh']){
  assert.equal((panel.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
 }
 assert.equal((panel.match(/src="\/api\/bili-duty\/life-character\.png"/g)||[]).length,1,'only one fish illustration')
 assert.doesNotMatch(panel,/fish-scene|fish-avatar|life-now-stage|life-now-refresh/)
 assert.match(panel,/FISH LIFE · 实时生活大动画/)
 assert.match(panel,/aria-live="polite"/)
 assert.match(js,/setInterval\(\(\)=>\{void reconcileVisibleLife\(\)\},4000\)/)
 assert.match(js,/Promise\.all\(\[refreshLiveNow\(\),loadLifeIntegration\(\),loadUnifiedLifeSettings\(\)\]\)/)
 assert.doesNotMatch(js,/\$\('life-now-refresh'\)/)
})
