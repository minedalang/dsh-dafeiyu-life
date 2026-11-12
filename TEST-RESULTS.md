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
