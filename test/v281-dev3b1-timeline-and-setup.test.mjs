import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {EventEmitter} from 'node:events'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionTimeline} from '../lib/video-perception-timeline.mjs'
import {openOllamaPowerShell,findWindowsOllama} from '../lib/ollama-start-windows.mjs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const bvid='BV1234567890', info={bvid,title:'测试字幕时间对齐'}, subtitles={bvid,text:'第一句\n第二句',timed_segments:[{startSeconds:1,endSeconds:3,text:'第一句'},{startSeconds:20,endSeconds:24,text:'第二句'}]}
test('only official explicit seconds produce caption spans, aligned to trusted low-res frames',()=>{
 const visual={bvid,status:'analyzed',image_source:'B站官方预览低清图',times:[2,21],description:'可以看到两个采样时刻的场景'}
 const e=buildVideoEvidenceBundle({bvid,info,subtitle:subtitles,visual})
 assert.deepEqual(e.sources.find(s=>s.kind==='subtitle').spans,[{startMs:1000,endMs:3000},{startMs:20000,endMs:24000}])
 const tl=buildVideoPerceptionTimeline({bvid,evidence:e,subtitle:subtitles,visual})
 assert.equal(tl.alignment,'time-proximity-only')
 assert.equal(tl.anchors.length,2)
 assert.equal(tl.anchors[0].nearbyCaptions[0].excerpt,'第一句')
 assert.equal(tl.anchors[1].nearbyCaptions[0].excerpt,'第二句')
 assert.equal(tl.sourceAvailability.originalAudio,'not-listened')
 assert.equal(tl.sourceAvailability.ocr,'not-observed')
 assert.equal(tl.sourceAvailability.videoFrames,'preview')
})
test('ASR without typed seconds remains unanchored, missing evidence cannot forge a timestamp',()=>{
 const asr={bvid,source:'local-asr',text:'本地模型转写的文字',segments:[{from:99,to:100,content:'不可相信的单位'}]}
 const e=buildVideoEvidenceBundle({bvid,info,subtitle:asr})
 const tl=buildVideoPerceptionTimeline({bvid,evidence:e,subtitle:asr})
 assert.equal(tl.sourceAvailability.localAsr,true)
 assert.equal(tl.anchors.length,0)
 assert.ok(tl.limitations.includes('transcript-has-no-timestamps'))
 assert.equal(buildVideoPerceptionTimeline({bvid:'BV1234567891',evidence:e,subtitle:asr}),null)
 const forged=buildVideoPerceptionTimeline({bvid,evidence:e,subtitle:{...asr,bvid:'BV1234567891',timed_segments:[{startSeconds:1,endSeconds:2,text:'别的视频'}]}})
 assert.equal(forged.anchors.length,0)
})
test('timeline clamps captions, caps anchors, ignores invalid and unverified visual receipts',()=>{
 const dirty={...subtitles,timed_segments:Array.from({length:250},(_,i)=>({startSeconds:i,endSeconds:i+.5,text:'甲'.repeat(500)}))}
 const e=buildVideoEvidenceBundle({bvid,info,subtitle:dirty})
 const tl=buildVideoPerceptionTimeline({bvid,evidence:e,subtitle:dirty})
 assert.equal(tl.sourceAvailability.timedCaptionSegments,160)
 assert.equal(tl.anchors.length,48)
 assert.ok(tl.anchors.every(a=>a.nearbyCaptions[0].excerpt.length<=120))
 const noVision=buildVideoEvidenceBundle({bvid,info,visual:{bvid,ok:false,status:'vision_error',times:[42],description:'假证据'}})
 assert.equal(buildVideoPerceptionTimeline({bvid,evidence:noVision,visual:{times:[42]}}).anchors.length,0)
})
test('PowerShell launcher is opt-in, Windows only, with a fixed safely quoted executable',async()=>{
 assert.equal((await openOllamaPowerShell({platform:'linux'})).ok,false)
 assert.match((await openOllamaPowerShell({platform:'win32',find:()=>null})).error,/未找到/)
 const calls=[]
 const result=await openOllamaPowerShell({platform:'win32',find:()=>"C:\\O'Neil\\ollama.exe",spawn:(cmd,args,options)=>{
   calls.push({cmd,args,options}); const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('close',0));return child
 }})
 assert.equal(result.opened,true)
 assert.equal(calls[0].cmd,'powershell.exe')
 assert.equal(calls[0].options.shell,false)
 assert.equal(calls[0].options.windowsHide,true)
 assert.match(Buffer.from(calls[0].args[3].match(/'([A-Za-z0-9+/=]+)'\) -WindowStyle/)[1],'base64').toString('utf16le'),/O''Neil/)
 assert.ok(!calls[0].args[3].includes('HTTPS_PROXY'))
 assert.equal(findWindowsOllama({env:{},where:()=>({status:1}),exists:()=>false}),null)
})
test('owner-only launcher route, DSH ability guide and README vector diagrams are wired',()=>{
 const src=read('index.js'),html=read('lib/management-console.html'),ui=read('lib/management-console.js'),readme=read('README.md')
 assert.match(src,/\/api\/bili-duty\/local-vision\/start-ollama/)
 assert.match(src,/req\.socket\?\.remoteAddress/)
 assert.match(ui,/dshVisionModelSnippet/)
 assert.match(ui,/local-vision\/start-ollama/)
 for(const id of ['local-vision-start-ollama','dsh-vision-config-copy','dsh-vision-capabilities-guide'])assert.ok(html.includes('id="'+id+'"'))
 assert.match(readme,/video-perception-current\.svg/)
 assert.match(readme,/video-danmaku-heat-illustration\.svg/)
 assert.ok(existsSync(new URL('../docs/architecture/assets/video-perception-current.svg',import.meta.url)))
 assert.match(read('vendor/bilibili-mcp/mcp_server.py'),/"timed_segments": timed_segments/)
})
