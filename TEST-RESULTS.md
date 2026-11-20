# 2.8.2-dev.37 · 离线定向测试和发布门禁

## 变更及来源限制

复核用户 `bili-duty-logs-20261120-215141-551.zip`：21:34主人专项记录了任务结束，旧导出只含任务阶段摘要而没有局部详细失败；此前 Debug JSON 返回 `focused-evidence-not-verified`，不能仅凭3帧推断失败根因。本轮新增未来失败的机器阶段码与脱敏报告，不声称追溯还原了旧失败原因。

## 自动化验证

- Node 相关定向 39/39 通过；新增分层失败、安全导出和行动树专项3项通过。
- Python 定向 27/27 通过；新增局部时长与选帧覆盖专项6项通过。
- `node selfcheck.mjs`、`npm run check:video-tool-contract`、`npm run check:context-budget`、`npm run check:life-architecture`（4张图）、`npm run check:test-governance` 通过。
- `npm pack --dry-run --json` 成功，预检包含 Whisper 模型下载脚本。
- 确认不修改用户现有 `tools/导出B站日志.bat`；本轮不调用真实 B站写入或外发。

## 未验证的发布门禁

- 没有用户 Windows/DSH 环境、真实 FFmpeg 和本地视觉模型，不声称已证明局部原视频成功或看清画面。
- 需要 Windows 15秒、20秒两次主人专项，核对返回的实际独立时间戳、模型完成、证据验证与新 `reports/video-focus-last-diagnostic.json`。
- 需要 Life **真实自主**选择 `focus_video` 并通过端到端交接；主人专项成功不能替代。
- 未跑 Windows full，正式2.8.2仍不放行；未执行 Git commit/push 或 npm publish。
