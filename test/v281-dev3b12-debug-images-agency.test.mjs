import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordInterestEvents} from '../lib/life-interests.mjs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'
const BV='BV1234567890';const main=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const client=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
test('Life 真正意愿选中的新视频与补看才可登记自主经历，主人指令不算自主兴趣',()=>{
  const payload={bvid:BV,info:{title:'关于鱼鱼的公开视频'},operationId:'validwatchrow123',autonomousSelected:true}
  assert.equal(buildVideoExplorationEvent({...payload,source:'bili-life'}).autonomousSelected,true)
  assert.equal(buildVideoExplorationEvent({...payload,source:'main-session'}).autonomousSelected,false)
  assert.equal(buildVideoExplorationEvent({...payload,source:'bili-life',autonomousSelected:false}).autonomousSelected,false)
  assert.match(main,/name:'bili_life_consider_video'/)
  assert.match(main,/name:'bili_video_revisit_moment'/)
  assert.match(main,/runLifeChosenVideoRead\(/)
})
test('自主观看的精确时间与账号归因进入兴趣候选，但主人观看不算 Life 自主兴趣',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-video-growth-'))
  try{
    const at=Date.parse('2026-11-15T08:00:00.000Z')
    const accountTag='abcdef1234567890'
    const base={bvid:BV,info:{title:'猫咪追逐一颗发光小球'},operationId:'read-origin-2026',at}
    const owner=buildVideoExplorationEvent({...base,source:'main-session',autonomousSelected:true})
    assert.equal(owner.autonomousSelected,false)
    assert.equal(recordInterestEvents(dir,[owner],at,{accountTag}).added,0)
    const life=buildVideoExplorationEvent({...base,source:'bili-life',autonomousSelected:true})
    assert.equal(life.time,new Date(at).toISOString())
    recordInterestEvents(dir,[life],at,{accountTag})
    const stored=JSON.parse(readFileSync(join(dir,'life-memory','interests.json'),'utf8'))
    assert.ok(stored.curiosityCandidates.some(c=>c.bvid===BV&&c.account===accountTag))
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('实际图像通过本机受保护端点显示，不把图片正文注入 Life / 备份',()=>{
  assert.match(main,/safeVideoDebugCapture/)
  assert.match(main,/delete parsedVisual\.debugCapture/)
  assert.match(main,/delete result\.debugCapture/)
  assert.match(main,/videoDebugJob\.images=debugImages/)
  assert.match(main,/video-perception-debug\/image/)
  assert.match(main,/local\)return sendJson\(res,403/)
  assert.match(main,/videoDebugAccount\(\)/)
  assert.match(main,/no-store, private/)
  assert.match(page,/id="video-debug-images"/)
  assert.match(client,/video-debug-image-grid/)
  assert.match(client,/videoDebugState\?\.lastLife\?\.images/)
})
test('未验收的本地视觉模型提供验收跳转高亮，已下载不再提供重复下载与取消按钮',()=>{
  assert.match(page,/id="local-vision-review-jump"/)
  assert.match(client,/vision-approval-flash/)
  assert.match(client,/local-vision-install'\)\.hidden=Boolean\(model\?\.installed\)/)
  assert.match(client,/local-vision-cancel'\)\.hidden=!downloading/)
})
