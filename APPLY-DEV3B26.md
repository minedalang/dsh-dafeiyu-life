# 2.8.1-dev.3b.26 应用说明

## 基线

本补丁以 `2.8.1-dev.3b.25` 源码为唯一基线。不要叠加 dev.3b.24 或更早补丁。

## 应用

在项目根目录执行：

```powershell
git status --short
git -c core.whitespace=cr-at-eol apply --check .\dafeiyu-2.8.1-dev.3b.25-to-dev.3b.26.patch
```

确认检查通过后：

```powershell
git -c core.whitespace=cr-at-eol apply .\dafeiyu-2.8.1-dev.3b.25-to-dev.3b.26.patch
git diff --check
git add -A
git commit -F .\COMMIT-dev3b26.txt
```

如果工作区已有自己的修改，先备份/提交，不要强制应用。

## 本地验证

```powershell
node --test --test-concurrency=2 test/v281-dev3b26-dm-share-card.test.mjs test/v281-dev3b26-video-watch-focus-scope.test.mjs test/v281-dev3b25-bili-share-link.test.mjs test/v281-dev3b25-autonomous-planner-shared-link.test.mjs test/v281-dev3b25-life-dynamic-action-protocol.test.mjs test/v281-dev3b25-life-shared-bili-links.test.mjs test/v281-dev3b25-shared-dynamic-permissions.test.mjs test/v281-dev3b25-window-capture-safe.test.mjs test/v281-dev3b24-dm-contact-recheck.test.mjs test/dm-inbox.test.mjs test/dm-autoreply.test.mjs test/v262-polling-budget-ui.test.mjs
npm run check:life-architecture
npm run check:video-tool-contract
node selfcheck.mjs
npm pack
```

云端不运行全量 Node 测试；全量由用户在 Windows 本地执行。

## 本次 13:40 日志新增修复

修复 `executeWatchVideo` 中局部复查结果在 try/finally 后作用域失效导致的 `focusReview is not defined`。手动视频 Agent 浏览候选及评论成功，不等于执行 `observe_video` 或取得画面回执。

## 黑窗口诊断

新采集 ZIP 包含：
- `process-snapshot.csv`：启动时进程名/PID/父 PID/父进程名
- `process-start-events.csv`：新进程及父进程名称
- `console-window-events.csv`：可见控制台或已知工具进程窗口所属 PID、进程名、父 PID/父进程名、窗口类和可见状态

运行 `tools/capture-intermittent-window.bat 900`。黑窗出现时切回采集器窗口按 Q 提前导出。采集不记录窗口标题、命令行、截图或私信内容。新版以约 40ms 周期采样（Windows PowerShell 5.1 实机待验）；缺少窗口事件不等于根因已排除。

## 重要边界

本版修复私信分享卡片丢链，并增强黑窗归因；**没有宣称黑窗口根因已经修复**。需要新窗口 owner 证据后才能针对 DSH 内部 MCP/下游启动器实施最终修复。好友动态仍由 Life 自主决定是否查看；点赞/评论权限默认关闭并保持独立授权。
