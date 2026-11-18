# 2.8.1-dev.3b.33.21 · Windows Patch 编码与 Life 实时调度导出验证

## 修复范围

1. `.19→.20` 旧 Patch 源目录误含三个 `tools/#U...` ZIP 兼容文件名（真实 Git checkout 为中文脚本名），导致 Windows `git apply --check` 报找不到文件。修正版从**真实中文文件名**的干净 `.19` 源码生成，Git 路径保留规范 C quoted UTF-8 octal 转义，不产生任何 `#U` 伪路径。
2. 新增只读 `GET /api/bili-duty/life-agent/scheduler-snapshot`，只返回运行中 Life timer 的 `running/busy/expected`、`schedulerPulse`、下一次预计决策与有限互动调度字段。与旧 `GET /autonomous-planner` 不同，该路由不调用 `ensureStarted()` / `tick()`、不触发模型或平台动作，因此不会在导出期间改变定时器状态。
3. `tools/导出B站日志.bat` 启动时在交互模式提示用户粘贴**当前运行中的 DSH 本地管理中心 URL**，或以 `--status-url` 显式传入。只连接明确的 localhost / 127.0.0.1 / ::1 端口及固定无重定向诊断路径，超时 3 秒、响应上限 64 KiB，输出隐私字段白名单。未提供 URL、服务不可达、旧版本不存在端点时绝不推测运行健康。
4. `AGENTS.md` 新增 Windows UTF-8 Patch/CRLF/ZIP 文件名映射、实际补丁回放及实时状态导出规则。保留原有旧配置、记忆、私信队列、共享预算和发送未知冻结机制。

## 离线测试

- 新增 `test/v281-dev3b3321-scheduler-live-export.test.mjs` **4/4**：本机模拟服务验证 timer=false/stale=true 的捕获、不泄漏多余字段、缺失/外网 URL 时不伪造状态、HTTP 302 不跟随、真实模拟宿主调度接口不唤醒。
- 相关 9 个 Node 定向测试文件 **30/30**：包括 `.20` DSH 视觉路由、配置保存、日志导出、Life 诊断与原包的中文 BAT 检查。
- `node --check index.js`；Life Architecture 4 张 Mermaid / 126 个代码节点通过；Video/MCP 契约通过；`node selfcheck.mjs` 通过；npm pack dry-run 通过。
- **三份 Git Patch** 均完成 `git apply --check` → `git apply` → 逐文件 SHA-256 一致回放：修正后的 `.19→.20`、累计 `.19→.21`、增量 `.20→.21`。修正补丁不再出现 `#U...` 错误重命名，累计/增量补丁中的中文 BAT 用 Git 标准 UTF-8 八进制路径转义。所有 Patch 无 BOM。
- 实际执行 `npm pack --ignore-scripts` 制作本地 TGZ，不执行 publish。

## Windows/实机仍需验证

- Linux Git 回放能证实文件名路径编码语义与版本匹配，但不能代替使用者 Windows PowerShell、Windows Git checkout 的端到端行为验证。
- 全流程要求用户在**仍运行的 DSH** 中打开管理中心并复制浏览器 URL 中的真实端口，然后导出；导出 ZIP 检查 `_diagnostics/live-status-availability.json` 的 `captured=true` 和 `_diagnostics/live-status-snapshot.json` 的 `scheduler.running`、`scheduler.schedulerPulse.stale`。若 `captured=false`，证据不完整，不能断言 Life 定时器正常。
- 脚本不发 B站请求、模型调用或任何写操作。本次未运行云端全量测试，未进行 Git Commit/Push/npm Publish。
