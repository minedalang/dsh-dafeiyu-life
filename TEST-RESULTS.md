# 2.8.0-dev.8 回归与验收记录（2026-11-12）

> 开发预览，不是正式 2.8.0 发布验收。测试在当前隔离的 Linux/Node/Python 环境执行，未连接真实 Windows DSH 或 B站账户、未发送任何真实评论／点赞／收藏／关注，也未运行 72 小时跨日验收。

## 本版针对性验收

- `node --test test/v280-dev8-video-entry-continuation.test.mjs`：**7/7 通过**。在模拟的原平台写执行器中，验证 Life 自选 `inspect_opportunity` → 原创主评论候选／执行，以及 Life 自选 `watch_video` 只读待办 → 点赞候选／执行，两条均不需要启动完整视频 Agent。
- 同一测试验证：视频只读任务没有可信完成记录、任务 / BV / 标题错误、账号不符、未经原 Life 核实决策、重复回执、主人关闭评论授权、模型选择休息，均不能伪造授权或强制外发。
- `node --test test/v271-dev46-life-decision-explain.test.mjs test/v271-dev33-life-architecture-contract.test.mjs test/v280-dev8-video-entry-continuation.test.mjs`：**15/16 通过，1 项历史失败**（旧 `social attention` 测试在原 `dev.7` 同样不通过）。
- `npm run write:life-architecture-view`：生成四张当前 Mermaid 图对应的 GitHub 预览。
- `npm run check:life-architecture`：**通过**，4 张 Mermaid／115 个唯一代码节点。
- `node selfcheck.mjs`：**通过**（宿主 API 与客户端注册预检）。
- `npm pack --dry-run`：**通过**，版本 `2.8.0-dev.8`、573 个待打包文件；未实际发布 npm。
- `git diff --check`：**通过**（仓库 `core.whitespace=cr-at-eol`，原源码主要使用 CRLF；没有新增空格错误）。
- 完整交付 ZIP 完整性和从原始 `dev.7` 源码应用补丁：交付阶段另行验证。

## 全量测试（同一环境下对照，不能宣称全绿）

| 测试 | 原始 `dev.7` 基线 | 本次 `dev.8` | 与基线比较 |
| --- | --- | --- | --- |
| `npm test` | 2,437 项；2,357 通过／80 失败 | 2,444 项；2,364 通过／80 失败 | 新增 7 项全通过；失败测试**名称集合完全一致**，未引入新失败 |
| `npm run test:python` | 272 项；5 fail／6 error／1 skipped | 272 项；5 fail／6 error／1 skipped | 失败／错误测试名称集合完全一致，未引入新失败 |

上述历史失败包含版本与 README 历史期望、既有依赖／运行环境、旧社交回执与现存架构测试未满足等问题。本次不擅自修改旧测试断言或扩大重构范围以让数字变绿；正式版封版前需逐项复核。

## 行为边界与人工待验

1. `inspect_opportunity` 只把 Life 已选择且资料核验成功的当前 BV 接进原账号探索片段；不是完整音画观看证明。
2. `watch_video` 只在 **Life 自主选择执行**、旧待办已经由可信执行器真正标记完成，且返回同 BV、真实标题的读取回执后接入互动续行。主人手动触发的其他渠道尚未全部统一到这个选择入口。
3. 续行模型有权点赞／收藏／关注／原创主评论，也有权休息；在原 `life-continuation-write` 中执行严格的账号、授权、配额、去重与平台确认检查；模拟写入测试不等于真实 B站发送成功。
4. 设置页进入时只读查询 npm `/latest` 的版本元数据，有新版时红色提醒；点击后复用既有 DSH 安装器，需人工查安装日志并重启。手动版本查询保留 GitHub 回退。npm 网络失败时不伪称已是最新版。
5. Windows DSH 设置页实际渲染、网络可达、真实 B站端点及风控、重启后连续 Life 行为、跨账号隔离与 72 小时稳定运行仍待测试；**`releaseReady:false`**，不得发布正式 2.8.0。

---

## 历史开发版测试记录（保留原 dev.7 及更早日志，不替代本次统计）

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
