import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('行动树下 24 小时画面记录、拼图与单张查看接线',()=>{
  for(const id of ['life-gallery-list','life-gallery-modal','life-gallery-grid','life-gallery-zoom','life-gallery-close','life-gallery-open-current','life-gallery-back','life-gallery-large-image'])
    assert.match(html,new RegExp('id="'+id+'"'))
  assert.match(js,/const openLifeGallery=row=>/)
  assert.match(js,/lifeGalleryRecords\.find\(x=>x\.bvid===bvid\)/)
  assert.match(js,/loadLifeVideoGallery\(\)/)
  assert.match(server,/pruneLifeVideoGallery\(stateDir,account\)/)
  assert.match(server,/readLifeVideoGalleryImage\(stateDir,account/)
  assert.match(html,/prefers-reduced-motion:reduce/)
  assert.doesNotMatch(js,/request\('\/life-video-gallery\/focus'/)
})
