import test from 'node:test'
import assert from 'node:assert/strict'
import {createLiveLifeActivity} from '../lib/live-life-activity.mjs'

test('video visual observation is an explicit live state distinct from browsing',()=>{
 let now=1_800_000_000_000
 const live=createLiveLifeActivity({now:()=>now})
 const stop=live.start('video-observe','0123456789abcdef')
 const active=live.snapshot('0123456789abcdef').active
 assert.equal(active.some(x=>x.kind==='video-observe'),true)
 stop()
 assert.equal(live.snapshot('0123456789abcdef').active.some(x=>x.kind==='video-observe'),false)
})

test('management action tree reads live activity and distinguishes watching from understood',async()=>{
 const {readFileSync}=await import('node:fs')
 const ui=readFileSync('lib/management-console.js','utf8'),host=readFileSync('index.js','utf8')
 assert.match(ui,/\['observe_video','正在看视频画面'\]/)
 assert.match(ui,/request\('\/live-activity'\)/)
 assert.match(ui,/不代表已理解/)
 assert.match(host,/liveLifeActivity\.start\('video-observe'/)
})
