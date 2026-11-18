# 2.8.1-dev.3b.33.20 · DSH 视觉路由修复离线验证

**基线**：`2.8.1-dev.3b.33.19-code-closure`。**修复版本**：`2.8.1-dev.3b.33.20-vision-debug-route-fix`。

## 确认的代码根因

手动固定图片验收单独创建 DSH Headless 临时受限宿主，生产 Video Agent 启动时创建本轮受限能力；但是管理中心全流程视频感知经过插件内部长驻 Python MCP，此 MCP 环境没有 `BILI_VISION_DSH_ARGV`。`vision_dsh.py` 读取不到该配置会返回 `vision_config_error: DSH 视觉模型执行路由未配置`，与用户错误完全一致。认可图片是另一条测试链，不能自动为长驻 MCP 注入一次性能力。

## 修复验证矩阵

- 单次只读 `bili_preview_vision` MCP 真实启动参数与临时宿主能力传递：通过。
- 新增真实 Node 模拟 MCP 子进程：协议握手、工具调用、实际环境变量交接、结束清理：通过（不调用 B站或真实 DSH）。
- 不存在 DSH 路由 / Windows 临时宿主不可用：拒绝调用而不回退旧 Bridge：通过。
- 错误/无效 MCP 回执/异常：释放 MCP 与宿主资源：通过。
- AI 模型页保存后显著验收提示、认可后的全流程说明、重复保存同路由不清除人工认可：定向静态及契约检查通过。
- 旧启动、原生产 Video Agent 白名单、账号/读取预算、私信及发布门禁未被扩权：有关代码与定向回归检查通过，未做实机证明。

## 测试与打包

- 定向视觉/AI 模型/宿主/Debug/权限测试：**38 通过、1 跳过、0 失败**（其中 1 项因本机缺失 `yaml` 测试依赖而跳过）。
- Life 架构契约：通过（4 张 Mermaid、126 个唯一代码节点）。
- Video/MCP 契约：通过。
- `node selfcheck.mjs`：通过（Host 43 工具、Client 插槽）。
- `node --check index.js lib/management-console.js lib/scoped-dsh-vision-read.mjs`：通过。
- `npm pack --dry-run --ignore-scripts --json`：通过，确认新模块、中文诊断脚本、发布指南被收录。
- `.19 → .20` Git Patch 独立回放，逐文件 SHA-256 对比：**1521 个文件一致**。

## 仍待实机验证

- Windows DSH Desktop 实际版本加载、设置保存后 UX、人工识图认可、真实公开视频采样 JPEG、受限宿主与 DSH 模型最终回答。
- Windows 账户切换、退出/重启时临时宿主停止、与真实 B站 `-509` 预算并行运行。
- 本地 Windows 全量测试，及上游正式发布检查单中未关闭门禁。

不执行真实 B站请求、不公开任何凭据/用户日志、不运行云端全量测试、不自动 Git Commit/Push 或 npm publish。
