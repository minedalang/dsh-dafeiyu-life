# 2.8.0 测试执行与历史测试治理

## 为什么默认测试列表缩短

原来的 `run-tests.bat` 把 2.4 至 2.8 的数百个历史断言、版本号和 UI 字符串快照一股脑运行。单批出现一个失败就标红，而且 Windows 下 PowerShell 5.1 将 Node UTF-8 输出解码为本地代码页，导致报错不可读。

现在分为三种**明确命名、互不冒充**的模式：

| 命令 | 目的 | 覆盖范围 |
|---|---|---|
| `run-tests.bat` | 日常当前版本核心回归 | `test/current-core-tests.txt`，Python 关键交易/回执/额度专项，插件自检 |
| `run-tests.bat full` | 发布前完整回归 | 所有根目录内当前仍维护的 Node 测试、全部 Python 测试、插件自检；历史版本专属快照不再充当发布门禁 |
| `run-tests.bat legacy` | 历史发行快照审计 | 单独测试 `test/legacy`；应在当时版本 Git tag 上解释结果 |

PowerShell 可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1 -Mode full`；详细逐条输出设置 `DAFEIYU_TEST_VERBOSE=1`，日常默认只在终端展示各步骤概况与失败名称，详细 TAP/traceback 始终以 UTF-8 存到 `%TEMP%\dsh-bili-scroll-plus-details-*`。

**快速通过不等于全量通过，也不是正式版本可发布证据。** 即便快速通过，发布还必须经过 full、Windows / 真实平台 / 72 小时等验收。完整测试目前还有真实或历史失败，不得通过删除断言、跳过安全检查或回填假回执制造绿色报告。

## 历史测试清理准则

只归档明确固定**旧版发行版本号、旧 README 文案、旧 UI 结构**且不承载当前平台安全约束的测试。具有业务安全价值的老测试即使命名 `v24xx` 也应继续保留。归档测试保留在 `legacy` 模式并可在相应旧版 tag 上运行；不再用固定旧版本断言阻断新版的 full 回归。

可在当前代码中逐项将过时断言改写为验证现有行为（优于删除）；确实无法迁移的单独说明为何不适用于 2.8.0。每次移动应在本文件及 changelog 记录清单和理由。

## Windows 平台差异

- Windows 未开启 Developer Mode、缺少符号链接创建特权时，涉及攻击性 symlink 的安全测试会明确 `SKIP` 而非 `PASS`。完整发布验收需使用具备相应权限的独立 Windows 环境复测；不能替换为普通文件以伪造覆盖。
- 测试应先关闭 SQLite 连接/日志句柄，再删除 `%TEMP%` 的临时文件夹。Python 中 `with sqlite3.connect(...)` **不会**自动关闭连接，必须 `contextlib.closing(...)`。
- UTF-8 输出和 `--test-reporter=tap` 用于准确定位 `not ok` 的单项失败，不再只有 36 批 FAIL 的汇总。
- 运行时勿与正在使用同一测试数据目录的其他测试实例互相覆盖；所有测试默认只应使用临时目录和模拟平台。

## 当前尚未解决的事项

原 Windows 完整日志存在旧版本锁定断言、旧管理界面字符串、主 Session 工具契约、跨平台符号链接权限与 Python 回执模拟接口等混合失败。此次修复了可复现的测试夹具、清理顺序与运行入口；**不声称所有旧版业务断言已修复**。完整审计仍应针对各个 `not ok` 分类修复，尤其账号隔离、Life 唤醒、跨进程锁、外发回执和不可重放行为。
