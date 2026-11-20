# 2.8.2-dev.28 · 离线实施验证记录

**输入基线：`2.8.2-dev.26`；输出源码：`2.8.2-dev.28`。** 测试环境为 Linux 容器 Node.js 22 和 Python；未接入用户 Windows/DSH 或真实 B站媒体流，也未安装/删除任何真实 Whisper 模型。

## Node.js 受影响定向回归

- 安装器、Issue #11、Whisper 管理与 Life 视频决策组合：**68 / 68 通过**（11 个变更相关测试文件，包含新增模型缓存及三档多候选合同）。
- 用户 README、视觉配置、旧 Life 单候选兼容及新功能测试：**44 / 44 通过**（8 个受影响文件，其中部分与上组重复）；首次有4项 README 历史固定措辞断言失败，已修正真实 README 文案并依法审计迁移过时的 2.8.1 标题断言，重测通过。
- Python 新增 Whisper 实际单文件进度事件/非法型号回归：**2 / 2 通过**（mock 隔离网络，不是实际下载验收）。

## 工程检查

- `node --check index.js`、`lib/autonomous-planner.mjs`、`lib/life-continuation.mjs`、`lib/management-console.js`、`lib/video-exploration-budget.mjs`、`lib/whisper-model-cache.mjs`：PASS。
- `python -m py_compile scripts/download_whisper_model.py`：PASS。
- `node selfcheck.mjs`：PASS（host 43 工具、client 注入自检）。
- `npm run check:video-tool-contract`：PASS。
- `npm run check:context-budget`：PASS（结构检查，不代表11类实际完整性已验收）。
- `npm run check:life-architecture`：PASS（4图、128个源节点）；已执行 `npm run write:life-architecture-view`。
- `npm run check:test-governance`：PASS（600 活跃 Node + 95 活跃 Python，5 历史归档；35项历史测试断言审计记录）。
- `npm pack --dry-run --json`：PASS（包元数据2.8.2-dev.28，758条文件）。
- 已生成新版 `video-perception-current.svg` 并转成 PNG 作本地视觉检查；流程/文字排版没有发现裁切。

## 尚未执行的发布阻断项

- 普通和管理员 Windows PowerShell 全量测试；实际 DSH 管理中心不同浏览器实时进度/日志与安装失败恢复。
- 真实 Hugging Face 权重首次下载、Windows symlink 缓存、自定义模型路径与活跃使用时删除边界；真实音频转写结果。
- 真实 B站 MP4/DASH/FFmpeg 多窗口、DSH/Ollama 多模态模型调用、费用及网络重试累积预算。
- M2 音画语义互证与 M3 11类上下文实际交付仍不能宣称完成。

**结论：新增核心能力及受影响离线定向回归通过，但没有达到正式发布门槛。**
