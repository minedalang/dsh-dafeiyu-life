import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLiveLifeActivity} from '../lib/live-life-activity.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
const BV='BV1EWxd6sExz'

test('active video BV appears only for the correct account and a validated public target',()=>{
  let now=Date.parse('2026-11-17T07:20:00Z')
  const tracker=createLiveLifeActivity({now:()=>now})
  const stop=tracker.start('video-observe','acct-a',{bvid:BV,maxAgeMs:120000})
  assert.equal(tracker.snapshot('acct-a').active[0].bvid,BV)
  assert.equal(tracker.snapshot('acct-a').active[0].videoUrl,'https://www.bilibili.com/video/'+BV)
  assert.deepEqual(tracker.snapshot('acct-b').active,[])
  stop()
  assert.equal(tracker.snapshot('acct-a').active.length,0)
  const close=tracker.start('video-observe','acct-a',{bvid:'javascript:alert(1)'})
  assert.equal(tracker.snapshot('acct-a').active[0].bvid,undefined)
  assert.equal(tracker.snapshot('acct-a').active[0].videoUrl,undefined)
  close()
  const dm=tracker.start('dm','acct-a',{bvid:BV})
  assert.equal(tracker.snapshot('acct-a').active[0].bvid,undefined,'private messages never expose BV fields')
  dm()
})

test('life action tree links only live verified-format BV and never invents a video from the last trace',()=>{
  const ui=read('lib/management-console.js'),html=read('lib/management-console.html')
  const server=read('index.js')
  assert.match(html,/id="life-tree-video-target"[^>]*hidden/)
  assert.match(ui,/currentVideoObservation\?\.bvid/)
  assert.match(ui,/videoTarget\.hidden=!targetBv/)
  assert.match(ui,/https:\/\/www\.bilibili\.com\/video\/['"]?\+targetBv/)
  assert.match(server,/liveLifeActivity\.start\(dryRun\?'video-observe-debug':'video-observe',initialLifeAccountTag,\{maxAgeMs:8\*60_000,bvid\}\)/)
})

test('timeline metadata read is not called full video understanding and receipt chronology is unchanged',()=>{
  const now=Date.parse('2026-11-17T08:00:00Z')
  const rows=buildLifeTimeline({now,days:7,lifeDecisions:[{at:now-3000,mode:'active',action:'inspect_exploration',result:'verified-metadata',verifiedReadKind:'video-metadata'}],
    explorationEvidence:[{action:'observe-video',at:now-11000,bvid:BV,frameCount:12,title:'元宝AI拟人',visualSource:'low-resolution-preview'}]})
  const m=rows.find(row=>row.type==='life-read'),v=rows.find(row=>row.type==='life-visual')
  assert.equal(m.label,'核验视频资料')
  assert.match(m.detail,/仅核对了公开视频资料/)
  assert.match(m.detail,/不代表已经完整观看或理解画面/)
  assert.doesNotMatch(m.detail,/公开资料读取回执|内部审计|操作回执/)
  assert.equal(v.label,'观察视频画面')
  assert.ok(Date.parse(m.at)>Date.parse(v.at),'historical receipts must not be backdated or reordered for a story')
  assert.doesNotMatch(m.detail,/已看完|完整观看成功/)
})

test('fresh DSH settings has explicit dependency install entry routing to real setup install card',()=>{
  const client=read('client.js'),server=read('index.js'),html=read('lib/management-console.html'),ui=read('lib/management-console.js')
  assert.match(client,/① 安装／修复主依赖/)
  assert.match(client,/onOpenManage\('firststart','fs-deps-card'\)/)
  assert.match(server,/tab==='firststart'&&body\?\.anchor==='fs-deps-card'/)
  assert.match(html,/href="#fs-deps-card" data-fs-step="account"/)
  assert.match(html,/id="fs-main-deps-install"/)
  assert.match(ui,/location\.hash==='#fs-deps-card'/)
  assert.match(ui,/request\('\/install',\{\}\)/)
  assert.match(ui,/\$\('fs-bili-start'\)\.disabled=!mainReady/)
  assert.match(server,/仅允许在本机管理中心明确操作 B站主依赖安装/)
})

test('server only allows the fixed first-start dependency anchor, even before onboarding completes',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {Readable}=await import('node:stream')
  const {apply}=await import('../index.js')
  const home=mkdtempSync(join(tmpdir(),'dsh-281-fresh-install-open-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return{dispose(){}}}},
      effect:fn=>fn(),settings:{describe(){return[]}}}
    apply(ctx,{})
    const open=async anchor=>{
      const req=Readable.from([Buffer.from(JSON.stringify({what:'manage',tab:'firststart',anchor,resolveOnly:true}))])
      req.method='POST';req.url='/api/bili-duty/open';req.headers={host:'127.0.0.1:5596',origin:'http://127.0.0.1:5596'}
      req.socket={remoteAddress:'::1'}
      let code,output='';await handler(req,{writeHead(n){code=n},end(x){output=String(x||'')}})
      return{code,result:JSON.parse(output)}
    }
    const safe=await open('fs-deps-card')
    assert.equal(safe.code,200);assert.equal(safe.result.ok,true)
    assert.equal(safe.result.url,'http://127.0.0.1:5596/api/bili-duty/manage?tab=firststart#fs-deps-card')
    const attacker=await open('javascript:alert(1)')
    assert.equal(attacker.result.url,'http://127.0.0.1:5596/api/bili-duty/manage?tab=firststart')
  }finally{rmSync(home,{recursive:true,force:true})}
})
