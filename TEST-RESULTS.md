# 2.8.2-dev.39 · 原视频局部 FFmpeg 滤镜修复 · 定向开发测试

- 用户提供 GTA `BV1Smsb6FEb6` 主人专项：`atSeconds=70`、`durationSeconds=30`，全局 24 帧两张图成功；局部 `video_decode_failed`，0 个有效原视频解码回执。日志没有保存 FFmpeg stderr，因此不能排除同时存在其他媒体问题。
- **源码确定性复现**：dev.38 的 `_decode_samples()` 焦点参数 `scale=min(640,iw):min(360,ih)` 内部逗号未转义。使用本机 FFmpeg 7.1.5 和离线合成 MP4，原生产函数抛出 `video_decode_failed`，相同测试文件在修复后成功解码成 640×360 RGB 帧并保留黑边，不上采样。
- Python 相关定向：新增真实 FFmpeg 2/2；dev.30 焦点门禁 2/2；dev.37 时间覆盖 6/6；dev.3b12 调试图像 4/4，**合计 14/14 通过**。
- Node 相关定向：`v282-dev37-focus-diagnostics`、`v282-dev36-owner-focus-acceptance`、`v281-dev3b29-video-debug-life-tree`，**14/14 通过**。
- 代码检查：`python -m py_compile`、`node selfcheck.mjs`、`npm run check:video-tool-contract`、`npm run check:life-architecture`（四张图）、`npm run check:context-budget`、`npm run check:test-governance`、`npm pack --dry-run --json` 全部通过；npm 预检 **762个文件**。
- **发布边界**：仅修 FFmpeg 离线取帧滤镜，不更改 Life 意愿、原视频网络预算、账号校验、限流、原有外发门禁或日志导出 BAT。未执行 Windows/DSH 实际 B站媒体下载、视频局部拼图+Ollama+Life 验证或全量测试；正式 2.8.2 仍待现场验收。

# 2.8.2-dev.38 · 定向开发测试与发布门禁

- 依据用户本轮 GTA Debug JSON：全局24帧成功，主人选择161秒×15秒；局部 `focus-unavailable`，`decode-or-tool` / `tool-result-unavailable`，未获得有效本轮原视频帧回执，也未显示真实局部拼图。dev.37 错误折叠已丢失原始安全机器码，不能追溯媒体故障具体原因。
- 修正目标：已知 `AdaptiveUnavailable.status` 的受信静态机器码经白名单保留至 UI 与脱敏 `reports/`；本轮未取得可用图片时继续显示失败，不生成假图。局部真实解码成功时拼图 `focus-00.jpg` 优先展示，最多12张局部逐帧图片 `focus-01.jpg`～`focus-12.jpg` 可另行查看。权限、预算和 Life 自主决策未变。
- Node 定向回归：**50/50 通过**（视频局部、证据、Debug、Life、自主预算、视觉图片账号隔离等）；Python 专项：**10/10 通过**（真实图片调试回执、10/15/20/30秒取帧覆盖）。
- `node selfcheck.mjs`、`npm run check:video-tool-contract`、`npm run check:life-architecture`（4张图）、`npm run check:context-budget`、`npm run check:test-governance`、`npm pack --dry-run --json`：**通过**；npm预检762文件。
- dev.37 → dev.38 Patch 经原始 dev.37 回放后再记录文件一致性；原有日志导出 BAT 保持不动。
- **未执行** Windows/DSH 真机原视频 CDN、FFmpeg、Ollama、全量 Node/Python、平台外发或正式发布。真实失败根因仍待新版本下一次原视频尝试回执；2.8.2 正式发布门禁不放行。
