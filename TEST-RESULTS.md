# 2.8.1-dev.3b.33.23 · DASH 长视频分段感知测试结果

## 范围与版本

基线 `.22-independent-life-hours`，目标 `.23-indexed-dash-long-video`。只读真实视频采样与 DSH 回退原因，未改 Life 自主权、通知/DM/发送、状态迁移、UI 设置、调度时间。

## 当前容器定向验证

- Python 定向 6 文件：**57 passed**，包括额外 18 个子测试（其中 DASH 新增 11 项以及 206、错误 Content-Range、ETag 变化、预算不足、focus、DSH 真实回退证明）。
- Node 定向 3 文件：**12/12 通过**（旧 DURL 证据、v7 DASH、长时间线、伪造网络预算/错误来源拒绝及 OCR/ASR 证据）。
- `python -m py_compile`（4 个改动核心 Python 文件）、`node --check lib/video-evidence-bundle.mjs`：通过。
- `node scripts/check-life-architecture.mjs`：通过（4 Mermaid / 126 代码节点）。
- `node scripts/check-video-tool-contract.mjs`：通过。
- `node selfcheck.mjs`：宿主/客户端自检通过。
- `npm pack --dry-run --ignore-scripts --json`：通过。
- 额外的历史 Node 断言 `test/v281-dev3a4-storyboard-contract.test.mjs` 对 README 中旧版图片引用的断言失败；该断言与 `.23` 解码接线无关，未算为通过，也没有修改 README 加回退役内容以使测试变绿。定向 Node 套件中未包含这个历史测试。

## 证据边界

- 实际 FFmpeg 读取的是**本机合成**碎片化 MP4 `ftyp/moov/SIDX/moof/mdat`；模拟 `206 Partial Content` 的受限 HTTPS CDN，不访问真实 B站，不触发写操作、不进行模型认证。
- 合成视频可从相距较远的四至六个窗口解码并生成分镜，在预算内读取少于媒体总长的片段；短视频旧路径仍被回归。
- API 元数据测试覆盖 30/60/166 分钟和 4 小时硬上限，但**未**使用真实 B站 10/30/45/120 分钟视频做 Windows 端到端视觉验收。
- 新增的公开 DASH 只支持官方 `SegmentBase` 中可解析的平面 `SIDX`、SAP 独立片段，其他 DASH 描述不能伪装为完成真实解码；可能仍降级低清或失败，返回准确代码。
- 不进行仓库禁止的云端全量 Node/Python、外部视频网络访问、真实外发、Git Commit/Push/npm publish。

## Patch 验证

此行用于说明交付要求：Git Patch 使用真实中文路径 UTF-8 编码；需要在 `.22` / `.19` 对应真实旧版源码上完成 `git apply --check`、实际回放、逐文件 SHA256 一致性。具体结果以交付包 `delivery/patch-replay*.txt` 为准，Windows PowerShell 本机仍待验证。
