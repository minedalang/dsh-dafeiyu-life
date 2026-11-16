# 2.8.1-dev.3b.26 增量测试报告

## 已通过

- 相关 Node 测试：16 个测试文件，102/102 通过。
- `node --check index.js lib/dm.mjs lib/dm-inbox.mjs lib/dm-contact-recheck.mjs`：通过。
- `npm run check:life-architecture`：通过（4 张 Mermaid、120 个唯一代码节点）。
- `npm run check:video-tool-contract`：通过。
- `node selfcheck.mjs`：通过（host/client 注入与 43 个工具检查）。
- `npm pack --dry-run`：通过，包名 `dsh-dafeiyu-life`，版本 `2.8.1-dev.3b.26`。
- 云端未运行全量 Node 测试，遵守 AGENTS.md。

## 本次新增覆盖

1. `msg_type=7/source=11` 动态分享卡片保留官方动态 URL。
2. 动态卡片无 URL 时，仅从安全 ID 构造官方动态 URL。
3. `source=5` 视频分享生成官方 BV URL；外站 URL 不进入 Life 链接。
4. `msg_type=13/14` 只保留白名单 B站 URL。
5. `msg_type=8` 不再误判为视频分享。
6. 普通 DM 入站与手动遗漏复核都接受动态/网页卡片。
7. 黑窗口采集包含启动进程快照、父进程名、约 40ms 的可见窗口枚举（包括已知工具进程的其他窗口类），且不采集标题/命令行。

8. 修复 `focusReview` 在视觉 try/finally 内声明、在 Life 记忆写入时引用导致的 `ReferenceError`；新增作用域和只读经历语义测试。
9. 手动视频 Agent 页面明确提示：评论核验成功不等于视频画面理解成功。

## 11月16日 13:40 实机日志对照

- 13:36:42 视频 Agent 启动，13:38:07 出现 `focusReview is not defined`，13:39:55 结束（code=0）。候选9、详情9、内容证据5、入选1、评论平台核验1；**没有可证明的 `observe_video` 视觉回执**。
- 13:36:27—13:40:24 原 Windows 采样 578 个进程启动：python 330、conhost 194、OpenConsole 12、FFmpeg 6；`console-window-events.csv` 只有开始时 2 个已存在可见窗口，因此根因仍未知。

## 未完成/限制

- 当前环境没有 Windows PowerShell 5.1，无法实机执行新增采集脚本；只完成静态检查和 Node 契约测试。
- 黑窗口仍未根因修复。旧 trace 只有新进程事件与 2 个初始可见窗口，conhost 数量不等于窗口可见；需要新 `console-window-events.csv` 确认窗口 owner PID。
- DSH MCP SDK 具体版本未知；不能在没有 stdio 兼容测试时改用 pythonw 或替换 MCP transport。
- 真实 B站 `msg_type=7/source=11` 消息 payload 与 Life 自主打开动态需本机验收。
- 本版未执行真实 B站写入、npm 发布或正式 Tag。
