## 2.8.1-dev.3a.4 多信号分镜与弹幕活跃曲线的实现归属

- 新增 `lib/video_heat_signal.py` 的官方 PBP 读取尝试和受限弹幕 XML 时间密度提取、`lib/adaptive_video.py` 的分层窗口/热度加权候选选择及 Pillow 分镜拼图均由本仓库**独立编写**。不保存弹幕内容、用户身份或 UID，也不将观众反应当成作品事实。
- README 使用的 Mermaid 架构和 `docs/architecture/assets/video-danmaku-heat-illustration.svg` 是本项目新编的示意图，曲线为**模拟值**，不来自真实 B站，未复制他人可视化素材。
- `SAOS-3624/dsh-video-storyboard`、`SAOS-3624/dsh-see-now`、`PySceneDetect` 仍仅为设计参考，**没有移植、复制或捆绑源代码**。FFmpeg 仅由用户自行安装，具体许可随其构建版本；Pillow 为原有依赖。此前 `adoresever/bilibili-mcp`、`c1overzz/dsh-bili-scroll` 和 `dsh-fish-memory` 的版权/许可证声明保留不变。

## 2.8.1-dev.3a.3 真实公开视频稀疏感知的第三方声明

- **FFmpeg（可选外部运行程序）**：本项目调用使用者**自行安装**并位于 PATH 的 `ffmpeg` 子进程，读取有严格大小上限的临时本地视频文件。**本补丁没有捆绑、修改、复制或再分发 FFmpeg 源码或可执行文件**。FFmpeg 许可证取决于安装的具体构建配置（可能包含 LGPL/GPL 组件），使用者按其所选发行版的 LICENSE 和相关声明使用。参见 https://ffmpeg.org/legal.html 。
- **PySceneDetect**：仅作候选镜头差异研究的概念参考，**未作为依赖安装，也未移植其代码**。本项目独立实现 2fps、0.5秒粒度下的基础像素变化启发式选择；不声称使用 PySceneDetect 的精确场景边界检测。
- **SAOS-3624/dsh-video-storyboard 与 SAOS-3624/dsh-see-now**：仍仅作为分镜整理、按变化选帧设计方向的参考，未复制或内嵌源码。已有 Pillow、Python 标准库及 `adoresever/bilibili-mcp` 的历史许可证声明保持不变。新增模块必须以本仓库独立编写代码身份列示，不能抹去既有上游版权。

## 2.8.1-dev.3a.2 时间窗复查实现的开源归属

这一批在项目自身的官方 B站 `videoshot` 低清预览采样器与 Life 决策协议基础上新增时间窗查询、缓存隔离及 DSH/Ollama 共用回执。仍然只参考已列明的 `SAOS-3624/dsh-video-storyboard`（按时间定位/分镜复查的设计方向）与 `SAOS-3624/dsh-see-now`（变化驱动选帧的设计方向），**没有复制、改编、捆绑或再分发上述项目源码**。若将来实际集成代码，应再次核对上游仓库对应版本的 LICENSE/NOTICE 并保留版权与改动说明。


# Third-Party Notices

This repository intentionally keeps third-party origins visible. The product name and repository rename do not erase upstream code ancestry.

## c1overzz/dsh-bili-scroll

- Upstream: https://github.com/c1overzz/dsh-bili-scroll
- Relationship: direct upstream / project ancestry
- License: MIT
- Preserved notice: repository root `LICENSE`

The original DSH Bilibili duty/report plugin forms the historical code base from which this project evolved.

## adoresever/bilibili-mcp

- Upstream: https://github.com/adoresever/bilibili-mcp
- Relationship: vendored and modified Python Bilibili MCP foundation
- License: MIT
- Copyright: Copyright (c) 2026 AGI_Ananas
- Preserved license: `vendor/bilibili-mcp/LICENSE`

Local modifications include restricted tool exposure, send-side policy enforcement, quotas, diagnostics, interaction state, meme/sticker support and additional Bilibili workflows.

## Yuuyuko-uu/dsh-fish-memory

The integrated long-term-memory functionality is derived from the design and portions of **dsh-fish-memory**.

- Upstream: https://github.com/Yuuyuko-uu/dsh-fish-memory
- Original author: Yuuyuko-uu / Yuuyuko
- Relationship: design + portions of implementation integrated and modified
- License: MIT
- Preserved license: `vendor/fish-memory/LICENSE`

Upstream contributions include the core concepts and implementation approach for per-session time-stamped fading memories, stable facts, fact keys, replacement semantics, scoped memory tools and context recall.

Changes made by `dsh-dafeiyu-life` include:

- integration into an explicitly selected “大肥鱼主 Session” instead of a separate plugin lifecycle;
- Claude/Anthropic-compatible ASCII model-facing tool-schema property names;
- deterministic ingestion of DaFeiYu's own Bilibili experiences without additional summarization-model calls;
- unified management UI, backup/restore and old `~/.dsh/fish-memory/<session>.json` import;
- isolation from Bilibili credentials, unrelated DSH sessions and stranger-DM content.

This integration is independently maintained and is not an official release of the upstream author.

## Yuuyuko-uu/dsh-bili-subagent

- Reference: https://github.com/Yuuyuko-uu/dsh-bili-subagent
- Relationship: architectural/product inspiration

Its “long-lived AI companion + going out to Bilibili + bringing experiences back home” model materially inspired this project's later “main Session = home / background plugin = body / local ledger = archive” direction.

No source from this repository is intentionally vendored as third-party code in `dsh-dafeiyu-life`; this notice exists to give clear credit for the architectural inspiration.

## Bilibili relation API documentation and existing SDK (v2.4.89)

- SDK already used by this project: [`bilibili-api-python`](https://github.com/Nemo2011/bilibili-api) (version range specified in `vendor/bilibili-mcp/requirements.txt`). Its public `User.modify_relation` and `RelationType` API is reused via the existing dependency, not copied into the plugin.
- Relationship API protocol reference: [pskdje/bilibili-API-collect](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/user/relation.md) for the **single-target** `GET /x/relation?fid=…` status check. No documentation source code has been copied. The new account-safety gates, local SQLite quotas and opt-in Bilibili MCP tools are independently implemented here.
- Existing upstream `c1overzz/dsh-bili-scroll` and `adoresever/bilibili-mcp` notices and their MIT license files remain retained without modification.

## v2.4.91 independently implemented privacy and social extension

The opt-in per-UID friend interest observations, privacy-isolated interaction batching,
local life-event reflection source, and evidence-based social outreach drafts in this
version are implemented by this repository. The **dsh-fish-memory** credit above still
applies to the integrated memory foundation and its reused design/implementation;
this release does not introduce additional vendored code from another project.


## Community contributors

See `CONTRIBUTORS.md` for fixes and implementation ideas adopted from community reports and pull requests.

## v2.4.92 independently implemented emotion and relationship lifecycle

The persistent role-emotion state, bounded mood decay, whitelist-only relationship metadata,
life timeline, interest-stage presentation, and opt-in public-video sharing intentions in this
release are implemented by this repository. They reuse the existing project modules and do not
vendor or copy new third-party source code. Existing MIT notices for `dsh-bili-scroll`,
`bilibili-mcp`, and `dsh-fish-memory`, and the architectural credit for `dsh-bili-subagent`,
remain in force.
## Qwen3-Embedding-0.6B-GGUF（可选下载的模型权重）

- 上游：<https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF>
- 许可：Apache License 2.0（以模型仓库随附许可为准）。
- 本项目不随 npm 包分发模型权重；用户明确启用后才下载固定 revision 的 `Qwen3-Embedding-0.6B-Q8_0.gguf`，或由用户导入同一文件。Runtime Manager 校验固定文件大小与 SHA-256。

## llama.cpp（可选下载的 CPU 推理 Runtime）

- 上游：<https://github.com/ggml-org/llama.cpp>
- 许可：MIT License（以 release 附带的上游许可文件为准）。
- 本项目不随 npm 包分发平台二进制；用户明确启用后，Runtime Manager 下载固定 `b12110` 平台资产并校验 SHA-256。

## 2.8.1-dev.2b：视频感知方案参考与可选本地模型

以下说明将 **设计借鉴** 与 **实际引入的代码/模型制品** 明确区分。本批次为独立实现的本地模型管理器与预览识图路由，**没有复制、修改或嵌入下列视频插件的任何源文件**。

### SAOS-3624/dsh-video-storyboard

- 上游：<https://github.com/SAOS-3624/dsh-video-storyboard>
- 当前仓库许可：Apache License 2.0（以采用的上游版本为准）
- 关系：视频分镜、时间锚点、局部复查的**设计参考**；本版尚未实现完整镜头检测/分镜布局算法，亦未引入其源代码。
- 若后续复制/修改源文件，必须保留相应 Apache-2.0 LICENSE、NOTICE、版权及修改说明。

### SAOS-3624/dsh-see-now

- 上游：<https://github.com/SAOS-3624/dsh-see-now>
- 当前仓库许可：Apache License 2.0（以采用的上游版本为准）
- 关系：变化驱动保留画面、减少重复帧的**设计参考**；本版尚未引入屏幕捕获、HSV 差分算法或其源代码。
- 后续若实际改编其实现，必须附带对应 LICENSE/NOTICE/版权与更改说明。

### Ollama 与可选视觉模型制品

- Ollama：<https://github.com/ollama/ollama>。本版通过用户已安装、仅在本机回环地址可用的 Ollama HTTP API 管理模型；**不内置或再分发 Ollama 二进制**。
- Qwen3.5 4B：<https://ollama.com/library/qwen3.5:4b>；Qwen 模型/权重许可须遵守所下载制品的官方说明。
- MiniCPM-V 4.7 1B：<https://github.com/OpenBMB/MiniCPM-V>；具体模型仓库可能有独立许可与使用条件，应以用户下载的官方制品为准。
- 本项目不将以上模型权重装入 npm 交付包。下载通过用户本地 Ollama 向其模型 Registry 请求；仍须核对运行时兼容、模型 digest 与适用许可。**下载成功不代表实际视觉推理成功**。

## 2.8.1-dev.2c：DSH/Ollama 图片验收与模式收敛

本阶段受限 DSH 图片验收实现、固定自检图片路径校验和 UI 逻辑为本项目独立实现；沿用此前 `adoresever/bilibili-mcp` 的 vendored MCP 基础（参见文件顶部的 MIT 声明）。
`dsh-video-storyboard` 与 `dsh-see-now` 在本阶段仍仅是设计参考，并未复制/嵌入其代码；今后如果真正采用代码，则按对应版本的许可证另行保留完整署名与 NOTICE。

## 2.8.1-dev.3a.1：自适应 B站预览代表帧

本阶段在项目现有 `lib/preview_vision.py` 基础上，由本项目独立编写限制在官方 B站低清预览拼图内部的「时间/活动候选 + 本地缩略图差异去重」实现。继续参考 [dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard) 的分镜和时间锚点方向、[dsh-see-now](https://github.com/SAOS-3624/dsh-see-now) 的变化采样理念，但**没有复制、修改、vendor 或再分发两者源代码**，也尚未实现它们的完整算法。若以后直接移植，须核对当时许可并随附版权、LICENSE/NOTICE 与改动说明。图片处理使用本项目已有的 Pillow 依赖；不下载或捆绑第三方模型权重。


### 2.8.1-dev.3b.1 能力配置参考（非第三方源码复制）

DSH 第三方模型的 `input` / `reasoningEfforts` 语法参考 [DeepSeek Harness 官方模型配置说明](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)；Windows `ollama serve` 的行为参考 [Ollama Windows 官方说明](https://github.com/ollama/ollama/blob/main/docs/windows.mdx)。本批的时间轴投影、管理界面提示、PowerShell 启动包装和 SVG 绘图代码为项目自行实现，未移植这些项目的源代码。

## 2.8.1-dev.3b.2：可选本地 OCR 引擎（不随插件分发）

- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) 是可由用户自行安装的外部 OCR 程序。本项目只按固定参数调用本机已安装的 CLI，对真实视频采样静帧解析机器结果；不捆绑其源码、可执行文件、训练数据或语言包。Tesseract 及其模型/依赖按用户安装的上游许可证执行（项目主代码为 Apache-2.0）。
- 原有本地 [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 模型运行方式未变；本批仅保留已由 Whisper 提供的时间信息，不分发新的模型权重或下载器。
- 画面 OCR、ASR 时间分段与时间轴代码均在本仓库独立编写。先前 dsh-video-storyboard、dsh-see-now 仍仅用于设计参考，没有移植源文件。
