# 2.8.2-dev.25 · 本批实际执行的离线定向验证

**输入**：用户本轮上传的 `dsh-bili-scroll-plus2 (2).zip`，`package.json` 为 `2.8.2-dev.24`。**输出**：`2.8.2-dev.25`。环境：Linux 容器、Node.js 22.16、Python 3.13，离线模拟视频与只读模型 proof；没有访问真实 B站账户、没有平台写操作。

| 项目 | 结果 | 范围与限制 |
| --- | --- | --- |
| Node 生产 Host / 安全提示 / Life 语义 / 下游视频证据 / 两阶段 | **38/38 PASS** | 5个 Node 测试文件；含真实 Python 生产提示词经 Node Host 验证和伪造越界拒绝 |
| Python videoshot 全片 JSON / pvdata 超3000帧与资源边界 | **6/6 PASS** | 6000格/60张源拼图、4000格 pvdata 二进制模拟数据 |
| Python 分镜兼容 / 历史 preview / DSH proof / 恢复流量 | **20/20 PASS** | 6+4+3+7；本地模拟，非真实服务器 |
| `node --check` | **PASS** | 生产 Host、证据验证及测试脚本 |
| `node selfcheck.mjs` | **PASS** | 假宿主，不触碰真实 DSH 家目录 |
| `npm run check:life-architecture` | **PASS** | 四张 Mermaid 契约；**架构接线未变** |
| `npm run check:video-tool-contract` | **PASS** | 视频工具规范 |
| `npm run check:context-budget` | **PASS** | 仅结构形状，不证明 M3 全部入模 |
| `npm run check:test-governance` | **PASS** | 597 Node / 94 Python 活跃；现有测试文件新增行为断言 |
| `npm pack --dry-run --json` | **PASS** | 752 个预览文件，版本 dev.25 |
| `git apply --check`、实际应用 + 逐文件回放比对 | **PASS** | 原始上传 ZIP 精确基线，不包含用户本机独立未提交变更 |

**测试环境说明：** `test_preview_vision.py` 在未设 `PYTHONPATH=lib` 的独立 Linux 发现模式第一次出现导入错误 `ModuleNotFoundError: video_traffic`；按项目源码的 Python 模块路径设置后原测试 **4/4 PASS**。不是本次生产修复导致的逻辑失败，不将初次错误隐瞒为首次成功。

**正式发布依然阻断**：未运行 Windows 普通或管理员 PowerShell full；未实测 Windows DSH Desktop 与真实 B站 CDN/Range/PBP/FFmpeg、图片模型；M2独立OCR/语义互证、M3十一类实际入模完整性仍未签收。任何实机失败须保留，不能以本地定向通过代替。
