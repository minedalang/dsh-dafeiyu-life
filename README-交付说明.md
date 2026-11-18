# 大肥鱼 Plus 2.8.1：发布前定向修订交付说明

**基线：** 用户上传的 `dsh-bili-scroll-plus2(3).zip`，包内版本 `2.8.1-dev.3b.33.25-ci-test-audit`。

**发布状态：BLOCKED。** 本轮修改仅为发布前文档及跨语言事务稳定性定向修复，**不等于** Windows 570 个 Node 测试文件及 Python 全量通过，也没有完成真实 DSH/B站视频端到端验收。切勿直接发布正式 2.8.1。

## 代码和文档变更

- `README.md`：改为面向使用者的产品首页，保留长期特色、版本新特性、安装与快速使用指南、权限与隐私；把「🌱 未来规划：让生活更有故事」恢复到致谢正上方。详细技术方案继续留在 docs。
- `AGENTS.md`：新增长期 README 维护规范和章节顺序，明确特色功能不能被新版本功能清单取代。
- `lib/owner-todos.mjs`：Node 跨进程待办写入锁的有界等待从 1.5 秒增加到 6 秒，适应 Windows 慢盘与杀毒软件引发的短暂锁竞争；仍然保留 `wx` 独占锁、超时安全拒绝与旧事务防覆盖。
- `test/v271-dev3-crosslang-todo-transaction.test.mjs`：等待并发写入子进程 `close`（输出管道全部关闭）而非提前在 `exit` 判定。
- `test/v281-readme-user-facing-contract.test.mjs`：新增 README 和 AGENTS 用户文档契约测试。

## 已执行验证（当前 Linux 容器，不是 Windows）

- 跨语言事务专项：3/3 通过。
- 双 Node 写入事务用例：连续 20 轮，20/20 通过。
- 事务、代码收口、README/AGENTS 联合定向测试：13/13 通过。
- 相关权限、视频路由安全定向测试：18/18 通过（之前同一工作目录内执行）。
- Life 架构检查、插件自检、npm pack --dry-run：已在本地执行并通过。
- README 相对链接：本地全部存在。

以上全部是**定向 / 离线结果**，不能代替用户 Windows 管理员 PowerShell 全量测试。2026-11-18 12:13:30 的管理员日志在跨语言事务专项提前结束；如另有新日志，应以其结尾的测试汇总为准。

## Windows 最终验收

1. 使用本包 `source/` 替换或在**原始 `.25` 基线**上单独应用补丁（**二选一**，勿在 `source/` 上再次应用补丁）。
2. 普通与管理员 PowerShell 可各运行必要专项；记录完整 TAP，核实既有账号/授权/私密域无新增写入权限。
3. 用 PowerShell 运行 `./run-tests.ps1 -Mode full` 或原 `run-tests.bat full`；必须看到最后的全量汇总，而非只启动批次。
4. 确保 Node、Python 失败数和错误数均为零；安全符号链接测试不能被跳过而误判安全通过。重点核查真实 Windows 视频识图、DSH 宿主与 B站限流处理。
5. 以上全部满足以后，才考虑正式版本号、Git Tag、npm 和市场发布。当前交付没有修改 `package.json` 版本，也没有执行 Git Push/npm publish。

**安全提醒：** 不要公开上传含 Cookie、私信原文、个人生活数据或密钥的测试完整包。失败 TAP 可先脱敏。
