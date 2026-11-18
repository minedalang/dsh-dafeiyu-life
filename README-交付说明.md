# 2.8.1-dev.3b.33.21 补丁编码与实时调度日志修复

本版为 `.20` 累计修复，重点是从 `.19` 真实中文路径基线生成标准 Git UTF-8 Patch；`AGENTS.md` 增加严格的路径/编码/回放约束，新增只读 Life 调度快照接口并更新 Windows 导出 BAT。

**推荐 Windows 升级方式**：从 `.19` 使用 `19-to-21-normalized-utf8.patch`；从 `.20` 使用 `20-to-21.patch`。两种 Patch 都要求先在项目根目录执行 `git apply --check`，通过后再 `git apply`。如果有本地未提交修改，先备份并对照 Patch，不要强制覆盖。

**日志导出**：双击 `tools/导出B站日志.bat`，在提示框粘贴当前 DSH 管理中心浏览器 URL（URL 中端口必须是你真实的端口），或 `--status-url` 指定；日志含 `_diagnostics/live-status-snapshot.json` 与 `_diagnostics/live-status-availability.json`。未采集成功则明确记录原因，不会误报调度正常。

这是离线代码测试候选。未运行真实 B站操作、Windows DSH 实机流程、全量云端测试，也未执行 Git Commit/Push 或 npm Publish。
