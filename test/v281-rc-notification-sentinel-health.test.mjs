import test from 'node:test'
import assert from 'node:assert/strict'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'

test('正常五分钟哨兵间隔不被误报为 B站限流',()=>{
  const now=1_800_000_000_000
  const result=systemHealthSnapshot({now,scheduler:{running:true,readBudget:{blocked:false,dmListRateLevel:0,
    dmUnreadNextAt:now+4*60_000},networkBackoff:{dm:{allowed:true},replies:{allowed:true},mentions:{allowed:true}},checks:{dm:{enabled:true,lastResult:'completed'}}}})
  assert.equal(result.channels.find(x=>x.id==='dm')?.state,'unknown')
  assert.equal(result.issues.some(x=>x.id==='network'),false)
})

test('DM 自适应哨兵间隔在 -509 后继续显示保护状态，即使全局短冷却已结束',()=>{
  const now=1_800_000_000_000
  const result=systemHealthSnapshot({now,scheduler:{running:true,readBudget:{blocked:false,dmListRateLevel:2,
    dmUnreadNextAt:now+15*60_000},networkBackoff:{dm:{allowed:false,category:'rate-limit',nextAt:now+10*60_000,streak:2}},
    checks:{dm:{enabled:true,lastResult:'completed'}}}})
  const dm=result.channels.find(x=>x.id==='dm')
  assert.equal(dm.state,'backoff')
  assert.equal(dm.retryAt,now+15*60_000)
  assert.match(dm.detail,/自适应间隔/)
})
