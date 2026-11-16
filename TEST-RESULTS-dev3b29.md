# 2.8.1-dev.3b.29 · 增量测试与验收说明

## 日志事实

- 2026-11-16 15:10 Windows 追踪记录 6 组短暂可见的伪控制台窗口，与 Ollama 服务 PID 43384 派生的 `ollama.exe` / `llama-server.exe` 关联；不能把这 6 组归因于插件 FFmpeg。Linux 云端无法验证是否消除 Windows 上的 Ollama runner 弹窗。
- DSH 图片验收诊断仍为 `headless_exit_unknown` / `exit=1` / `stderrKind=node_exception`；没有真实 MCP 图片工具回执及模型答案。新版本仅闭集提取安全 Node `ERR_*` 错误码，不读出 stderr 内容。
- 手动视频验收在之前日志中缺少可持久追溯的完成回执。新版本记录匿名阶段、最大 8 分钟看门狗；任务底层仍执行时阻止重复启动。

## 已完成检查

| 检查 | 结果 |
|---|---|
| Node 相关 6 个测试文件 | 30/30 通过，0 失败 |
| Python 相关 3 个测试文件 | 7/7 通过 |
| JS 语法检查（index、管理页、Life 活动、记录器） | 通过 |
| Python 编译检查（视觉相关代码） | 通过 |
| `npm run check:life-architecture` | 通过 |
| `npm run check:video-tool-contract` | 通过 |
| `node selfcheck.mjs` | 通过 |
| `npm pack --dry-run --json` | 通过，672 个文件；包含新记录器 |
| 原始 dev.3b.28 基线 `git apply --check` 和实际回放 | 通过；20 个修改／新增文件逐字节一致 |
| 云端全量 Node 测试 | 按 AGENTS.md 规定未执行 |
| Windows 本机 Ollama 子进程黑窗消除 | 未验证；仍为开放 P0 |
| Windows DSH 真实识图成功 | 未验证；仍为开放 P0 |

## 本版主要变化

1. 本地 Ollama 图片请求由 `keep_alive:0` 改为 `5m`，减少同一模型频繁退出与重新启动（有本地内存使用代价），**不保证首次加载不弹窗**。
2. 手动视频感知调试与 Life 自主看画面使用两个独立的实时活动类型。前者不登记为鱼鱼自己的生活行动。
3. 后台视频验收增加匿名、有限保存的进度记录，插件重启后显示“中断”，并将资料处理与模型真正提供视觉回答区分。
4. Life 行动树只常驻五类行为，真实进行中的行为才展开并动画显示；下方时间线同步提供正在观察的阶段条。
5. DSH 异常仅按闭集保存模块/参数等安全 Node 错误码，不输出堆栈、路径、密钥或模型输入。

## Windows 用户验收步骤

- 完全退出 DSH Desktop，在本机安装 dev.3b.29 包并重启；单纯 Git commit 不会升级正在运行的插件。
- 再运行一次「只读视频感知验收」，确认是否显示阶段、8 分钟超时或模型真实回答，不再无限等待；首次 Ollama 模型加载仍可能由 Ollama 自身弹出控制台。
- 打开行动树，真实 `observe_video` 时应显示「正在看视频画面」；手动 Debug 应显示「主人只读调试」，不要把它当 Life 自主选择。
- 运行 DSH 图片验证并导出新日志，重点看新增 `cliNodeErrorCode`（仅支持安全闭集），若仍为 `unknown` 应记录未知，不能猜具体根因。
- 如果仍出现黑窗，继续提供含 owner PID 的采集 ZIP，特别检查 `ollama.exe`/`llama-server.exe` 及 Python/FFmpeg 不同来源。
