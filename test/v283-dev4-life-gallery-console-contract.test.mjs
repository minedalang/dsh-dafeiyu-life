import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
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
  assert.match(js,/const allFrames=related\.flatMap/)
  assert.match(js,/item\.gridCols/)
  assert.doesNotMatch(html,/id="life-gallery-list"/, '不可独占一大块图库列表')
  assert.doesNotMatch(html,/VISUAL JOURNAL · 最近 24 小时/)
  assert.match(js,/loadLifeVideoGallery\(\)/)
  assert.match(server,/safeVideoDebugCapture=\(value,bvid\)=>/);
  assert.match(server,/gridCols:cols,gridRows:rows/, '网格坐标须经过实际工具回执白名单接线');
  assert.match(server,/pruneLifeVideoGallery\(stateDir,account\)/)
  assert.match(server,/readLifeVideoGalleryImage\(stateDir,account/)
  assert.match(html,/prefers-reduced-motion:reduce/)
  assert.doesNotMatch(js,/request\('\/life-video-gallery\/focus'/)
})
