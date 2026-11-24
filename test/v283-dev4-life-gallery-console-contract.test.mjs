import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {neuralProjectionKey} from '../lib/memory-neural-projection.mjs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('行动节点/时间线关联24小时画面，拼图按视频时间排序并支持逐格放大',()=>{
  for(const id of ['life-gallery-open-latest','life-gallery-modal','life-gallery-grid','life-gallery-zoom','life-gallery-close','life-gallery-open-current','life-gallery-back','life-gallery-large-image','life-gallery-tile-canvas','life-gallery-tile-times','life-gallery-show-board'])
    assert.match(html,new RegExp('id="'+id+'"'))
  assert.match(js,/const openLifeGallery=row=>/)
  assert.match(js,/const galleryForAction=\(bvid,at\)=>/)
  assert.match(js,/Math\.abs\(row\.at-at\)<=5\*60_000/)
  assert.match(js,/life-timeline-gallery-open/)
  assert.match(js,/const tiles=related\.flatMap/, '逐张生成真实拼图格及局部帧')
  assert.match(js,/item\.times\.map\(\(t,index\)=>\(\{entry,item,index/, '每个有效时间码一张画面卡')
  assert.match(js,/canvas\.getContext\('2d'\)\.drawImage/, '逐格裁切必须来自真实 JPEG')
  assert.match(js,/confirmAction\(\{title:'确认主人视频局部补看'/, '主人确认应使用管理页统一弹窗')
  assert.doesNotMatch(js.slice(js.indexOf('const requestGalleryFocus='),js.indexOf("$('life-gallery-revisit-frame').addEventListener")),/window\.confirm|window\.prompt|window\.alert/)
  assert.match(js,/item\?\.gridCols/)
  assert.doesNotMatch(html,/id="life-gallery-list"/, '不可独占一大块图库列表')
  assert.doesNotMatch(html,/VISUAL JOURNAL · 最近 24 小时/)
  assert.match(js,/loadLifeVideoGallery\(\)/)
  assert.match(server,/safeVideoDebugCapture=\(value,bvid\)=>/);
  assert.match(server,/gridCols:cols,gridRows:rows/, '网格坐标须经过实际工具回执白名单接线');
  assert.match(server,/pruneLifeVideoGallery\(stateDir,account\)/)
  assert.match(server,/readLifeVideoGalleryImage\(stateDir,account/)
  assert.match(html,/prefers-reduced-motion:reduce/)
  assert.match(html,/id="life-gallery-revisit-frame"/)
  assert.match(html,/id="life-gallery-revisit-time"/)
  assert.match(js,/request\('\/life-video-gallery\/focus'/)
  assert.match(js,/request\('\/life-video-gallery\/focus\/status'/)
  assert.match(server,/planOwnerGalleryRevisit/)
  assert.match(server,/recordVerifiedFocusRevision/)
  assert.match(server,/detailPersisted\?/, 'deep-only partial failures must never claim fully updated memory')
  assert.match(js,/memory\.status==='partial'/, 'owner must be warned about partial deep-only persistence')
})

test('dev6 long-video owner revisit shows rejected reason and actual worker stage',()=>{
  assert.match(html,/id="life-gallery-revisit-status"[^>]*data-state="idle"/)
  assert.match(html,/id="life-gallery-revisit-seconds"[^>]*max="14400"/)
  assert.match(js,/data\?\.error\|\|data\?\.reason\|\|'请求失败'/)
  assert.match(js,/ownerFocusErrorText/)
  assert.match(js,/job\.stage/)
  assert.match(js,/查看画面 · /)
  assert.match(server,/stage:job\.stage/)
  assert.match(server,/job\.stage='video-read'/)
  assert.match(server,/job\.stage='verification'/)
  assert.match(server,/job\.stage='memory-write'/)
  assert.match(server,/x\.times\.every\(t=>Number\.isFinite\(t\)&&t>=0&&t<=14400\)/)
})

test('neural detail timeline only opens authorized current clear memories in read-only mode',()=>{
 for(const id of ['neural-deep-expand','neural-deep-fragments'])assert.match(html,new RegExp('id="'+id+'"'))
 assert.match(js,/const openNeuralDeep=async/)
 assert.match(js,/request\('\/main-session\/memory\/neural\/deep\?node='/)
 assert.match(js,/neuralDeepSelected=m\.clarity==='clear'/)
 assert.match(server,/path==='\/api\/bili-duty\/main-session\/memory\/neural\/deep'/)
 assert.match(server,/m\.stage==='clear'&&m\.kind==='watch'/)
 assert.match(server,/lifeMemory\.videoEvidenceTrace\(\{accountTag:account,memoryId:matches\[0\]\.id,limit:1\}\)/)
 assert.match(server,/neuralProjectionKey\(\{\.\.\.m,gardenKind:'experience'/)
 assert.match(server,/expandMemoryDetail\(\{memoryId:matches\[0\]\.id,accountTag:account,maxBytes:8192\}\)/)
 assert.doesNotMatch(server.slice(server.indexOf('on-demand deep memory'),server.indexOf('// Owner\'s read-only management view')),/sendComment|readArchive|restoreBackup/)
})


test('neural deep endpoint binds opaque current node to the Life Gateway rather than trusting the browser',async()=>{
  const start=server.indexOf("    if(req.method==='GET'&&path==='/api/bili-duty/main-session/memory/neural/deep'){")
  const end=server.indexOf("    if (req.method === 'GET' && (path === '/api/bili-duty/main-session/memory/garden'",start)
  assert.ok(start>0&&end>start)
  const bv='BV1234567890',record={id:'e-'+'a'.repeat(18),kind:'watch',stage:'clear',
    summary:'真实公开视频经历',at:'2026-11-24T08:00:00.000Z',bvid:bv}
  const nodeId=neuralProjectionKey({...record,gardenKind:'experience',gardenEvidence:'fading-life-episode'})
  let expandCalls=0,traceProof=true
  const lifeMemory={semanticCandidates:()=>[record],videoEvidenceTrace:()=>traceProof?[{bvid:bv,detailStorage:'available'}]:[],
    expandMemoryDetail:()=>{expandCalls++;return {ok:true,totalFragments:1,truncated:false,
      fragments:[{type:'focused-observation',certainty:'model-observation',
        content:'真实采样到一张海报',timeAnchorMs:[3000000,3012000],uncertainties:['人物身份不确定'],sourceRef:'private-internal-source'}]}}}
  const create=(node,peer='127.0.0.1')=>{
    const ctx={req:{method:'GET',socket:{remoteAddress:peer},headers:{host:'127.0.0.1:8000',origin:'http://127.0.0.1:8000'}},
      path:'/api/bili-duty/main-session/memory/neural/deep',url:new URL('http://127.0.0.1:8000/x?node='+node),
      res:{setHeader(){}},trustedLifeAccountTag:()=> 'a'.repeat(16),hasCredential:()=>true,
      accountBinding:{status:()=>({blocked:false})},lifeMemory,neuralProjectionKey,validBv:x=>/^BV[A-Za-z0-9]{10}$/.test(x),
      sendJson:(_res,status,payload)=>({status,payload})}
    runInNewContext('async function invoke(){'+server.slice(start,end)+'} globalThis.invoke=invoke',ctx)
    return ctx.invoke()
  }
  const success=await create(nodeId)
  assert.equal(success.status,200);assert.equal(success.payload.fragments.length,1)
  assert.equal(success.payload.fragments[0].content,'真实采样到一张海报')
  assert.equal(success.payload.fragments[0].sourceRef,undefined,'source IDs never exposed')
  traceProof=false
  assert.equal((await create(nodeId)).status,404)
  assert.equal((await create(nodeId,'192.0.2.1')).status,403)
  assert.equal((await create('f'.repeat(16))).status,404)
  assert.equal(expandCalls,1,'failed identity checks must not touch deep memory content')
})
