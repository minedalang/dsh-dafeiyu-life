import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeRetiredDailyPickCharter, VIDEO_PICK_POLICY} from '../lib/video-pick-policy.mjs'
import {lifeVideoGate} from '../lib/life-pace-policy.mjs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const retiredCharter = `# 我的自定义日常
2. 从结果里挑出**值得的**，条数同时受「每天最多挑几条」和「每轮最多挑几条」约束；**这一轮开头给出的最终上限为准**（两者取较小值）；**判重** —— 已经看过的跳过。
  ⭐⭐ **这一行是宿主数配额用的**：\`### BV…\` 的行数 = 你这一轮挑中的条数（宿主拿它跟「每天最多几条」对账，
   也算你下一轮还能挑几条）⇒ **挑中的一条都不能漏写这行**；
   ⚠️ 只是**提到过 / 跳过 / 评论区别人问起**的视频**不要**加这种标题 —— 加了就会被算成"挑中"，
   当天的额度会被它吃掉（使用者就少看到几条 ✗）。写完顺手数一遍：
- ⭐ **一天只有这一份**：开头说「今天已经挑过 N 条」时，**追加到末尾**，别覆盖上一轮写的内容 ——
  「每天最多挑几条」是**全天**的总量，宿主要靠这份报告数数（覆盖了，配额就数不准 ⇒ 要么白跑、要么超量）。
  ⭐ 补进去的每一段照样**以 \`### BV号\` 开头** —— 宿主数的就是这种标题行（见「一轮要做的事」第 4 条）。
- 主人自定义：只有实际阅读证据才能入选；不准泄漏私信。
`

test('旧家目录章程的每日选片额度被运行时兼容消除；主人其他规则不被改写',()=>{
  const out=normalizeRetiredDailyPickCharter(retiredCharter)
  assert.doesNotMatch(out,/每天最多挑几条|每天最多几条|当天的额度会被它吃掉|宿主数配额用/)
  assert.match(out,/每天不设入选视频数量上限/)
  assert.match(out,/真实入选/)
  assert.match(out,/主人自定义：只有实际阅读证据才能入选；不准泄漏私信/)
  assert.equal(normalizeRetiredDailyPickCharter(out),out,'重复应用不应再修改内容')
})

test('现代规则明确覆盖旧章程/旧配置里的50条和标题级跳过；不扩展发送权限',()=>{
  assert.match(VIDEO_PICK_POLICY,/最多挑中 50 条/)
  assert.match(VIDEO_PICK_POLICY,/已挑中超过 50 条，也可以继续自主选片/)
  assert.match(VIDEO_PICK_POLICY,/额度已满／额度不明/)
  assert.match(VIDEO_PICK_POLICY,/可以重新查详情和内容/)
  assert.match(VIDEO_PICK_POLICY,/点赞、收藏、关注、评论、动态等外发行为仍受各自独立开关、每日额度/)
  assert.doesNotMatch(read('prompts/duty.md'),/每天最多挑几条|每天最多几条|宿主数配额用/)
})

test('真正生产 prompt 始终使用新版本工具契约，并保留历史章程文件不覆盖',()=>{
  const source=read('index.js')
  assert.match(source,/effectiveVideoCharter\(shipped,local\)/)
  assert.match(source,/\+ '\\n' \+ VIDEO_PICK_POLICY/)
  assert.match(source,/const pickedBeforeRun = countPickedToday\(\)/,'只记录真实计数')
  assert.doesNotMatch(source,/report-off-one-round/,'关闭日报不应每天只允许一轮')
  assert.doesNotMatch(source,/countPickedToday\(\)\s*>=\s*cfg\.perDay/)
  assert.doesNotMatch(source,/pickedBeforeRun\s*>=\s*cfg\.perDay/)
})

test('超过50次已有启动计数也不会产生新每日视频限制，只有启动间隔继续有效',()=>{
  const now=Date.UTC(2026,10,10,11,0,0)
  const config={autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,videoAgentMinIntervalMinutes:20}
  const ready=lifeVideoGate(config,{videoStartsToday:61,lastVideoAt:now-25*60_000},now)
  assert.equal(ready.eligible,true)
  assert.equal(ready.limitReached,false)
  const cooling=lifeVideoGate(config,{videoStartsToday:61,lastVideoAt:now-5*60_000},now)
  assert.equal(cooling.eligible,false)
  assert.equal(cooling.reason,'video-launch-cooldown')
})
