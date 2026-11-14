import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
const read = name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const bvid='BV1234567890'
test('自适应预览只生成证据元数据，不产生视频已播放或已听到声音的假回执',()=>{
  const evidence=buildVideoEvidenceBundle({bvid,info:{bvid,title:'仅供验证的预览视频'},
    visual:{bvid,ok:true,status:'frames_ready',times:[4.5,18],sampling:{
      sampler_version:2,strategy:'activity-time+local-thumbnail-difference',
      candidates_examined:9,frames_selected:2,sheets_downloaded:2}},at:Date.now()})
  const frames=evidence.sources.find(s=>s.kind==='preview_frames')
  assert.deepEqual(frames.timePointsMs,[4500,18000])
  assert.equal(frames.sampling.selection,'activity-time+thumbnail-dedup')
  assert.equal(frames.sampling.framesSelected,2)
  assert.equal(evidence.observedVideoPlayback,false)
  assert.equal(evidence.analyzedOriginalAudio,false)
  assert.equal(evidence.verifiedContent,false)
})
test('分镜统计字段限制为安全范围，禁止透传上游任意注入字段',()=>{
  const data=buildVideoEvidenceBundle({bvid,info:{title:'测试'},visual:{bvid,ok:true,status:'analyzed',
    description:'蓝色底图上有一只鱼',times:[2],sampling:{sampler_version:2,
      strategy:'activity-time+local-thumbnail-difference',candidates_examined:99999,
      frames_selected:200,sheets_downloaded:999,secret:'do-not-copy'}},at:Date.now()})
  const frames=data.sources.find(s=>s.kind==='preview_frames')
  assert.equal(frames.sampling.candidatesExamined,12)
  assert.equal(frames.sampling.framesSelected,3)
  assert.equal(frames.sampling.sheetsDownloaded,3)
  assert.ok(!JSON.stringify(data).includes('do-not-copy'))
  assert.equal(data.observedVideoPlayback,false)
})
test('代码不增加任意视频 URL 或全量视频下载入口，不改变写入工具',()=>{
  const py=read('lib/preview_vision.py'),mcp=read('vendor/bilibili-mcp/mcp_server.py')
  assert.match(py,/_candidate_indices_from_primary/)
  assert.match(py,/_select_distinct_previews/)
  assert.match(py,/other\/\/slots==index\/\/slots/)
  assert.match(py,/max_frames=max\(1,min\(3,int\(max_frames\)\)\)/)
  assert.match(mcp,/bili_preview_vision/)
  assert.doesNotMatch(py,/https:\/\/www\.bilibili\.com\/video\/\{bvid\}/)
})
