# 2.8.2-dev.30 · 增量测试结果

审计基线：`2.8.2-dev.29`。当前成果为开发候选版，不能据此宣称 `2.8.2` 正式发布条件已满足。

## 实际执行（当前云端环境）

- Node 14 份与视频、Life 决策、模型页面和安全回执直接相关的测试文件：**74/74 通过**、0 失败、0 跳过。
- Python 6 份直接相关专项：`test_v282_dev30_video_focus.py`（2）、`test_v282_dev20_hybrid_preview.py`（6）、`test_v282_dev19_video_recovery_traffic.py`（7）、`test_v282_dev18_official_dynamic_stream.py`（4）、`test_adaptive_video_dev3a3.py`（9）、`test_dev3a2_life_selected_focus.py`（2），合计 **30/30 通过**。历史测试使用 `PYTHONPATH=lib`（与项目测试运行器一致）。
- `node --check index.js`、Python `py_compile` 通过。
- `node selfcheck.mjs`、`npm run check:life-architecture`、`npm run check:video-tool-contract`、`npm run check:context-budget`、`npm run check:test-governance` 通过。
- `npm pack --dry-run --json` 通过；发布清单 **760** 个文件，包含 `scripts/download_whisper_model.py` 和修改后的 `lib/adaptive_video.py`。
- 之前 dev.28/dev.29 包遗漏的 `tools/导出B站日志.bat` 已从用户原始源码压缩包恢复；日志脱敏专项 **2/2 通过**，计入上述 Node 74 项。
- Git Patch 在从 dev.29 复制的干净基线实际通过 `git apply --check` 并执行回放；**1,571 个源码文件逐一 SHA-256 核验一致**。恢复的 Windows `.bat` 脚本以原始 CRLF 精确二进制补丁保存。

## 尚未执行或不能推断

- **未**在 Windows 普通、管理员 PowerShell 执行完整 600+ Node / Python 全量测试。
- **未**在 DSH 用户环境实际下载 B站视频、用 FFmpeg 解码实际 360p 帧或让真实多模态模型判断多段内容。
- **未**通过真实外部网络测量多段 MP4/DASH 并发降级、`-509`、超时、DNS 和额度跨窗口结算。
- M2 音画语义一致性与 M3 十一类上下文完整交付仍需用户端到端验收。

**结论：离线定向质量门禁通过；正式版仍需维护者在目标 Windows/DSH 环境完整验收。**
