# 2.8.2-dev.33 · 定向测试与交付核验

- **基线**：2.8.2-dev.32（此前源码 ZIP）；**目标**：2.8.2-dev.33；云端 Linux，无 Windows/DSH 实机，也未联网触发真实 B站操作。
- Node 增量测试：**69/69 通过**（视觉验证、4/6/12格 Life 交接、模型 UI、权限、Debug、Whisper 兼容、历史 UI 更新）。
- Python 增量测试：**38/38 通过**（v12 分镜与生成限制、Whisper 语种/缓存/拒绝边界、既有 ASR 调度与音频采样）。
- 已有测试曾发现无 BILI_DUTY_HOME 时缓存落入源码树的风险，已修复并加回归；旧2.8.1版本亮点断言已按当前2.8.2 UI 修正，未改变正式安全门禁。
- 实际已上传的三份识图回执在**离线**验证层复现：2份 `analyzed` 被验证器接受且分别给 Life 2张分镜；1份 `vision_incomplete` 仍不升级为可信视觉证据。
- `node selfcheck.mjs`、上下文检查、视频契约检查、测试治理检查、四张 Life 架构检查、`npm pack --dry-run`：通过。npm 发行预检含 `scripts/download_whisper_model.py`，本轮无发布操作。
- 未完成：Windows/DSH 全量与真实模型、真实 Whisper 缓存复用、相同视频 2B 性能准确率、线上媒体来源、管理员/非管理员系统差异。**正式版发布仍被上述实机验收门禁阻断**。
