import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const scheduler=readFileSync(new URL('../lib/interaction-scheduler.mjs',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('后台采用双未读计数哨兵；完整私信/互动详情只由变化、基线或一致性核对触发',()=>{
  assert.match(index,/readPrivateUnreadCounts/)
  assert.match(index,/readInteractionUnreadCounts/)
  assert.match(index,/readPrivateUnread:readPrivateUnreadSentinel/)
  assert.match(index,/readSocialUnread:readSocialUnreadSentinel/)
  assert.match(scheduler,/SENTINEL_INTERVAL_MS=5\*MINUTE/)
  assert.match(scheduler,/createNotificationSentinelState/);assert.match(scheduler,/reconciliationMinutes:30/)
  assert.match(scheduler,/comments\.poll\(\{notifications:categories\.includes\('replies'\),/)
  assert.match(scheduler,/dm\.poll\(\)/)
  assert.doesNotMatch(scheduler,/dmQuietIntervals|commentReplyWatchMinutes|commentAtWatchMinutes/)
})

test('Life 手动 check_notifications 复用哨兵，不再旁路读取三份完整通知列表',()=>{
  assert.match(index,/interactionScheduler\.checkNow\(\)/)
  const start=index.indexOf("if(task?.type==='check_notifications')")
  const end=index.indexOf("if(task?.type===",start+10)
  const block=index.slice(start,end>start?end:start+1200)
  assert.doesNotMatch(block,/call\('bili_received_replies'/)
  assert.doesNotMatch(block,/call\('bili_received_at_and_likes'/)
  assert.match(block,/只有发现新增通知时才会读取详情/)
})

test('旧轮询配置字段继续兼容读取，但不再由管理页暴露为独立定时器',()=>{
  for(const key of ['dmWatchMinutes','dmQuietMaxMinutes','commentReplyWatchMinutes','commentAtWatchMinutes'])assert.match(index,new RegExp(key))
  for(const id of ['dm-interval','dm-quiet-max','poll-replies-minutes','poll-at-minutes','polling-choice'])assert.doesNotMatch(html,new RegExp(`id="${id}"|name="${id}"`))
  assert.match(html,/私信未读计数哨兵/)
  assert.match(html,/互动通知计数哨兵/)
  assert.match(html,/每 30 分钟进行一次必要的详情核对/)
  assert.match(html,/活跃私信定向检查/)
  assert.match(ui,/私信未读计数哨兵/)
  assert.match(ui,/互动通知计数哨兵/)
})

test('管理页只保存活跃私信定向参数，旧配置项不会被静默覆盖',()=>{
  const save=ui.slice(ui.indexOf("$('polling-save').addEventListener"),ui.indexOf('// 显式加载内置默认提示词'))
  assert.match(save,/dmActivePollEnabled/)
  assert.match(save,/dmActivePollSeconds/)
  assert.match(save,/dmDetailMaxSessions/)
  assert.doesNotMatch(save,/dmWatchMinutes|dmQuietMaxMinutes|commentReplyWatchMinutes|commentAtWatchMinutes/)
  assert.match(html,/旧版「私信最短检查间隔」「收到评论回复检查」「被 @ 邀请检查」仅作为旧配置兼容字段保留/)
})

test('插件配置 API 保留旧轮询字段的读取与保存兼容',async()=>{
  const home=mkdtempSync(join(tmpdir(),'v2453-ui-'));let route
  try{
    apply({get(k){return k==='dshHomePath'?(...x)=>join(home,...x):undefined},logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{})
    async function req(method,path,body){const request=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
      request.method=method;request.url=path;request.headers={host:'localhost'}
      let out;const response={writeHead(){},end(v){out=JSON.parse(v)}};await route.handler(request,response);return out}
    let c=await req('GET','/api/bili-duty/config')
    assert.equal(c.config.dmWatchMinutes,5);assert.equal(c.config.commentReplyWatchMinutes,2)
    c=await req('POST','/api/bili-duty/config',{dmWatchMinutes:5,dmQuietMaxMinutes:40,commentReplyWatchMinutes:8,commentAtWatchMinutes:2})
    assert.equal(c.config.dmWatchMinutes,5);assert.equal(c.config.dmQuietMaxMinutes,40);assert.equal(c.config.commentReplyWatchMinutes,8)
  }finally{rmSync(home,{recursive:true,force:true})}
})
