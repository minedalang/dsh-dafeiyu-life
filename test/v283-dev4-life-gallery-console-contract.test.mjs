import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {neuralProjectionKey} from '../lib/memory-neural-projection.mjs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('行动节点/时间线关联12小时画面，拼图按视频时间排序并支持逐格放大',()=>{
  for(const id of ['life-gallery-open-latest','life-gallery-modal','life-gallery-grid','life-gallery-zoom','life-gallery-close','life-gallery-open-current','life-gallery-back','life-gallery-large-image','life-gallery-tile-canvas','life-gallery-view-frames','life-gallery-view-boards','life-gallery-boards'])
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
 assert.match(server,/lifeMemory\.videoEvidenceTrace\(\{accountTag:account,memoryId:matches\[0\]\.id,limit:1,ownerSession:true\}\)/)
 assert.match(server,/neuralProjectionKey\(\{\.\.\.m,gardenKind:'experience'/)
 assert.match(server,/recallVideoDetails\(\{bvid:matches\[0\]\.bvid,accountTag:account,maxBytes:8192,ownerSession:true,visibility:trace\[0\]\.visibility\}\)/)
 assert.doesNotMatch(server.slice(server.indexOf('on-demand deep memory'),server.indexOf('// Owner\'s read-only management view')),/sendComment|readArchive|restoreBackup/)
})


test('neural deep endpoint binds opaque current node to the Life Gateway rather than trusting the browser',async()=>{
  const start=server.indexOf("    if(req.method==='GET'&&path==='/api/bili-duty/main-session/memory/neural/deep'){")
  const end=server.indexOf("    if (req.method === 'GET' && (path === '/api/bili-duty/main-session/memory/garden'",start)
  assert.ok(start>0&&end>start)
  const bv='BV1234567890',record={id:'e-'+'a'.repeat(18),kind:'watch',stage:'clear',
    summary:'真实公开视频经历',at:'2026-11-24T08:00:00.000Z',bvid:bv}
  const nodeId=neuralProjectionKey({...record,gardenKind:'experience',gardenEvidence:'fading-life-episode'})
  let expandCalls=0,traceProof=true,visibility='private-session'
  const lifeMemory={semanticCandidates:()=>[record],videoRecallGroups:rows=>rows,videoEvidenceTrace:()=>traceProof?[{bvid:bv,detailStorage:'available',visibility}]:[],
    recallVideoDetails:opts=>{assert.equal(opts.ownerSession,true);assert.equal(opts.visibility,visibility);expandCalls++;return {ok:true,totalFragments:1,truncated:false,
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
  visibility='unknown';assert.equal((await create(nodeId)).status,404)
  traceProof=false
  assert.equal((await create(nodeId)).status,404)
  assert.equal((await create(nodeId,'192.0.2.1')).status,403)
  assert.equal((await create('f'.repeat(16))).status,404)
  assert.equal(expandCalls,1,'failed identity checks must not touch deep memory content')
})

test('dev6 画廊首行是单帧／原始拼图两种互斥模式；下方仅有一处大图；补看原位插入',()=>{
  assert.match(html,/id="life-gallery-view-frames" aria-pressed="true"/);
  assert.match(html,/id="life-gallery-view-boards" aria-pressed="false"/);
  assert.match(html,/id="life-gallery-grid"[^>]*>[\s\S]*?id="life-gallery-boards"[^>]*hidden/,
    '拼图模式应直接替换第一行缩略图浏览区');
  assert.match(html,/id="life-gallery-boards"[^>]*hidden[\s\S]*?id="life-gallery-zoom"[^>]*hidden/,
    '选中单帧的大图是下面独立的一块区域');
  assert.doesNotMatch(html,/id="life-gallery-show-board"|id="life-gallery-tile-times"/,
    '下方大图不得再叠加原拼图切换按钮或重复时间码行');
  assert.match(js,/const setLifeGalleryViewMode=mode=>/);
  assert.match(js,/life-gallery-grid'\)\.hidden=lifeGalleryViewMode!=='frames'/);
  assert.match(js,/life-gallery-boards'\)\.hidden=lifeGalleryViewMode!=='boards'/);
  assert.match(js,/const renderLifeGalleryBoards=row=>/);
  assert.match(js,/figure\.appendChild\(image\)/);
  assert.match(html,/拼图与局部图保存 12 小时/);
  assert.match(server,/retentionHours:LIFE_GALLERY_RETENTION_HOURS/);
  assert.match(html,/life-gallery-wait-spin/);
  assert.match(js,/el\.setAttribute\('aria-busy',String\(state==='running'\)\)/);
  assert.doesNotMatch(js,/figure\.addEventListener\('click'/,'完整拼图仅查看，不能误选单帧');
  assert.match(js,/clearGalleryTile\(\);\$\('life-gallery-zoom'\)\.hidden=false/,
    '选择单帧时下方显示大图，上方两种浏览模式保持挂载');
  assert.match(html,/#panel-life-agent #life-gallery-tile-canvas\[hidden\][^}]*display:none!important/);
  assert.match(html,/#panel-life-agent #life-gallery-large-image\[hidden\]/);
  assert.match(js,/const renderLifeGalleryTiles=\(row,\{animateNew=false\}=\{\}\)=>/);
  assert.match(js,/const oldCards=new Map/);
  assert.match(js,/let button=oldCards\.get\(key\)/,'已有帧 DOM 必须复用，不能每次重新创建');
  assert.match(js,/grid\.replaceChildren\(fragment\)/,'旧卡片重用，新局部卡片按真实时间重排');
  assert.match(js,/button\.classList\.add\('life-gallery-new-frame'\)/);
  assert.match(js,/setLifeGalleryTileLock\(true\)/,'请求中采样图应禁用、置灰');
  assert.match(js,/context\.mode==='frame'\?\[\.\.\.grid\.querySelectorAll/,'只有选帧补看才闪绿目标帧');
  assert.match(js,/source\.classList\.add\('life-gallery-verified-source'\)/);
  assert.match(js,/await loadLifeVideoGallery\(\)/,'必须从服务端重新读取真实新图');
  assert.match(js,/renderLifeGalleryTiles\(updated,\{animateNew:true\}\)/);
  assert.match(js,/isLifeGalleryFocusContextCurrent\(context\)/,'弹窗关闭或其他观察组不能错误回填图片');
  assert.match(js,/已在当前时间线新增 /);
  assert.doesNotMatch(js,/可重新打开本次画面查看新增局部图/,'成功后不应要求用户重新打开弹窗');
  assert.match(html,/prefers-reduced-motion:reduce[^{]*\{[^}]*life-gallery-frame-tile\.life-gallery-verified-source/,
    '尊重系统减少动画设置');
})


test('原始拼图仅展示真实多时间点文件，局部单帧不重复显示',()=>{
  const start=js.indexOf('  const renderLifeGalleryBoards=row=>{');
  const end=js.indexOf('  const setLifeGalleryTileLock=',start);
  assert.ok(start>=0&&end>start);
  const node=(tag,text='')=>({tag,text,children:[],appendChild(child){this.children.push(child)},replaceChildren(fragment){this.children=fragment.children}});
  const boards=node('div');
  const entry={at:1,images:[{file:'global.jpg',kind:'storyboard',times:[1,2,3]},
    {file:'focus-board.jpg',kind:'focus',times:[5,6,7]},
    {file:'focus-single.jpg',kind:'focus',times:[6]},
    {file:'focus-single2.jpg',kind:'focus',times:[7]}]};
  const ctx={$:()=>boards,node,document:{createDocumentFragment:()=>node('fragment')},
    lifeGalleryRelatedRows:()=>[entry],lifeGalleryImageUrl:(_entry,item)=>item.file,videoClock:String};
  runInNewContext(js.slice(start,end)+'\n globalThis.render=renderLifeGalleryBoards;',ctx);
  ctx.render(entry);
  assert.deepEqual(boards.children.map(card=>card.children[0].src),['global.jpg','focus-board.jpg']);
  entry.images=[{file:'focus-single.jpg',kind:'focus',times:[6]}];
  ctx.render(entry);
  assert.equal(boards.children.length,1);assert.equal(boards.children[0].tag,'p');
})

test('video cache expiry starts independently of backup and retries periodically; expired captures cannot renew gallery retention',()=>{
 assert.match(server,/const runVideoCacheCleanup=\(\)=>\{/)
 assert.match(server,/setInterval\(runVideoCacheCleanup,VIDEO_CACHE_RETENTION\.interval\)/)
 assert.match(server,/setTimeout\(runVideoCacheCleanup,30_000\)/)
 assert.match(server,/clearTimeout\(videoCacheStart\);clearInterval\(videoCacheTimer\)/)
 assert.match(server,/Date\.now\(\)-value\.createdAt>=videoDebugExpiry/)
 assert.match(server,/const result=pruneVideoCaches\(stateDir\)/)
})
