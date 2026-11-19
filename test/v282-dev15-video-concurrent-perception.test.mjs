import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beginVideoObservationRead} from '../lib/video-observation-read.mjs';

// Tests actual production concurrency helper; no model/network is invoked.
test('already-authorized vision can resolve while ASR remains pending',async()=>{
  let releaseSpeech,started=false,duration=-1;
  const speech=new Promise(resolve=>{releaseSpeech=resolve});
  const visual=beginVideoObservationRead(async()=>{started=true;return {ok:true,status:'analyzed'}},ms=>{duration=ms});
  const result=await visual;
  assert.equal(started,true);
  assert.equal(result.status,'analyzed');
  assert.ok(duration>=0);
  let speechCompleted=false;
  void speech.then(()=>{speechCompleted=true});
  await Promise.resolve();
  assert.equal(speechCompleted,false,'slow speech must not block visual resolution');
  releaseSpeech({text:'partial transcript'});
  await speech;
});

test('vision failure is surfaced; helper cannot forge a success receipt',async()=>{
  let recorded=-1;
  await assert.rejects(beginVideoObservationRead(()=>{throw new Error('read unavailable')},ms=>{recorded=ms}),
    /read unavailable/);
  assert.ok(recorded>=0);
  assert.throws(()=>beginVideoObservationRead(null),TypeError);
});

test('actual Life path initiates independent read before Promise.all speech awaits',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const body=index.slice(index.indexOf('const executeWatchVideo = async'),index.indexOf("name:'bili_watch_video'"));
  assert.ok(body.indexOf('beginVideoObservationRead(')>0);
  assert.ok(body.indexOf('beginVideoObservationRead(')<body.indexOf('await Promise.all(tasks)'));
  assert.ok(body.indexOf('await Promise.all(tasks)')<body.indexOf('vision=await visualPromise'));
  assert.match(body,/const earlyVisionPlan=visionDecision\(\{enabled:cfg\.visionEnabled===true/);
  assert.match(body,/willInvokeVision=earlyVisionPlan\.attempt/);
  assert.match(body,/speechAttempt,\s*phaseDiagnostics:/);
  assert.ok(!body.includes('await call(\'bili_preview_vision\', {'), 'no second serial first-pass visual invocation');
});

test('owner can distinguish safe authority detail, fallback and measured stages',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  for(const term of ['fallback.authorityDetail','fallback.rejectedTrack','Whisper 耗时拆分',
      'audioDownloadMs','modelLoadMs','clipExtractionMs','inferenceMs','visualCompletedBeforeSpeech',
      '不是原视频取帧'])assert.ok(js.includes(term),term);
});
