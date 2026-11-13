import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {plannerActionMenu} from '../lib/autonomous-planner.mjs'

const root=new URL('../',import.meta.url)
const index=readFileSync(new URL('index.js',root),'utf8')
const client=readFileSync(new URL('client.js',root),'utf8')
const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
const lifeModelUsage=readFileSync(new URL('lib/model-task-usage.mjs',root),'utf8')

test('首页漫游有独立入口，且只有主页视频选片能力就绪时才提供',()=>{
  const skills=[{id:'bilibili.video-explore'}]
  const opts={videoEligible:true,homeEnabled:true,lifeSkills:skills}
  assert.ok(plannerActionMenu(opts).some(x=>x.action==='browse_home'))
  assert.ok(!plannerActionMenu({...opts,homeEnabled:false}).some(x=>x.action==='browse_home'))
  assert.ok(!plannerActionMenu({...opts,videoEligible:false}).some(x=>x.action==='browse_home'))
})

test('首页轮次的真实 MCP 工具白名单剔除关键词搜索，无候选不兜底转搜索',()=>{
  assert.match(index,/const mcpWhitelist = \(sourceMode='mixed'\)/)
  assert.match(index,/sourceMode==='home'\?\[\]:\['bili_search'\]/)
  assert.match(index,/sourceMode==='home' && cfg\.homeRecommendationsEnabled/)
  assert.match(index,/mcpWhitelist\(videoSourceMode\)\.join/)
  assert.match(index,/headless-video-home-overlay\.yml/)
  assert.match(index,/没有候选时直接结束，不重试、也不降级混入兴趣搜索/)
  assert.match(index,/promptFor\(\{sourceMode:homeFirst\?'home':'mixed'\}\)/)
})

test('会话页不注册大肥鱼足迹；主 Session 已接入的多气泡能力在管理中心明确说明',()=>{
  assert.doesNotMatch(client,/slots\.inject\('conversation\.view'/)
  assert.doesNotMatch(client,/id: 'bili-watched'/)
  assert.match(html,/自然聊天已与主人私信共用多气泡协议/)
  assert.match(html,/预先规划的分条表达/)
  assert.match(lifeModelUsage,/'behaviorDecision'/)
})
