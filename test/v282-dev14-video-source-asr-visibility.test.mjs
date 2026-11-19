import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildVideoPerceptionHandoff} from '../lib/video-perception-handoff.mjs';
const BV='BV1234567890';

test('owner debug reports actual lowres fallback and video source rejection without echoing URLs',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  for(const text of ['原视频降级原因','video_source_domain_rejected','video_source_path_rejected',
    '视频源不是 HTTPS','不是原视频取帧'])assert.ok(js.includes(text),text);
  assert.match(js,/fallback\?\.actual_source==='videoshot'/);
  assert.match(js,/debugCard\('语音／字幕',speech.source==='machine-asr'/);
});

test('Life receives representative audio windows as partial evidence, never full audio consumption',()=>{
  const result=buildVideoPerceptionHandoff({bvid:BV,depth:'standard',
    info:{bvid:BV,title:'演示',duration:1364},
    subtitle:{bvid:BV,source:'local-asr',coverage:'representative-windows',
      text:'抽样真实语音',sampleWindows:[{startSeconds:0,endSeconds:60},{startSeconds:652,endSeconds:712}],
      timed_segments:[{startSeconds:653,endSeconds:655,text:'抽样真实语音'}]},
    visual:{bvid:BV},
    evidence:{schema:'life-video-evidence/v1',bvid:BV,sources:[{kind:'asr_transcript',status:'verified'}],limits:[]},
    timeline:{schema:'life-video-perception-timeline/v1',bvid:BV,anchors:[]}});
  assert.equal(result.speech.source,'machine-asr');
  assert.equal(result.speech.audioCoverage,'representative-windows');
  assert.deepEqual(result.speech.sampleWindows,[{startMs:0,endMs:60000},{startMs:652000,endMs:712000}]);
  assert.ok(result.speech.limitations.includes('sampled-audio-not-full-transcript'));
  assert.equal(result.coverageAssessment.videoIsFullyObserved,false);
});
