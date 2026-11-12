# 2.8.0-dev.7 · 界面合并与发布收口测试

- `test/v280-dev7-unified-life-story-ui.test.mjs`：校验树/时间线同卡、旧 DOM ID 唯一、SSE 与只读时间线 API 未变、分类说明只有三句。
- 调整原 UI 布局测试以匹配新的组件位置，不更改其他行为数据、发送权限或模型调用。
- 本次管理中心和发布文档定向 Node 测试：5 个文件、22 项通过，0 失败；HTML DOM/控件唯一性检查通过。
- 冻结前 dev.6 全量 Node 2434 项（2343 通过、84 失败、7 跳过）；全量 Python 272 项（5 失败、6 错误、1 跳过）。仍需旧版基线对比与实机复核，不能宣布正式版 P0 门禁通过。

---

# 2.8.0-dev.6 · 单次 Life 意愿修复专项验证

- `node --test` 选取 12 个相关测试文件：**86 项通过，0 失败**，覆盖原创 Life 写动作、统一意愿、DM 私信续行、待办自主执行、回访与任务来源、异常旧状态。测试日志留存于开发环境，不作为真实平台回执。
- 新 `test/v280-dev6-single-intent-contract.test.mjs` 测试真实 OwnerTodos 入账 now/later、旧任务/虚假 BV 拒绝、极低情绪不二次否决、联系人关注授权的同 UID 一次消费/跨账号失效、下游文本不重复投票。
- `test/v271-dev38-subagent-continuity.test.mjs`：新 `intentProtocol:2` 候选正常续接，旧私信账本仅提议的 pending 行不能直接升级成平台关注授权。
- `npm run write:life-architecture-view` 与 `npm run check:life-architecture`：4 张图、111 个代码节点对齐；`node selfcheck.mjs` 通过（临时数据目录）；`npm pack --dry-run --json` 通过。
- 仍未取得 Windows DSH、B站真实收发、连续 72 小时、旧用户完整迁移/回滚和跨日自然成长的正式验收证据；本次为 `2.8.0-dev.6` 开发版，不等于正式稳定版。以前全量 Node 基线存在未逐项修复的测试失败，不宣称整个仓库全量测试通过。

---

# 2.8.0-dev.5 · 作品私信即时意愿与生活事项时间测试

## 本轮已验证（离线，不调用用户真实模型/B站）

- `test/v280-dev5-dm-read-wake-and-plan-times.test.mjs`：**8/8 通过**。涵盖：已接受且新建的当前账号私信只读待办可绕开普通最短时间间隔；Life 仍可 skip；可当轮选择原只读工具；旧任务/非私信/关闭待办/停用模式不得唤醒；不伪造任意 ID；日报额度、模型退避不突破；模型期间账号切换禁止执行；真实列表的本机时区及缺失时间不伪造；不引入第二 DM 发送器。
- 社交待办、旧 OwnerTodos、Life 节奏、菜单、Episode、意见授权恢复等 11 个相关测试文件：**51/51 通过（含新增 8 项）**。
- `node --check index.js`、`node --check lib/autonomous-planner.mjs`：通过。
- `npm run write:life-architecture-view` 与 `npm run check:life-architecture`：通过（4 张图、110 个唯一代码节点）。
- `node selfcheck.mjs`：通过；`npm pack --dry-run`：通过（569 个 npm 文件）。
- 当前仅执行相关离线测试，并未执行本版全量 Node、Python 测试，**不能宣称全套通过**；原 dev.3 已有旧全量 82 项失败未逐一归因。

## 严格界限与日志关联

- 11 月 12 日 11:00:45 私信 BV 出现了已接受候选入口日志，而在该段日志未观察到对应 OwnerTodos 新建回执；因此不能认定当时已入账，亦不能说是残留调度锁导致这段回复。私信回复模型的快速调用独立于普通 Life 10 分钟规划。
- 接受意愿 ≠ 已加入待办；入账成功 ≠ 执行；读取公开标题/字幕 ≠ 完整看过/听过；AI 回复 ≠ 平台送达。只对已通过原社交意愿与受信来源核验、当前轮新建的只读任务触发快速考虑，不因对方单纯发送 BV 而强制看。
- 快唤醒如果碰到 Life busy/运行锁或关闭时段，不绕过这些保护，保留已有待办等待正常规划；不会外发消息，不保证一定有后续回复。
- Windows DSH、实际模型结果、B站真实工具、私信发送、SSE 浏览器实时界面尚未在此环境验收。

---

# 2.8.0-dev.4 · Life 调度异常退出自动恢复补丁测试

## 本轮已验证（隔离测试目录，未访问用户真实 B站账号）

- Life 运行锁自动恢复、真实 Node 子进程异常退出、两进程竞争同一旧锁、单日模型额度不退款、损坏锁/符号链接/附加异常文件、恢复守卫失效及原外发事务隔离：`test/v271-dev4-life-agent-atomic-recovery.test.mjs`，**13/13 通过**；另重复运行 5 次通过。
- 原 Life 恢复、动作菜单、事件账本、原账号权限、Life 节奏与计数、架构、管理员 UI 和旧版备份协议等 13 个测试文件：**83/83 通过**；合计 **85/85 通过**。
- 新增普通用户 UI 与自动恢复入口契约：`test/v280-dev4-life-crash-auto-recovery-ui.test.mjs`，**2/2 通过**。
- `npm run write:life-architecture-view` / `npm run check:life-architecture`：通过；`node selfcheck.mjs`：通过；相关 JS 文件语法检查：通过。
- 本轮只针对自动恢复与相邻模块做离线回归，不等于 npm test 全量成功。上版 dev.3 已记录全量 **2413 项：2324 通过、82 失败、7 跳过**，这些历史问题本版未全面解决、未宣称可直接发布正式 2.8.0。

## 自动恢复的精确范围

仅在 `autonomous-planner-run.lock/owner.json` 完全合法、上一进程 PID 已由操作系统证实不存在时回收该 **非发送规划运行锁**。`life-willingness-ledger`、实际私信/评论事务、未知回执、模型预算、账号权限和待办状态均不改变。原 PID 仍活着、无法确认、锁损坏、额外文件或恢复守卫异常时拒绝危险解锁并展示原因。

Windows DSH Desktop 实机、异常中途再次崩溃、文件权限和真实 B站平台端到端未验收；只声明离线行为已测试。
