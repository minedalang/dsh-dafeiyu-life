import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('production interaction scheduler forwards targeted fast-DM polling and exposes the active-session selector',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=source.indexOf('const interactionScheduler = createInteractionScheduler({')
  const end=source.indexOf("try { MIG_200()",start)
  assert.ok(start>=0&&end>start,'production scheduler block exists')
  const block=source.slice(start,end)
  assert.match(block,/poll:async\(\{fastUid=''\}=\{\}\)=>\{/)
  assert.match(block,/dmAutoreply\.poll\(fastUid\?\{fastUid\}:\{\}\)/)
  assert.match(block,/nextFastUid:\(\)=>dmAutoreply\.nextFastUid\(\)/)
  assert.match(block,/status:\(\)=>dmAutoreply\.status\(\)/)
  assert.match(block,/if\(!fastUid&&!result\?\.error&&!result\?\.skipped\)/)
})

test('network recovery endpoint is same-origin and delegates only to the network-category clearer',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=source.indexOf("path === '/api/bili-duty/interaction-backoff/clear-network'")
  assert.ok(start>=0,'network recovery endpoint exists')
  const block=source.slice(start-100,start+1300)
  assert.match(block,/sec-fetch-site/)
  assert.match(block,/body\?\.confirm!==true/)
  assert.match(block,/interactionScheduler\.clearNetworkBackoff\(\{expected:body\.expected\}\)/)
  assert.match(block,/仅清除 DNS\/连接失败退避/)
})
