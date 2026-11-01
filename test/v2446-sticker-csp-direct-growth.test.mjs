import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from './helpers/ready-host.mjs'
import { buildGrowthContext, listGrowth } from '../lib/persona-growth.mjs'

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-v2446-'))
  let handler
  const ctx = {
    get: k => k === 'dshHomePath' ? (...parts) => join(home, ...parts) : undefined,
    logger: { info() {}, warn() {} }, tools: { register() {} },
    webServer: { register(spec) { handler = spec.handler; return { dispose() {} } } },
    effect: f => f(), settings: { describe() {} },
  }
  apply(ctx, {})
  async function request(method, path, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    req.method = method; req.url = '/api/bili-duty/' + path; req.headers = { host: 'localhost' }
    let code, headers = {}, raw
    const res = { writeHead(c, h = {}) { code = c; headers = h }, end(v) { raw = v } }
    await handler(req, res)
    let parsed = raw
    if (typeof raw === 'string') { try { parsed = JSON.parse(raw) } catch {} }
    return { code, headers, body: parsed }
  }
  return { home, dir: join(home, 'bili-duty'), request, close: () => rmSync(home, { recursive: true, force: true }) }
}

test('management CSP allows same-origin sticker previews while blocking external images', async () => {
  const x = setup()
  try {
    const res = await x.request('GET', 'manage')
    assert.equal(res.code, 200)
    assert.match(res.headers['content-security-policy'], /img-src 'self' data:/)
    assert.match(res.headers['content-security-policy'], /default-src 'none'/)
    assert.match(res.headers['content-security-policy'], /connect-src 'self'/)
  } finally { x.close() }
})

test('manual growth entry can be reviewed and approved without invoking AI', async () => {
  const x = setup()
  try {
    const text = '评论应该直接表达大肥鱼自己的反应，不要先复述视频再跟着评价。'
    const created = await x.request('POST', 'persona-growth', { action: 'add-direct', type: 'style', text })
    assert.equal(created.code, 200, JSON.stringify(created.body))
    const entry = created.body.result
    assert.equal(entry.source, 'owner-direct')
    assert.equal(entry.suggestedText, text)
    assert.equal(entry.directReview, true)
    assert.equal(entry.modelSuggestedAt, undefined)
    assert.ok(!buildGrowthContext(x.dir).includes(text), 'pending direct entry must not be injected')
    const approved = await x.request('POST', 'persona-growth', { action: 'approve', id: entry.id })
    assert.equal(approved.code, 200, JSON.stringify(approved.body))
    assert.equal(approved.body.result.approvedText, text)
    assert.match(buildGrowthContext(x.dir), /不要先复述视频再跟着评价/)
  } finally { x.close() }
})

test('existing owner feedback can switch to direct review, be edited, and approved without model extraction', async () => {
  const x = setup()
  try {
    const added = await x.request('POST', 'persona-growth', { action: 'add', type: 'style', text: '评论应优先表达自己的直接感受，避免重复视频标题。' })
    assert.equal(added.code, 200)
    const id = added.body.result.id
    const direct = await x.request('POST', 'persona-growth', { action: 'direct', id })
    assert.equal(direct.code, 200, JSON.stringify(direct.body))
    assert.equal(direct.body.result.suggestedText, direct.body.result.text)
    assert.equal(direct.body.result.directReview, true)
    const revisedText = '评论应优先表达自己的直接感受，看到合适的具体笑点才自然互相调侃。'
    const revised = await x.request('POST', 'persona-growth', { action: 'revise', id, suggestion: revisedText })
    assert.equal(revised.code, 200, JSON.stringify(revised.body))
    const approved = await x.request('POST', 'persona-growth', { action: 'approve', id })
    assert.equal(approved.code, 200, JSON.stringify(approved.body))
    assert.equal(approved.body.result.approvedText, revisedText)
    assert.equal(listGrowth(x.dir).entries[0].status, 'approved')
    assert.match(buildGrowthContext(x.dir, { scene: 'comment', query: '自然调侃' }), /自然互相调侃/)
  } finally { x.close() }
})
