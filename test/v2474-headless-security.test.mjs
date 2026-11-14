import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HEADLESS_DENY_TOOLS, validateHeadlessOverlayText, validateHeadlessOverlayFile,
  writeSecureHeadlessOverlay, assertSafeHeadlessLaunch,
} from '../lib/headless-security.mjs'

function base(kind='main') {
  const rows=[]
  for (const id of HEADLESS_DENY_TOOLS) rows.push('- id: '+id,'  disabled: true','')
  for (const id of ['credentials','authorization','deepseek-account']) rows.push('- id: '+id,'  disabled: false','')
  if (kind==='main' || kind==='home') rows.push('- insert:','    - id: mcp-bili-duty',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bili-duty','        transport: stdio','        env:',"          BILI_MCP_TOOLS: '"+(kind==='home'?'bili_home_recommendations,bili_video_info':'bili_search,bili_comments')+"'",'')
  if (kind==='vision') rows.push('- insert:','    - id: mcp-bili-vision-readonly',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bilivision','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_preview_vision'",'')
  return rows.join('\n')
}

test('all three generated overlay shapes validate',()=>{
  assert.equal(validateHeadlessOverlayText(base('main'),'main').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('home'),'home').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('behaviorDecision'),'behaviorDecision').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('dm'),'dm').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('vision'),'vision').denied,HEADLESS_DENY_TOOLS.length)
})

test('a single re-enabled workstation tool fails closed',()=>{
  const text=base('main').replace('- id: tool-fs\n  disabled: true','- id: tool-fs\n  disabled: false')
  assert.throws(()=>validateHeadlessOverlayText(text,'main'),/tool-fs/)
})

test('DM overlay cannot accidentally receive MCP tools',()=>{
  assert.throws(()=>validateHeadlessOverlayText(base('main'),'dm'),/非预期插件/)
})

test('secure writer replaces an existing symlink instead of following it',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v2474-overlay-'))
  try {
    const victim=join(dir,'victim.txt'); writeFileSync(victim,'KEEP','utf8')
    const out=join(dir,'headless-overlay.yml')
    try { symlinkSync(victim,out,'file') } catch { return } // Windows without symlink privilege
    writeSecureHeadlessOverlay(out,base('main'),{kind:'main',stateDir:dir})
    assert.equal(readFileSync(victim,'utf8'),'KEEP')
    assert.equal(validateHeadlessOverlayFile(out,{kind:'main',stateDir:dir}).ok,true)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('launch guard fixes profile and exact patch path',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v2474-launch-'))
  try {
    const out=join(dir,'headless-dm-overlay.yml')
    writeSecureHeadlessOverlay(out,base('dm'),{kind:'dm',stateDir:dir})
    assert.equal(assertSafeHeadlessLaunch(['bin.js','--profile','headless','--patch',out,'hello'],out,{kind:'dm',stateDir:dir}),true)
    assert.throws(()=>assertSafeHeadlessLaunch(['bin.js','--profile','custom','--patch',out],out,{kind:'dm',stateDir:dir}),/固定使用/)
    assert.throws(()=>assertSafeHeadlessLaunch(['bin.js','--profile','headless','--patch',out,'--patch',out],out,{kind:'dm',stateDir:dir}),/只能带一个/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('首页 overlay 禁止搜索，Life 决策 overlay 只能是无 MCP 的安全模式',()=>{
  const home=base('home')
  assert.equal(validateHeadlessOverlayText(home,'home').ok,true)
  assert.throws(()=>validateHeadlessOverlayText(home.replace('bili_home_recommendations,bili_video_info','bili_search,bili_video_info'),'home'),/首页专用/)
  assert.throws(()=>validateHeadlessOverlayText(base('main'),'home'),/首页专用/)
  assert.throws(()=>validateHeadlessOverlayText(base('main'),'behaviorDecision'),/非预期插件/)
  const dir=mkdtempSync(join(tmpdir(),'v280-life-overlay-'))
  try {
    const behavior=join(dir,'headless-life-decision-overlay.yml')
    const homePath=join(dir,'headless-video-home-overlay.yml')
    writeSecureHeadlessOverlay(behavior,base('behaviorDecision'),{kind:'behaviorDecision',stateDir:dir})
    writeSecureHeadlessOverlay(homePath,home,{kind:'home',stateDir:dir})
    assert.equal(validateHeadlessOverlayFile(behavior,{kind:'behaviorDecision',stateDir:dir}).ok,true)
    assert.equal(validateHeadlessOverlayFile(homePath,{kind:'home',stateDir:dir}).ok,true)
    assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',behavior],behavior,{kind:'behaviorDecision',stateDir:dir})
    assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',homePath],homePath,{kind:'home',stateDir:dir})
    assert.throws(()=>assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',homePath],homePath,{kind:'main',stateDir:dir}),/overlay 文件名异常/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('actual source auto-generates main and DM overlays and fixes automated profile to headless',()=>{
  const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(code,/mainOverlayAtBoot=ensureOverlay\(false\)/)
  assert.match(code,/dmOverlayAtBoot=ensureOverlay\(true\)/)
  assert.match(code,/const args = \[\.\.\.dsh\.args, '--profile', 'headless'\]/)
  assert.match(code,/const args = \[\.\.\.dsh\.args, '--profile', 'headless', '--patch', overlay, promptText\]/)
  assert.match(code,/assertVerifiedHeadless\(args,overlay,\{kind:homeFirst\?'home':'main',stateDir\},'main'\)/)
  assert.match(code,/assertVerifiedHeadless\(args,overlay,\{kind:reflectionRoute\?'reflection':dynamicRoute\?'dailyDynamic':ownerAgentRoute\?'ownerDmAgent':behaviorRoute\?'behaviorDecision':'dm',stateDir\},modelRoute\)/)
})
