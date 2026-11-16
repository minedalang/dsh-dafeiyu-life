# 2.8.1-dev.3b.27 · 增量测试与未完成验收

## 基线与日志

- 源码基线：此前交付的 `dafeiyu-2.8.1-dev.3b.26-source.zip`（不是另一份热修叠加）
- 图片故障日志：`bili-duty-logs-20261116-142640-591.zip`，14:26:29，`preflight=ready`、`mcpImage=not_received`、`providerApi=not_confirmed`、`modelAnswer=not_returned`、`headless_exit_unknown`。
- 黑窗线索：此前 `dafeiyu-window-event-trace-20261116-142125-024.zip`，FFmpeg 与短暂可见 PseudoConsoleWindow 同一进程链；不构成所有黑窗都由 FFmpeg 引起的证明。

## 云端实测（仅相关增量）

| 检查 | 结果 |
| --- | --- |
| Python 与本轮相关视觉/抽帧增量测试 | **52 passed, 9 subtests passed** |
| Node 相关画像/状态/视频契约测试 | **12 passed, 1 skipped, 0 failed** |
| Life architecture | 通过 |
| Video/MCP contract | 通过 |
| `node selfcheck.mjs` | 通过 |
| `npm pack --dry-run --json` | 通过 |
| JS 语法与 Python 编译 | 通过 |
| Patch 原始 ZIP 基线回放 | **16/16 改动文件逐字节一致** |

还有一个更宽的 `v281-dev3a3-adaptive-source-contract.test.mjs` 在这轮组合运行时失败；**单独在未经修改的 dev.3b.26 源码上也会因过期正则 `/if\(visionPlan\.attempt/` 失败**。属于既有测试与当前代码不匹配，不因本版新增。没有修改与本任务无关的旧测试以掩盖失败。

## 必须本机完成

1. Windows `DETACHED_PROCESS` 与 FFmpeg/FFprobe 实际解码成功、无可见黑窗（采集器按 Q 提前停止并导出）。
2. DSH Headless 视觉 MCP 成功初始化并留下真实图片回执、模型最终中文回答及用户人工认可。当前 `exit=1` 具体根因尚未识别；不能声称已修复模型图片输入。
3. 插件安装后验证同步安全、Life 感知不回归；不进行真实 B站自动写入测试。

没有在云端运行全量 Node 测试，没有真实 Windows、B站、DSH/第三方模型端到端测试，也没有发布 npm。
