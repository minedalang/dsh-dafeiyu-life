# 2.8.2-dev.31 · 相关离线测试结果

基线：2.8.2-dev.30（用户已有日志导出工具的工作区状态）；当前候选：2.8.2-dev.31。

- Node.js 11 个相关测试文件的定向运行：**62/62 通过**（2026-11-20，本地 Linux 容器环境），包括 Life 多候选、安全预算、图片证据交接、2.8.2 设置/README。非全量 602 个 Node 测试文件。
- Python 变更相关六组专项：**27/27 通过**；其中一项旧加载测试需通过 `PYTHONPATH=lib` 设定正确模块路径，修正启动环境后通过。
- `node selfcheck.mjs`、Life 四张架构图检查、视频工具契约、提示词上下文结构检查、测试治理检查、`npm pack --dry-run --json`：通过；npm 清单包含 Whisper 权重脚本和新 2.8.2 用户指南。
- 此项修复没有执行用户 Windows Ollama/MiniCPM 真正模型推理、真实 B站画面或 Windows full。**时间点合法不证明视觉内容语义一定正确**。
- Git 补丁回放验证及完整哈希比较见交付包 `README-交付说明.md`。不包括 Git commit、push、npm 发布。
