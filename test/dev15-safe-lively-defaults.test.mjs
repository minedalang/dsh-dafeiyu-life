import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply, Config } from '../index.js'

function harness({ existing = null, hostRow = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lively-defaults-'))
  const state = join(root, 'bili-duty')
  if (existing !== null) {
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'config.json'), JSON.stringify(existing))
  }
  let handler
  const ctx = {
    get: k => k === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined,
    logger: { info() {}, warn() {} }, tools: { register() {} },
    connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer: { register(spec) { handler = spec.handler; return { dispose() {} } } },
    effect: fn => fn(), settings: { describe() { return hostRow ? [hostRow] : [] } },
    slots: { register() {}, inject() {} },
  }
  apply(ctx, {})
  const config = async (body = null) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    req.method = body ? 'POST' : 'GET'
    req.url = '/api/bili-duty/config'
    req.headers = { host: 'localhost' }
    let status, output
    const res = { writeHead(n) { status = n }, end(x) { output = JSON.parse(x) } }
    await handler(req, res)
    assert.equal(status, 200)
    return output.config
  }
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('2.8.0 新安装允许受限互动，动态可在独立授权后发表且可切换仅草稿', async () => {
  const x = harness()
  try {
    const c = await x.config()
    assert.equal(c.mainSessionMemoryEnabled, true)
    assert.equal(c.mainSessionReflectionAuto, true)
    assert.equal(c.mainSessionMemorySemanticEnabled, false)
    assert.equal(c.mainSessionMemoryMaxItems, 8)
    assert.equal(c.mainSessionMemoryMaxChars, 1200)
    assert.equal(c.emotionSystemEnabled, true)
    assert.equal(c.autonomousPlannerEnabled, true)
    assert.equal(c.autonomousPlannerDailyLimit, 4)
    assert.equal(c.autonomousPlannerMinutes, 180)
    assert.equal(c.dailyDynamicEnabled, true)
    assert.equal(c.dailyDynamicDraftOnly, false)
    assert.equal(c.dailyDynamicDailyLimit, 1)
    assert.equal(c.ownerDmAgentEnabled,true,'已核验主人受限 Agent 的能力在新安装默认可用')
    assert.equal(c.ownerDmActionsEnabled,true,'公开写入仍必须由本条主人消息明确授权')
    assert.equal(c.ownerTodoCompletionFollowupEnabled,false,'主动任务进度回访必须单独开启')
    for(const key of ['autoComment','autoVideoLike','autoVideoCollect'])assert.equal(c[key],true,`新安装默认授权: ${key}`)
    assert.equal(c.socialOutreachEnabled,true)
    assert.equal(c.socialLifeIntentEnabled,true)
    assert.equal(c.socialAutoSend,true,'仅可给已授权的私信推荐收件人，仍受真实选片和冷却限制')
    assert.equal(c.agentFollowEnabled,true,'新安装自主关注/取关默认允许但仍经平台门禁')
    assert.equal(c.incomingImageRecognitionEnabled,true,'新安装入站图片理解默认开启，可禁用')
    for(const key of ['ownerCommentAgentEnabled','ownerCommentLikeEnabled','ownerCommentSocialPublishEnabled','commentMemesEnabled','commentWatchReplies','ownerDmAgentReadMainContext','ownerDmAgentSyncMain','lifeProactiveFriendDmEnabled','lifeNaturalDmOutreachEnabled','lifePublicInteractionEnabled'])assert.equal(c[key],true,key)
    for (const key of [
      'ownerCommentNaturalAckEnabled',
      'emotionRecallMainEnabled',
      'emotionRecallDmEnabled', 'visionEnabled',
      'dmStrangerOnce', 'mainSessionBridgeEnabled', 'ownerTodoAutoReviewEnabled',
    ]) assert.equal(c[key], false, `未经授权的默认开关: ${key}`)
  } finally { x.cleanup() }
})

test('历史配置即使缺少新增字段，也不被新默认偷偷打开；显式关闭会被保存', async () => {
  const x = harness({ existing: { mainSessionMemoryEnabled: false, dmWatch: false } })
  try {
    let c = await x.config()
    assert.equal(c.mainSessionMemoryEnabled, true,'身份级长期记忆在新旧安装均固定开启')
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(c.dailyDynamicEnabled, false)
    assert.equal(c.autonomousPlannerDailyLimit, 24)
    assert.equal(c.autonomousPlannerMinutes, 30)
    assert.equal(c.mainSessionMemoryMaxItems, 6)
    assert.equal(c.mainSessionMemoryMaxChars, 800)
    assert.equal(c.dmWatch, false)
    for(const key of ['ownerCommentAgentEnabled','ownerCommentLikeEnabled','ownerCommentSocialPublishEnabled','commentMemesEnabled','commentWatchReplies','ownerDmAgentReadMainContext','ownerDmAgentSyncMain','lifeProactiveFriendDmEnabled','lifeNaturalDmOutreachEnabled','lifePublicInteractionEnabled'])assert.equal(c[key],false,key)
    for(const key of ['autoComment','autoVideoLike','autoVideoCollect'])assert.equal(c[key],false,`旧用户缺键不自动扩大权限: ${key}`)
    c=await x.config({agentFollowEnabled:false,incomingImageRecognitionEnabled:false})
    assert.equal(c.agentFollowEnabled,false);assert.equal(c.incomingImageRecognitionEnabled,false)
    c = await x.config({ mainSessionMemoryEnabled: true, dailyDynamicEnabled: true })
    assert.equal(c.mainSessionMemoryEnabled, true)
    assert.equal(c.dailyDynamicEnabled, true)
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(JSON.parse(readFileSync(join(x.root, 'bili-duty', 'config.json'))).autonomousPlannerEnabled, false)
  } finally { x.cleanup() }
})

test('新装可关闭自主规划和动态，身份级记忆固定开启，公开发布仍需授权', async () => {
  const x = harness()
  try {
    const c = await x.config({mainSessionMemoryEnabled:false, autonomousPlannerEnabled:false, dailyDynamicEnabled:false})
    assert.equal(c.mainSessionMemoryEnabled, true,'身份级长期记忆在新旧安装均固定开启')
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(c.dailyDynamicEnabled, false)
    assert.equal(c.dailyDynamicDraftOnly, false)
    assert.equal(c.ownerCommentSocialPublishEnabled, true)
  } finally { x.cleanup() }
})


test('fresh defaults survive restart and explicit disable survives restart',async()=>{
 const a=harness();let b,c;try{
  const path=join(a.root,'bili-duty','config.json');await a.config();
  b=harness({existing:JSON.parse(readFileSync(path,'utf8'))});
  const fresh=await b.config();for(const key of ['commentMemesEnabled','commentWatchReplies','ownerDmAgentSyncMain','ownerCommentSocialPublishEnabled'])assert.equal(fresh[key],true,key);
  await b.config({commentMemesEnabled:false,ownerDmAgentSyncMain:false});
  c=harness({existing:JSON.parse(readFileSync(join(b.root,'bili-duty','config.json'),'utf8'))});const restarted=await c.config();assert.equal(restarted.commentMemesEnabled,false);assert.equal(restarted.ownerDmAgentSyncMain,false);
 }finally{a.cleanup();b?.cleanup();c?.cleanup()}
})

// Real effective configuration, not merely schema string parity. A Host row
// with its schema-populated defaults cannot turn old missing grants on.
test('schema defaults match fresh recommendations and do not replace old missing/explicit permissions', async () => {
  const defaults = Object.fromEntries(Object.entries(Config({})).map(([key,value])=>[key,typeof value?.get==='function'?value.get():value]));
  const keys=['commentWatchReplies','ownerCommentAgentEnabled','ownerCommentLikeEnabled','ownerCommentSocialPublishEnabled','lifeProactiveFriendDmEnabled','lifeNaturalDmOutreachEnabled','lifePublicInteractionEnabled','ownerDmAgentReadMainContext','ownerDmAgentSyncMain','commentMemesEnabled'];
  const hostRow={value:{...defaults,perDay:50,mentionName:'大肥鱼',overlayMcp:true},user:{}};
  const fresh=harness({hostRow}), legacy=harness({existing:{dmWatch:false,commentWatchReplies:false},hostRow});
  try {
    const a=await fresh.config(),b=await legacy.config();
    for (const key of keys){assert.equal(defaults[key],true,key);assert.equal(a[key],true,key);assert.equal(b[key],false,key);}
    const disabled=await fresh.config({commentWatchReplies:false,ownerCommentSocialPublishEnabled:false});
    assert.equal(disabled.commentWatchReplies,false);assert.equal(disabled.ownerCommentSocialPublishEnabled,false);
  }finally{fresh.cleanup();legacy.cleanup();}
});
