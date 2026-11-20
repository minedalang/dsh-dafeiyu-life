# 2.8.2-dev.38 · 定向开发测试与发布门禁

- 依据用户本轮 GTA Debug JSON：全局24帧成功，主人选择161秒×15秒；局部 `focus-unavailable`，`decode-or-tool` / `tool-result-unavailable`，未获得有效本轮原视频帧回执，也未显示真实局部拼图。dev.37 错误折叠已丢失原始安全机器码，不能追溯媒体故障具体原因。
- 修正目标：已知 `AdaptiveUnavailable.status` 的受信静态机器码经白名单保留至 UI 与脱敏 `reports/`；本轮未取得可用图片时继续显示失败，不生成假图。局部真实解码成功时拼图 `focus-00.jpg` 优先展示，最多12张局部逐帧图片 `focus-01.jpg`～`focus-12.jpg` 可另行查看。权限、预算和 Life 自主决策未变。
- Node 定向回归：**50/50 通过**（视频局部、证据、Debug、Life、自主预算、视觉图片账号隔离等）；Python 专项：**10/10 通过**（真实图片调试回执、10/15/20/30秒取帧覆盖）。
- `node selfcheck.mjs`、`npm run check:video-tool-contract`、`npm run check:life-architecture`（4张图）、`npm run check:context-budget`、`npm run check:test-governance`、`npm pack --dry-run --json`：**通过**；npm预检762文件。
- dev.37 → dev.38 Patch 经原始 dev.37 回放后再记录文件一致性；原有日志导出 BAT 保持不动。
- **未执行** Windows/DSH 真机原视频 CDN、FFmpeg、Ollama、全量 Node/Python、平台外发或正式发布。真实失败根因仍待新版本下一次原视频尝试回执；2.8.2 正式发布门禁不放行。
